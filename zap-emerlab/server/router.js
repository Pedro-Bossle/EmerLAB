// Roteador único da API do painel (usado pela função Vercel e pelo servidor de dev)
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { getEnv, envFaltando } from './env.js'
import { hashSenha, conferirSenha, criarToken, lerToken, compararSeguro, segredoAleatorio, impressao } from './crypto.js'
import { db, ok, DbError, buscarUsuarioPorEmail, buscarUsuarioPorId, idsDepartamentos } from './db.js'
import * as wati from './wati.js'
import { emailConfigurado, enviarEmail, montarEmailConvite } from './email.js'
import { municipiosPorUf } from './ibge.js'
import { lerRegras } from '../src/regras.js'
import { preencherVariaveis } from '../src/variaveis.js'

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
    const d = soDigitos(bruto)
    if (d.length < 8 || d.length > 15) throw new HttpError(400, 'Conversa inválida.', 'requisicao')
    return { id: d, canal: 'whatsapp', alvo: d }
}

// alvo aceito pelos endpoints v1 da WATI (número ou ContactId)
const alvoWati = (id) => lerIdConversa(id).alvo
const canalDe = (id) => lerIdConversa(id).canal

// ---------- limite de tentativas de login (por instância) ----------

const tentativas = new Map()
function checarLimiteLogin(ip) {
    const agora = Date.now()
    const t = tentativas.get(ip)
    if (!t || t.reset < agora) {
        tentativas.set(ip, { n: 1, reset: agora + 15 * 60 * 1000 })
        return
    }
    t.n += 1
    if (t.n > 10) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.')
}

// ---------- sessão / permissões ----------

async function usuarioDaSessao(req) {
    const env = getEnv()
    const payload = lerToken(lerCookies(req)[COOKIE], env.sessionSecret)
    if (!payload) throw new HttpError(401, 'Sessão expirada. Entre novamente.')
    if (payload.uid === ADMIN_ENV_ID) {
        if (!env.adminEmail || payload.email !== env.adminEmail) throw new HttpError(401, 'Sessão inválida.')
        return { id: ADMIN_ENV_ID, nome: env.adminNome, email: env.adminEmail, papel: 'admin', departamentos: [] }
    }
    const u = await buscarUsuarioPorId(payload.uid)
    if (!u || !u.ativo) throw new HttpError(401, 'Usuário desativado.')
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, departamentos: idsDepartamentos(u) }
}

function exigirAdmin(usuario) {
    if (usuario.papel !== 'admin') throw new HttpError(403, 'Apenas administradores.')
}

function podeVerConversa(usuario, meta) {
    if (usuario.papel === 'admin') return true
    if (meta?.atendente_email && meta.atendente_email === usuario.email) return true
    if (!meta?.departamento_id) return getEnv().atendenteVeSemDepto
    return usuario.departamentos.includes(meta.departamento_id)
}

async function metaConversa(waId) {
    return ok(await db().from('zap_conversas').select('*').eq('wa_id', waId).maybeSingle())
}

async function exigirConversa(usuario, waId) {
    const meta = await metaConversa(waId)
    if (!podeVerConversa(usuario, meta)) throw new HttpError(403, 'Esta conversa foi transferida para outro departamento e saiu da sua fila.', 'outro_departamento')
    return meta
}

async function salvarMeta(waId, campos) {
    ok(
        await db()
            .from('zap_conversas')
            .upsert({ wa_id: waId, ...campos, atualizado_em: new Date().toISOString() }, { onConflict: 'wa_id' }),
    )
}

// ---------- normalização ----------

function normalizarMensagem(m) {
    const evento = m.eventType || 'message'
    return {
        id: m.id || m.whatsappMessageId || `${m.created}-${Math.random()}`,
        wamid: m.whatsappMessageId || m.messageId || null,
        tipo: m.type || 'text',
        texto: m.text ?? m.finalText ?? '',
        arquivo: typeof m.data === 'string' ? m.data : null,
        em: m.created || (m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null),
        minha: Boolean(m.owner),
        status: String(m.statusString || m.status || '').toLowerCase(),
        operador: m.operatorName || null,
        falha: m.failedDetail || m.failedReason || m.errorMessage || null,
        evento,
        descricao: m.eventDescription || null,
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

// atributos da WATI que entram na busca da lista (além de nome, telefone e etiquetas)
const ATRIBUTOS_BUSCA = ['tipo', 'cidade', 'uf']

function normalizarContato(c) {
    const waId = soDigitos(c.wAid || c.waId || c.phone)
    const atributos = {}
    for (const p of c.customParams || []) {
        const k = String(p?.name || '').toLowerCase()
        if (ATRIBUTOS_BUSCA.includes(k) && p.value) atributos[k] = String(p.value)
    }
    return {
        waId,
        nome: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.firstName || null,
        foto: c.photo || null,
        atualizadoEm: c.lastUpdated || c.created || null,
        atributos,
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
    checarLimiteLogin(ipDe(req))
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
        sessao = { uid: u.id, email: u.email }
    }
    const maxAge = Math.round(env.sessionHoras * 3600)
    const token = criarToken({ ...sessao, exp: Date.now() + maxAge * 1000 }, env.sessionSecret)
    tentativas.delete(ipDe(req))
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
    checarLimiteLogin(ipDe(req))
    const env = getEnv()
    const { token, senha } = await lerCorpo(req)
    if (!senha || String(senha).length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres.')
    const u = await lerConvite(token)
    ok(await db().from('zap_usuarios').update({ senha_hash: hashSenha(senha), atualizado_em: new Date().toISOString() }).eq('id', u.id))
    const maxAge = Math.round(env.sessionHoras * 3600)
    const sessao = criarToken({ uid: u.id, email: u.email, exp: Date.now() + maxAge * 1000 }, env.sessionSecret)
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
        config: { tenantId: env.watiTenantId, canalConfigurado: Boolean(env.watiChannel), webhook: Boolean(env.webhookSecret) },
    }
}

async function trocarSenha(req, usuario) {
    if (usuario.id === ADMIN_ENV_ID) throw new HttpError(400, 'A senha do administrador inicial é definida no .env (ZAP_ADMIN_SENHA).')
    const { atual, nova } = await lerCorpo(req)
    if (!nova || String(nova).length < 8) throw new HttpError(400, 'A nova senha precisa ter ao menos 8 caracteres.')
    const u = await buscarUsuarioPorEmail(usuario.email)
    if (!u || !conferirSenha(atual || '', u.senha_hash)) throw new HttpError(400, 'Senha atual incorreta.')
    ok(await db().from('zap_usuarios').update({ senha_hash: hashSenha(nova), atualizado_em: new Date().toISOString() }).eq('id', u.id))
    return { ok: true }
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
    for (const c of contatos) if (c.waId) porId.set(c.waId, { ...c })
    for (const m of metas) {
        const atual = porId.get(m.wa_id) || { waId: m.wa_id, nome: m.nome, foto: null, atualizadoEm: null }
        porId.set(m.wa_id, { ...atual, nome: atual.nome || m.nome, meta: m })
    }
    let lista = [...porId.values()]
        .filter((c) => podeVerConversa(usuario, c.meta))
        .map((c) => {
            const ultimaEm = [c.meta?.ultima_msg_em, c.atualizadoEm].filter(Boolean).sort().pop() || null
            return {
                waId: c.waId,
                nome: c.nome || null,
                foto: c.foto,
                ultimaMsg: c.meta?.ultima_msg || null,
                ultimaMinha: c.meta?.ultima_msg_minha ?? null,
                ultimaEm,
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
                Object.values(c.atributos).some((v) => v.toLowerCase().includes(b)) ||
                (d && canal === 'whatsapp' && c.waId.includes(d)),
        )
    }
    await verificarNaWati(lista, new Map(metas.map((m) => [m.wa_id, m])))
    lista.sort((a, b) => String(b.ultimaEm || '').localeCompare(String(a.ultimaEm || '')))
    return { conversas: lista, canal }
}

// Sem webhook, o banco não fica sabendo das mensagens novas: a cada carregamento da lista, verifica na WATI
// as últimas mensagens de algumas conversas (nunca vistas primeiro, depois as ativas há mais tempo sem checar)
// e grava prévia, horário e quantidade de não lidas, para o card mostrar como no WhatsApp.
// Com o webhook configurado, a verificação só confirma o que já chegou por ele.
const VERIFICAR_POR_VEZ = 6
const INTERVALO_VERIFICACAO = 20000
const ATIVA_MS = 48 * 3600 * 1000
const FOLGA_MS = 2000 // webhook grava em segundos; a WATI devolve com milissegundos
const verificadas = new Map() // waId → quando foi checada (por instância do servidor)

function escolherParaVerificar(lista) {
    const agora = Date.now()
    const nunca = lista.filter((c) => !verificadas.has(c.waId))
    const ativas = lista
        .filter((c) => verificadas.has(c.waId) && agora - verificadas.get(c.waId) > INTERVALO_VERIFICACAO)
        .filter((c) => c.ultimaEm && agora - new Date(c.ultimaEm).getTime() < ATIVA_MS)
        .sort((a, b) => verificadas.get(a.waId) - verificadas.get(b.waId))
    return [...nunca, ...ativas].slice(0, VERIFICAR_POR_VEZ)
}

async function verificarNaWati(lista, metaPorId) {
    await Promise.allSettled(
        escolherParaVerificar(lista).map(async (c) => {
            verificadas.set(c.waId, Date.now())
            const { mensagens: itens } = await wati.listarMensagens(alvoWati(c.waId), { pagina: 1, tamanho: 20 })
            const msgs = itens
                .map(normalizarMensagem)
                .filter((m) => (m.evento === 'message' || m.evento === 'broadcastMessage') && m.em)
                .sort((a, b) => String(b.em).localeCompare(String(a.em)))
            const ultima = msgs[0]
            if (!ultima) return
            const meta = metaPorId.get(c.waId)
            const conhecidaMs = meta?.ultima_msg_em ? new Date(meta.ultima_msg_em).getTime() : null
            const nova = (m) => conhecidaMs === null || new Date(m.em).getTime() > conhecidaMs + FOLGA_MS
            if (conhecidaMs !== null && !nova(ultima)) return
            // mensagens do cliente depois da última resposta nossa
            const corte = msgs.findIndex((m) => m.minha)
            const semResposta = corte < 0 ? msgs : msgs.slice(0, corte)
            let naoLidas
            if (conhecidaMs === null) {
                // primeira vez: só conta como nova se ainda dá para responder (janela de 24h)
                naoLidas = Date.now() - new Date(ultima.em).getTime() < 24 * 3600 * 1000 ? semResposta.length : 0
            } else if (msgs.some((m) => m.minha && nova(m))) {
                naoLidas = semResposta.length // alguém respondeu (pela WATI): conta só o que veio depois
            } else {
                naoLidas = (meta?.nao_lidas || 0) + semResposta.filter(nova).length
            }
            const texto = textoPrevia(ultima.tipo, ultima.texto).slice(0, 500)
            const campos = { ultima_msg: texto, ultima_msg_em: ultima.em, ultima_msg_minha: ultima.minha, nao_lidas: naoLidas }
            // cliente escreveu numa conversa resolvida → reabre (igual ao webhook)
            if (!ultima.minha && meta?.status === 'resolvida') campos.status = 'aberta'
            await salvarMeta(c.waId, campos)
            Object.assign(c, {
                ultimaMsg: texto,
                ultimaMinha: ultima.minha,
                ultimaEm: [c.ultimaEm, ultima.em].filter(Boolean).sort().pop(),
                naoLidas,
                ...(campos.status ? { status: campos.status } : {}),
            })
        }),
    )
}

async function mensagens(usuario, waId, query) {
    await exigirConversa(usuario, waId)
    const pagina = Math.max(1, Number(query.get('pagina')) || 1)
    const { mensagens: itens, temMais } = await wati.listarMensagens(alvoWati(waId), { pagina, tamanho: 50 })
    const lista = itens.map(normalizarMensagem).sort((a, b) => String(a.em).localeCompare(String(b.em)))
    return { mensagens: lista, temMais }
}

async function enviarTextoHandler(req, usuario, waId) {
    const meta = await exigirConversa(usuario, waId)
    const { texto, replyContextId } = await lerCorpo(req)
    const limpo = String(texto || '').trim()
    if (!limpo) throw new HttpError(400, 'Mensagem vazia.', 'vazia')
    if (limpo.length > 4096) throw new HttpError(400, `Mensagem muito longa: ${limpo.length} de 4096 caracteres. Divida em duas.`, 'longa')
    const final = preencherVariaveis(limpo, { nome: meta?.nome || '', atendente: usuario.nome, telefone: canalDe(waId) === 'whatsapp' ? waId : '' })
    const msg = await wati.enviarTexto(alvoWati(waId), final, replyContextId)
    await salvarMeta(waId, {
        ultima_msg: final.slice(0, 500),
        ultima_msg_em: new Date().toISOString(),
        ultima_msg_minha: true,
        nao_lidas: 0,
        ...(meta?.atendente_email ? {} : { atendente_email: usuario.email }),
    })
    return { ok: true, mensagem: msg ? normalizarMensagem({ ...msg, owner: true }) : null }
}

async function enviarArquivoHandler(req, usuario, waId) {
    await exigirConversa(usuario, waId)
    const { nome, mime, base64, legenda } = await lerCorpo(req)
    if (!base64) throw new HttpError(400, 'Arquivo vazio.')
    const buffer = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64')
    if (buffer.length > MAX_ARQUIVO) throw new HttpError(413, 'Arquivo acima de 3 MB. Comprima ou envie um link.', 'arquivo_grande')
    await wati.enviarArquivo(alvoWati(waId), { buffer, nomeArquivo: String(nome || 'arquivo').slice(0, 120), mime, legenda })
    await salvarMeta(waId, { ultima_msg: `📎 ${nome || 'Arquivo'}`, ultima_msg_em: new Date().toISOString(), ultima_msg_minha: true, nao_lidas: 0 })
    return { ok: true }
}

async function enviarTemplateHandler(req, usuario, waId) {
    await exigirConversa(usuario, waId)
    if (canalDe(waId) !== 'whatsapp') throw new HttpError(400, 'Templates existem só no WhatsApp. No Instagram e no Messenger, aguarde o cliente escrever.', 'canal')
    const { nome, parametros } = await lerCorpo(req)
    if (!nome) throw new HttpError(400, 'Escolha um template.')
    await wati.enviarTemplate(alvoWati(waId), nome, parametros)
    await salvarMeta(waId, { ultima_msg: `📄 Template: ${nome}`, ultima_msg_em: new Date().toISOString(), ultima_msg_minha: true })
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
        await wati.atribuirAtendente(alvoWati(waId), alvo)
    } catch (e) {
        // e-mail pode não existir como operador na WATI; mantém a atribuição local
        avisoWati = e.message
    }
    await salvarMeta(waId, { atendente_email: alvo })
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
    const alvo = alvoWati(waId)
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
        const c = await wati.detalheContato(alvoWati(waId))
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
        const c = await wati.detalheContato(alvoWati(waId))
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
    return {
        perfil: {
            waId,
            nomeWhatsapp: ficha?.nome || meta?.nome || '',
            email: meta?.email || '',
            tags: meta?.tags || [],
            notas: meta?.notas || '',
        },
        wati: ficha,
        avisoWati,
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
    await salvarMeta(waId, {
        email: email || null,
        tags,
        notas: String(b.notas || '').trim().slice(0, 2000) || null,
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
                await wati.atualizarAtributos(alvoWati(waId), atributos)
            } catch (e) {
                avisoWati = e.message
            }
        }
    }
    return { ok: true, tags, avisoWati, atributosVazios, falhasTags }
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
            await wati.atribuirEquipe(alvoWati(waId), [depto.equipe_wati])
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
        await wati.atualizarStatus(alvoWati(waId), status)
    } catch (e) {
        avisoWati = e.message
    }
    await salvarMeta(waId, { status })
    return { ok: true, avisoWati }
}

async function midiaHandler(res, usuario, query) {
    const arquivo = String(query.get('arquivo') || '')
    const waId = query.get('waId') ? lerIdConversa(query.get('waId')).id : ''
    if (!arquivo || arquivo.includes('..')) throw new HttpError(400, 'Arquivo inválido.')
    if (waId) await exigirConversa(usuario, waId)
    const resp = await wati.baixarMidia(arquivo)
    res.statusCode = 200
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/octet-stream')
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

function validarResposta(b) {
    const atalho = String(b.atalho || '').trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-')
    const texto = String(b.texto || '').trim()
    if (!atalho || !texto) throw new HttpError(400, 'Atalho e texto são obrigatórios.')
    const regras = String(b.regras || '').trim().slice(0, 2000)
    const { erros } = lerRegras(regras)
    if (erros.length) throw new HttpError(400, `Regras: ${erros[0]}`)
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
    for (const item of (Array.isArray(b.itens) ? b.itens : []).slice(0, MAX_IMPORTACAO)) {
        try {
            const r = validarResposta({ ...item, departamentoId })
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
        const comAtendente = ok(
            await db()
                .from('zap_conversas')
                .select('wa_id')
                .in('wa_id', recentes.map((c) => soDigitos(c.wAid)))
                .not('atendente_email', 'is', null),
        )
        const jaTem = new Set(comAtendente.map((m) => m.wa_id))
        recentes = recentes.filter((c) => !jaTem.has(soDigitos(c.wAid)))
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
            await salvarMeta(soDigitos(grupo[j].wAid), { atendente_email: email })
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

async function webhook(req, res, query) {
    const { webhookSecret } = getEnv()
    if (!webhookSecret || !compararSeguro(query.get('token') || '', webhookSecret)) throw new HttpError(401, 'Token inválido.')
    const b = await lerCorpo(req)
    const waId = soDigitos(b.waId || b.whatsappNumber)
    const evento = b.eventType || ''
    if (waId && (evento === 'message' || evento === 'sessionMessageSent' || evento === 'templateMessageSent' || b.text !== undefined)) {
        const minha = Boolean(b.owner) || evento === 'sessionMessageSent' || evento === 'templateMessageSent'
        const texto = textoPrevia(b.type, b.text || b.finalText)
        const em = b.timestamp ? new Date(Number(b.timestamp) * 1000).toISOString() : b.created || new Date().toISOString()
        ok(
            await db().rpc('zap_registrar_mensagem', {
                p_wa_id: waId,
                p_nome: minha ? null : b.senderName || null,
                p_texto: String(texto).slice(0, 500),
                p_em: em,
                p_minha: minha,
            }),
        )
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
        if (rota === 'auth/senha' && metodo === 'POST') return responder(await trocarSenha(req, usuario))
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

        if (partes[0] === 'conversas' && partes[1]) {
            const waId = lerIdConversa(decodeURIComponent(partes[1])).id
            const acao = partes[2]
            if (acao === 'mensagens' && metodo === 'GET') return responder(await mensagens(usuario, waId, query))
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
                await gravarResposta(validarResposta(await lerCorpo(req)), (d) => db().from('zap_respostas_rapidas').insert(d))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'PUT') {
                await gravarResposta(validarResposta(await lerCorpo(req)), (d) => db().from('zap_respostas_rapidas').update(d).eq('id', partes[1]))
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
