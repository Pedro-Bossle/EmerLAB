/**
 * Receptor de webhooks da Clicksign (painel / API).
 * POST /api/clicksign-webhook (domínio Vercel do EmerLAB)
 *
 * Variáveis (Vercel):
 * - CLICKSIGN_WEBHOOK_SECRET — HMAC SHA256 (obrigatório em produção)
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — gravar notificações no sininho
 */

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const EVENTOS_UTEIS = new Set(['sign', 'close', 'auto_close', 'add_signer', 'remove_signer'])

async function readRawBody(req) {
    if (req.method === 'GET' || req.method === 'HEAD') return Buffer.alloc(0)
    const chunks = []
    try {
        for await (const chunk of req) chunks.push(chunk)
    } catch {
        return Buffer.alloc(0)
    }
    return Buffer.concat(chunks)
}

function header(req, name) {
    const h = req.headers || {}
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? h[key] : undefined
}

function extrairAssinaturaRecebida(req) {
    const candidatos = [
        header(req, 'content-hmac'),
        header(req, 'x-content-hmac'),
        header(req, 'x-clicksign-signature'),
        header(req, 'content-hmac-sha256'),
        header(req, 'x-hub-signature-256'),
        header(req, 'signature'),
    ]
    for (const c of candidatos) {
        if (c == null || c === '') continue
        const s = String(c).trim()
        if (s.toLowerCase().startsWith('sha256=')) return s.slice(7).trim()
        return s
    }
    return ''
}

function assinaturaEsperadaHex(secret, rawBody) {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

function igualHexSeguro(esperado, recebido) {
    const a = String(esperado || '').trim().toLowerCase()
    const b = String(recebido || '').trim().toLowerCase()
    if (!a || !b || a.length !== b.length || a.length % 2 !== 0) return false
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
    } catch {
        return false
    }
}

function verificarHmac(req, rawBody) {
    const secret = (process.env.CLICKSIGN_WEBHOOK_SECRET || '').trim()
    if (!secret) {
        if (process.env.VERCEL) {
            return { ok: false, reason: 'secret_not_configured' }
        }
        return { ok: true, skipped: true }
    }
    const recebido = extrairAssinaturaRecebida(req)
    if (!recebido) {
        return { ok: false, reason: 'missing_signature_header' }
    }
    const esperado = assinaturaEsperadaHex(secret, rawBody)
    if (igualHexSeguro(esperado, recebido)) {
        return { ok: true }
    }
    const esperadoB64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
    if (recebido === esperadoB64) {
        return { ok: true }
    }
    return { ok: false, reason: 'invalid_signature' }
}

function parseJsonBody(rawBody) {
    const raw = rawBody.toString('utf-8')
    if (!raw.trim()) return null
    try {
        return JSON.parse(raw)
    } catch {
        return { _raw: raw.slice(0, 4000) }
    }
}

function nomeEvento(body) {
    const ev = body?.event?.name || body?.event?.type || body?.event_name || body?.name || ''
    return String(ev || '').trim().toLowerCase()
}

function montarTextoNotificacao(body, evento) {
    const doc = body?.document || body?.data?.document || {}
    const env = body?.envelope || body?.data?.envelope || body?.envelope_data || {}
    const signer = body?.signer || body?.event?.data?.signer || {}
    const nomeDoc =
        String(doc.filename || doc.name || doc.path || '').trim() ||
        String(env.name || env.attributes?.name || '').trim() ||
        'Documento'
    const nomeEnv = String(env.name || env.attributes?.name || '').trim()
    const nomeSig = String(signer.name || signer.email || '').trim()

    if (evento === 'sign') {
        const quem = nomeSig ? `${nomeSig} assinou` : 'Assinatura registrada'
        return nomeEnv ? `${quem} em «${nomeEnv}».` : `${quem}: «${nomeDoc}».`
    }
    if (evento === 'close' || evento === 'auto_close') {
        return nomeEnv
            ? `Documento finalizado em «${nomeEnv}».`
            : `Documento finalizado: «${nomeDoc}».`
    }
    if (evento === 'add_signer') {
        return nomeEnv ? `Signatário adicionado em «${nomeEnv}».` : `Signatário adicionado: «${nomeDoc}».`
    }
    if (evento === 'remove_signer') {
        return nomeEnv ? `Signatário removido em «${nomeEnv}».` : `Signatário removido: «${nomeDoc}».`
    }
    return `Evento Clicksign: ${evento || 'desconhecido'}`
}

function extrairIds(body) {
    const doc = body?.document || body?.data?.document || {}
    const env = body?.envelope || body?.data?.envelope || {}
    return {
        envelopeId: String(env.id || env.key || doc.envelope_id || body?.envelope_id || '').trim() || null,
        envelopeName: String(env.name || env.attributes?.name || '').trim() || null,
    }
}

async function persistirNotificacao({ evento, texto, envelopeId, envelopeName, payload }) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return { ok: false, reason: 'supabase_not_configured' }

    const supabase = createClient(url, key)
    const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    let dupQuery = supabase
        .from('clicksign_notificacoes_webhook')
        .select('id')
        .eq('evento', evento)
        .eq('texto', texto)
        .gte('criado_em', desde)
        .limit(1)
    if (envelopeId) {
        dupQuery = dupQuery.eq('envelope_id', envelopeId)
    }
    const { data: dupRows, error: dupErr } = await dupQuery
    if (!dupErr && dupRows?.length) {
        return { ok: true, duplicate: true }
    }

    const { error } = await supabase.from('clicksign_notificacoes_webhook').insert({
        evento,
        texto,
        envelope_id: envelopeId,
        envelope_name: envelopeName,
        payload,
        lido: false,
    })
    if (error) return { ok: false, reason: error.message }
    return { ok: true }
}

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const temSecret = Boolean((process.env.CLICKSIGN_WEBHOOK_SECRET || '').trim())
        res.status(200).json({
            ok: true,
            message: 'Webhook Clicksign EmerLAB ativo. Use POST com o payload da Clicksign.',
            hmacConfigured: temSecret,
        })
        return
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método não permitido. Use POST.' })
        return
    }

    const rawBody = await readRawBody(req)
    const auth = verificarHmac(req, rawBody)
    if (!auth.ok) {
        res.status(401).json({ error: 'Assinatura HMAC inválida ou ausente.', reason: auth.reason })
        return
    }

    const body = parseJsonBody(rawBody)
    if (!body) {
        res.status(400).json({ error: 'Corpo vazio.' })
        return
    }

    const evento = nomeEvento(body)
    if (evento && !EVENTOS_UTEIS.has(evento)) {
        res.status(200).json({ ok: true, ignored: true, evento })
        return
    }

    const texto = montarTextoNotificacao(body, evento)
    const { envelopeId, envelopeName } = extrairIds(body)
    const persist = await persistirNotificacao({
        evento: evento || 'unknown',
        texto,
        envelopeId,
        envelopeName,
        payload: body,
    })

    res.status(200).json({
        ok: true,
        evento: evento || null,
        persisted: persist.ok,
        persistReason: persist.ok ? undefined : persist.reason,
        hmac: auth.skipped ? 'skipped' : 'ok',
    })
}
