// Integração com a Microsoft (Outlook e Teams) pelo Microsoft Graph.
//
// Modelo: permissões DELEGADAS e individuais. Cada atendente entra com a própria conta Microsoft; o servidor guarda o
// refresh token (cifrado) e fala com o Graph em nome dessa pessoa. Ninguém vê o que outra pessoa não vê no Outlook/Teams
// (canais privados continuam só para quem é membro: quem controla isso é o administrador, no próprio Teams).
//
// Nenhum e-mail nem mensagem é gravado no banco. O webhook do Graph só avisa "mudou" (Supabase Realtime) e a tela busca
// o conteúdo de novo pela API. Tudo fica desligado até MS_ATIVO=true e o app estar registrado no Azure.
import { getEnv, msFaltando } from './env.js'
import { db, ok } from './db.js'
import { cifrar, decifrar, criarToken, lerToken, segredoAleatorio, compararSeguro } from './crypto.js'
import { avisar } from './tempoReal.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'

// Nunca use 401 aqui: no painel, 401 significa "sessão do Emerzap expirou" e derruba o login.
export class MsError extends Error {
    constructor(status, message, codigo = 'ms') {
        super(message)
        this.status = status
        this.codigo = codigo
    }
}

export const ESCOPOS = [
    'offline_access',
    'User.Read',
    'Mail.ReadWrite',
    'Mail.Send',
    'Team.ReadBasic.All',
    'Channel.ReadBasic.All',
    'ChannelMessage.Read.All',
    'ChannelMessage.Send',
]

export function msAtivo() {
    return getEnv().msAtivo && msFaltando().length === 0
}

export function exigirMsAtivo() {
    if (!getEnv().msAtivo) throw new MsError(404, 'A integração com a Microsoft não está ligada.', 'ms_desligado')
    const falta = msFaltando()
    if (falta.length) throw new MsError(503, `Integração Microsoft sem configuração: ${falta.join(', ')}.`, 'ms_config')
}

const urlAutoridade = () => `https://login.microsoftonline.com/${encodeURIComponent(getEnv().msTenantId)}/oauth2/v2.0`

// ---------- login (OAuth, código de autorização) ----------

/** Endereço da Microsoft para onde mandar o navegador. O state é assinado e amarrado ao usuário (anti-CSRF). */
export function urlLogin(usuario, app) {
    exigirMsAtivo()
    const e = getEnv()
    const state = criarToken({ uid: usuario.id, app: app === 'teams' ? 'teams' : 'outlook', exp: Date.now() + 10 * 60_000, n: segredoAleatorio() }, e.sessionSecret)
    const q = new URLSearchParams({
        client_id: e.msClientId,
        response_type: 'code',
        redirect_uri: e.msRedirectUri,
        response_mode: 'query',
        scope: ESCOPOS.join(' '),
        state,
        prompt: 'select_account',
    })
    return `${urlAutoridade()}/authorize?${q}`
}

async function pedirToken(params) {
    const e = getEnv()
    const resp = await fetch(`${urlAutoridade()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: e.msClientId, client_secret: e.msClientSecret, scope: ESCOPOS.join(' '), ...params }),
    }).catch(() => {
        throw new MsError(502, 'Não foi possível falar com a Microsoft agora. Tente de novo.', 'ms_rede')
    })
    const dados = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        const revogado = dados.error === 'invalid_grant' || dados.error === 'interaction_required'
        if (!revogado) console.error('[ms] token', dados.error, dados.error_description)
        throw new MsError(revogado ? 409 : 502, revogado ? 'Reconecte sua conta Microsoft.' : 'A Microsoft recusou o login. Avise o administrador.', revogado ? 'ms_reconectar' : 'ms_login')
    }
    return dados
}

const acessos = new Map() // usuarioId → { token, expira }
const renovando = new Map() // usuarioId → Promise (junta renovações simultâneas)

function guardarAcesso(uid, dados) {
    acessos.set(uid, { token: dados.access_token, expira: Date.now() + Math.max(60, (dados.expires_in || 3600) - 120) * 1000 })
}

/** Termina o login: troca o código pelos tokens e grava a conta (refresh token cifrado). Devolve o app de origem. */
export async function concluirLogin(usuario, code, state) {
    exigirMsAtivo()
    const e = getEnv()
    const estado = lerToken(state, e.sessionSecret)
    if (!estado || estado.uid !== usuario.id) throw new MsError(400, 'Login Microsoft inválido ou expirado. Tente de novo.', 'ms_state')
    const dados = await pedirToken({ grant_type: 'authorization_code', code, redirect_uri: e.msRedirectUri })
    if (!dados.refresh_token) throw new MsError(502, 'A Microsoft não devolveu acesso permanente (offline_access).', 'ms_login')
    const perfil = await fetch(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${dados.access_token}` } })
        .then((r) => r.json())
        .catch(() => ({}))
    if (!perfil.id) throw new MsError(502, 'Não foi possível ler o perfil da conta Microsoft.', 'ms_login')
    ok(
        await db().from('zap_ms_contas').upsert({
            usuario_id: usuario.id,
            ms_id: perfil.id,
            email: perfil.mail || perfil.userPrincipalName || null,
            nome: perfil.displayName || null,
            refresh_token: cifrar(dados.refresh_token, e.msTokenKey),
            escopos: dados.scope || null,
            status: 'ok',
            atualizado_em: new Date().toISOString(),
        }),
    )
    guardarAcesso(usuario.id, dados)
    return estado.app
}

async function lerConta(uid) {
    return ok(await db().from('zap_ms_contas').select('usuario_id, ms_id, email, nome, refresh_token, status').eq('usuario_id', uid).maybeSingle())
}

async function acessoDe(uid) {
    const guardado = acessos.get(uid)
    if (guardado && guardado.expira > Date.now()) return guardado.token
    if (renovando.has(uid)) return renovando.get(uid)
    const p = (async () => {
        try {
            const conta = await lerConta(uid)
            if (!conta) throw new MsError(409, 'Conecte sua conta Microsoft.', 'ms_desconectado')
            if (conta.status === 'reconectar') throw new MsError(409, 'Reconecte sua conta Microsoft.', 'ms_reconectar')
            const refresh = decifrar(conta.refresh_token, getEnv().msTokenKey)
            if (!refresh) throw new MsError(409, 'Reconecte sua conta Microsoft.', 'ms_reconectar')
            let dados
            try {
                dados = await pedirToken({ grant_type: 'refresh_token', refresh_token: refresh })
            } catch (e) {
                if (e.codigo === 'ms_reconectar') ok(await db().from('zap_ms_contas').update({ status: 'reconectar', atualizado_em: new Date().toISOString() }).eq('usuario_id', uid))
                throw e
            }
            guardarAcesso(uid, dados)
            // a Microsoft pode girar o refresh token: guarda o novo
            if (dados.refresh_token && dados.refresh_token !== refresh) {
                ok(await db().from('zap_ms_contas').update({ refresh_token: cifrar(dados.refresh_token, getEnv().msTokenKey), atualizado_em: new Date().toISOString() }).eq('usuario_id', uid))
            }
            return dados.access_token
        } finally {
            renovando.delete(uid)
        }
    })()
    renovando.set(uid, p)
    return p
}

// ---------- chamadas ao Graph ----------

async function graph(uid, caminho, { method = 'GET', body, headers = {}, _repetiu = false } = {}) {
    const token = await acessoDe(uid)
    let resp
    try {
        resp = await fetch(caminho.startsWith('http') ? caminho : `${GRAPH}${caminho}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        })
    } catch {
        throw new MsError(502, 'Não foi possível falar com a Microsoft agora.', 'ms_rede')
    }
    if (resp.status === 401 && !_repetiu) {
        acessos.delete(uid)
        return graph(uid, caminho, { method, body, headers, _repetiu: true })
    }
    if (resp.status === 204 || resp.status === 202) return null
    const dados = await resp.json().catch(() => ({}))
    if (resp.ok) return dados
    const msg = dados?.error?.message || ''
    if (resp.status === 401) throw new MsError(409, 'Reconecte sua conta Microsoft.', 'ms_reconectar')
    if (resp.status === 403) throw new MsError(403, 'A Microsoft negou o acesso. O administrador precisa aprovar as permissões do app, ou você não é membro desse canal.', 'ms_permissao')
    if (resp.status === 404) throw new MsError(404, 'Item não encontrado na Microsoft (pode ter sido apagado).', 'ms_nao_encontrado')
    if (resp.status === 429 || resp.status === 503) throw new MsError(503, 'A Microsoft pediu para aguardar um pouco. Tente de novo em instantes.', 'ms_limite')
    console.error('[ms] graph', method, caminho.split('?')[0], resp.status, dados?.error?.code, msg)
    throw new MsError(resp.status >= 500 ? 502 : 400, 'A Microsoft recusou o pedido.', 'ms_graph')
}

// ---------- conta ----------

export async function statusConta(uid) {
    if (!msAtivo()) return { ativo: false }
    const conta = await lerConta(uid)
    return {
        ativo: true,
        conectado: Boolean(conta && conta.status === 'ok'),
        reconectar: conta?.status === 'reconectar',
        email: conta?.email || null,
        nome: conta?.nome || null,
    }
}

export async function desconectar(uid) {
    const subs = ok(await db().from('zap_ms_assinaturas').select('id').eq('usuario_id', uid))
    await Promise.all(subs.map((s) => graph(uid, `/subscriptions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }).catch(() => null)))
    ok(await db().from('zap_ms_contas').delete().eq('usuario_id', uid))
    acessos.delete(uid)
}

// ---------- conversão de textos ----------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodificar(t) {
    return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, c) => {
        if (c[0] === '#') {
            const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
        }
        return ENTIDADES[c.toLowerCase()] ?? m
    })
}

/** HTML de mensagem do Teams → texto puro (menções viram @Nome). */
export function htmlParaTexto(html) {
    return decodificar(
        String(html || '')
            .replace(/<at[^>]*>(.*?)<\/at>/gis, '@$1')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, ''),
    )
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

const EMOJI_REACAO = { like: '👍', heart: '❤️', laugh: '😆', surprised: '😮', sad: '🙁', angry: '😠' }

// ---------- Teams (canais) ----------

function mapearMensagemCanal(m, eu) {
    if (m.deletedDateTime || m.messageType !== 'message') return null
    const reacoes = {}
    for (const r of m.reactions || []) {
        const emoji = EMOJI_REACAO[r.reactionType] || r.reactionType
        reacoes[emoji] = (reacoes[emoji] || 0) + 1
    }
    const anexo = (m.attachments || []).find((a) => a.contentType === 'reference')
    const texto = htmlParaTexto(m.body?.contentType === 'html' ? m.body.content : String(m.body?.content || '').replace(/</g, '&lt;'))
    return {
        id: m.id,
        autor: m.from?.user?.displayName || m.from?.application?.displayName || 'Teams',
        texto,
        criado: m.createdDateTime,
        minha: Boolean(m.from?.user?.id && m.from.user.id === eu),
        mencao: (m.mentions || []).some((x) => x.mentioned?.user?.id === eu),
        reacoes: Object.entries(reacoes),
        arquivo: anexo ? { nome: anexo.name || 'arquivo', tipo: 'arquivo', url: anexo.contentUrl || null } : null,
    }
}

async function mensagensDoCanal(uid, eu, team, canal, top = 20) {
    const r = await graph(uid, `/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(canal)}/messages?$top=${top}`)
    // o Graph devolve da mais nova para a mais antiga; a tela quer em ordem de leitura
    return (r.value || []).map((m) => mapearMensagemCanal(m, eu)).filter(Boolean).reverse()
}

/** Equipes e canais da conta (com as últimas mensagens de cada canal). Canal sem acesso vem com `erro`. */
export async function listarCanais(uid, { mensagens = true } = {}) {
    const conta = await lerConta(uid)
    if (!conta) throw new MsError(409, 'Conecte sua conta Microsoft.', 'ms_desconectado')
    const { msTeamNome } = getEnv()
    let equipes = (await graph(uid, '/me/joinedTeams?$select=id,displayName')).value || []
    if (msTeamNome) equipes = equipes.filter((t) => String(t.displayName).trim().toLowerCase() === msTeamNome.toLowerCase())
    const canais = []
    for (const t of equipes) {
        const lista = (await graph(uid, `/teams/${encodeURIComponent(t.id)}/channels?$select=id,displayName,membershipType`)).value || []
        for (const c of lista) canais.push({ team: t.id, canal: c.id, equipe: t.displayName, nome: c.displayName, privado: c.membershipType === 'private' })
    }
    // 3 por vez: poucos canais, e o Graph limita pedidos paralelos de mensagens de canal
    const saida = []
    for (let i = 0; i < canais.length; i += 3) {
        const lote = await Promise.all(
            canais.slice(i, i + 3).map(async (c) => {
                try {
                    return { ...c, id: `${c.team}|${c.canal}`, mensagens: mensagens ? await mensagensDoCanal(uid, conta.ms_id, c.team, c.canal) : [] }
                } catch (e) {
                    if (e.codigo === 'ms_reconectar' || e.codigo === 'ms_desconectado') throw e
                    return { ...c, id: `${c.team}|${c.canal}`, mensagens: [], erro: e.message }
                }
            }),
        )
        saida.push(...lote)
    }
    return { eu: { id: conta.ms_id, nome: conta.nome }, canais: saida }
}

export async function enviarMensagemCanal(uid, team, canal, texto) {
    const t = String(texto || '').trim()
    if (!team || !canal) throw new MsError(400, 'Canal inválido.', 'requisicao')
    if (!t) throw new MsError(400, 'Escreva a mensagem.', 'requisicao')
    if (t.length > 4000) throw new MsError(400, 'Mensagem longa demais (máx. 4000 caracteres).', 'requisicao')
    const m = await graph(uid, `/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(canal)}/messages`, { method: 'POST', body: { body: { contentType: 'text', content: t } } })
    const conta = await lerConta(uid)
    return mapearMensagemCanal(m, conta?.ms_id)
}

// ---------- Outlook (e-mail) ----------

const PASTAS = { entrada: 'inbox', enviados: 'sentitems', rascunhos: 'drafts', arquivo: 'archive', lixeira: 'deleteditems' }
const CAMPOS_EMAIL = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,importance,hasAttachments,flag,bodyPreview'
const emailValido = (e) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(String(e || '').trim())

const pessoa = (r) => ({ nome: r?.emailAddress?.name || r?.emailAddress?.address || '', email: r?.emailAddress?.address || '' })

function mapearEmail(m, pasta) {
    const de = pessoa(m.from)
    const para = (m.toRecipients || []).map(pessoa)
    return {
        id: m.id,
        pasta,
        de,
        para: para.map((p) => p.nome),
        paraEmails: para.map((p) => p.email),
        cc: (m.ccRecipients || []).length ? m.ccRecipients.map((r) => pessoa(r).nome) : undefined,
        assunto: m.subject || '(sem assunto)',
        lido: m.isRead !== false,
        importante: m.importance === 'high',
        sinalizado: m.flag?.flagStatus === 'flagged',
        recebido: Date.parse(m.receivedDateTime || m.sentDateTime || '') || Date.now(),
        texto: m.bodyPreview || '',
        corpo: [],
        temAnexo: Boolean(m.hasAttachments),
    }
}

export async function listarEmails(uid, pasta, top = 30) {
    const id = PASTAS[pasta]
    if (!id) throw new MsError(400, 'Pasta inválida.', 'requisicao')
    const ordem = pasta === 'enviados' ? 'sentDateTime' : 'receivedDateTime'
    const r = await graph(uid, `/me/mailFolders/${id}/messages?$top=${Math.min(50, top)}&$orderby=${ordem} desc&$select=${CAMPOS_EMAIL}`)
    return (r.value || []).map((m) => mapearEmail(m, pasta))
}

/** Corpo e anexos de um e-mail (carregado só ao abrir, para a lista não pesar). */
export async function lerEmail(uid, id) {
    const m = await graph(uid, `/me/messages/${encodeURIComponent(id)}?$select=body,subject&$expand=attachments($select=name,size,isInline)`, {
        headers: { Prefer: 'outlook.body-content-type="html"' },
    })
    const html = m.body?.contentType === 'html' ? m.body.content : null
    return {
        id,
        html,
        corpo: html ? [] : String(m.body?.content || '').split(/\n{2,}/),
        anexos: (m.attachments || []).filter((a) => !a.isInline).map((a) => ({ nome: a.name, tamanho: a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : '' })),
    }
}

const corpoHtml = (html) => ({ contentType: 'HTML', content: String(html || '') })
const destinatarios = (lista) => (lista || []).map((e) => ({ emailAddress: { address: String(e).trim() } }))

function validarDestinos(para, cc) {
    const p = (para || []).map((e) => String(e).trim()).filter(Boolean)
    const c = (cc || []).map((e) => String(e).trim()).filter(Boolean)
    const ruim = [...p, ...c].find((e) => !emailValido(e))
    if (ruim) throw new MsError(400, `Endereço de e-mail inválido: ${ruim}`, 'requisicao')
    return { p, c }
}

export async function enviarEmail(uid, { para, cc, assunto, html }) {
    const { p, c } = validarDestinos(para, cc)
    if (!p.length) throw new MsError(400, 'Informe o destinatário.', 'requisicao')
    if (!String(assunto || '').trim()) throw new MsError(400, 'Informe o assunto.', 'requisicao')
    if (String(html || '').length > 1_000_000) throw new MsError(400, 'E-mail grande demais.', 'requisicao')
    await graph(uid, '/me/sendMail', {
        method: 'POST',
        body: { message: { subject: String(assunto).trim(), body: corpoHtml(html), toRecipients: destinatarios(p), ccRecipients: destinatarios(c) }, saveToSentItems: true },
    })
}

export async function responderEmail(uid, id, { modo, html, para }) {
    const comentario = String(html || '')
    if (modo === 'encaminhar') {
        const { p } = validarDestinos(para, [])
        if (!p.length) throw new MsError(400, 'Informe o destinatário.', 'requisicao')
        await graph(uid, `/me/messages/${encodeURIComponent(id)}/forward`, { method: 'POST', body: { comment: comentario, toRecipients: destinatarios(p) } })
        return
    }
    await graph(uid, `/me/messages/${encodeURIComponent(id)}/${modo === 'todos' ? 'replyAll' : 'reply'}`, { method: 'POST', body: { comment: comentario } })
}

export async function alterarEmail(uid, id, { lido, sinalizado }) {
    const body = {}
    if (typeof lido === 'boolean') body.isRead = lido
    if (typeof sinalizado === 'boolean') body.flag = { flagStatus: sinalizado ? 'flagged' : 'notFlagged' }
    if (!Object.keys(body).length) return
    await graph(uid, `/me/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body })
}

/** Mover muda o id do e-mail no Graph: devolve o novo. */
export async function moverEmail(uid, id, pasta) {
    const destino = PASTAS[pasta]
    if (!destino) throw new MsError(400, 'Pasta inválida.', 'requisicao')
    const m = await graph(uid, `/me/messages/${encodeURIComponent(id)}/move`, { method: 'POST', body: { destinationId: destino } })
    return { id: m?.id || id }
}

export async function excluirEmail(uid, id) {
    await graph(uid, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---------- webhook (assinaturas do Graph) ----------

const urlWebhook = () => `${getEnv().publicUrl}/api/ms/webhook`
// e-mail: o Graph permite até ~3 dias. Canal: valor configurável (a confirmar na documentação da Microsoft).
const minutosDe = (tipo) => (tipo === 'email' ? 4200 : getEnv().msCanalMinutos)
const MARGEM = 0.5 // renova quando resta menos da metade da vida da assinatura

async function recursosDesejados(uid) {
    const itens = [{ recurso: "/me/mailFolders('inbox')/messages", tipo: 'email' }]
    try {
        const { canais } = await listarCanais(uid, { mensagens: false })
        for (const c of canais) if (!c.erro) itens.push({ recurso: `/teams/${c.team}/channels/${c.canal}/messages`, tipo: 'canal' })
    } catch (e) {
        if (e.codigo === 'ms_reconectar' || e.codigo === 'ms_desconectado') throw e
    }
    return itens
}

async function criarAssinatura(uid, { recurso, tipo }) {
    const clientState = segredoAleatorio()
    const expira = new Date(Date.now() + minutosDe(tipo) * 60_000).toISOString()
    const s = await graph(uid, '/subscriptions', {
        method: 'POST',
        body: { changeType: 'created,updated', notificationUrl: urlWebhook(), lifecycleNotificationUrl: urlWebhook(), resource: recurso, expirationDateTime: expira, clientState },
    })
    ok(await db().from('zap_ms_assinaturas').upsert({ id: s.id, usuario_id: uid, recurso, tipo, client_state: clientState, expira_em: s.expirationDateTime || expira, erro: null }, { onConflict: 'usuario_id,recurso' }))
}

async function renovarAssinatura(uid, linha) {
    const expira = new Date(Date.now() + minutosDe(linha.tipo) * 60_000).toISOString()
    try {
        const s = await graph(uid, `/subscriptions/${encodeURIComponent(linha.id)}`, { method: 'PATCH', body: { expirationDateTime: expira } })
        ok(await db().from('zap_ms_assinaturas').update({ expira_em: s?.expirationDateTime || expira, erro: null }).eq('id', linha.id))
    } catch (e) {
        if (e.codigo !== 'ms_nao_encontrado') throw e
        ok(await db().from('zap_ms_assinaturas').delete().eq('id', linha.id))
        await criarAssinatura(uid, linha)
    }
}

const ultimaGarantia = new Map() // usuarioId → quando foi checado (evita refazer a cada abertura de tela)

/** Idempotente: cria o que falta e renova o que está perto de vencer. Nunca derruba a tela (erros ficam na linha). */
export async function garantirAssinaturas(uid, { forcar = false } = {}) {
    if (!msAtivo()) return { criadas: 0, renovadas: 0 }
    if (!forcar && Date.now() - (ultimaGarantia.get(uid) || 0) < 5 * 60_000) return { criadas: 0, renovadas: 0, adiado: true }
    ultimaGarantia.set(uid, Date.now())
    const existentes = ok(await db().from('zap_ms_assinaturas').select('id, recurso, tipo, expira_em').eq('usuario_id', uid))
    const porRecurso = new Map(existentes.map((l) => [l.recurso, l]))
    const desejados = await recursosDesejados(uid)
    let criadas = 0
    let renovadas = 0
    await Promise.all(
        desejados.map(async (d) => {
            try {
                const atual = porRecurso.get(d.recurso)
                if (!atual) {
                    await criarAssinatura(uid, d)
                    criadas++
                } else if (Date.parse(atual.expira_em) - Date.now() < minutosDe(d.tipo) * 60_000 * MARGEM) {
                    await renovarAssinatura(uid, atual)
                    renovadas++
                }
            } catch (e) {
                console.error('[ms] assinatura', d.tipo, e.message)
                ok(await db().from('zap_ms_assinaturas').update({ erro: String(e.message).slice(0, 200) }).eq('usuario_id', uid).eq('recurso', d.recurso))
            }
        }),
    )
    return { criadas, renovadas }
}

/** Rotina diária (cron): renova as assinaturas de todo mundo que está conectado. */
export async function renovarTodas() {
    const contas = ok(await db().from('zap_ms_contas').select('usuario_id').eq('status', 'ok'))
    let total = 0
    for (const c of contas) {
        try {
            const r = await garantirAssinaturas(c.usuario_id, { forcar: true })
            total += r.criadas + r.renovadas
        } catch (e) {
            console.error('[ms] renovação', c.usuario_id, e.message)
        }
    }
    return { contas: contas.length, alteradas: total }
}

/**
 * Notificações do Graph. Devolve quantos avisos disparou. Só confirma quem manda o clientState certo.
 * O conteúdo NÃO vem na notificação: a tela busca pela API (que exige a sessão do Emerzap).
 */
export async function processarNotificacoes(corpo) {
    const itens = Array.isArray(corpo?.value) ? corpo.value.slice(0, 100) : []
    if (!itens.length) return 0
    const ids = [...new Set(itens.map((n) => String(n.subscriptionId || '')).filter(Boolean))]
    const linhas = ok(await db().from('zap_ms_assinaturas').select('id, usuario_id, tipo, client_state').in('id', ids))
    const porId = new Map(linhas.map((l) => [l.id, l]))
    const avisados = new Set()
    for (const n of itens) {
        const linha = porId.get(String(n.subscriptionId))
        if (!linha || !compararSeguro(String(n.clientState || ''), linha.client_state)) continue // desconhecida ou forjada: ignora
        if (n.lifecycleEvent === 'subscriptionRemoved') {
            ok(await db().from('zap_ms_assinaturas').delete().eq('id', linha.id))
            ultimaGarantia.delete(linha.usuario_id) // a próxima abertura recria
        } else if (n.lifecycleEvent === 'reauthorizationRequired') {
            await renovarAssinatura(linha.usuario_id, linha).catch((e) => console.error('[ms] reautorização', e.message))
        }
        // qualquer coisa (mensagem nova, evento perdido, renovação): a tela só precisa recarregar
        avisados.add(linha.usuario_id)
    }
    await Promise.all([...avisados].map((uid) => avisar('ms', uid)))
    return avisados.size
}
