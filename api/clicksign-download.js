/**
 * Download/visualização de PDF de documento Clicksign com token no servidor.
 * GET /api/clicksign-download?envelopeId=&documentId=&variant=original|signed|auto
 */

const DEFAULT_BASE = 'https://sandbox.clicksign.com/api/v3'

function hrefDeLink(link) {
    if (!link) return ''
    if (typeof link === 'string') return link.trim()
    return String(link.href || link.url || link.download || '').trim()
}

function urlsArquivosDocumento(item) {
    const a = item?.attributes || {}
    const l = item?.links || {}
    const f = l.files || a.files || {}
    const original = hrefDeLink(f.original) || hrefDeLink(f.url) || hrefDeLink(a.download_url) || hrefDeLink(a.original_file_url) || hrefDeLink(l.download)
    const signed = hrefDeLink(f.signed) || hrefDeLink(f.signed_url) || hrefDeLink(a.signed_file_url) || hrefDeLink(a.signed_url)
    return { original, signed }
}

const normBase = (b) => String(b || DEFAULT_BASE).replace(/\/$/, '')

function pickUrl(meta, variant) {
    const { original, signed } = urlsArquivosDocumento(meta)
    const v = String(variant || 'auto').toLowerCase()
    if (v === 'signed') return signed || original
    if (v === 'original') return original || signed
    return signed || original
}

async function fetchMeta(base, token, eid, docId) {
    const url = `${base}/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(docId)}`
    const res = await fetch(url, {
        headers: {
            Authorization: token.replace(/^Bearer\s+/i, '').trim(),
            Accept: 'application/vnd.api+json',
        },
    })
    const text = await res.text()
    let data = {}
    if (text.trim()) {
        try {
            data = JSON.parse(text)
        } catch {
            return { ok: false, status: res.status, data: null }
        }
    }
    return { ok: res.ok, status: res.status, data }
}

async function fetchPdfFromUrl(fileUrl, token) {
    const headers = { Authorization: token.replace(/^Bearer\s+/i, '').trim() }
    const res = await fetch(fileUrl, { headers, redirect: 'follow' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok) return { ok: false, status: res.status, body: null, contentType: ct }
    const buf = Buffer.from(await res.arrayBuffer())
    return { ok: true, status: res.status, body: buf, contentType: ct || 'application/pdf' }
}

async function tryDownloadEndpoints(base, token, eid, docId) {
    const suffixes = ['/download', '/file', '/download?type=original']
    for (const suf of suffixes) {
        const url = `${base}/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(docId)}${suf}`
        const res = await fetch(url, {
            headers: {
                Authorization: token.replace(/^Bearer\s+/i, '').trim(),
                Accept: 'application/pdf, application/octet-stream, application/vnd.api+json',
            },
            redirect: 'follow',
        })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && (ct.includes('pdf') || ct.includes('octet-stream'))) {
            const buf = Buffer.from(await res.arrayBuffer())
            return { ok: true, body: buf, contentType: 'application/pdf' }
        }
    }
    return { ok: false }
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const { PERMISSION_KEYS } = await import('../src/lib/accessControl.js')
    const { getClientIp, validarJwtComPermissao } = await import('../src/lib/api/serverAuth.js')
    const { aplicarRateLimit, RATE_LIMITS } = await import('../src/lib/api/rateLimit.js')

    if (!aplicarRateLimit(res, `clicksign-dl:${getClientIp(req)}`, RATE_LIMITS.clicksign)) return

    const auth = await validarJwtComPermissao(req, [
        PERMISSION_KEYS.CONTRATOS_VIEW,
        PERMISSION_KEYS.CONTRATOS_EDIT,
        PERMISSION_KEYS.ACCESS_MANAGE,
    ])
    if (auth.error) {
        res.status(auth.status || 401).json({ error: auth.error })
        return
    }

    const token = (process.env.CLICKSIGN_ACCESS_TOKEN || process.env.CLICKSIGN_TOKEN || '').trim()
    if (!token) {
        res.status(503).json({ error: 'CLICKSIGN_ACCESS_TOKEN não configurado.' })
        return
    }

    const u = new URL(req.url || '/', 'http://localhost')
    const eid = String(u.searchParams.get('envelopeId') || '').trim()
    const docId = String(u.searchParams.get('documentId') || '').trim()
    const variant = String(u.searchParams.get('variant') || 'auto').trim()

    if (!eid || !docId) {
        res.status(400).json({ error: 'Parâmetros envelopeId e documentId são obrigatórios.' })
        return
    }

    const base = normBase(process.env.CLICKSIGN_API_BASE)

    const meta = await fetchMeta(base, token, eid, docId)
    if (!meta.ok) {
        res.status(meta.status || 502).json({ error: 'Não foi possível obter o documento na Clicksign.' })
        return
    }

    const item = meta.data?.data
    let fileUrl = pickUrl(item, variant)

    if (fileUrl && fileUrl.startsWith('/')) {
        fileUrl = `${base}${fileUrl}`
    }

    let pdf = null
    if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
        pdf = await fetchPdfFromUrl(fileUrl, token)
    }

    if (!pdf?.ok) {
        pdf = await tryDownloadEndpoints(base, token, eid, docId)
    }

    if (!pdf?.ok) {
        res.status(404).json({ error: 'URL de download do PDF indisponível para este documento.' })
        return
    }

    if (req.method === 'HEAD') {
        res.status(200)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Length', String(pdf.body.length))
        res.end()
        return
    }

    res.status(200)
    res.setHeader('Content-Type', pdf.contentType || 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="documento.pdf"`)
    res.end(pdf.body)
}
