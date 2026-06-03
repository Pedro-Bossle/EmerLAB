/**
 * Proxy seguro para a API 3.0 (Envelope) da Clicksign — JSON:API.
 * Variáveis: CLICKSIGN_ACCESS_TOKEN (obrigatório), CLICKSIGN_API_BASE (opcional).
 * Base padrão: https://sandbox.clicksign.com/api/v3
 *
 * Rotas locais: qualquer método em /api/clicksign/* → upstream {CLICKSIGN_API_BASE}/*
 * Ex.: GET /api/clicksign/envelopes → GET {base}/envelopes
 *
 * Autenticação: cabeçalho Authorization com o Access Token (sem prefixo Bearer), conforme documentação.
 * Accept/Content-Type: application/vnd.api+json
 */

const DEFAULT_BASE = 'https://sandbox.clicksign.com/api/v3'

const normBase = (b) => String(b || DEFAULT_BASE).replace(/\/$/, '')

/** Evita path traversal e limita a prefixos da API pública de envelope / webhooks. */
function isPathAllowed(subPath) {
    const raw = subPath.split('?')[0] || ''
    if (!raw || raw.includes('..')) return false
    const p = raw.replace(/\/+$/, '') || '/'
    const lower = p.toLowerCase()
    const prefixes = ['/envelopes', '/webhooks', '/templates', '/batch']
    return prefixes.some((pre) => lower === pre || lower.startsWith(`${pre}/`))
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

/** Compatível com Node `res` e com o adaptador do Vite (`status` + `json` + `end`). */
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

export default async function handler(req, res) {
    const token = (process.env.CLICKSIGN_ACCESS_TOKEN || process.env.CLICKSIGN_TOKEN || '').trim()
    if (!token) {
        res.status(503).json({
            error:
                'CLICKSIGN_ACCESS_TOKEN não configurado. Crie CLICKSIGN_ACCESS_TOKEN no .env.local (na raiz do projeto), reinicie o Vite (npm run dev) e confirme o nome da variável.',
        })
        return
    }

    const base = normBase(process.env.CLICKSIGN_API_BASE)
    const u = new URL(req.url || '/', 'http://localhost')
    const subPath = (u.pathname || '').replace(/^\/api\/clicksign/, '') || '/'
    const search = u.search || ''

    if (!isPathAllowed(subPath)) {
        res.status(403).json({ error: 'Caminho não permitido neste proxy. Use prefixos /envelopes, /webhooks, /templates ou /batch.' })
        return
    }

    const upstreamUrl = `${base}${subPath}${search}`
    const method = (req.method || 'GET').toUpperCase()

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
        const upstream = await fetch(upstreamUrl, fetchOpts)
        const text = await upstream.text()
        const ct = (upstream.headers.get('content-type') || '').toLowerCase()
        const pareceJson =
            !text.length ||
            ct.includes('json') ||
            ct.includes('application/vnd.api')
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
        res.status(upstream.status).json(data)
    } catch (e) {
        res.status(502).json({ error: e?.message || 'Falha ao contactar a Clicksign.' })
    }
}
