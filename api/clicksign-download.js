/**
 * Download/visualização de PDF de documento Clicksign com token no servidor.
 * GET /api/clicksign-download?envelopeId=&documentId=&variant=original|signed|auto[&format=url]
 *
 * - format=url → devolve JSON { url } com o link pré-assinado ATUAL (expira em ~5 min), para o
 *   navegador abrir direto no S3 (sem limite de 4,5 MB da Vercel e sem passar o PDF pelo servidor).
 * - sem format → o servidor baixa o PDF e o devolve (fallback).
 *
 * O Access Token só é enviado a hosts da própria Clicksign. Links pré-assinados do S3 NÃO recebem
 * o header Authorization (o S3 recusa dois mecanismos de autenticação e o token vazaria).
 */

import { fetchComRetry, hostEhApiClicksign, hostEhArquivoClicksign, resolverBaseClicksign } from '../src/lib/clicksign/clicksignConfig.js'
import { MENSAGEM_SEM_PERMISSAO_CLICKSIGN, clicksignPermitido } from '../src/lib/clicksign/clicksignPermissao.js'

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

function pickUrl(meta, variant) {
    const { original, signed } = urlsArquivosDocumento(meta)
    const v = String(variant || 'auto').toLowerCase()
    if (v === 'signed') return signed || original
    if (v === 'original') return original || signed
    return signed || original
}

const authHeader = (token) => token.replace(/^Bearer\s+/i, '').trim()

async function fetchMeta(base, token, eid, docId) {
    const url = `${base}/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(docId)}`
    const res = await fetchComRetry(url, {
        headers: {
            Authorization: authHeader(token),
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

/** Valida a URL do arquivo e decide se o token pode acompanhar a requisição. */
function avaliarUrlArquivo(fileUrl) {
    let u
    try {
        u = new URL(fileUrl)
    } catch {
        return { ok: false }
    }
    if (u.protocol !== 'https:') return { ok: false }
    if (!hostEhArquivoClicksign(u.hostname)) return { ok: false }
    return { ok: true, enviarToken: hostEhApiClicksign(u.hostname), url: u.toString() }
}

async function fetchPdfFromUrl(fileUrl, token) {
    const alvo = avaliarUrlArquivo(fileUrl)
    if (!alvo.ok) return { ok: false, status: 400, body: null, contentType: '' }
    const headers = alvo.enviarToken ? { Authorization: authHeader(token) } : {}
    const res = await fetchComRetry(alvo.url, { headers, redirect: 'follow' })
    const ct = res.headers.get('content-type') || ''
    if (!res.ok) return { ok: false, status: res.status, body: null, contentType: ct }
    const buf = Buffer.from(await res.arrayBuffer())
    return { ok: true, status: res.status, body: buf, contentType: ct || 'application/pdf' }
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

    if (!clicksignPermitido(auth.profile, 'GET')) {
        res.status(403).json({ error: MENSAGEM_SEM_PERMISSAO_CLICKSIGN })
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
    const format = String(u.searchParams.get('format') || '').trim().toLowerCase()

    if (!eid || !docId) {
        res.status(400).json({ error: 'Parâmetros envelopeId e documentId são obrigatórios.' })
        return
    }

    const { base, error: erroBase } = resolverBaseClicksign()
    if (erroBase) {
        res.status(503).json({ error: erroBase })
        return
    }

    const meta = await fetchMeta(base, token, eid, docId)
    if (!meta.ok) {
        res.status(meta.status || 502).json({ error: 'Não foi possível obter o documento na Clicksign.' })
        return
    }

    let fileUrl = pickUrl(meta.data?.data, variant)
    if (fileUrl && fileUrl.startsWith('/')) {
        fileUrl = `${new URL(base).origin}${fileUrl}`
    }

    const alvo = fileUrl ? avaliarUrlArquivo(fileUrl) : { ok: false }
    if (!alvo.ok) {
        res.status(404).json({ error: 'URL de download do PDF indisponível para este documento.' })
        return
    }

    // Link novo para o navegador abrir direto (válido por ~5 min; não deve ser guardado).
    if (format === 'url') {
        // Links na API Clicksign exigiriam o token → só devolvemos links públicos pré-assinados (S3).
        if (alvo.enviarToken) {
            res.status(409).json({ error: 'Link exige autenticação; use o download pelo servidor.' })
            return
        }
        res.setHeader('Cache-Control', 'no-store')
        res.status(200).json({ url: alvo.url })
        return
    }

    const pdf = await fetchPdfFromUrl(alvo.url, token)
    if (!pdf?.ok) {
        res.status(pdf?.status === 404 ? 404 : 502).json({
            error: 'Não foi possível baixar o PDF deste documento na Clicksign.',
        })
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
    res.setHeader('Cache-Control', 'private, no-store')
    res.end(pdf.body)
}
