// Roteador único da API do painel (usado pela função Vercel e pelo servidor de dev)
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { getEnv, envFaltando } from './env.js'
import { hashSenha, conferirSenha, criarToken, lerToken, compararSeguro, segredoAleatorio, impressao } from './crypto.js'
import { db, ok, DbError, buscarUsuarioPorEmail, buscarUsuarioPorId, idsDepartamentos } from './db.js'
import * as wati from './wati.js'
import { emailConfigurado, enviarEmail, montarEmailConvite } from './email.js'
import { municipiosPorUf } from './ibge.js'
import { lerRegras, codigosServicos, erroMarcaServicos, temMarcaServicos, MARCA_SERVICOS, temMarcaCredenciados } from '../src/regras.js'
import { catalogoProcedimentos, credenciadosNaCidade, servicosNaCidade } from './quemRealiza.js'
import { preencherVariaveis } from '../src/variaveis.js'
import { normalizarWaId, variantesWaId } from '../src/util.js'

const COOKIE = 'zap_sess'
const ADMIN_ENV_ID = 'admin-env'
const MAX_ARQUIVO = 3 * 1024 * 1024 // limite de corpo da Vercel (~4,5 MB) com base64
const CONVITE_DIAS = 7
// senha_hash de quem ainda não aceitou o convite: não é scrypt, então nenhum login confere
const PREFIXO_CONVITE = 'convite$'
// importação de atribuições: cada contato custa uma chamada getMessages; 40 por lote, 4 em paralelo (~10 s por lote)
const LOTE_ATRIBUICOES = 40
const PARALELO_ATRIBUICOES = 4
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

class HttpError extends Error {
    constructor(status, message, codigo) {
        super(message)
        this.status = status
        this.codigo = codigo
    }
}

// ---------- utilidades HTTP ----------

function enviar(res, status, corpo, headers = {}) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    res.end(JSON.stringify(corpo ?? {}))
}

async function lerCorpo(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
    let raw = req.body
    if (raw == null) {
        const partes = []
        for await (const p of req) partes.push(p)
        raw = Buffer.concat(partes)
    }
    const texto = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    if (!texto) return {}
    try {
        return JSON.parse(texto)
    } catch {
        throw new HttpError(400, 'JSON inválido.')
    }
}

function lerCookies(req) {
    const out = {}
    for (const parte of String(req.headers.cookie || '').split(';')) {
        const i = parte.indexOf('=')
        if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim())
    }
    return out
}

function cookieSessao(req, valor, maxAgeSeg) {
    const https = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1'
    return [`${COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`, https ? 'Secure' : ''].filter(Boolean).join('; ')
}

function ipDe(req) {
    return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim()
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '')

// Identificador de conversa: WhatsApp = número (só dígitos); Instagram/Messenger = "ig:<contactId>" / "ms:<contactId>"
const PREFIXO_CANAL = { instagram: 'ig', messenger: 'ms' }
const CANAL_PREFIXO = { ig: 'instagram', ms: 'messenger' }

function lerIdConversa(bruto) {
    const m = String(bruto || '').match(/^(ig|ms):([A-Za-z0-9_-]{6,64})$/)
    if (m) return { id: m[0], canal: CANAL_PREFIXO[m[1]], alvo: m[2] }
    const d = normalizarWaId(bruto)
    if (d.length < 8 || d.length > 15) throw new HttpError(400, 'Conversa inválida.', 'requisicao')
    return { id: d, canal: 'whatsapp', alvo: d }
}

// alvo aceito pelos endpoints v1 da WATI (número ou ContactId)
const alvoWati = (id) => lerIdConversa(id).alvo
const canalDe = (id) => lerIdConversa(id).canal

// Qual variante do número a WATI aceitou nesta instância (evita repetir tentativa a cada envio)
const alvoWatiOk = new Map()

/** getMessages: tenta com/sem 9º dígito até achar histórico (ou esgotar variantes). */
async function listarMensagensWati(waId, opts = {}) {
    const preferido = alvoWatiOk.get(normalizarWaId(waId))
    const ordem = preferido ? [preferido, ...variantesWaId(waId).filter((v) => v !== preferido)] : variantesWaId(waId)
    let vazio = { mensagens: [], temMais: false }
    let ultimoErro = null
    for (const alvo of ordem) {
        try {
            const r = await wati.listarMensagens(alvo, opts)
            const itens = r.mensagens || []
            if (itens.length) {
                alvoWatiOk.set(normalizarWaId(waId), alvo)
                return { ...r, mensagens: itens, alvoUsado: alvo }
            }
            vazio = { ...r, mensagens: itens, alvoUsado: alvo }
        } catch (e) {
            ultimoErro = e
            if (!(e instanceof wati.WatiError && (e.status === 400 || e.status === 404 || e.codigo === 'numero_invalido'))) throw e
        }
    }
    if (ultimoErro && !vazio.alvoUsado) throw ultimoErro
    return vazio
}

/** Envio/atribuir: usa a variante que já funcionou; senão tenta todas. */
async function comAlvoWati(waId, fn) {
    const preferido = alvoWatiOk.get(normalizarWaId(waId))
    const ordem = preferido ? [preferido, ...variantesWaId(waId).filter((v) => v !== preferido)] : variantesWaId(waId)
    let ultimoErro = null
    for (const alvo of ordem) {
        try {
            const r = await fn(alvo)
            alvoWatiOk.set(normalizarWaId(waId), alvo)
            return r
        } catch (e) {
            ultimoErro = e
            if (!(e instanceof wati.WatiError && (e.status === 400 || e.status === 404 || e.codigo === 'numero_invalido'))) throw e
        }
    }
    throw ultimoErro || new wati.WatiError('Número inválido ou sem WhatsApp. Confira o DDI e o DDD.', 400, null, 'numero_invalido')
}

// ---------- limite de tentativas de login ----------
// No banco (zap_registrar_tentativa_login): vale para todas as instâncias da Vercel, que não dividem memória.
// O Map é só a reserva se o banco não responder.

const JANELA_LOGIN_SEG = 15 * 60
const MAX_TENTATIVAS_LOGIN = 10
const tentativas = new Map()
async function checarLimiteLogin(ip) {
    const r = await db().rpc('zap_registrar_tentativa_login', { p_chave: `login:${ip}`, p_janela_seg: JANELA_LOGIN_SEG })
    let n = typeof r.data === 'number' && !r.error ? r.data : null
    if (n === null) {
        const agora = Date.now()
        const t = tentativas.get(ip)
        if (!t || t.reset < agora) tentativas.set(ip, { n: 1, reset: agora + JANELA_LOGIN_SEG * 1000 })
        else t.n += 1
        n = tentativas.get(ip).n
    }
    if (n > MAX_TENTATIVAS_LOGIN) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.')
}

async function limparTentativasLogin(ip) {
    tentativas.delete(ip)
    await db().from('zap_login_tentativas').delete().eq('chave', `login:${ip}`)
}

// ---------- sessão / permissões ----------

async function usuarioDaSessao(req) {
    const env = getEnv()
    const payload = lerToken(lerCookies(req)[COOKIE], env.sessionSecret)
    if (!payload) throw new HttpError(401, 'Sessão expirada. Entre novamente.')
    if (payload.uid === ADMIN_ENV_ID) {
        if (!env.adminEmail || payload.email !== env.adminEmail) throw new HttpError(401, 'Sessão inválida.')
        return { id: ADMIN_ENV_ID, nome: env.adminNome, email: env.adminEmail, papel: 'admin', departamentos: [], fixo: true, admin: true }
    }
    const u = await buscarUsuarioPorId(payload.uid)
    if (!u || !u.ativo) throw new HttpError(401, 'Usuário desativado.')
    // sessão amarrada à senha (pv): trocou a senha, as sessões abertas em outros lugares caem
    if (payload.pv && payload.pv !== impressao(u.senha_hash)) throw new HttpError(401, 'Sua senha foi alterada. Entre novamente.')
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, departamentos: idsDepartamentos(u) }
}

function exigirAdmin(usuario) {
    if (usuario.papel !== 'admin') throw new HttpError(403, 'Apenas administradores.')
}

function mesmoEmail(a, b) {
    return Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

function podeVerConversa(usuario, meta) {
    if (usuario.papel === 'admin') return true
    if (meta?.atendente_email && mesmoEmail(meta.atendente_email, usuario.email)) return true
    // fila do setor: sem atendente + departamento do qual o usuário faz parte
    if (!meta?.atendente_email && meta?.departamento_id) {
        return usuario.departamentos.includes(meta.departamento_id)
    }
    if (!meta?.departamento_id) return getEnv().atendenteVeSemDepto
    // atribuída a outro, mas no meu departamento
    return usuario.departamentos.includes(meta.departamento_id)
}

async function metaConversa(waId) {
    return ok(await db().from('zap_conversas').select('*').eq('wa_id', waId).maybeSingle())
}

async function exigirConversa(usuario, waId) {
    const meta = await metaConversa(waId)
    if (podeVerConversa(usuario, meta)) return meta
    // sem atendente (ou ainda sem registro): qualquer um pode abrir para Assumir / iniciar contato
    if (!meta?.atendente_email) return meta
    throw new HttpError(403, 'Esta conversa foi transferida para outro departamento e saiu da sua fila.', 'outro_departamento')
}

async function salvarMeta(waId, campos) {
    ok(
        await db()
            .from('zap_conversas')
            .upsert({ wa_id: waId, ...campos, atualizado_em: new Date().toISOString() }, { onConflict: 'wa_id' }),
    )
}

// Entrada por anúncio (Click-to-WhatsApp): a mensagem do cliente que veio do anúncio traz messageReferral
// (ctwaClid, título, link). Guarda o mais recente na conversa para a pill "Tráfego".
function anuncioDe(itens) {
    const r = [...itens]
        .filter((m) => !m.owner && (m.messageReferral?.ctwaClid || m.messageReferral?.sourceId))
        .sort((a, b) => msData(emDaMensagemWati(b)) - msData(emDaMensagemWati(a)))[0]
    if (!r) return null
    const ref = r.messageReferral
    return {
        titulo: String(ref.headline || '').slice(0, 120) || null,
        texto: String(ref.body || '').slice(0, 200) || null,
        url: ref.url || ref.sourceUrl || null,
        id: ref.sourceId || null,
        em: emDaMensagemWati(r),
    }
}

// só grava anúncio novo; sem a coluna anuncio (supabase/schema.sql) não faz nada, para não quebrar lista nem chat
async function registrarAnuncio(waId, anuncio, atual) {
    if (!anuncio || (atual && atual.em === anuncio.em)) return false
    const r = await db().from('zap_conversas').upsert({ wa_id: waId, anuncio }, { onConflict: 'wa_id' })
    return !r.error
}

// Mensagem nossa feita por pessoa (atendente na WATI ou no painel), não pelo bot: o bot aparece como "Bot"
// (operatorName) e sem e-mail. Usado no filtro "Não respondidas", que como na WATI ignora respostas do bot.
function respostaHumanaWati(operador, email) {
    if (email && !/^api-token-user\./i.test(String(email))) return true
    const nome = String(operador || '').trim()
    return Boolean(nome) && !/^bot(\s|$)/i.test(nome) && !/^api\s*token/i.test(nome)
}

// "Não respondidas": o cliente escreveu depois da última resposta humana (sem resposta humana ainda = esperando).
// Sem a hora do cliente, vale a última mensagem ser dele.
function aguardaHumano(meta, ultimaEm) {
    if (!meta || meta.status === 'resolvida') return false
    const cliente = msData(meta.ultima_cliente_em) || (meta.ultima_msg_minha === false ? msData(ultimaEm) : 0)
    if (!cliente) return false
    return cliente > msData(meta.ultima_humana_em) + FOLGA_MS
}

// Pessoas do painel para as menções nas notas (@Ana, @ana.souza, @ana@emerdog.com.br), guardadas por 5 min
let pessoasCache = null
async function pessoasDoPainel() {
    if (pessoasCache && Date.now() - pessoasCache.em < 5 * 60 * 1000) return pessoasCache.lista
    const env = getEnv()
    const r = await db().from('zap_usuarios').select('nome, email').eq('ativo', true)
    const lista = [...(r.data || []), ...(env.adminEmail ? [{ nome: env.adminNome || '', email: env.adminEmail }] : [])]
        .filter((p) => p.email)
        .map((p) => ({ email: String(p.email).toLowerCase(), apelidos: apelidosDe(p) }))
    pessoasCache = { em: Date.now(), lista }
    return lista
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
function apelidosDe(p) {
    const email = String(p.email).toLowerCase()
    const primeiro = semAcento(String(p.nome || '').trim().split(/\s+/)[0])
    return new Set([email, email.split('@')[0], primeiro].filter((x) => x && x.length >= 2))
}

/** E-mails das pessoas citadas com @ nas notas da conversa. */
function mencionadosNasNotas(notas, pessoas) {
    const texto = semAcento(notas)
    if (!texto.includes('@') || !pessoas?.length) return []
    const citados = new Set([...texto.matchAll(/@([\p{L}0-9._-]+(?:@[a-z0-9.-]+)?)/gu)].map((m) => m[1].replace(/[.,;:!?]+$/, '')))
    return pessoas.filter((p) => [...citados].some((c) => p.apelidos.has(c))).map((p) => p.email)
}

// ---------- normalização ----------

// Templates/broadcasts da WATI muitas vezes vêm sem owner=true; ainda assim são envio nosso
const EVENTOS_ENVIADOS = new Set([
    'broadcastMessage',
    'templateMessageSent',
    'templateMessageSent_v2',
    'sessionMessageSent',
    'sessionMessageSent_v2',
])

// Documento recebido: o WhatsApp do cliente manda o nome original no texto ("Comprovante_27-10.pdf")
const PARECE_NOME_ARQUIVO = /^[^\n\\/]{1,180}\.[a-z0-9]{2,5}$/i
const extensao = (nome) => (String(nome || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase()
const semBarraInicial = (c) => String(c || '').replace(/^\/+/, '')

// Envios via API da WATI vêm com operatorName "API Token 10265430" — não é um atendente
function nomeOperadorUtil(nome, email) {
    const n = String(nome || '').trim()
    if (n && !/^api\s*token\b/i.test(n)) return n
    const e = String(email || '').trim()
    if (e && !/^api\s*token\b/i.test(e)) return e
    return null
}

function normalizarMensagem(m) {
    const evento = m.eventType || 'message'
    // WATI manda a frase da pill em eventDescription; em alguns tipos também em text/finalText
    const descricao = m.eventDescription || m.description || null
    const textoBruto = m.text ?? m.finalText ?? ''
    const tipo = String(m.type || 'text').toLowerCase()
    const minha =
        Boolean(m.owner) || EVENTOS_ENVIADOS.has(evento) || tipo === 'template' || /^templateMessage/i.test(evento)
    // replyContextId = wamid da mensagem citada (webhook e, às vezes, getMessages)
    const replyContextId =
        m.replyContextId || m.replySourceId || m.reply_context_id || m.context?.id || m.context?.message_id || null
    return {
        id: m.id || m.whatsappMessageId || `${m.created}-${Math.random()}`,
        wamid: m.whatsappMessageId || m.messageId || null,
        tipo: m.type || 'text',
        texto: textoBruto,
        arquivo: typeof m.data === 'string' ? m.data : null,
        // nome original quando se sabe (recebido: no texto; enviado pelo painel: ver nomesArquivosEnviados)
        nomeArquivo:
            String(m.type).toLowerCase() === 'document' && !m.owner && PARECE_NOME_ARQUIVO.test(String(textoBruto).trim()) ? String(textoBruto).trim() : null,
        em: emDaMensagemWati(m),
        minha,
        status: String(m.statusString || m.status || '').toLowerCase(),
        operador: nomeOperadorUtil(m.operatorName, m.operatorEmail),
        falha: m.failedDetail || m.failedReason || m.errorMessage || null,
        evento,
        descricao,
        replyContextId: replyContextId ? String(replyContextId) : null,
        respostaA: null,
    }
}

/** Liga replyContextId ao preview da mensagem citada (quando ela está no lote carregado). */
function anexarRespostasCitadas(lista) {
    const porWamid = new Map()
    for (const m of lista) if (m.wamid) porWamid.set(String(m.wamid), m)
    for (const m of lista) {
        if (!m.replyContextId) continue
        const alvo = porWamid.get(String(m.replyContextId))
        if (alvo) {
            m.respostaA = {
                wamid: alvo.wamid,
                texto: alvo.texto,
                tipo: alvo.tipo,
                minha: alvo.minha,
                operador: alvo.operador,
                nomeArquivo: alvo.nomeArquivo,
            }
        } else {
            m.respostaA = { wamid: m.replyContextId, texto: '', tipo: 'text', minha: null, operador: null }
        }
    }
}

// Texto curto do card da lista ("📷 Foto", "🎤 Áudio"…), como na prévia do WhatsApp
const ROTULO_TIPO = { image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', voice: '🎤 Áudio', document: '📄 Documento', sticker: '🏷️ Figurinha', location: '📍 Localização', contacts: '👤 Contato' }
function textoPrevia(tipo, texto) {
    const t = String(texto || '').trim()
    if (!tipo || tipo === 'text') return t
    const rotulo = ROTULO_TIPO[tipo] || '📎 Anexo'
    return t ? `${rotulo}: ${t}` : rotulo
}

function normalizarContatoCanal(c, canal) {
    return {
        waId: `${PREFIXO_CANAL[canal]}:${c.id}`,
        nome: c.name || c.display_name || c.username || null,
        foto: c.photo || null,
        atualizadoEm: c.last_updated || c.created || null,
    }
}

// atributos da WATI que entram na busca da lista (além de nome/telefone WhatsApp e etiquetas)
// `name` é o Nome da ficha (CRM), distinto do fullName do WhatsApp
const ATRIBUTOS_BUSCA = ['name', 'tipo', 'cidade', 'uf']

function normalizarContato(c) {
    const waId = normalizarWaId(c.wAid || c.waId || c.phone)
    // número exatamente como a WATI guarda (com ou sem o 9º dígito): getMessages acerta de primeira
    const alvoWati = String(c.wAid || c.waId || c.phone || '').replace(/\D/g, '') || null
    const atributos = {}
    let nomeFicha = null
    for (const p of c.customParams || []) {
        const k = String(p?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!p?.value) continue
        if (ATRIBUTOS_BUSCA.includes(k)) atributos[k] = String(p.value)
        if (k === 'name') nomeFicha = String(p.value).trim()
    }
    const nomeWati = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.firstName || null
    // ficha salva (atributo name) tem prioridade sobre o push name do WhatsApp
    return {
        waId,
        alvoWati,
        nome: nomeFicha || nomeWati || null,
        foto: c.photo || null,
        atualizadoEm: c.lastUpdated || c.created || null,
        atributos,
    }
}

/** Junta duas metas do mesmo número (ex.: gravadas com e sem o 9º dígito). */
function fundirMeta(a, b) {
    if (!a) return b
    if (!b) return a
    const aEm = msData(a.ultima_msg_em)
    const bEm = msData(b.ultima_msg_em)
    const recente = bEm > aEm ? b : a
    const outro = recente === a ? b : a
    // estado da conversa (status, atendente, setor) vem da linha gravada por último, não da mensagem mais nova:
    // o painel grava na linha canônica; a antiga (sem o 9º dígito) podia ter mensagem mais nova e status velho,
    // e o "Resolver"/"Pendente" recém-marcado parecia não pegar
    const gravada = msData(b.atualizado_em) > msData(a.atualizado_em) ? b : a
    return {
        ...outro,
        ...recente,
        wa_id: normalizarWaId(recente.wa_id || outro.wa_id),
        nome: recente.nome || outro.nome || null,
        tags: (recente.tags?.length ? recente.tags : outro.tags) || [],
        anuncio: recente.anuncio || outro.anuncio || null,
        status: gravada.status || recente.status,
        atendente_email: gravada.atendente_email ?? null,
        departamento_id: gravada.departamento_id ?? null,
        atualizado_em: msData(a.atualizado_em) >= msData(b.atualizado_em) ? a.atualizado_em : b.atualizado_em,
        nao_lidas: Math.max(recente.nao_lidas || 0, outro.nao_lidas || 0),
        ultima_cliente_em: msData(recente.ultima_cliente_em) >= msData(outro.ultima_cliente_em) ? recente.ultima_cliente_em : outro.ultima_cliente_em,
    }
}

// Busca no WhatsApp: a WATI tem dezenas de milhares de contatos, então a filtragem é feita lá —
// uma consulta por nome/telefone e uma por atributo, em paralelo, juntando os resultados
async function buscarContatosWhatsapp(busca) {
    if (!busca) return (await wati.listarContatos({ tamanho: 100 })).contatos.map(normalizarContato)
    const consultas = [
        wati.listarContatos({ tamanho: 50, nome: busca }),
        ...ATRIBUTOS_BUSCA.map((name) => wati.listarContatos({ tamanho: 50, atributo: { name, value: busca } })),
    ]
    const porId = new Map()
    for (const r of await Promise.allSettled(consultas)) {
        // um atributo que ainda não existe na conta (ex.: uf) só não traz nada
        if (r.status !== 'fulfilled') continue
        for (const c of r.value.contatos.map(normalizarContato)) if (c.waId && !porId.has(c.waId)) porId.set(c.waId, c)
    }
    return [...porId.values()]
}

// ---------- handlers ----------

async function login(req, res) {
    await checarLimiteLogin(ipDe(req))
    const env = getEnv()
    const { tenantId, email, senha } = await lerCorpo(req)
    const emailN = String(email || '').trim().toLowerCase()
    if (!tenantId || !emailN || !senha) throw new HttpError(400, 'Informe ID, e-mail e senha.')
    const falha = new HttpError(401, 'ID, e-mail ou senha inválidos.')
    if (String(tenantId).trim().toLowerCase() !== env.watiTenantId.toLowerCase()) throw falha

    let sessao
    if (env.adminEmail && env.adminSenha && emailN === env.adminEmail && compararSeguro(senha, env.adminSenha)) {
        sessao = { uid: ADMIN_ENV_ID, email: env.adminEmail }
    } else {
        const u = await buscarUsuarioPorEmail(emailN)
        if (!u || !u.ativo || !conferirSenha(senha, u.senha_hash)) throw falha
        sessao = { uid: u.id, email: u.email, pv: impressao(u.senha_hash) }
    }
    const maxAge = Math.round(env.sessionHoras * 3600)
    const token = criarToken({ ...sessao, exp: Date.now() + maxAge * 1000 }, env.sessionSecret)
    await limparTentativasLogin(ipDe(req))
    enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, token, maxAge) })
}

// ---- convite (criar a própria senha) ----
// Token assinado sem estado: amarrado ao senha_hash atual, deixa de valer assim que a senha é criada

const segredoConvite = () => `${getEnv().sessionSecret}:convite`

async function enviarConvite(u) {
    const env = getEnv()
    const token = criarToken({ conv: u.id, v: impressao(u.senha_hash), exp: Date.now() + CONVITE_DIAS * 86400000 }, segredoConvite())
    const link = `${env.publicUrl}/?convite=${token}`
    // sem e-mail o admin recebe o link para repassar
    if (!emailConfigurado()) return { emailEnviado: false, link, erroEmail: 'Falta RESEND_API_KEY no .env.' }
    try {
        await enviarEmail({
            to: u.email,
            ...montarEmailConvite({ nome: u.nome, email: u.email, link, tenantId: env.watiTenantId, validadeDias: CONVITE_DIAS }),
        })
        return { emailEnviado: true }
    } catch (e) {
        console.error('[zap] convite', e)
        return { emailEnviado: false, link, erroEmail: e.message }
    }
}

async function lerConvite(token) {
    const falha = new HttpError(400, 'Este convite expirou ou já foi usado. Peça um novo ao administrador.', 'convite_invalido')
    const p = lerToken(token, segredoConvite())
    if (!p?.conv) throw falha
    const u = ok(await db().from('zap_usuarios').select('id, nome, email, senha_hash, ativo').eq('id', p.conv).maybeSingle())
    if (!u || !u.ativo || impressao(u.senha_hash) !== p.v) throw falha
    return u
}

async function aceitarConvite(req, res) {
    await checarLimiteLogin(ipDe(req))
    const env = getEnv()
    const { token, senha } = await lerCorpo(req)
    if (!senha || String(senha).length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres.')
    const u = await lerConvite(token)
    const senhaHash = hashSenha(senha)
    ok(await db().from('zap_usuarios').update({ senha_hash: senhaHash, atualizado_em: new Date().toISOString() }).eq('id', u.id))
    const maxAge = Math.round(env.sessionHoras * 3600)
    const sessao = criarToken({ uid: u.id, email: u.email, pv: impressao(senhaHash), exp: Date.now() + maxAge * 1000 }, env.sessionSecret)
    enviar(res, 200, { ok: true, tenantId: env.watiTenantId, email: u.email }, { 'Set-Cookie': cookieSessao(req, sessao, maxAge) })
}

async function me(usuario) {
    const env = getEnv()
    const [departamentos, canais] = await Promise.all([
        db().from('zap_departamentos').select('id, nome, cor, equipe_wati').order('nome').then(ok),
        wati.listarCanais(),
    ])
    return {
        usuario,
        departamentos,
        canais,
        config: {
            tenantId: env.watiTenantId,
            canalConfigurado: Boolean(env.watiChannel),
            webhook: Boolean(env.webhookSecret),
            // como a "Default Team" da WATI: conversa sem atendente e sem setor fica visível para todos os atendentes
            atendenteVeSemDepto: env.atendenteVeSemDepto,
        },
    }
}

// responde com um cookie novo: a sessão de quem trocou continua; as de outros aparelhos caem (pv)
async function trocarSenha(req, res, usuario) {
    if (usuario.id === ADMIN_ENV_ID) throw new HttpError(400, 'A senha do administrador inicial é definida no .env (ZAP_ADMIN_SENHA).')
    const { atual, nova } = await lerCorpo(req)
    if (!nova || String(nova).length < 8) throw new HttpError(400, 'A nova senha precisa ter ao menos 8 caracteres.')
    const u = await buscarUsuarioPorEmail(usuario.email)
    if (!u || !conferirSenha(atual || '', u.senha_hash)) throw new HttpError(400, 'Senha atual incorreta.')
    const senhaHash = hashSenha(nova)
    ok(await db().from('zap_usuarios').update({ senha_hash: senhaHash, atualizado_em: new Date().toISOString() }).eq('id', u.id))
    const env = getEnv()
    const maxAge = Math.round(env.sessionHoras * 3600)
    const token = criarToken({ uid: u.id, email: u.email, pv: impressao(senhaHash), exp: Date.now() + maxAge * 1000 }, env.sessionSecret)
    enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, token, maxAge) })
}

async function listarConversas(usuario, query) {
    const busca = String(query.get('q') || '').trim()
    const canal = PREFIXO_CANAL[query.get('canal')] ? query.get('canal') : 'whatsapp'
    const buscarContatos =
        canal === 'whatsapp'
            ? buscarContatosWhatsapp(busca)
            : wati.listarContatosCanal(canal).then((lista) => lista.map((c) => normalizarContatoCanal(c, canal)))
    const [contatos, metasTodas] = await Promise.all([
        buscarContatos,
        db()
            .from('zap_conversas')
            .select('*')
            .order('ultima_msg_em', { ascending: false, nullsFirst: false })
            .limit(300)
            .then(ok),
    ])
    const metas = metasTodas.filter((m) => canalDe(m.wa_id) === canal)
    const porId = new Map()
    for (const c of contatos) {
        if (!c.waId) continue
        porId.set(c.waId, { ...c })
        // lista da WATI diz a variante certa do número: a conferência e o chat não gastam uma chamada errando
        if (c.alvoWati) alvoWatiOk.set(c.waId, c.alvoWati)
    }
    for (const m of metas) {
        // canônico: evita card duplicado quando o banco tem o número com e sem o 9º dígito
        const waId = normalizarWaId(m.wa_id)
        const atual = porId.get(waId) || { waId, nome: m.nome, foto: null, atualizadoEm: null }
        const meta = fundirMeta(atual.meta, { ...m, wa_id: waId })
        // nome da ficha (WATI) > nome já gravado no painel > vazio
        porId.set(waId, { ...atual, waId, nome: atual.nome || meta?.nome || m.nome || null, meta })
    }
    // com busca: toda a base WATI (mesmo sem atribuição). sem busca: só o que o atendente pode ver
    const brutos = [...porId.values()].filter((c) => Boolean(busca) || podeVerConversa(usuario, c.meta))
    // espelha nomes da ficha WATI no painel (só quando a meta ainda não tem nome)
    const espelhar = brutos
        .filter((c) => (c.nome || c.atributos?.name) && !c.meta?.nome)
        .slice(0, 40)
    if (espelhar.length) {
        Promise.allSettled(
            espelhar.map((c) => salvarMeta(c.waId, { nome: String(c.nome || c.atributos.name).slice(0, 120) })),
        ).catch(() => {})
    }
    const pessoas = await pessoasDoPainel().catch(() => [])
    let lista = brutos.map((c) => {
        // horário da última mensagem. O last_updated do contato na WATI também muda sem mensagem (chatbot expirando
        // ~3h depois, atributo, atribuição): só serve de palpite enquanto a conversa não foi verificada
        const ultimaEm = c.meta?.ultima_msg_em || c.atualizadoEm || null
        return {
            waId: c.waId,
            nome: c.nome || c.atributos?.name || null,
            foto: c.foto,
            ultimaMsg: c.meta?.ultima_msg || null,
            ultimaMinha: c.meta?.ultima_msg_minha ?? null,
            ultimaEm,
            // a janela de 24h do WhatsApp conta da última mensagem do cliente (null = ainda não se sabe)
            ultimaClienteEm: c.meta?.ultima_cliente_em || (c.meta?.ultima_msg_minha === false ? ultimaEm : null),
            // "Não respondidas" (como a WATI): cliente escreveu depois da última resposta humana; bot não conta
            aguardandoHumano: aguardaHumano(c.meta, ultimaEm),
            // "Menções": e-mails de quem foi citado com @ nas notas da conversa
            mencionados: mencionadosNasNotas(c.meta?.notas, pessoas),
            anuncio: c.meta?.anuncio || null,
            naoLidas: c.meta?.nao_lidas || 0,
            departamentoId: c.meta?.departamento_id || null,
            atendenteEmail: c.meta?.atendente_email || null,
            status: c.meta?.status || 'aberta',
            tags: c.meta?.tags || [],
            atributos: c.atributos || {},
        }
    })
    if (busca) {
        const b = busca.toLowerCase()
        const d = soDigitos(busca)
        lista = lista.filter(
            (c) =>
                (c.nome || '').toLowerCase().includes(b) ||
                c.tags.some((t) => t.toLowerCase().includes(b)) ||
                Object.values(c.atributos).some((v) => String(v).toLowerCase().includes(b)) ||
                (d && canal === 'whatsapp' && c.waId.includes(d)),
        )
    }
    const contatoEm = new Map([...porId.values()].map((c) => [c.waId, c.atualizadoEm]))
    const metaPorId = new Map()
    for (const m of metas) {
        const id = normalizarWaId(m.wa_id)
        metaPorId.set(id, fundirMeta(metaPorId.get(id), { ...m, wa_id: id }))
    }
    await verificarNaWati(lista, metaPorId, contatoEm)
    lista.sort((a, b) => msData(b.ultimaEm) - msData(a.ultimaEm))
    return { conversas: lista, canal }
}

// Sem webhook, o banco não fica sabendo das mensagens novas: a cada carregamento da lista, verifica na WATI
// as últimas mensagens de algumas conversas (nunca vistas primeiro, depois as ativas há mais tempo sem checar)
// e grava prévia, horário e quantidade de não lidas, para o card mostrar como no WhatsApp.
// Com o webhook configurado, a verificação só confirma o que já chegou por ele.
// com o webhook gravando, a conferência só corrige o que escapou: 3 por carga, ativa de novo após 60 s
const VERIFICAR_POR_VEZ = 3
const INTERVALO_VERIFICACAO = 60000
const ATIVA_MS = 24 * 3600 * 1000
const RECONFERIR_ATIVA_MS = 3 * 60 * 1000
const FOLGA_MS = 2000 // webhook grava em segundos; a WATI devolve com milissegundos
const verificadas = new Map() // waId → quando foi checada (por instância do servidor)
// datas da WATI ("…Z") e do Postgres ("…+00:00") não se comparam como texto
const msData = (iso) => (iso ? new Date(iso).getTime() || 0 : 0)

// WATI documenta horários em UTC; `created` às vezes vem sem Z ("2022-11-27 10:26:58") e o JS
// interpretava como horário local — o relógio da janela de 24h ficava horas fora do painel WATI.
// `timestamp` (unix) é a fonte mais estável quando existe.
function isoDaWati(bruto) {
    if (bruto == null || bruto === '') return null
    if (typeof bruto === 'number' && Number.isFinite(bruto)) {
        const ms = bruto < 1e12 ? bruto * 1000 : bruto
        return new Date(ms).toISOString()
    }
    const s = String(bruto).trim()
    if (/^\d{10,13}$/.test(s)) {
        const n = Number(s)
        const ms = n < 1e12 ? n * 1000 : n
        return new Date(ms).toISOString()
    }
    // "YYYY-MM-DD HH:mm:ss(.sss)?" ou com T, sem fuso → UTC
    const naive = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/i)
    if (naive) {
        const iso = naive[3] ? `${naive[1]}T${naive[2]}${naive[3]}` : `${naive[1]}T${naive[2]}Z`
        const t = new Date(iso).getTime()
        return Number.isFinite(t) ? new Date(t).toISOString() : null
    }
    const t = new Date(s).getTime()
    return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function emDaMensagemWati(m) {
    if (!m) return null
    if (m.timestamp != null && m.timestamp !== '') {
        const viaTs = isoDaWati(m.timestamp)
        if (viaTs) return viaTs
    }
    return isoDaWati(m.created) || isoDaWati(m.em) || null
}

// O que conferir decide pelo banco (igual em todas as instâncias da Vercel), não pela memória da instância:
// conversa que o banco não conhece, ou contato que a WATI mudou depois do último registro (atualizado_em).
// Cada conferência grava atualizado_em, então a mesma conversa não volta a ser conferida sem mudança nova.
// O Map `verificadas` só evita repetir a mesma conversa dentro do intervalo nesta instância.
function escolherParaVerificar(lista, metaPorId, contatoEm) {
    const agora = Date.now()
    const recente = (c) => verificadas.has(c.waId) && agora - verificadas.get(c.waId) < INTERVALO_VERIFICACAO
    const desconhecidas = lista.filter((c) => !metaPorId.has(c.waId) && !recente(c))
    const mexidas = lista
        .filter((c) => metaPorId.has(c.waId) && !recente(c))
        .filter((c) => msData(contatoEm.get(c.waId)) > msData(metaPorId.get(c.waId).atualizado_em) + FOLGA_MS)
        .sort((a, b) => msData(contatoEm.get(b.waId)) - msData(contatoEm.get(a.waId)))
    // Conversa ativa (mensagem nas últimas 24 h, não resolvida) é conferida de novo a cada 3 min mesmo sem mudança
    // no contato: o bot da WATI atribui/transfere sem mexer no last_updated do contato e não há webhook de atribuição.
    // A mais antiga no banco primeiro; como a conferência grava atualizado_em, vale para todas as instâncias.
    const ativas = lista
        .filter((c) => metaPorId.has(c.waId) && !recente(c))
        .filter((c) => {
            const m = metaPorId.get(c.waId)
            return m.status !== 'resolvida' && agora - msData(m.ultima_msg_em) < ATIVA_MS && agora - msData(m.atualizado_em) > RECONFERIR_ATIVA_MS
        })
        .sort((a, b) => msData(metaPorId.get(a.waId).atualizado_em) - msData(metaPorId.get(b.waId).atualizado_em))
    // no máximo 1 ativa por carga: o resto das vagas fica para o que mudou; evita pico quando a instância é nova
    return [...new Set([...mexidas, ...desconhecidas, ...ativas.slice(0, 1)])].slice(0, VERIFICAR_POR_VEZ)
}

// Quem atende segundo a WATI: o bot (round-robin) e o painel oficial atribuem lá, e o painel só ficava sabendo pelo
// "Assumir". Vale o evento de atribuição mais recente ("The chat has been assigned to x@y by Bot…",
// "Chat is now assigned to x@y"); sem evento, usa o operatorEmail da última mensagem humana.
const RE_ATRIBUIDO = /assigned to ([^\s()]+@[^\s()]+?)[.,]?(?:\s|$)/i
function atendenteDoHistorico(itens) {
    const eventos = [...itens].filter((m) => m.eventType === 'ticket').sort((a, b) => msData(b.created) - msData(a.created))
    for (const e of eventos) {
        const m = String(e.eventDescription || e.text || '').match(RE_ATRIBUIDO)
        if (m) return m[1].toLowerCase()
    }
    // Ju responde na WATI sem novo assign → o card não pode continuar como “do Alfa”
    const enviadas = [...itens]
        .filter((m) => m.owner && m.operatorEmail && !/^api\s*token\b/i.test(String(m.operatorEmail)))
        .sort((a, b) => msData(b.created || b.timestamp) - msData(a.created || a.timestamp))
    const email = enviadas[0]?.operatorEmail
    return email ? String(email).trim().toLowerCase() : null
}

/**
 * Status do ticket segundo o evento mais recente da WATI (solved/open/pending).
 * Devolve também o horário do evento — só sincroniza se for mais novo que meta.atualizado_em,
 * senão um "Open" antigo desfaz o Resolver feito agora pela API.
 */
function statusDoHistorico(itens) {
    const eventos = [...itens].filter((m) => m.eventType === 'ticket').sort((a, b) => msData(b.created) - msData(a.created))
    for (const e of eventos) {
        const t = String(e.eventDescription || e.text || e.finalText || '')
        let status = null
        // "The chat has been closed by Bot / by agent X" = resolvido na WATI;
        // "opened by agent" / "initialized by contact" = aberto de novo. "Expired" não muda o status.
        if (/\b(chat|ticket)\s+has\s+been\s+(closed|solved|resolved)\b/i.test(t)) status = 'resolvida'
        else if (/\b(chat|ticket)\s+has\s+been\s+(opened|reopened|initialized)\b/i.test(t)) status = 'aberta'
        else if (!/\bstatus\b/i.test(t) && !/\bmarked as\b/i.test(t)) continue
        else if (/\b(solved|resolved|closed)\b/i.test(t)) status = 'resolvida'
        else if (/\bpending\b/i.test(t)) status = 'pendente'
        else if (/\bopen\b/i.test(t)) status = 'aberta'
        if (status) return { status, em: e.created || e.timestamp || null }
    }
    return null
}

function aplicarStatusDoHistorico(meta, itens) {
    const ev = statusDoHistorico(itens)
    if (!ev || ev.status === (meta?.status || 'aberta')) return null
    // evento sem data: só aceita "resolvida" (não reabre por Open antigo sem timestamp)
    if (!ev.em) return ev.status === 'resolvida' ? ev.status : null
    if (msData(ev.em) > msData(meta?.atualizado_em) + FOLGA_MS) return ev.status
    // fechamento pelo bot que a conferência antiga não reconhecia: o último evento da WATI ainda é o fechamento
    // e o cliente não escreveu depois dele, então lá a conversa continua encerrada
    if (ev.status === 'resolvida' && msData(ev.em) > msData(meta?.ultima_cliente_em) + FOLGA_MS) return ev.status
    return null
}

// Departamento pela equipe da WATI (o bot distribui por equipe e o painel não ficava sabendo): mantém o atual
// se a equipe dele está na conversa; senão o primeiro departamento cuja equipe_wati bate. Sem equipe mapeada, nada.
async function departamentoDaWati(waId, meta, departamentos) {
    const comEquipe = departamentos.filter((d) => d.equipe_wati)
    if (!comEquipe.length) return undefined
    const c = await comAlvoWati(waId, (alvo) => wati.detalheContato(alvo))
    const equipes = (c?.teams || []).map((t) => String(t?.name ?? t).trim().toLowerCase())
    const daEquipe = (d) => equipes.includes(d.equipe_wati.trim().toLowerCase())
    const atual = comEquipe.find((d) => d.id === meta?.departamento_id)
    if (atual && daEquipe(atual)) return undefined
    for (const nome of equipes) {
        const d = comEquipe.find((x) => x.equipe_wati.trim().toLowerCase() === nome)
        if (d) return d.id
    }
    return undefined
}

/** Frases de sistema/Ask mode que a WATI manda como “mensagem” — não reabrem ticket resolvido. */
function textoPareceSistemaWati(texto) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim()
    if (!t) return false
    return /\b(ticket|chat)\s+status\s+has\s+been\s+set\b/i.test(t)
        || /\bsession\s+is\s+in\s+['"]?ask['"]?\s+mode\b/i.test(t)
        || /you\s+can'?t\s+send\s+messages\s+now/i.test(t)
        || /^(the\s+)?(chat|ticket)\s+(has\s+been|was|is\s+now)\s+(assigned|unassigned|opened|closed)\b/i.test(t)
        || /^(ended|opened|closed|started|resolved|expired)\s*:/i.test(t)
}

async function verificarNaWati(lista, metaPorId, contatoEm) {
    if (wati.watiEmPausa()) return
    const escolhidas = escolherParaVerificar(lista, metaPorId, contatoEm)
    if (!escolhidas.length) return
    const departamentos = await db().from('zap_departamentos').select('id, equipe_wati').then(ok).catch(() => [])
    await Promise.allSettled(
        escolhidas.map(async (c) => {
            verificadas.set(c.waId, Date.now())
            const { mensagens: itens } = await listarMensagensWati(c.waId, { pagina: 1, tamanho: 20 })
            // marca como conferida no banco (atualizado_em), mesmo que não haja nada novo
            await salvarMeta(c.waId, {})
            const msgs = itens
                .map(normalizarMensagem)
                .filter((m) => (m.evento === 'message' || m.evento === 'broadcastMessage') && m.em)
                .sort((a, b) => msData(b.em) - msData(a.em))
            const meta = metaPorId.get(c.waId)
            const anuncio = anuncioDe(itens)
            if (await registrarAnuncio(c.waId, anuncio, meta?.anuncio)) c.anuncio = anuncio
            const atendente = atendenteDoHistorico(itens)
            if (atendente && !mesmoEmail(atendente, meta?.atendente_email)) {
                await salvarMeta(c.waId, { atendente_email: atendente })
                c.atendenteEmail = atendente
            }
            const statusWati = aplicarStatusDoHistorico(meta, itens)
            if (statusWati) {
                await salvarMeta(c.waId, { status: statusWati })
                c.status = statusWati
                if (meta) meta.status = statusWati
            }
            // sem atendente, a conversa fica com a equipe (como na WATI): traz a equipe para o setor do painel
            if (!c.atendenteEmail && (meta?.status || c.status) !== 'resolvida') {
                const depto = await departamentoDaWati(c.waId, meta, departamentos).catch(() => undefined)
                if (depto) {
                    await salvarMeta(c.waId, { departamento_id: depto })
                    c.departamentoId = depto
                    if (meta) meta.departamento_id = depto
                }
            }
            const ultima = msgs[0]
            if (!ultima) return
            // horário certo mesmo quando não há nada novo (o card podia estar com o last_updated do contato)
            c.ultimaEm = ultima.em
            // última do cliente entre as lidas: corrige a janela de 24h mesmo sem mensagem nova
            const humana = msgs.find((m) => m.minha && respostaHumanaWati(m.operador))?.em
            if (humana && msData(humana) > msData(meta?.ultima_humana_em) + FOLGA_MS) {
                await salvarMeta(c.waId, { ultima_humana_em: humana })
                c.ultimaHumanaEm = humana
            }
            const doCliente = msgs.find((m) => !m.minha && !textoPareceSistemaWati(m.texto))?.em
            // espelha o horário da WATI mesmo se a meta local estava adiantada/atrasada (fuso errado)
            if (doCliente && Math.abs(msData(doCliente) - msData(meta?.ultima_cliente_em)) > FOLGA_MS) {
                await salvarMeta(c.waId, { ultima_cliente_em: doCliente })
                c.ultimaClienteEm = doCliente
            }
            const conhecidaMs = meta?.ultima_msg_em ? new Date(meta.ultima_msg_em).getTime() : null
            const nova = (m) => conhecidaMs === null || new Date(m.em).getTime() > conhecidaMs + FOLGA_MS
            const texto = textoPrevia(ultima.tipo, ultima.texto).slice(0, 500)
            const previaDesatualizada =
                texto !== (meta?.ultima_msg || '') || Boolean(ultima.minha) !== Boolean(meta?.ultima_msg_minha)
            // mensagens do cliente depois da última resposta nossa (ignora pills Ask/status)
            const msgsCliente = msgs.filter((m) => !textoPareceSistemaWati(m.texto))
            const corte = msgsCliente.findIndex((m) => m.minha)
            const semResposta = corte < 0 ? msgsCliente.filter((m) => !m.minha) : msgsCliente.slice(0, corte).filter((m) => !m.minha)
            let naoLidas = meta?.nao_lidas || 0
            if (conhecidaMs === null || nova(ultima)) {
                if (conhecidaMs === null) {
                    // primeira vez: só conta como nova se ainda dá para responder (janela de 24h)
                    naoLidas = Date.now() - new Date(ultima.em).getTime() < 24 * 3600 * 1000 ? semResposta.length : 0
                } else if (msgsCliente.some((m) => m.minha && nova(m))) {
                    naoLidas = semResposta.length // alguém respondeu (pela WATI): conta só o que veio depois
                } else {
                    naoLidas = (meta?.nao_lidas || 0) + semResposta.filter(nova).length
                }
            }
            // sempre corrige a prévia do card se o texto/lado divergir (ex.: resposta feita só na WATI)
            if (conhecidaMs !== null && !nova(ultima) && !previaDesatualizada) {
                c.ultimaMsg = texto
                c.ultimaMinha = ultima.minha
                return
            }
            const campos = { ultima_msg: texto, ultima_msg_em: ultima.em, ultima_msg_minha: ultima.minha, nao_lidas: naoLidas }
            // cliente escreveu numa conversa resolvida → reabre (igual ao webhook)
            // espelha na WATI: senão o ticket fica Solved lá e o Assumir falha
            // Ask mode / pills de status NÃO contam como mensagem do cliente
            if (!ultima.minha && !textoPareceSistemaWati(ultima.texto) && (meta?.status || c.status) === 'resolvida') {
                campos.status = 'aberta'
                await comAlvoWati(c.waId, (alvo) => wati.atualizarStatus(alvo, 'aberta')).catch(() => {})
            }
            await salvarMeta(c.waId, campos)
            Object.assign(c, {
                ultimaMsg: texto,
                ultimaMinha: ultima.minha,
                naoLidas,
                ...(campos.status ? { status: campos.status } : {}),
            })
        }),
    )
}

async function mensagens(usuario, waId, query) {
    const meta = await exigirConversa(usuario, waId)
    const pagina = Math.max(1, Number(query.get('pagina')) || 1)
    let itens = []
    let temMais = false
    try {
        const r = await listarMensagensWati(waId, { pagina, tamanho: 50 })
        itens = r.mensagens || []
        temMais = Boolean(r.temMais)
    } catch (e) {
        // conversa nova / número ainda sem histórico na WATI: getMessages costuma vir 400 —
        // abre o chat vazio para o atendente enviar o template
        if (e instanceof wati.WatiError && (e.status === 400 || e.status === 404 || e.codigo === 'numero_invalido')) {
            return { mensagens: [], temMais: false }
        }
        throw e
    }
    await registrarAnuncio(waId, anuncioDe(itens), meta?.anuncio)
    const lista = itens.map(normalizarMensagem).sort((a, b) => msData(a.em) - msData(b.em))
    await Promise.all([nomesArquivosEnviados(waId, lista), wamidsDoWebhook(waId, lista)])
    anexarRespostasCitadas(lista)

    // espelha a prévia da lista no banco (respostas feitas na WATI não passam pelo webhook às vezes)
    const chat = lista.filter((m) => (m.evento === 'message' || m.evento === 'broadcastMessage') && m.em)
    const ultima = chat.at(-1)
    const doCliente = [...chat].reverse().find((m) => !m.minha)
    if (ultima) {
        const texto = textoPrevia(ultima.tipo, ultima.texto).slice(0, 500)
        const campos = {}
        if (texto !== (meta?.ultima_msg || '') || msData(ultima.em) > msData(meta?.ultima_msg_em) + FOLGA_MS || Boolean(ultima.minha) !== Boolean(meta?.ultima_msg_minha)) {
            campos.ultima_msg = texto
            campos.ultima_msg_em = ultima.em
            campos.ultima_msg_minha = ultima.minha
        }
        if (doCliente?.em && Math.abs(msData(doCliente.em) - msData(meta?.ultima_cliente_em)) > FOLGA_MS) {
            campos.ultima_cliente_em = doCliente.em
        }
        const atendente = atendenteDoHistorico(itens)
        if (atendente && !mesmoEmail(atendente, meta?.atendente_email)) campos.atendente_email = atendente
        const statusWati = aplicarStatusDoHistorico(meta, itens)
        if (statusWati) campos.status = statusWati
        if (Object.keys(campos).length) await salvarMeta(waId, campos).catch(() => {})
    }
    return { mensagens: lista, temMais }
}

// Responder citando precisa do wamid, que o getMessages não traz: vem do que o webhook gravou,
// pelo id da mensagem na WATI ou, se não bater, pelo horário (até 3 s) e pelo lado (cliente/nós)
async function wamidsDoWebhook(waId, lista) {
    const faltando = lista.filter((m) => !m.wamid && m.em && (m.evento === 'message' || m.evento === 'broadcastMessage'))
    if (!faltando.length) return
    const tempos = faltando.map((m) => msData(m.em))
    const r = await db()
        .from('zap_mensagens_wamid')
        .select('id, wamid, em, minha')
        .eq('wa_id', waId)
        .gte('em', new Date(Math.min(...tempos) - 60000).toISOString())
        .lte('em', new Date(Math.max(...tempos) + 60000).toISOString())
    if (r.error || !r.data.length) return // tabela ainda não criada ou webhook desligado: fica sem "Responder"
    const porId = new Map(r.data.map((x) => [x.id, x.wamid]))
    for (const m of faltando) {
        m.wamid =
            porId.get(String(m.id)) ||
            r.data.find((x) => x.minha === m.minha && Math.abs(msData(x.em) - msData(m.em)) <= 3000)?.wamid ||
            null
    }
}

// Arquivo enviado pelo painel: liga a mensagem ao nome guardado no envio, pelo caminho na WATI ou, sem ele,
// pelo horário (até 2 min depois do envio, mesma extensão). O que casa pelo horário grava o caminho para a próxima vez.
const JANELA_ARQUIVO_MS = 120000
async function nomesArquivosEnviados(waId, lista) {
    const midias = lista.filter((m) => m.minha && m.arquivo && !m.nomeArquivo)
    if (!midias.length) return
    const r = await db().from('zap_arquivos').select('id, nome, arquivo, enviado_em').eq('wa_id', waId).order('enviado_em', { ascending: false }).limit(200)
    if (r.error) return // tabela ainda não criada (supabase/schema.sql): fica o nome amigável do navegador
    const livres = r.data.filter((a) => !a.arquivo)
    const porCaminho = new Map(r.data.filter((a) => a.arquivo).map((a) => [semBarraInicial(a.arquivo), a.nome]))
    for (const m of midias) {
        const conhecido = porCaminho.get(semBarraInicial(m.arquivo))
        if (conhecido) {
            m.nomeArquivo = conhecido
            continue
        }
        const em = msData(m.em)
        const i = livres.findIndex((a) => {
            const dif = em - msData(a.enviado_em)
            return dif > -10000 && dif < JANELA_ARQUIVO_MS && extensao(a.nome) === extensao(m.arquivo)
        })
        if (i < 0) continue
        const [a] = livres.splice(i, 1)
        m.nomeArquivo = a.nome
        await db().from('zap_arquivos').update({ arquivo: semBarraInicial(m.arquivo) }).eq('id', a.id)
    }
}

/** Sessão livre (texto/arquivo) só com mensagem do cliente nas últimas 24h — abertura nossa exige template. */
async function exigirSessaoLivre(waId, meta) {
    const iso = meta?.ultima_cliente_em || null
    if (iso) {
        const restante = 24 * 3600 * 1000 - (Date.now() - new Date(iso).getTime())
        if (restante > 0) return
    }
    // meta pode estar atrasada: confere as mensagens recentes na WATI (com/sem 9º dígito)
    try {
        const { mensagens } = await listarMensagensWati(waId, { tamanho: 30 })
        const doCliente = (mensagens || [])
            .map(normalizarMensagem)
            .filter((m) => !m.minha && m.evento === 'message' && m.em)
            .sort((a, b) => String(b.em).localeCompare(String(a.em)))[0]
        if (doCliente?.em) {
            const restante = 24 * 3600 * 1000 - (Date.now() - new Date(doCliente.em).getTime())
            if (restante > 0) {
                await salvarMeta(waId, { ultima_cliente_em: doCliente.em }).catch(() => {})
                return
            }
        }
    } catch {
        /* se a WATI falhar, mantém o bloqueio pelo meta */
    }
    const canal = canalDe(waId)
    if (canal === 'whatsapp') {
        throw new HttpError(
            400,
            iso
                ? 'Janela de 24h fechada. Envie um template aprovado para retomar o contato.'
                : 'Abertura nossa: envie um template aprovado para iniciar o contato. Mensagem livre só depois que o cliente responder.',
            'janela_24h',
        )
    }
    throw new HttpError(
        400,
        'Só é possível responder depois que o cliente escrever (janela de 24h).',
        'janela_24h',
    )
}

async function enviarTextoHandler(req, usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    await exigirSessaoLivre(waId, meta)
    const { texto, replyContextId } = await lerCorpo(req)
    const limpo = String(texto || '').trim()
    if (!limpo) throw new HttpError(400, 'Mensagem vazia.', 'vazia')
    if (limpo.length > 4096) throw new HttpError(400, `Mensagem muito longa: ${limpo.length} de 4096 caracteres. Divida em duas.`, 'longa')
    // a lista de quem realiza é montada no navegador; a marca crua não pode chegar ao cliente
    if (temMarcaServicos(limpo)) throw new HttpError(400, `A mensagem ainda tem ${MARCA_SERVICOS}: a lista de quem realiza não foi preenchida. Confira a UF e a cidade do contato.`)
    if (temMarcaCredenciados(limpo)) throw new HttpError(400, 'A mensagem ainda tem uma marca {credenciados.…}: a lista de credenciados não foi preenchida. Confira a UF e a cidade do contato.')
    const final = preencherVariaveis(limpo, { nome: meta?.nome || '', atendente: usuario.nome, telefone: canalDe(waId) === 'whatsapp' ? waId : '' })
    const msg = await comAlvoWati(waId, (alvo) => wati.enviarTexto(alvo, final, replyContextId))
    await salvarMeta(waId, {
        ultima_msg: final.slice(0, 500),
        ultima_msg_em: new Date().toISOString(),
        ultima_msg_minha: true,
        ultima_humana_em: new Date().toISOString(),
        nao_lidas: 0,
        ...(meta?.atendente_email ? {} : { atendente_email: usuario.email }),
    })
    return { ok: true, mensagem: msg ? normalizarMensagem({ ...msg, owner: true }) : null }
}

async function enviarArquivoHandler(req, usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    await exigirSessaoLivre(waId, meta)
    const { nome, mime, base64, legenda } = await lerCorpo(req)
    if (!base64) throw new HttpError(400, 'Arquivo vazio.')
    const buffer = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64')
    if (buffer.length > MAX_ARQUIVO) throw new HttpError(413, 'Arquivo acima de 3 MB. Comprima ou envie um link.', 'arquivo_grande')
    const nomeArquivo = String(nome || 'arquivo').slice(0, 120)
    const enviada = await comAlvoWati(waId, (alvo) => wati.enviarArquivo(alvo, { buffer, nomeArquivo, mime, legenda }))
    // guarda o nome original (a WATI renomeia para um UUID); sem a tabela, o envio segue normal
    const caminho = typeof enviada?.data === 'string' ? semBarraInicial(enviada.data) : null
    await db().from('zap_arquivos').insert({ wa_id: waId, nome: nomeArquivo, arquivo: caminho })
    await salvarMeta(waId, { ultima_msg: `📎 ${nome || 'Arquivo'}`, ultima_msg_em: new Date().toISOString(), ultima_msg_minha: true, ultima_humana_em: new Date().toISOString(), nao_lidas: 0 })
    return { ok: true }
}

async function enviarTemplateHandler(req, usuario, waId) {
    await exigirConversa(usuario, waId)
    if (canalDe(waId) !== 'whatsapp') throw new HttpError(400, 'Templates existem só no WhatsApp. No Instagram e no Messenger, aguarde o cliente escrever.', 'canal')
    const { nome, parametros } = await lerCorpo(req)
    if (!nome) throw new HttpError(400, 'Escolha um template.')
    await comAlvoWati(waId, (alvo) => wati.enviarTemplate(alvo, nome, parametros))
    // template enviado por atendente conta como resposta (regra do "Não respondidas" da WATI)
    await salvarMeta(waId, { ultima_msg: `📄 Template: ${nome}`, ultima_msg_em: new Date().toISOString(), ultima_msg_minha: true, ultima_humana_em: new Date().toISOString() })
    return { ok: true }
}

async function atribuirHandler(req, usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    const { email } = await lerCorpo(req)
    const alvo = email === undefined ? usuario.email : email ? String(email).toLowerCase() : null
    if (alvo && alvo !== usuario.email && usuario.papel !== 'admin') {
        // atendente só transfere para colegas do mesmo departamento da conversa
        const colega = await buscarUsuarioPorEmail(alvo)
        if (!colega || !colega.ativo) throw new HttpError(400, 'Atendente não encontrado.')
        if (meta?.departamento_id && !idsDepartamentos(colega).includes(meta.departamento_id)) {
            throw new HttpError(400, 'Esse atendente não pertence ao departamento da conversa.')
        }
    }
    let avisoWati = null
    try {
        await comAlvoWati(waId, (num) => wati.atribuirAtendente(num, alvo))
    } catch (e) {
        // mantém a atribuição local; inclui o texto original da WATI quando o mapeamento for genérico
        const original = e?.detalhe?.original || e?.detalhe?.info || e?.detalhe?.message
        avisoWati = original && original !== e.message ? `${e.message} — detalhe: ${original}` : e.message
    }
    // Assumir implica conversa aberta; se a WATI reabriu um Solved no assign, alinha o painel
    const campos = { atendente_email: alvo }
    if (meta?.status === 'resolvida') campos.status = 'aberta'
    await salvarMeta(waId, campos)
    return { ok: true, avisoWati }
}

// ---- perfil do contato ----

const MAX_TAGS = 20

// mantém maiúsculas/minúsculas como digitado, para bater com o nome da tag na WATI
function normalizarTag(t) {
    return String(t || '').trim().replace(/\s+/g, ' ').slice(0, 30)
}

const mesmaTag = (a, b) => a.toLowerCase() === b.toLowerCase()

/**
 * Sugestões de etiquetas: catálogo da WATI (quando a API expõe) + etiquetas já usadas
 * nas conversas do painel (que costumam ser as mesmas cadastradas na WATI).
 */
async function listarTagsSugestao() {
    const [watiTags, rows] = await Promise.all([
        wati.listarTags().catch(() => []),
        db().from('zap_conversas').select('tags').then(ok).catch(() => []),
    ])
    const conta = new Map()
    for (const t of watiTags) {
        const nome = normalizarTag(t)
        if (!nome) continue
        const chave = nome.toLowerCase()
        if (!conta.has(chave)) conta.set(chave, { nome, n: 1000 })
    }
    for (const r of rows || []) {
        for (const t of r.tags || []) {
            const nome = normalizarTag(t)
            if (!nome) continue
            const chave = nome.toLowerCase()
            const atual = conta.get(chave)
            if (atual) atual.n += 1
            else conta.set(chave, { nome, n: 1 })
        }
    }
    const tags = [...conta.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR')).map((x) => x.nome)
    return { tags }
}

// Espelha na conversa da WATI o que mudou nas etiquetas do painel; devolve as que falharam
async function sincronizarTags(waId, antes, depois) {
    const adicionar = depois.filter((t) => !antes.some((x) => mesmaTag(x, t)))
    const remover = antes.filter((t) => !depois.some((x) => mesmaTag(x, t)))
    if (!adicionar.length && !remover.length) return []
    const alvo = alvoWatiOk.get(normalizarWaId(waId)) || variantesWaId(waId)[0] || alvoWati(waId)
    const r = await Promise.allSettled([...adicionar.map((t) => wati.adicionarTag(alvo, t)), ...remover.map((t) => wati.removerTag(alvo, t))])
    const falhas = []
    r.forEach((x, i) => {
        if (x.status === 'fulfilled') return
        const tag = i < adicionar.length ? adicionar[i] : remover[i - adicionar.length]
        falhas.push({ tag, acao: i < adicionar.length ? 'adicionar' : 'remover', motivo: x.reason?.message || 'erro' })
    })
    return falhas
}

// Atributos da WATI mostrados na ficha, nesta ordem; os demais (lead_stage, cx_score…) ficam só na WATI.
// Comparados sem maiúsculas, espaços ou "_". Um que o contato ainda não tem aparece vazio e é criado ao preencher.
const ATRIBUTOS_FICHA = ['name', 'phone', 'cidade', 'uf', 'tipo']
const chaveAtributo = (nome) => String(nome).toLowerCase().replace(/[^a-z0-9]/g, '')
const atributoDaFicha = (nome) => ATRIBUTOS_FICHA.includes(chaveAtributo(nome))

// Dados do contato usados pelas regras das respostas rápidas (UF, cidade e todos os atributos da WATI)
async function contextoHandler(usuario, waId) {
    await exigirConversa(usuario, waId)
    if (canalDe(waId) !== 'whatsapp') return { atributos: {} }
    try {
        const c = await comAlvoWati(waId, (alvo) => wati.detalheContato(alvo))
        const atributos = {}
        for (const p of c?.custom_params || []) if (p?.name && p.value) atributos[chaveRegra(p.name)] = String(p.value)
        return { atributos }
    } catch {
        // sem os dados, as respostas com regra só vão para o grupo "não se aplicam"
        return { atributos: {} }
    }
}

// mesmo formato de chave que src/regras.js usa para atributos ("Lead Stage" → lead_stage)
const chaveRegra = (nome) =>
    String(nome)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')

async function perfilHandler(usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    let ficha = null
    let avisoWati = null
    try {
        const c = await comAlvoWati(waId, (alvo) => wati.detalheContato(alvo))
        ficha = {
            nome: c?.name || c?.display_name || null,
            foto: c?.photo || null,
            criadoEm: c?.created || null,
            optIn: c?.opted_in ?? null,
            segmentos: c?.segments || [],
            equipes: c?.teams || [],
            atributos: ATRIBUTOS_FICHA.map((k) => {
                const p = (c?.custom_params || []).find((x) => x?.name && chaveAtributo(x.name) === k)
                return { name: p?.name || k, value: p?.value ?? '' }
            }),
        }
    } catch (e) {
        avisoWati = e.message
    }
    // espelha o Nome da ficha (atributo WATI) em zap_conversas.nome para a lista não cair no telefone
    const nomeFicha = String(ficha?.atributos?.find((a) => chaveAtributo(a.name) === 'name')?.value || '').trim().slice(0, 120)
    if (nomeFicha && nomeFicha !== meta?.nome) {
        await salvarMeta(waId, { nome: nomeFicha }).catch(() => {})
    }
    return {
        perfil: {
            waId,
            nomeWhatsapp: nomeFicha || ficha?.nome || meta?.nome || '',
            email: meta?.email || '',
            tags: meta?.tags || [],
            notas: meta?.notas || '',
        },
        wati: ficha,
        avisoWati,
        nome: nomeFicha || ficha?.nome || meta?.nome || null,
    }
}

async function salvarPerfilHandler(req, usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    const b = await lerCorpo(req)
    const email = String(b.email || '').trim().slice(0, 120)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.')
    const tags = []
    for (const t of (Array.isArray(b.tags) ? b.tags : []).map(normalizarTag)) if (t && !tags.some((x) => mesmaTag(x, t))) tags.push(t)
    tags.splice(MAX_TAGS)
    // nome da ficha (atributo) ou campo explícito — atualiza o título da lista
    const nomeBody = String(b.nome || '').trim().slice(0, 120)
    const nomeAttr = (Array.isArray(b.atributos) ? b.atributos : [])
        .map((a) => ({ name: String(a?.name || '').trim(), value: String(a?.value ?? '').trim().slice(0, 500) }))
        .find((a) => a.name && chaveAtributo(a.name) === 'name' && a.value)?.value?.slice(0, 120)
    const nome = nomeBody || nomeAttr || null
    await salvarMeta(waId, {
        email: email || null,
        tags,
        notas: String(b.notas || '').trim().slice(0, 2000) || null,
        ...(nome ? { nome } : {}),
    })
    const falhasTags = await sincronizarTags(waId, meta?.tags || [], tags)
    if (falhasTags.length < tags.length || (meta?.tags || []).length !== tags.length) {
        // alguma tag foi aplicada (ou removida) na WATI → atualiza o catálogo de sugestões
        wati.invalidarCacheTags()
    }
    // atributos personalizados vão para a WATI (o painel só manda quando mudaram)
    let avisoWati = null
    let atributosVazios = []
    if (Array.isArray(b.atributos)) {
        const lista = b.atributos
            .map((a) => ({ name: String(a?.name || '').trim().slice(0, 60), value: String(a?.value ?? '').trim().slice(0, 500) }))
            .filter((a) => a.name && atributoDaFicha(a.name))
        // a WATI recusa o lote inteiro se algum valor vier vazio ("CustomParam Value is required")
        atributosVazios = lista.filter((a) => !a.value).map((a) => a.name)
        const atributos = lista.filter((a) => a.value)
        if (atributos.length) {
            try {
                await comAlvoWati(waId, (alvo) => wati.atualizarAtributos(alvo, atributos))
            } catch (e) {
                avisoWati = e.message
            }
        }
    }
    return { ok: true, tags, avisoWati, atributosVazios, falhasTags, nome: nome || meta?.nome || null }
}

async function departamentoHandler(req, usuario, waId) {
    await exigirConversa(usuario, waId)
    const { departamentoId } = await lerCorpo(req)
    let depto = null
    if (departamentoId) {
        depto = ok(await db().from('zap_departamentos').select('*').eq('id', departamentoId).maybeSingle())
        if (!depto) throw new HttpError(400, 'Departamento não encontrado.')
    }
    let avisoWati = null
    if (depto?.equipe_wati) {
        try {
            await comAlvoWati(waId, (alvo) => wati.atribuirEquipe(alvo, [depto.equipe_wati]))
        } catch (e) {
            avisoWati = e.message
        }
    }
    // ao trocar de departamento, libera o atendente para a nova fila
    await salvarMeta(waId, { departamento_id: depto?.id || null, atendente_email: null })
    return { ok: true, avisoWati }
}

async function statusHandler(req, usuario, waId) {
    await exigirConversa(usuario, waId)
    const { status } = await lerCorpo(req)
    if (!['aberta', 'pendente', 'resolvida'].includes(status)) throw new HttpError(400, 'Status inválido.')
    let avisoWati = null
    try {
        await comAlvoWati(waId, (alvo) => wati.atualizarStatus(alvo, status))
    } catch (e) {
        // bot/atendente já fechou na WATI (ou expirou): lá não há conversa aberta, então resolver é só espelhar
        const fechadaNaWati = e instanceof wati.WatiError && e.codigo === 'conversa_fechada'
        // resolvida só no painel some da lista e a WATI reabre/recusa — o atendente acha que “não encerra”
        if (status === 'resolvida' && !fechadaNaWati) throw e
        if (!(status === 'resolvida' && fechadaNaWati)) avisoWati = e.message
    }
    await salvarMeta(waId, { status })
    return { ok: true, avisoWati }
}

async function midiaHandler(res, usuario, query) {
    const arquivo = String(query.get('arquivo') || '')
    const waId = query.get('waId') ? lerIdConversa(query.get('waId')).id : ''
    if (!arquivo || arquivo.includes('..')) throw new HttpError(400, 'Arquivo inválido.')
    // a conversa é obrigatória: sem ela, qualquer atendente baixaria mídia de conversa de outro setor
    if (!waId) throw new HttpError(400, 'Informe a conversa do arquivo.')
    await exigirConversa(usuario, waId)
    const resp = await wati.baixarMidia(arquivo)
    res.statusCode = 200
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/octet-stream')
    // abre no navegador, mas "Salvar como" usa o nome original em vez do UUID da WATI
    const nome = String(query.get('nome') || '').replace(/[\r\n"]/g, '').slice(0, 180)
    if (nome) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nome)}`)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.end(Buffer.from(await resp.arrayBuffer()))
}

// ---- respostas rápidas ----

// banco ainda sem a coluna departamento_ids (supabase/schema.sql não rodado): erro 42703 do Postgres
const semColunaNova = (r) => r.error?.code === '42703'

async function listarRespostas(usuario) {
    const ids = usuario.departamentos
    const admin = usuario.papel === 'admin'
    let q = db().from('zap_respostas_rapidas').select('id, atalho, titulo, texto, departamento_ids, regras, criado_em').order('atalho')
    // sem departamento = para todos; senão precisa ter ao menos um departamento em comum com o atendente
    if (!admin) q = ids.length ? q.or(`departamento_ids.eq.{},departamento_ids.ov.{${ids.join(',')}}`) : q.eq('departamento_ids', '{}')
    const r = await q
    if (!semColunaNova(r)) return { respostas: ok(r) }
    // compatível com o banco antigo: um departamento por resposta
    let antigo = db().from('zap_respostas_rapidas').select('id, atalho, titulo, texto, departamento_id, regras, criado_em').order('atalho')
    if (!admin) antigo = ids.length ? antigo.or(`departamento_id.is.null,departamento_id.in.(${ids.join(',')})`) : antigo.is('departamento_id', null)
    const lista = ok(await antigo)
    return { respostas: lista.map(({ departamento_id, ...x }) => ({ ...x, departamento_ids: departamento_id ? [departamento_id] : [] })) }
}

// insert/update de resposta; no banco antigo grava sem departamento_ids (só dá para um departamento)
async function gravarResposta(dados, gravar) {
    const r = await gravar(dados)
    if (!semColunaNova(r)) return ok(r)
    if (dados.departamento_ids.length > 1) {
        throw new HttpError(400, 'Para vincular vários departamentos, o banco precisa da atualização: rode supabase/schema.sql no Supabase.', 'migracao')
    }
    const { departamento_ids: _, ...semIds } = dados
    return ok(await gravar(semIds))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// departamentoIds (vários) ou departamentoId (planilha); departamento_id só com exatamente um, ver schema.sql
function departamentosDaResposta(b) {
    const brutos = Array.isArray(b.departamentoIds) ? b.departamentoIds : b.departamentoId ? [b.departamentoId] : []
    const ids = [...new Set(brutos.map(String).filter((id) => UUID.test(id)))]
    return { departamento_ids: ids, departamento_id: ids.length === 1 ? ids[0] : null }
}

// catálogo de procedimentos só quando alguma regra usa services {…} (confere se os códigos existem)
async function procedimentosDasRegras(textos) {
    return textos.some((t) => codigosServicos(t).length) ? await catalogoProcedimentos() : undefined
}

function validarResposta(b, procedimentos) {
    const atalho = String(b.atalho || '').trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-')
    const texto = String(b.texto || '').trim()
    if (!atalho || !texto) throw new HttpError(400, 'Atalho e texto são obrigatórios.')
    const regras = String(b.regras || '').trim().slice(0, 2000)
    const { erros } = lerRegras(regras, { procedimentos })
    if (erros.length) throw new HttpError(400, `Regras: ${erros[0]}`)
    const erroMarca = erroMarcaServicos(texto, regras)
    if (erroMarca) throw new HttpError(400, erroMarca)
    return {
        atalho: atalho.slice(0, 40),
        titulo: String(b.titulo || '').trim().slice(0, 80) || null,
        texto: texto.slice(0, 4096),
        ...departamentosDaResposta(b),
        regras: regras || null,
    }
}

// Importação em massa: atalho já existente no mesmo escopo (departamento) é atualizado, o resto é criado
const MAX_IMPORTACAO = 500

async function importarRespostas(b) {
    const departamentoId = b.departamentoId || null
    const porAtalho = new Map()
    let ignoradas = 0
    let repetidas = 0
    const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, MAX_IMPORTACAO)
    const procedimentos = await procedimentosDasRegras(itens.map((i) => String(i?.regras || '')))
    for (const item of itens) {
        try {
            const r = validarResposta({ ...item, departamentoId }, procedimentos)
            if (porAtalho.has(r.atalho)) repetidas += 1 // repetido no arquivo: vale a última linha
            porAtalho.set(r.atalho, r)
        } catch {
            ignoradas += 1
        }
    }
    if (!porAtalho.size) throw new HttpError(400, 'Nenhuma resposta válida para importar.')
    let q = db().from('zap_respostas_rapidas').select('id, atalho').in('atalho', [...porAtalho.keys()])
    q = departamentoId ? q.eq('departamento_id', departamentoId) : q.is('departamento_id', null)
    const existentes = new Map(ok(await q).map((r) => [r.atalho, r.id]))
    const novas = [...porAtalho.values()].filter((r) => !existentes.has(r.atalho))
    const atualizar = [...porAtalho.values()].filter((r) => existentes.has(r.atalho))
    // importação vincula no máximo um departamento: funciona com ou sem a coluna departamento_ids
    const semIds = (r) => {
        const { departamento_ids: _, ...resto } = r
        return resto
    }
    if (novas.length) {
        const r = await db().from('zap_respostas_rapidas').insert(novas)
        ok(semColunaNova(r) ? await db().from('zap_respostas_rapidas').insert(novas.map(semIds)) : r)
    }
    await Promise.all(atualizar.map((r) => gravarResposta(r, (d) => db().from('zap_respostas_rapidas').update(d).eq('id', existentes.get(r.atalho)))))
    return { criadas: novas.length, atualizadas: atualizar.length, ignoradas, repetidas }
}

// ---- departamentos ----

function validarDepto(b) {
    const nome = String(b.nome || '').trim()
    if (!nome) throw new HttpError(400, 'Nome é obrigatório.')
    const cor = /^#[0-9a-f]{6}$/i.test(b.cor || '') ? b.cor : '#25d366'
    return { nome: nome.slice(0, 60), cor, equipe_wati: String(b.equipeWati || '').trim() || null }
}

// ---- usuários ----

async function listarUsuarios() {
    const { adminEmail, adminNome } = getEnv()
    const lista = ok(
        await db().from('zap_usuarios').select('id, nome, email, senha_hash, papel, ativo, criado_em, zap_usuario_departamentos(departamento_id)').order('nome'),
    )
    const usuarios = lista.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        papel: u.papel,
        ativo: u.ativo,
        departamentos: idsDepartamentos(u),
        convitePendente: u.senha_hash.startsWith(PREFIXO_CONVITE),
    }))
    if (adminEmail && !usuarios.some((u) => u.email === adminEmail)) {
        usuarios.unshift({ id: ADMIN_ENV_ID, nome: adminNome, email: adminEmail, papel: 'admin', ativo: true, departamentos: [], fixo: true })
    }
    return { usuarios }
}

async function salvarDepartamentosDoUsuario(usuarioId, ids) {
    ok(await db().from('zap_usuario_departamentos').delete().eq('usuario_id', usuarioId))
    const linhas = [...new Set(ids || [])].map((departamento_id) => ({ usuario_id: usuarioId, departamento_id }))
    if (linhas.length) ok(await db().from('zap_usuario_departamentos').insert(linhas))
}

async function criarUsuario(req) {
    const b = await lerCorpo(req)
    const nome = String(b.nome || '').trim()
    const email = String(b.email || '').trim().toLowerCase()
    if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Nome e e-mail válidos são obrigatórios.')
    if (email === getEnv().adminEmail) throw new HttpError(400, 'Esse e-mail é o administrador inicial do .env.')
    const papel = b.papel === 'admin' ? 'admin' : 'atendente'
    const senha_hash = PREFIXO_CONVITE + segredoAleatorio()
    const criado = ok(await db().from('zap_usuarios').insert({ nome, email, papel, senha_hash, ativo: b.ativo !== false }).select('id').single())
    await salvarDepartamentosDoUsuario(criado.id, b.departamentos)
    return { ok: true, id: criado.id, ...(await enviarConvite({ id: criado.id, nome, email, senha_hash })) }
}

async function reenviarConvite(id) {
    if (id === ADMIN_ENV_ID) throw new HttpError(400, 'O administrador inicial é configurado no .env.')
    const u = ok(await db().from('zap_usuarios').select('id, nome, email, senha_hash, ativo').eq('id', id).maybeSingle())
    if (!u) throw new HttpError(404, 'Usuário não encontrado.')
    if (!u.ativo) throw new HttpError(400, 'Ative o usuário antes de enviar o convite.')
    return { ok: true, ...(await enviarConvite(u)) }
}

async function editarUsuario(req, id) {
    if (id === ADMIN_ENV_ID) throw new HttpError(400, 'O administrador inicial é configurado no .env.')
    const b = await lerCorpo(req)
    const campos = { atualizado_em: new Date().toISOString() }
    if (b.nome !== undefined) campos.nome = String(b.nome).trim()
    if (b.papel !== undefined) campos.papel = b.papel === 'admin' ? 'admin' : 'atendente'
    if (b.ativo !== undefined) campos.ativo = Boolean(b.ativo)
    if (b.senha) {
        if (String(b.senha).length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres.')
        campos.senha_hash = hashSenha(b.senha)
    }
    ok(await db().from('zap_usuarios').update(campos).eq('id', id))
    if (Array.isArray(b.departamentos)) await salvarDepartamentosDoUsuario(id, b.departamentos)
    return { ok: true }
}

// ---- importar da WATI ----

async function operadoresWati() {
    const { adminEmail } = getEnv()
    const [ops, existentes] = await Promise.all([wati.listarOperadores(), db().from('zap_usuarios').select('email').then(ok)])
    const jaTem = new Set(existentes.map((u) => u.email))
    return ops
        // fora robôs e o usuário técnico do token da API (api-token-user.<tenant>@clare.ai)
        .filter((o) => !o.isBot && o.email && !/^api-token-user\./i.test(o.email))
        .map((o) => {
            const email = String(o.email).trim().toLowerCase()
            return {
                nome: String(o.fullName || o.firstName || email.split('@')[0]).trim(),
                email,
                papel: (o.roles || []).includes('ADMINISTRATOR') ? 'admin' : 'atendente',
                jaExiste: jaTem.has(email) || email === adminEmail,
            }
        })
}

// cria só as contas (com convite pendente); os convites o admin envia depois pelo painel
async function importarUsuariosWati(req) {
    const { emails } = await lerCorpo(req)
    const escolhidos = new Set((emails || []).map((e) => String(e).toLowerCase()))
    const novos = (await operadoresWati()).filter((o) => !o.jaExiste && escolhidos.has(o.email))
    if (novos.length) {
        ok(
            await db()
                .from('zap_usuarios')
                .insert(novos.map((o) => ({ nome: o.nome, email: o.email, papel: o.papel, senha_hash: PREFIXO_CONVITE + segredoAleatorio(), ativo: true }))),
        )
    }
    return { ok: true, criados: novos.length }
}

// Um lote da importação de "quem está atendendo": a mensagem mais recente de cada conversa traz o operador (assignedId).
// O navegador chama página a página até `fim`, porque a WATI limita as chamadas e a função tem 30 s.
async function importarAtribuicoesWati(req) {
    const { pagina = 1, desde, soSemAtendente = false } = await lerCorpo(req)
    const limite = new Date(desde || Date.now() - 7 * 86400000).getTime()
    const ops = await wati.listarOperadores()
    const emailPorId = new Map(ops.filter((o) => !o.isBot && o.email).map((o) => [o.id, String(o.email).toLowerCase()]))
    // getContacts vem do mais recente para o mais antigo (lastUpdated)
    const { contatos } = await wati.listarContatos({ pagina: Number(pagina) || 1, tamanho: LOTE_ATRIBUICOES })
    const dentro = contatos.filter((c) => new Date(c.lastUpdated || c.created || 0).getTime() >= limite)
    let recentes = dentro.filter((c) => c.wAid)
    // sincronização: só as conversas que ainda não têm atendente no painel (economiza chamadas à WATI)
    if (soSemAtendente && recentes.length) {
        const ids = [...new Set(recentes.map((c) => normalizarWaId(c.wAid)).filter(Boolean))]
        const comAtendente = ok(
            await db()
                .from('zap_conversas')
                .select('wa_id')
                .in('wa_id', ids)
                .not('atendente_email', 'is', null),
        )
        const jaTem = new Set(comAtendente.map((m) => normalizarWaId(m.wa_id)))
        recentes = recentes.filter((c) => !jaTem.has(normalizarWaId(c.wAid)))
    }
    const mensagensDe = (waId) =>
        wati.listarMensagens(waId, { tamanho: 20 }).catch(async (e) => {
            if (e.codigo !== 'limite') return { mensagens: [] }
            await pausa(2000)
            return wati.listarMensagens(waId, { tamanho: 20 }).catch(() => ({ mensagens: [] }))
        })
    let atribuidas = 0
    for (let i = 0; i < recentes.length; i += PARALELO_ATRIBUICOES) {
        const grupo = recentes.slice(i, i + PARALELO_ATRIBUICOES)
        const respostas = await Promise.all(grupo.map((c) => mensagensDe(c.wAid)))
        for (const [j, { mensagens }] of respostas.entries()) {
            const ultima = [...mensagens]
                .filter((m) => m.assignedId)
                .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))[0]
            const email = ultima ? emailPorId.get(ultima.assignedId) : null
            if (!email) continue
            await salvarMeta(normalizarWaId(grupo[j].wAid), { atendente_email: email })
            atribuidas += 1
        }
    }
    return { verificadas: recentes.length, atribuidas, fim: dentro.length < contatos.length || contatos.length < LOTE_ATRIBUICOES }
}

// Lista enxuta de colegas para "transferir para atendente"
async function equipe() {
    const lista = ok(await db().from('zap_usuarios').select('nome, email, papel, zap_usuario_departamentos(departamento_id)').eq('ativo', true).order('nome'))
    return { equipe: lista.map((u) => ({ nome: u.nome, email: u.email, papel: u.papel, departamentos: idsDepartamentos(u) })) }
}

// ---- webhook WATI ----

/** Token do webhook: query `token`, header `x-zap-webhook-token`, ou `Authorization: Bearer …`.
 *  Decodifica URI e rejeita segredos com `#` (fragmento de URL — a WATI corta o token). */
function tokenWebhookRecebido(req, query) {
    const q = query.get('token') || ''
    const h = req.headers['x-zap-webhook-token'] || ''
    const auth = String(req.headers.authorization || '')
    const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1] || ''
    const bruto = q || h || bearer || ''
    try {
        return decodeURIComponent(String(bruto).trim())
    } catch {
        return String(bruto).trim()
    }
}

function tokenWebhookValido(recebido, esperado) {
    if (!esperado || !recebido) return false
    if (compararSeguro(recebido, esperado)) return true
    // legado: URL com `#` no secret — a WATI só envia o trecho antes do `#`
    const corte = esperado.indexOf('#')
    if (corte > 0 && compararSeguro(recebido, esperado.slice(0, corte))) return true
    return false
}

async function webhook(req, res, query) {
    const { webhookSecret } = getEnv()
    if (!webhookSecret || !tokenWebhookValido(tokenWebhookRecebido(req, query), webhookSecret)) {
        throw new HttpError(401, 'Token inválido.')
    }
    const b = await lerCorpo(req)
    const waId = normalizarWaId(b.waId || b.whatsappNumber)
    const evento = b.eventType || ''
    if (waId && (evento === 'message' || EVENTOS_ENVIADOS.has(evento) || /^templateMessage/i.test(evento) || b.text !== undefined)) {
        const minha = Boolean(b.owner) || EVENTOS_ENVIADOS.has(evento) || /^templateMessage/i.test(evento) || String(b.type || '').toLowerCase() === 'template'
        const texto = textoPrevia(b.type, b.text || b.finalText)
        const em = emDaMensagemWati(b) || new Date().toISOString()
        // status antes do RPC: cliente em resolvida → painel reabre; precisa reabrir na WATI também
        const metaAntes = !minha ? await metaConversa(waId).catch(() => null) : null
        ok(
            await db().rpc('zap_registrar_mensagem', {
                p_wa_id: waId,
                p_nome: minha ? null : b.senderName || null,
                p_texto: String(texto).slice(0, 500),
                p_em: em,
                p_minha: minha,
            }),
        )
        // resposta de atendente (na WATI ou no painel) zera o "Não respondidas"; mensagem do bot não conta
        if (minha && respostaHumanaWati(b.operatorName, b.operatorEmail)) {
            await db().from('zap_conversas').update({ ultima_humana_em: em }).eq('wa_id', waId).or(`ultima_humana_em.is.null,ultima_humana_em.lt.${em}`)
        }
        if (!minha && metaAntes?.status === 'resolvida') {
            await comAlvoWati(waId, (alvo) => wati.atualizarStatus(alvo, 'aberta')).catch(() => {})
        }
        if (!minha && b.messageReferral) await registrarAnuncio(waId, anuncioDe([{ ...b, created: em }]), null)
        if (b.whatsappMessageId) {
            // guarda o wamid para o "Responder"; sem a tabela, o webhook segue normal
            await db()
                .from('zap_mensagens_wamid')
                .upsert({ id: String(b.id || `${waId}:${b.whatsappMessageId}`), wa_id: waId, wamid: String(b.whatsappMessageId), em, minha })
        }
        wati.invalidarCache(`msgs:${waId}:`)
    }
    enviar(res, 200, { ok: true })
}

// ---------- roteamento ----------

export async function handle(req, res, rotaForcada) {
    try {
        const url = new URL(req.url || '/', 'http://local')
        const rota = String(rotaForcada ?? url.searchParams.get('_route') ?? url.pathname.replace(/^\/api\/?/, ''))
            .replace(/^\/+|\/+$/g, '')
        const partes = rota.split('/').filter(Boolean)
        const metodo = req.method || 'GET'
        const query = url.searchParams

        if (rota === 'status') return enviar(res, 200, { configurado: envFaltando().length === 0, faltando: envFaltando() })

        const faltando = envFaltando()
        if (faltando.length) throw new HttpError(503, `Painel não configurado. Preencha no .env: ${faltando.join(', ')}`)

        if (rota === 'webhook' && metodo === 'POST') return await webhook(req, res, query)

        // CSRF: toda escrita precisa do cabeçalho customizado (navegador força preflight cross-origin)
        if (metodo !== 'GET' && req.headers['x-zap'] !== '1') throw new HttpError(403, 'Requisição bloqueada.')

        if (rota === 'auth/login' && metodo === 'POST') return await login(req, res)
        if (rota === 'auth/convite' && metodo === 'GET') {
            const u = await lerConvite(query.get('token'))
            return enviar(res, 200, { nome: u.nome, email: u.email })
        }
        if (rota === 'auth/convite' && metodo === 'POST') return await aceitarConvite(req, res)
        if (rota === 'auth/logout' && metodo === 'POST') return enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) })

        const usuario = await usuarioDaSessao(req)
        const responder = (corpo) => enviar(res, 200, corpo)

        if (rota === 'auth/me' && metodo === 'GET') return responder(await me(usuario))
        if (rota === 'auth/senha' && metodo === 'POST') return await trocarSenha(req, res, usuario)
        if (rota === 'conversas' && metodo === 'GET') return responder(await listarConversas(usuario, query))
        if (rota === 'templates' && metodo === 'GET') return responder({ templates: await wati.listarTemplates() })
        if (rota === 'tags' && metodo === 'GET') return responder(await listarTagsSugestao())
        if (rota === 'media' && metodo === 'GET') return await midiaHandler(res, usuario, query)
        if (rota === 'equipe' && metodo === 'GET') return responder(await equipe())
        if (rota === 'ibge/municipios' && metodo === 'GET') {
            const lista = await municipiosPorUf(query.get('uf')).catch(() => {
                throw new HttpError(502, 'Não foi possível carregar as cidades do IBGE agora.')
            })
            if (!lista) throw new HttpError(400, 'UF inválida.')
            res.setHeader('Cache-Control', 'private, max-age=86400')
            return responder({ municipios: lista })
        }

        // regra services {…}: códigos que a rede realiza na cidade do contato (Credenciamento > Quem realiza)
        if (rota === 'servicos' && metodo === 'GET') {
            const codigos = String(query.get('codigos') || '').split(',').filter(Boolean).slice(0, 100)
            const alvo = { uf: query.get('uf'), cidade: query.get('cidade') }
            const [servicos, credenciados] = await Promise.all([
                servicosNaCidade({ ...alvo, codigos }),
                // marcas {credenciados.*}: mesma rota, mesma base em cache
                query.get('credenciados') === '1' ? credenciadosNaCidade(alvo) : null,
            ])
            return responder({ ...servicos, ...(credenciados ? { credenciados } : {}) })
        }
        if (rota === 'procedimentos' && metodo === 'GET') {
            const catalogo = await catalogoProcedimentos()
            return responder({ procedimentos: [...catalogo].map(([codigo, nome]) => ({ codigo, nome })) })
        }

        if (partes[0] === 'conversas' && partes[1]) {
            const waId = lerIdConversa(decodeURIComponent(partes[1])).id
            const acao = partes[2]
            if (acao === 'mensagens' && metodo === 'GET') return responder(await mensagens(usuario, waId, query))
            // só banco: o chat aberto pergunta isto e vai à WATI apenas quando mudou (webhook ou envio gravou algo)
            if (acao === 'versao' && metodo === 'GET') {
                const meta = await exigirConversa(usuario, waId)
                return responder({ versao: meta ? `${meta.ultima_msg_em || ''}|${meta.atualizado_em || ''}` : null })
            }
            if (acao === 'lida' && metodo === 'POST') {
                await exigirConversa(usuario, waId)
                await salvarMeta(waId, { nao_lidas: 0 })
                return responder({ ok: true })
            }
            // "marcar como não lida" (só no painel: a WATI não tem isso na API) — mantém a contagem se já houver
            if (acao === 'nao-lida' && metodo === 'POST') {
                const meta = await exigirConversa(usuario, waId)
                await salvarMeta(waId, { nao_lidas: Math.max(1, meta?.nao_lidas || 0) })
                return responder({ ok: true })
            }
            if (acao === 'texto' && metodo === 'POST') return responder(await enviarTextoHandler(req, usuario, waId))
            if (acao === 'arquivo' && metodo === 'POST') return responder(await enviarArquivoHandler(req, usuario, waId))
            if (acao === 'template' && metodo === 'POST') return responder(await enviarTemplateHandler(req, usuario, waId))
            if (acao === 'atribuir' && metodo === 'POST') return responder(await atribuirHandler(req, usuario, waId))
            if (acao === 'departamento' && metodo === 'POST') return responder(await departamentoHandler(req, usuario, waId))
            if (acao === 'status' && metodo === 'POST') return responder(await statusHandler(req, usuario, waId))
            if (acao === 'perfil' && metodo === 'GET') return responder(await perfilHandler(usuario, waId))
            if (acao === 'contexto' && metodo === 'GET') return responder(await contextoHandler(usuario, waId))
            if (acao === 'perfil' && metodo === 'PUT') return responder(await salvarPerfilHandler(req, usuario, waId))
        }

        if (partes[0] === 'respostas') {
            if (!partes[1] && metodo === 'GET') return responder(await listarRespostas(usuario))
            exigirAdmin(usuario)
            if (partes[1] === 'importar' && metodo === 'POST') return responder(await importarRespostas(await lerCorpo(req)))
            if (!partes[1] && metodo === 'POST') {
                const b = await lerCorpo(req)
                await gravarResposta(validarResposta(b, await procedimentosDasRegras([String(b.regras || '')])), (d) => db().from('zap_respostas_rapidas').insert(d))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'PUT') {
                const b = await lerCorpo(req)
                await gravarResposta(validarResposta(b, await procedimentosDasRegras([String(b.regras || '')])), (d) => db().from('zap_respostas_rapidas').update(d).eq('id', partes[1]))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'DELETE') {
                ok(await db().from('zap_respostas_rapidas').delete().eq('id', partes[1]))
                return responder({ ok: true })
            }
        }

        if (partes[0] === 'departamentos') {
            exigirAdmin(usuario)
            if (!partes[1] && metodo === 'POST') {
                ok(await db().from('zap_departamentos').insert(validarDepto(await lerCorpo(req))))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'PUT') {
                ok(await db().from('zap_departamentos').update(validarDepto(await lerCorpo(req))).eq('id', partes[1]))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'DELETE') {
                ok(await db().from('zap_departamentos').delete().eq('id', partes[1]))
                return responder({ ok: true })
            }
        }

        if (partes[0] === 'usuarios') {
            exigirAdmin(usuario)
            if (!partes[1] && metodo === 'GET') return responder(await listarUsuarios())
            if (!partes[1] && metodo === 'POST') return responder(await criarUsuario(req))
            if (partes[1] === 'wati' && !partes[2] && metodo === 'GET') return responder({ operadores: await operadoresWati() })
            if (partes[1] === 'wati' && partes[2] === 'importar' && metodo === 'POST') return responder(await importarUsuariosWati(req))
            if (partes[1] === 'wati' && partes[2] === 'atribuicoes' && metodo === 'POST') return responder(await importarAtribuicoesWati(req))
            if (partes[1] && partes[2] === 'convite' && metodo === 'POST') return responder(await reenviarConvite(partes[1]))
            if (partes[1] && metodo === 'PUT') return responder(await editarUsuario(req, partes[1]))
            if (partes[1] && metodo === 'DELETE') {
                if (partes[1] === ADMIN_ENV_ID || partes[1] === usuario.id) throw new HttpError(400, 'Não é possível remover este usuário.')
                ok(await db().from('zap_usuarios').delete().eq('id', partes[1]))
                return responder({ ok: true })
            }
        }

        throw new HttpError(404, 'Rota não encontrada.')
    } catch (e) {
        const status = e instanceof HttpError || e instanceof DbError || e instanceof wati.WatiError ? e.status : 500
        if (status >= 500) console.error('[zap]', e)
        enviar(res, status, {
            erro: status === 500 && !(e instanceof DbError) ? 'Erro interno no painel. Tente de novo; se persistir, avise o administrador.' : e.message,
            codigo: e.codigo || (status === 401 ? 'sessao' : status === 403 ? 'acesso' : status >= 500 ? 'servidor' : 'requisicao'),
        })
    }
}
