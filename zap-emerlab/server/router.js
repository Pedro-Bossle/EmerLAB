// Roteador único da API do painel (usado pela função Vercel e pelo servidor de dev)
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { getEnv, envFaltando } from './env.js'
import { hashSenha, conferirSenha, criarToken, lerToken, compararSeguro } from './crypto.js'
import { db, ok, DbError, buscarUsuarioPorEmail, buscarUsuarioPorId, idsDepartamentos } from './db.js'
import * as wati from './wati.js'

const COOKIE = 'zap_sess'
const ADMIN_ENV_ID = 'admin-env'
const MAX_ARQUIVO = 3 * 1024 * 1024 // limite de corpo da Vercel (~4,5 MB) com base64

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

function normalizarContatoCanal(c, canal) {
    return {
        waId: `${PREFIXO_CANAL[canal]}:${c.id}`,
        nome: c.name || c.display_name || c.username || null,
        foto: c.photo || null,
        atualizadoEm: c.last_updated || c.created || null,
    }
}

function normalizarContato(c) {
    const waId = soDigitos(c.wAid || c.waId || c.phone)
    return {
        waId,
        nome: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.firstName || null,
        foto: c.photo || null,
        atualizadoEm: c.lastUpdated || c.created || null,
    }
}

function preencherVariaveis(texto, ctx) {
    return String(texto).replace(/\{\{\s*(nome|primeiro_nome|atendente|telefone)\s*\}\}/gi, (_, k) => {
        const chave = k.toLowerCase()
        if (chave === 'primeiro_nome') return (ctx.nome || '').split(' ')[0]
        return ctx[chave] ?? ''
    })
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
            ? wati.listarContatos({ tamanho: 100, nome: busca && !/^\d+$/.test(busca) ? busca : undefined }).then((r) => r.contatos.map(normalizarContato))
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
            }
        })
    if (busca) {
        const b = busca.toLowerCase()
        const d = soDigitos(busca)
        lista = lista.filter((c) => (c.nome || '').toLowerCase().includes(b) || (d && canal === 'whatsapp' && c.waId.includes(d)))
    }
    lista.sort((a, b) => String(b.ultimaEm || '').localeCompare(String(a.ultimaEm || '')))
    return { conversas: lista, canal }
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

async function listarRespostas(usuario) {
    let q = db().from('zap_respostas_rapidas').select('id, atalho, titulo, texto, departamento_id').order('atalho')
    if (usuario.papel !== 'admin') {
        const ids = usuario.departamentos
        q = ids.length ? q.or(`departamento_id.is.null,departamento_id.in.(${ids.join(',')})`) : q.is('departamento_id', null)
    }
    return { respostas: ok(await q) }
}

function validarResposta(b) {
    const atalho = String(b.atalho || '').trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-')
    const texto = String(b.texto || '').trim()
    if (!atalho || !texto) throw new HttpError(400, 'Atalho e texto são obrigatórios.')
    return { atalho: atalho.slice(0, 40), titulo: String(b.titulo || '').trim().slice(0, 80) || null, texto: texto.slice(0, 4096), departamento_id: b.departamentoId || null }
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
        await db().from('zap_usuarios').select('id, nome, email, papel, ativo, criado_em, zap_usuario_departamentos(departamento_id)').order('nome'),
    )
    const usuarios = lista.map((u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo, departamentos: idsDepartamentos(u) }))
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
    if (!b.senha || String(b.senha).length < 8) throw new HttpError(400, 'A senha precisa ter ao menos 8 caracteres.')
    if (email === getEnv().adminEmail) throw new HttpError(400, 'Esse e-mail é o administrador inicial do .env.')
    const papel = b.papel === 'admin' ? 'admin' : 'atendente'
    const criado = ok(
        await db().from('zap_usuarios').insert({ nome, email, papel, senha_hash: hashSenha(b.senha), ativo: b.ativo !== false }).select('id').single(),
    )
    await salvarDepartamentosDoUsuario(criado.id, b.departamentos)
    return { ok: true, id: criado.id }
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
        const texto = b.text || b.finalText || (b.type && b.type !== 'text' ? `📎 ${b.type}` : '')
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
        if (rota === 'auth/logout' && metodo === 'POST') return enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) })

        const usuario = await usuarioDaSessao(req)
        const responder = (corpo) => enviar(res, 200, corpo)

        if (rota === 'auth/me' && metodo === 'GET') return responder(await me(usuario))
        if (rota === 'auth/senha' && metodo === 'POST') return responder(await trocarSenha(req, usuario))
        if (rota === 'conversas' && metodo === 'GET') return responder(await listarConversas(usuario, query))
        if (rota === 'templates' && metodo === 'GET') return responder({ templates: await wati.listarTemplates() })
        if (rota === 'media' && metodo === 'GET') return await midiaHandler(res, usuario, query)
        if (rota === 'equipe' && metodo === 'GET') return responder(await equipe())

        if (partes[0] === 'conversas' && partes[1]) {
            const waId = lerIdConversa(decodeURIComponent(partes[1])).id
            const acao = partes[2]
            if (acao === 'mensagens' && metodo === 'GET') return responder(await mensagens(usuario, waId, query))
            if (acao === 'lida' && metodo === 'POST') {
                await exigirConversa(usuario, waId)
                await salvarMeta(waId, { nao_lidas: 0 })
                return responder({ ok: true })
            }
            if (acao === 'texto' && metodo === 'POST') return responder(await enviarTextoHandler(req, usuario, waId))
            if (acao === 'arquivo' && metodo === 'POST') return responder(await enviarArquivoHandler(req, usuario, waId))
            if (acao === 'template' && metodo === 'POST') return responder(await enviarTemplateHandler(req, usuario, waId))
            if (acao === 'atribuir' && metodo === 'POST') return responder(await atribuirHandler(req, usuario, waId))
            if (acao === 'departamento' && metodo === 'POST') return responder(await departamentoHandler(req, usuario, waId))
            if (acao === 'status' && metodo === 'POST') return responder(await statusHandler(req, usuario, waId))
        }

        if (partes[0] === 'respostas') {
            if (!partes[1] && metodo === 'GET') return responder(await listarRespostas(usuario))
            exigirAdmin(usuario)
            if (!partes[1] && metodo === 'POST') {
                ok(await db().from('zap_respostas_rapidas').insert(validarResposta(await lerCorpo(req))))
                return responder({ ok: true })
            }
            if (partes[1] && metodo === 'PUT') {
                ok(await db().from('zap_respostas_rapidas').update(validarResposta(await lerCorpo(req))).eq('id', partes[1]))
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
