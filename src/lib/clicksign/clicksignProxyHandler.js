/**
 * Proxy seguro para a API 3.0 (Envelope) da Clicksign — JSON:API.
 * Usado por api/clicksign-catchall.js e dev (não é Serverless Function).
 */
import { fetchComRetry, removerSegredosWebhook, resolverBaseClicksign } from './clicksignConfig.js'

const PREFIXOS_LEITURA = ['/envelopes', '/webhooks', '/templates', '/batch']
/** Escrita só em envelopes (e batch ligado a envelopes). Webhooks/templates ficam só leitura. */
const PREFIXOS_ESCRITA = ['/envelopes', '/batch']

function normalizarSubPath(subPath) {
    const raw = String(subPath || '').split('?')[0] || ''
    if (!raw || raw.includes('..')) return ''
    return (raw.replace(/\/+$/, '') || '/')
}

function caminhoNoPrefixo(subPath, prefixes) {
    const lower = normalizarSubPath(subPath).toLowerCase()
    if (!lower) return false
    return prefixes.some((pre) => lower === pre || lower.startsWith(`${pre}/`))
}

function isPathAllowed(subPath) {
    return caminhoNoPrefixo(subPath, PREFIXOS_LEITURA)
}

function isWritePathAllowed(subPath) {
    return caminhoNoPrefixo(subPath, PREFIXOS_ESCRITA)
}

function metodoEhLeitura(method) {
    const m = String(method || 'GET').toUpperCase()
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

async function readBody(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return ''
    const chunks = []
    try {
        for await (const chunk of req) chunks.push(chunk)
    } catch {
        return ''
    }
    return Buffer.concat(chunks).toString('utf-8')
}

function setResponseStatus(res, code) {
    if (typeof res.status === 'function') {
        res.status(code)
        return
    }
    res.statusCode = code
}

function sendRawResponse(res, status, contentType, body) {
    setResponseStatus(res, status)
    res.setHeader('Content-Type', contentType)
    if (typeof res.end === 'function') {
        res.end(body)
        return
    }
    if (typeof res.json === 'function') {
        res.json({ error: 'Resposta não JSON da Clicksign.', raw: String(body || '').slice(0, 500) })
    }
}

export default async function clicksignProxyHandler(req, res) {
    const { PERMISSION_KEYS } = await import('../accessControl.js')
    const { getClientIp, validarJwtComPermissao } = await import('../api/serverAuth.js')
    const { aplicarRateLimit, RATE_LIMITS } = await import('../api/rateLimit.js')

    if (!aplicarRateLimit(res, `clicksign:${getClientIp(req)}`, RATE_LIMITS.clicksign)) return

    const method = (req.method || 'GET').toUpperCase()
    const leitura = metodoEhLeitura(method)
    const auth = await validarJwtComPermissao(
        req,
        leitura
            ? [
                  PERMISSION_KEYS.CONTRATOS_VIEW,
                  PERMISSION_KEYS.CONTRATOS_EDIT,
                  PERMISSION_KEYS.ACCESS_MANAGE,
              ]
            : [PERMISSION_KEYS.CONTRATOS_EDIT, PERMISSION_KEYS.ACCESS_MANAGE],
    )
    if (auth.error) {
        res.status(auth.status || 401).json({
            error: leitura
                ? auth.error
                : auth.status === 403
                  ? 'Sem permissão para alterar Clicksign. É necessário contratos.edit.'
                  : auth.error,
        })
        return
    }

    // Limite por usuário (o por IP, acima, é compartilhado por todo o escritório).
    if (!aplicarRateLimit(res, `clicksign-u:${auth.user?.id || 'anon'}`, RATE_LIMITS.clicksignUsuario)) return

    const token = (process.env.CLICKSIGN_ACCESS_TOKEN || process.env.CLICKSIGN_TOKEN || '').trim()
    if (!token) {
        res.status(503).json({
            error:
                'CLICKSIGN_ACCESS_TOKEN não configurado. Crie CLICKSIGN_ACCESS_TOKEN no .env.local (na raiz do projeto), reinicie o Vite (npm run dev) e confirme o nome da variável.',
        })
        return
    }

    const { base, error: erroBase } = resolverBaseClicksign()
    if (erroBase) {
        res.status(503).json({ error: erroBase })
        return
    }

    const u = new URL(req.url || '/', 'http://localhost')
    let subPath = (u.pathname || '').replace(/^\/api\/clicksign/, '') || '/'
    // Evita /envelopes/ e /envelopes//signers (ID vazio)
    subPath = subPath.replace(/\/{2,}/g, '/')
    if (subPath.length > 1) subPath = subPath.replace(/\/+$/, '')
    const search = u.search || ''

    if (!isPathAllowed(subPath)) {
        res.status(403).json({
            error: 'Caminho não permitido neste proxy. Use prefixos /envelopes, /webhooks, /templates ou /batch.',
        })
        return
    }
    if (!leitura && !isWritePathAllowed(subPath)) {
        res.status(403).json({
            error:
                'Escrita não permitida neste caminho. Use /envelopes ou /batch. /webhooks e /templates são só leitura.',
        })
        return
    }

    // Rotas que exigem UUID do envelope: /envelopes/:id/...
    const precisaEnvelopeId = /^\/envelopes\/(documents|signers|requirements)(\/|$)/i.test(subPath)
    if (precisaEnvelopeId || /^\/envelopes\/\/+/i.test(subPath)) {
        res.status(400).json({
            error: 'ID do envelope ausente. Recarregue a página e abra o envelope de novo.',
        })
        return
    }

    const upstreamUrl = `${base}${subPath}${search}`

    const headers = {
        Authorization: token.replace(/^Bearer\s+/i, '').trim(),
        Accept: 'application/vnd.api+json',
    }
    if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/vnd.api+json'
    }

    let body = ''
    if (typeof req.body === 'string') {
        body = req.body
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
        body = JSON.stringify(req.body)
    } else {
        body = await readBody(req)
    }

    const fetchOpts = { method, headers }
    if (body && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = body
    }

    try {
        // Retry com backoff + jitter (429/5xx/rede); POST só repete em 429.
        const upstream = await fetchComRetry(upstreamUrl, fetchOpts)
        const text = await upstream.text()
        const ct = (upstream.headers.get('content-type') || '').toLowerCase()
        if (upstream.status === 429) {
            setResponseStatus(res, 429)
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            // A Clicksign informa o reset em X-Rate-Limit-Reset (Unix time UTC), não em Retry-After.
            const resetUnix = Number(upstream.headers.get('x-rate-limit-reset'))
            const retryAfterSec =
                Number.isFinite(resetUnix) && resetUnix > 0
                    ? Math.max(1, Math.ceil(resetUnix - Date.now() / 1000))
                    : 10
            res.setHeader('Retry-After', String(retryAfterSec))
            res.setHeader('X-Limite-Origem', 'clicksign')
            // Os logs da Vercel não trazem o código HTTP: deixa registrado quem limitou e quanto sobrou.
            console.warn('[clicksign-proxy] 429 vindo da Clicksign', {
                path: subPath,
                limite: upstream.headers.get('x-rate-limit'),
                restante: upstream.headers.get('x-rate-limit-remaining'),
                reset: upstream.headers.get('x-rate-limit-reset'),
            })
            res.json({
                ok: false,
                origem: 'clicksign',
                error: `Limite de pedidos na API Clicksign (429). Aguarde ${retryAfterSec} s e tente de novo.`,
                retryAfterSec,
            })
            return
        }
        const pareceJson = !text.length || ct.includes('json') || ct.includes('application/vnd.api')
        if (!pareceJson && text.length > 0) {
            sendRawResponse(res, upstream.status, ct || 'text/plain; charset=utf-8', text)
            return
        }
        let data = {}
        if (text.trim()) {
            try {
                data = JSON.parse(text)
            } catch {
                if (upstream.status >= 200 && upstream.status < 300) {
                    data = {}
                } else {
                    res.status(502).json({ error: 'Resposta JSON inválida da Clicksign.', raw: text.slice(0, 500) })
                    return
                }
            }
        }
        // O `secret` HMAC dos webhooks nunca deve chegar ao navegador.
        if (/^\/webhooks(\/|$)/i.test(subPath)) data = removerSegredosWebhook(data)
        res.status(upstream.status).json(data)
    } catch (e) {
        res.status(502).json({ error: e?.message || 'Falha ao contactar a Clicksign.' })
    }
}
