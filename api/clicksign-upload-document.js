/**
 * Anexa PDF a um envelope Clicksign sem passar o base64 pelo body da Vercel (~4,5 MB).
 *
 * Fluxo:
 * 1) Browser faz upload do PDF ao Storage (bucket clicksign-uploads)
 * 2) POST /api/clicksign-upload-document { envelopeId, filename, storagePath }
 * 3) Servidor descarrega o ficheiro, envia à Clicksign e apaga o temporário
 */
import { createSupabaseAdminClient, getClientIp, validarJwtComPermissao } from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'
import { PERMISSION_KEYS } from '../src/lib/accessControl.js'

const DEFAULT_BASE = 'https://sandbox.clicksign.com/api/v3'
const BUCKET = 'clicksign-uploads'
const PDF_MAX_BYTES = 12 * 1024 * 1024

function nomeArquivoPdfSeguro(name) {
    const n = String(name || 'documento.pdf').trim() || 'documento.pdf'
    const ascii = n
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    const out = (ascii || 'documento').slice(0, 180)
    return out.toLowerCase().endsWith('.pdf') ? out : `${out || 'documento'}.pdf`
}

function normBase(b) {
    return String(b || DEFAULT_BASE).replace(/\/$/, '')
}

function uuidOk(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(id || '').trim(),
    )
}

async function readJson(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        return req.body
    }
    if (typeof req.body === 'string' && req.body.trim()) {
        try {
            return JSON.parse(req.body)
        } catch {
            return {}
        }
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw.trim()) return {}
    try {
        return JSON.parse(raw)
    } catch {
        return {}
    }
}

function bufferToPdfDataUri(buf) {
    return `data:application/pdf;base64,${Buffer.from(buf).toString('base64')}`
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end()
        return
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Use POST.' })
        return
    }

    if (!aplicarRateLimit(res, `clicksign-upload:${getClientIp(req)}`, RATE_LIMITS.clicksign)) return

    const auth = await validarJwtComPermissao(req, [
        PERMISSION_KEYS.CONTRATOS_EDIT,
        PERMISSION_KEYS.ACCESS_MANAGE,
    ])
    if (auth.error) {
        res.status(auth.status || 401).json({ error: auth.error })
        return
    }

    const token = (process.env.CLICKSIGN_ACCESS_TOKEN || process.env.CLICKSIGN_TOKEN || '').trim()
    if (!token) {
        res.status(503).json({ error: 'CLICKSIGN_ACCESS_TOKEN não configurado no servidor.' })
        return
    }

    const body = await readJson(req)
    const envelopeId = String(body.envelopeId || body.envelope_id || '').trim()
    const storagePath = String(body.storagePath || body.storage_path || '').trim()
    const filename = nomeArquivoPdfSeguro(body.filename || body.name || 'documento.pdf')

    if (!uuidOk(envelopeId)) {
        res.status(400).json({ error: 'ID do envelope inválido.' })
        return
    }
    if (!storagePath || storagePath.includes('..') || storagePath.startsWith('/')) {
        res.status(400).json({ error: 'Caminho de storage inválido.' })
        return
    }
    // Só caminhos do próprio utilizador: {uid}/...
    const uid = String(auth.user?.id || '').trim()
    if (!uid || !storagePath.startsWith(`${uid}/`)) {
        res.status(403).json({ error: 'Storage não pertence à sessão atual.' })
        return
    }

    let admin
    try {
        admin = createSupabaseAdminClient()
    } catch (e) {
        res.status(503).json({ error: e?.message || 'Supabase admin indisponível.' })
        return
    }

    const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath)
    if (dlErr || !fileData) {
        res.status(404).json({
            error: dlErr?.message || 'Ficheiro temporário não encontrado no storage.',
            hint: 'Confirme o bucket clicksign-uploads e volte a anexar o PDF.',
        })
        return
    }

    const ab = await fileData.arrayBuffer()
    const buf = Buffer.from(ab)
    if (!buf.length) {
        res.status(400).json({ error: 'PDF vazio.' })
        return
    }
    if (buf.length > PDF_MAX_BYTES) {
        res.status(413).json({
            error: `PDF ultrapassa ${PDF_MAX_BYTES / (1024 * 1024)} MB.`,
        })
        return
    }

    const base = normBase(process.env.CLICKSIGN_API_BASE)
    const upstreamUrl = `${base}/envelopes/${encodeURIComponent(envelopeId)}/documents`
    const payload = {
        data: {
            type: 'documents',
            attributes: {
                filename,
                content_base64: bufferToPdfDataUri(buf),
            },
        },
    }

    try {
        const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                Authorization: token.replace(/^Bearer\s+/i, '').trim(),
                Accept: 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
            },
            body: JSON.stringify(payload),
        })
        const text = await upstream.text()
        let data = {}
        if (text.trim()) {
            try {
                data = JSON.parse(text)
            } catch {
                data = { error: 'Resposta inválida da Clicksign.', raw: text.slice(0, 400) }
            }
        }

        // Limpa o temporário (sucesso ou falha — evita lixo)
        try {
            await admin.storage.from(BUCKET).remove([storagePath])
        } catch {
            /* ignore */
        }

        res.status(upstream.status).json(data)
    } catch (e) {
        try {
            await admin.storage.from(BUCKET).remove([storagePath])
        } catch {
            /* ignore */
        }
        res.status(502).json({ error: e?.message || 'Falha ao contactar a Clicksign.' })
    }
}
