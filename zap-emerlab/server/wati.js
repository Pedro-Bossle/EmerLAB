// Cliente da API WATI (v1 /{tenantId}/api/v1 e v3 /api/ext/v3)
// Docs: https://docs.wati.io/reference/introduction
import { getEnv } from './env.js'

export class WatiError extends Error {
    constructor(message, status = 502, detalhe = null, codigo = 'wati') {
        super(message)
        this.status = status
        this.detalhe = detalhe
        this.codigo = codigo
    }
}

// Traduz recusas comuns da WATI/WhatsApp para um código e uma explicação acionável.
// Não usar padrões largos demais (ex.: só "assign") — mascaravam o erro real.
const RECUSAS = [
    [/24s*h|24-hour|session.*(expir|clos|not.*open)|ticket.*expir|window|outside.*time/i, 'janela_24h',
        'A janela de 24h está fechada: o cliente não escreve há mais de 24 horas. Envie um template aprovado para retomar.'],
    [/invalid.*(whatsapp|number|phone)|not.*valid.*number|validWhatsAppNumber|not.*whatsapp user/i, 'numero_invalido',
        'Número inválido ou sem WhatsApp. Confira o DDI e o DDD.'],
    // antes de "operador": "Could not assign operator because the ticket is Solved" batia em no.*operator
    [/\bticket\s+is\s+solved\b|because\s+the\s+ticket\s+is\s+solved|assign\s+operator.*\bsolved\b|\bsolved\b.*assign/i, 'ticket_resolvido',
        'Na WATI este ticket ainda está como Solved (resolvido). O painel pode já ter reaberto — a atribuição ficou só no painel.'],
    // v3 conversations/{target}/status sem conversa aberta: o bot/atendente fechou ou a janela expirou
    // "Conversation Expired" (PUT status em chat que expirou) também vale como já encerrada
    [/conversation\s+with\s+.*\bnot\s+found\b|\bconversation\s+(has\s+)?expired\b/i, 'conversa_fechada',
        'Na WATI esta conversa já está encerrada (fechada pelo bot, por um atendente ou expirada).'],
    // o número tentado não existe como contato (ex.: a variante com/sem o 9º dígito que a WATI não usa)
    [/\bcontact\s+(was\s+)?not\s+found\b|\bcontact\s+does\s+not\s+exist\b/i, 'contato_inexistente',
        'Este número não existe como contato na WATI (confira se ele está gravado lá com ou sem o 9º dígito).'],
    [/operator.*(not|no).*(found|exist)|user.*(not|no).*found|\bno\s+such\s+operator\b|email.*(not|no).*(found|exist|operator)|not\s+a\s+valid\s+operator|operator\s+does\s+not\s+exist/i, 'operador',
        'Esse e-mail não existe como operador na WATI. A atribuição ficou só no painel.'],
    [/template.*(not.*found|not.*approved|paused|disabled)|parameter/i, 'template',
        'O template foi recusado: verifique se está aprovado e se todas as variáveis foram preenchidas.'],
    [/file|media|size|too large|mime/i, 'arquivo',
        'A WATI recusou o arquivo. Formatos aceitos: imagem, vídeo, áudio, PDF e documentos do Office.'],
    [/blocked|spam/i, 'bloqueado', 'Este contato está bloqueado ou marcado como spam na WATI.'],
]

function comHttp(erro, http) {
    erro.http = http
    return erro
}

function recusa(msgOriginal, status, dados) {
    const texto = String(msgOriginal || '')
    for (const [re, codigo, amigavel] of RECUSAS) {
        if (re.test(texto)) return new WatiError(amigavel, status, { ...dados, original: texto }, codigo)
    }
    return new WatiError(texto ? `A WATI recusou: ${texto}` : 'A WATI recusou a operação.', status, dados, 'wati')
}

// Cache curto por instância: a WATI limita getContacts/getMessages a 10 req / 10 s
// por tenant, e vários atendentes fazem polling ao mesmo tempo.
const cache = new Map()
function cacheGet(key) {
    const hit = cache.get(key)
    if (hit && hit.exp > Date.now()) return hit.valor
    cache.delete(key)
    return undefined
}
function cacheSet(key, valor, ms) {
    if (cache.size > 500) cache.clear()
    cache.set(key, { valor, exp: Date.now() + ms })
}
export function invalidarCache(prefixo) {
    for (const k of cache.keys()) if (k.startsWith(prefixo)) cache.delete(k)
}

function v1Url(caminho, query) {
    const { watiBase, watiTenantId } = getEnv()
    const url = new URL(`${watiBase}/${encodeURIComponent(watiTenantId)}/api/v1/${caminho}`)
    for (const [k, v] of Object.entries(query || {})) {
        if (v === undefined || v === null || v === '') continue
        url.searchParams.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v))
    }
    return url
}

// número do canal WhatsApp só vale para alvos que são telefone (Instagram/Messenger usam ContactId)
const canalWa = (alvo, canal) => (canal && /^[0-9]+$/.test(String(alvo)) ? canal : undefined)

function v3Url(caminho) {
    const { watiBase } = getEnv()
    return new URL(`${watiBase}/api/ext/v3/${caminho}`)
}

// Depois de um 429 a WATI fica 30 s sem ser chamada por esta instância: insistir só prolonga o bloqueio
const PAUSA_LIMITE_MS = 30000
let pausaAte = 0
export const watiEmPausa = () => Date.now() < pausaAte

// Retry-After da WATI (segundos ou data HTTP); sem ele ou com valor estranho, a pausa padrão. Teto de 5 min.
function esperaDoLimite(cabecalho) {
    const v = String(cabecalho || '').trim()
    if (!v) return PAUSA_LIMITE_MS
    const ms = /^\d+(\.\d+)?$/.test(v) ? Number(v) * 1000 : new Date(v).getTime() - Date.now()
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 5 * 60 * 1000) : PAUSA_LIMITE_MS
}

async function chamar(url, { method = 'GET', body, headers, raw = false } = {}) {
    if (watiEmPausa()) throw new WatiError('A WATI limitou as requisições por alguns segundos. Tente de novo já já.', 429, null, 'limite')
    const { watiToken } = getEnv()
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    let resp
    try {
        resp = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${watiToken}`,
            ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
        // WATI lenta não pode segurar a função até o maxDuration: 10 s nas chamadas comuns, 20 s em upload e mídia
        signal: AbortSignal.timeout(isForm || raw ? 20000 : 10000),
        })
    } catch {
        throw new WatiError('Não foi possível falar com a WATI (rede ou tempo esgotado). Tente novamente.', 502, null, 'wati_fora')
    }
    if (raw) {
        if (!resp.ok) throw new WatiError('Mídia indisponível na WATI (pode ter expirado).', resp.status === 404 ? 404 : 502, null, 'midia')
        return resp
    }
    const texto = await resp.text()
    let dados = null
    try {
        dados = texto ? JSON.parse(texto) : null
    } catch {
        dados = { info: texto }
    }
    if (resp.status === 401) throw new WatiError('O token da WATI é inválido ou expirou. Avise o administrador (WATI_API_TOKEN).', 502, null, 'token')
    if (resp.status === 403) throw new WatiError('O token da WATI não tem permissão para esta ação (escopo ou plano).', 502, null, 'permissao')
    if (resp.status === 429) pausaAte = Date.now() + esperaDoLimite(resp.headers.get('retry-after'))
    if (resp.status === 429) throw new WatiError('A WATI limitou as requisições por alguns segundos. Tente de novo já já.', 429, null, 'limite')
    if (resp.status >= 500) throw new WatiError('A WATI está instável no momento. Tente novamente em instantes.', 502, dados, 'wati_fora')
    // http: o status real. Um 400 de HTTP é recusa antes de aceitar; já um 200 com result=false pode ter saído
    if (!resp.ok) throw comHttp(recusa(dados?.info || dados?.message || dados?.error?.message, 400, dados), resp.status)
    // v1 pode responder 200 com { result: false, info }. validWhatsAppNumber=false com result=true é envio aceito
    // (sendTemplateMessage devolve os dois campos): tratar como erro fazia o painel repetir e mandar dois templates
    const invalido = dados?.validWhatsAppNumber === false && dados?.result !== true
    if (dados && (dados.result === false || dados.ok === false || invalido)) {
        throw comHttp(recusa(dados.info || dados.error?.message || (invalido ? 'invalid whatsapp number' : ''), 400, dados), resp.status)
    }
    return dados
}

// `nome` busca no nome e no telefone; `atributo` filtra por atributo ({ name, value }, operador "contain" da WATI)
export async function listarContatos({ pagina = 1, tamanho = 100, nome, atributo } = {}) {
    const filtro = atributo ? [{ name: atributo.name, operator: 'contain', value: atributo.value }] : undefined
    const key = `contatos:${pagina}:${tamanho}:${nome || ''}:${filtro ? JSON.stringify(filtro) : ''}`
    const hit = cacheGet(key)
    if (hit) return hit
    const dados = await chamar(v1Url('getContacts', { pageSize: tamanho, pageNumber: pagina, name: nome, attribute: filtro }))
    const r = { contatos: dados?.contact_list || [], total: dados?.link?.total ?? null }
    cacheSet(key, r, 30000)
    return r
}

// Operadores da conta (nome, e-mail, papéis) — usado para importar os usuários
export async function listarOperadores() {
    const dados = await chamar(v1Url('operators'))
    return Array.isArray(dados?.result) ? dados.result : []
}

export async function listarMensagens(waId, { pagina = 1, tamanho = 50 } = {}) {
    const key = `msgs:${waId}:${pagina}:${tamanho}`
    const hit = cacheGet(key)
    if (hit) return hit
    const { watiChannel } = getEnv()
    const dados = await chamar(
        v1Url(`getMessages/${encodeURIComponent(waId)}`, { pageSize: tamanho, pageNumber: pagina, channelPhoneNumber: canalWa(waId, watiChannel) }),
    )
    const items = dados?.messages?.items || dados?.messages || []
    const r = { mensagens: Array.isArray(items) ? items : [], temMais: Boolean(dados?.link?.nextPage) }
    cacheSet(key, r, 3000)
    return r
}

export async function enviarTexto(waId, texto, replyContextId) {
    const { watiChannel } = getEnv()
    const dados = await chamar(
        v1Url(`sendSessionMessage/${encodeURIComponent(waId)}`, {
            messageText: texto,
            replyContextId,
            channelPhoneNumber: canalWa(waId, watiChannel),
        }),
        { method: 'POST' },
    )
    invalidarCache(`msgs:${waId}:`)
    return dados?.message || null
}

export async function enviarArquivo(waId, { buffer, nomeArquivo, mime, legenda }) {
    const { watiChannel } = getEnv()
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), nomeArquivo || 'arquivo')
    const dados = await chamar(
        v1Url(`sendSessionFile/${encodeURIComponent(waId)}`, { caption: legenda, channelPhoneNumber: canalWa(waId, watiChannel) }),
        { method: 'POST', body: form },
    )
    invalidarCache(`msgs:${waId}:`)
    return dados?.message || null
}

export async function baixarMidia(nomeArquivo) {
    return chamar(v1Url('getMedia', { fileName: nomeArquivo }), { raw: true })
}

/** Resolve o e-mail exato do operador na WATI (a API é sensível a casing / espaços). */
async function emailOperadorWati(email) {
    const desejado = String(email || '').trim().toLowerCase()
    if (!desejado) return null
    try {
        const ops = await listarOperadores()
        // lista vazia/indisponível: não bloqueia — tenta o assign com o e-mail informado
        if (!ops.length) return desejado
        const match = ops.find((o) => String(o.email || '').trim().toLowerCase() === desejado)
        if (!match) {
            throw new WatiError(
                'Esse e-mail não existe como operador na WATI. A atribuição ficou só no painel.',
                400,
                { email: desejado },
                'operador',
            )
        }
        return String(match.email).trim()
    } catch (e) {
        if (e instanceof WatiError && e.codigo === 'operador') throw e
        return desejado
    }
}

export async function atribuirAtendente(waId, email) {
    const { watiChannel } = getEnv()
    // sem e-mail = soltar para o Bot (comportamento documentado da WATI)
    const emailFinal = email ? await emailOperadorWati(email) : undefined
    const url = v1Url('assignOperator', { target: waId, email: emailFinal, channelPhoneNumber: canalWa(waId, watiChannel) })
    try {
        return await chamar(url, { method: 'POST' })
    } catch (e) {
        // Painel reabre localmente quando o cliente escreve, mas a WATI pode continuar Solved —
        // nesse caso reabre o ticket e tenta atribuir de novo.
        if (!(e instanceof WatiError) || e.codigo !== 'ticket_resolvido') throw e
        await atualizarStatus(waId, 'aberta')
        return chamar(url, { method: 'POST' })
    }
}

// Atendente pela v3 (PUT conversations/{target}/operator). target = ConversationId ou telefone;
// sem e-mail a conversa volta para o bot (documentado).
export async function atribuirAtendenteV3(target, email) {
    const emailFinal = email ? await emailOperadorWati(email) : null
    return chamar(v3Url(`conversations/${encodeURIComponent(target)}/operator`), { method: 'PUT', body: { assignee_email: emailFinal } })
}

// Equipe da conversa pela v3 (PUT contacts/teams): o v1 assignTeam responde 403 para este token (só no plano Pro).
// target aceita telefone ou ContactId; substitui as equipes que o contato já tinha.
export async function atribuirEquipe(waId, equipes) {
    invalidarCache(`contatos:detalhe:${waId}`)
    return chamar(v3Url('contacts/teams'), { method: 'PUT', body: { target: String(waId), teams: equipes } })
}

// Ficha do contato na WATI (v3): atributos personalizados, segmentos, opt-in…
export async function detalheContato(alvo) {
    const key = `contatos:detalhe:${alvo}`
    const hit = cacheGet(key)
    if (hit) return hit
    const dados = await chamar(v3Url(`contacts/${encodeURIComponent(alvo)}`))
    cacheSet(key, dados, 30000)
    return dados
}

// A API não permite mudar o nome do contato, só os atributos personalizados
export async function atualizarAtributos(alvo, atributos) {
    invalidarCache('contatos:')
    return chamar(v3Url('contacts'), {
        method: 'PUT',
        body: { contacts: [{ target: alvo, customParams: atributos.map(({ name, value }) => ({ name, value: String(value ?? '') })) }] },
    })
}

// Tags da conversa (v3). Adicionar só aplica tag que já existe na WATI: não cria a definição.
// Não há rota documentada para LER as tags de uma conversa, então a sincronização é só painel → WATI.
export async function adicionarTag(alvo, tag) {
    return chamar(v3Url(`conversations/${encodeURIComponent(alvo)}/tags`), { method: 'POST', body: { tagName: tag } })
}

export async function removerTag(alvo, tag) {
    return chamar(v3Url(`conversations/${encodeURIComponent(alvo)}/tags/${encodeURIComponent(tag)}`), { method: 'DELETE' })
}

/** Extrai nomes de tag de respostas heterogêneas da WATI. */
function nomesDeTags(dados) {
    const bruto = dados?.tagList || dados?.tags || dados?.data || dados?.result || dados
    const lista = Array.isArray(bruto) ? bruto : Array.isArray(bruto?.items) ? bruto.items : []
    const nomes = []
    for (const item of lista) {
        const n = typeof item === 'string' ? item : item?.tagName || item?.name || item?.tag || item?.title
        const t = String(n || '').trim()
        if (t) nomes.push(t)
    }
    return nomes
}

/**
 * Tenta listar as tags cadastradas na conta WATI (não documentado de forma estável).
 * Se a conta/plano não expuser a rota, devolve [] sem lançar — o painel completa com o histórico local.
 */
export async function listarTags() {
    const hit = cacheGet('tags:catalogo')
    if (hit) return hit
    // POST /api/v1/tags (paginado) é o que responde hoje; getTags e v3/tags dão 404 nesta conta
    const tentativas = [
        () => chamar(v1Url('tags'), { method: 'POST', body: { pageSize: 500, pageNumber: 1 } }),
        () => chamar(v1Url('tags/list')),
        () => chamar(v1Url('getTags')),
    ]
    for (const tentativa of tentativas) {
        try {
            const nomes = nomesDeTags(await tentativa())
            if (nomes.length) {
                cacheSet('tags:catalogo', nomes, 5 * 60 * 1000)
                return nomes
            }
        } catch {
            /* próxima tentativa */
        }
    }
    cacheSet('tags:catalogo', [], 60 * 1000)
    return []
}

/** Após sync bem-sucedido, invalida o catálogo para a próxima leitura pegar tags novas. */
export function invalidarCacheTags() {
    invalidarCache('tags:')
}

const STATUS_WATI = { aberta: 'open', pendente: 'pending', resolvida: 'solved', bloqueada: 'block' }
export async function atualizarStatus(waId, status) {
    const novo = STATUS_WATI[status]
    if (!novo) throw new WatiError('Status inválido.', 400)
    return chamar(v3Url(`conversations/${encodeURIComponent(waId)}/status`), { method: 'PUT', body: { new_status: novo } })
}

/** Texto de botões do template (URL dinâmica costuma trazer {{1}} / {{nome}}). */
function textoBotoesTemplate(t) {
    const botoes = t?.buttons || t?.buttonsOriginal || t?.localizableButtons || []
    if (!Array.isArray(botoes) || !botoes.length) return ''
    return botoes
        .map((b) =>
            [b?.text, b?.parameter, b?.url, b?.phone_number, b?.example, ...(Array.isArray(b?.example) ? b.example : [])]
                .filter(Boolean)
                .map(String)
                .join(' '),
        )
        .join('\n')
}

export async function listarTemplates() {
    const hit = cacheGet('templates')
    if (hit) return hit
    const { watiChannel } = getEnv()
    const dados = await chamar(v1Url('getMessageTemplates', { pageSize: 200, pageNumber: 1, channelPhoneNumber: watiChannel || undefined }))
    const lista = (dados?.messageTemplates || [])
        .filter((t) => String(t.status || '').toUpperCase() === 'APPROVED')
        .map((t) => ({
            nome: t.elementName,
            categoria: t.category,
            idioma: t.language?.value || t.language?.key || t.language || '',
            corpo: t.bodyOriginal || t.body || '',
            // headerOriginal / textOriginal: placeholders; header.text às vezes já vem “resolvido”
            cabecalho: t.headerOriginal || t.header?.textOriginal || t.header?.text || '',
            rodape: t.footerOriginal || t.footer || '',
            botoes: textoBotoesTemplate(t),
        }))
    cacheSet('templates', lista, 5 * 60 * 1000)
    return lista
}

export async function enviarTemplate(waId, nomeTemplate, parametros) {
    const { watiChannel } = getEnv()
    if (!watiChannel) throw new WatiError('Envio de templates desativado: falta WATI_CHANNEL_NUMBER no .env.', 400, null, 'config')
    const dados = await chamar(v1Url('sendTemplateMessage', { whatsappNumber: waId }), {
        method: 'POST',
        body: {
            template_name: nomeTemplate,
            broadcast_name: `zap_emerlab_${Date.now()}`,
            channel_number: watiChannel,
            // a WATI exige a ordem da numeração do template ({{1}}, {{2}}…); nomeados vêm depois, na ordem recebida
            parameters: Object.entries(parametros || {})
                .map(([name, value], i) => ({ name, value: String(value ?? ''), i }))
                .sort((a, b) => {
                    const na = /^\d+$/.test(a.name)
                    const nb = /^\d+$/.test(b.name)
                    if (na && nb) return Number(a.name) - Number(b.name)
                    if (na !== nb) return na ? -1 : 1
                    return a.i - b.i
                })
                .map(({ name, value }) => ({ name, value })),
        },
    })
    invalidarCache(`msgs:${waId}:`)
    return dados
}

// ---------- multicanal (v3) ----------

const CANAIS_V3 = { whatsapp: 'whatsapp', instagram: 'instagram', messenger: 'messenger' }

// Canais conectados na conta (WhatsApp, Instagram, Messenger)
export async function listarCanais() {
    const hit = cacheGet('canais')
    if (hit) return hit
    let canais = []
    try {
        const url = v3Url('channels')
        url.searchParams.set('page_number', '1')
        url.searchParams.set('page_size', '100')
        const dados = await chamar(url)
        canais = (dados?.channels || [])
            .filter((c) => c.enabled !== false)
            .map((c) => ({ id: c.id, nome: c.name, tipo: String(c.channel || '').toLowerCase(), plataformaId: c.platform_id }))
            .filter((c) => CANAIS_V3[c.tipo])
    } catch (e) {
        // token sem escopo v3 ou plano sem multicanal: segue só com WhatsApp
        canais = [{ id: 'whatsapp', nome: 'WhatsApp', tipo: 'whatsapp', erro: e.message }]
    }
    if (!canais.some((c) => c.tipo === 'whatsapp')) canais.unshift({ id: 'whatsapp', nome: 'WhatsApp', tipo: 'whatsapp' })
    cacheSet('canais', canais, 10 * 60 * 1000)
    return canais
}

// Contatos de Instagram/Messenger (v3 traz channel_type); até 3 páginas de 100
export async function listarContatosCanal(canal) {
    const key = `contatos-canal:${canal}`
    const hit = cacheGet(key)
    if (hit) return hit
    const todos = []
    for (let pagina = 1; pagina <= 3; pagina++) {
        const url = v3Url('contacts')
        url.searchParams.set('page_number', String(pagina))
        url.searchParams.set('page_size', '100')
        const dados = await chamar(url)
        const lista = dados?.contact_list || []
        todos.push(...lista)
        if (lista.length < 100) break
    }
    const r = todos.filter((c) => String(c.channel_type || '').toLowerCase() === canal)
    cacheSet(key, r, 8000)
    return r
}
