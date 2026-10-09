import path from 'node:path'
import { config as dotenvConfig } from 'dotenv'
import {
    getClientIp,
    readJsonBodyLimited,
    responderSePayloadGrande,
} from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'
import { enviarEmailResend, enviarEmailTemplate } from './_lib/resendMail.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const getHeader = (req, name) => {
    const headers = req.headers || {}
    return headers[name] || headers[name.toLowerCase()] || ''
}

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const segredoInterno = () =>
    String(process.env.EMAIL_INTERNAL_SECRET || process.env.RESEND_PIPELINE_SECRET || '').trim()

const autorizarSegredo = (req) => {
    const esperado = segredoInterno()
    if (!esperado) {
        return { ok: false, status: 503, error: 'Defina EMAIL_INTERNAL_SECRET no servidor.' }
    }

    const authHeader = String(getHeader(req, 'authorization') || '')
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
    const headerSecret = String(getHeader(req, 'x-emerlab-email-secret') || '').trim()
    const recebido = bearer || headerSecret

    if (!recebido || recebido !== esperado) {
        return { ok: false, status: 401, error: 'Segredo de e-mail inválido.' }
    }
    return { ok: true }
}

/**
 * POST /api/email
 * Autenticação: Bearer EMAIL_INTERNAL_SECRET (ou header x-emerlab-email-secret).
 *
 * Modo template (recomendado p/ pipeline):
 *   { template: "pipeline", to, vars?: { nome, cidade, uf, resumo, appUrl }, attachments?, subject? }
 *
 * Modo livre:
 *   { to, subject, html?, text?, attachments? }
 */
export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (req.method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    const ip = getClientIp(req)
    const limit = RATE_LIMITS?.adminUsers || { windowMs: 60_000, max: 60 }
    if (!aplicarRateLimit(res, `email:${ip}`, limit)) return

    const auth = autorizarSegredo(req)
    if (!auth.ok) return responderErro(res, auth.status, auth.error)

    try {
        let body
        try {
            body = await readJsonBodyLimited(req)
        } catch (e) {
            if (responderSePayloadGrande(res, e)) return
            throw e
        }

        const to = body?.to
        const attachments = body?.attachments
        const template = String(body?.template || '').trim()

        if (template) {
            const data = await enviarEmailTemplate({
                to,
                template,
                vars: body?.vars && typeof body.vars === 'object' ? body.vars : {},
                attachments,
                subject: body?.subject,
            })
            return res.status(200).json({ ok: true, id: data?.id || null, template })
        }

        const data = await enviarEmailResend({
            to,
            subject: body?.subject,
            html: body?.html,
            text: body?.text,
            attachments,
        })
        return res.status(200).json({ ok: true, id: data?.id || null })
    } catch (error) {
        return responderErro(res, 500, error?.message || 'Falha ao enviar e-mail.')
    }
}
