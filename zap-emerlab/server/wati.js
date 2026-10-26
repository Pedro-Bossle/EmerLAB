// Cliente da API WATI (v1 /{tenantId}/api/v1 e v3 /api/ext/v3)
// Docs: https://docs.wati.io/reference/introduction
import { getEnv } from './env.js'

export class WatiError extends Error {
    constructor(message, status = 502, detalhe = null) {
        super(message)
        this.status = status
        this.detalhe = detalhe
    }
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

function v3Url(caminho) {
    const { watiBase } = getEnv()
    return new URL(`${watiBase}/api/ext/v3/${caminho}`)
}

async function chamar(url, { method = 'GET', body, headers, raw = false } = {}) {
    const { watiToken } = getEnv()
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    const resp = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${watiToken}`,
            ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    })
    if (raw) {
        if (!resp.ok) throw new WatiError(`WATI respondeu ${resp.status}`, resp.status === 404 ? 404 : 502)
        return resp
    }
    const texto = await resp.text()
    let dados = null
    try {
        dados = texto ? JSON.parse(texto) : null
    } catch {
        dados = { info: texto }
    }
    if (resp.status === 401) throw new WatiError('Token da WATI inválido ou expirado (WATI_API_TOKEN).', 502)
    if (resp.status === 403) throw new WatiError('Token da WATI sem permissão para esta ação (verifique os escopos ou o plano).', 502)
    if (resp.status === 429) throw new WatiError('Limite de requisições da WATI atingido. Tente em alguns segundos.', 429)
    if (!resp.ok) {
        const msg = dados?.info || dados?.message || dados?.error?.message || `WATI respondeu ${resp.status}`
        throw new WatiError(String(msg), resp.status >= 500 ? 502 : 400, dados)
    }
    // v1 pode responder 200 com { result: false, info }
    if (dados && (dados.result === false || dados.ok === false)) {
        throw new WatiError(String(dados.info || dados.error?.message || 'A WATI recusou a operação.'), 400, dados)
    }
    return dados
}

export async function listarContatos({ pagina = 1, tamanho = 100, nome } = {}) {
    const key = `contatos:${pagina}:${tamanho}:${nome || ''}`
    const hit = cacheGet(key)
    if (hit) return hit
    const dados = await chamar(v1Url('getContacts', { pageSize: tamanho, pageNumber: pagina, name: nome }))
    const r = { contatos: dados?.contact_list || [], total: dados?.link?.total ?? null }
    cacheSet(key, r, 8000)
    return r
}

export async function listarMensagens(waId, { pagina = 1, tamanho = 50 } = {}) {
    const key = `msgs:${waId}:${pagina}:${tamanho}`
    const hit = cacheGet(key)
    if (hit) return hit
    const { watiChannel } = getEnv()
    const dados = await chamar(
        v1Url(`getMessages/${encodeURIComponent(waId)}`, { pageSize: tamanho, pageNumber: pagina, channelPhoneNumber: watiChannel || undefined }),
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
            channelPhoneNumber: watiChannel || undefined,
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
        v1Url(`sendSessionFile/${encodeURIComponent(waId)}`, { caption: legenda, channelPhoneNumber: watiChannel || undefined }),
        { method: 'POST', body: form },
    )
    invalidarCache(`msgs:${waId}:`)
    return dados?.message || null
}

export async function baixarMidia(nomeArquivo) {
    return chamar(v1Url('getMedia', { fileName: nomeArquivo }), { raw: true })
}

export async function atribuirAtendente(waId, email) {
    const { watiChannel } = getEnv()
    return chamar(v1Url('assignOperator', { target: waId, email: email || undefined, channelPhoneNumber: watiChannel || undefined }), {
        method: 'POST',
    })
}

export async function atribuirEquipe(waId, equipes) {
    const { watiChannel } = getEnv()
    return chamar(v1Url('assignTeam', { target: waId, teams: equipes, channelPhoneNumber: watiChannel || undefined }), { method: 'POST' })
}

const STATUS_WATI = { aberta: 'open', pendente: 'pending', resolvida: 'solved' }
export async function atualizarStatus(waId, status) {
    const novo = STATUS_WATI[status]
    if (!novo) throw new WatiError('Status inválido.', 400)
    return chamar(v3Url(`conversations/${encodeURIComponent(waId)}/status`), { method: 'PUT', body: { new_status: novo } })
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
            cabecalho: t.header?.text || '',
            rodape: t.footer || '',
        }))
    cacheSet('templates', lista, 5 * 60 * 1000)
    return lista
}

export async function enviarTemplate(waId, nomeTemplate, parametros) {
    const { watiChannel } = getEnv()
    if (!watiChannel) throw new WatiError('Configure WATI_CHANNEL_NUMBER para enviar templates.', 400)
    const dados = await chamar(v1Url('sendTemplateMessage', { whatsappNumber: waId }), {
        method: 'POST',
        body: {
            template_name: nomeTemplate,
            broadcast_name: `zap_emerlab_${Date.now()}`,
            channel_number: watiChannel,
            parameters: Object.entries(parametros || {}).map(([name, value]) => ({ name, value: String(value ?? '') })),
        },
    })
    invalidarCache(`msgs:${waId}:`)
    return dados
}
