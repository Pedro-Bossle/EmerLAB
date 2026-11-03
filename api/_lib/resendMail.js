import { Resend } from 'resend'
import { EMAIL_BRAND } from './emailBrand.js'
import { getEmailLogoAttachments } from './emailLogoCid.js'
import { montarEmailAuth, montarEmailAuthHtml, montarEmailPorTemplate } from './emailTemplates.js'

export { montarEmailAuth, montarEmailAuthHtml, montarEmailPorTemplate }

const DEFAULT_FROM_EMAIL = EMAIL_BRAND.fromEmail
const DEFAULT_FROM_NAME = EMAIL_BRAND.name

/**
 * Normaliza RESEND_API_KEY: remove BOM, aspas (comuns ao colar no Vercel) e prefixo Bearer.
 * Sem isso a Resend responde "API key is invalid" mesmo com a chave certa no painel.
 */
export function normalizeResendApiKey(raw) {
    let k = String(raw ?? '').trim()
    if (k.charCodeAt(0) === 0xfeff) k = k.slice(1).trim()
    k = k.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim()
    k = k.replace(/^Bearer\s+/i, '').trim()
    return k
}

export function getResendApiKey() {
    return normalizeResendApiKey(process.env.RESEND_API_KEY || process.env.RESEND_KEY || '')
}

export function getResendFrom() {
    const email = String(process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim() || DEFAULT_FROM_EMAIL
    const name = String(process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME
    return `${name} <${email}>`
}

function getResendClient() {
    const apiKey = getResendApiKey()
    if (!apiKey) {
        throw new Error('Defina RESEND_API_KEY para enviar e-mails.')
    }
    if (!/^re_/i.test(apiKey)) {
        throw new Error(
            'RESEND_API_KEY com formato inválido (deve começar com re_). Confira aspas extras no .env / Vercel.',
        )
    }
    return new Resend(apiKey)
}

/**
 * @param {{
 *   to: string | string[],
 *   subject: string,
 *   html?: string,
 *   text?: string,
 *   attachments?: Array<{ filename: string, content: string | Buffer, contentType?: string }>,
 * }} opts
 */
export async function enviarEmailResend(opts) {
    const toRaw = opts?.to
    const toList = (Array.isArray(toRaw) ? toRaw : [toRaw])
        .map((v) => String(v || '').trim().toLowerCase())
        .filter((v) => v.includes('@'))

    if (!toList.length) {
        throw new Error('Informe ao menos um destinatário de e-mail válido.')
    }

    const subject = String(opts?.subject || '').trim()
    if (!subject) throw new Error('Informe o assunto do e-mail.')

    const html = opts?.html != null ? String(opts.html) : undefined
    const text = opts?.text != null ? String(opts.text) : undefined
    if (!html && !text) {
        throw new Error('Informe html ou text para o e-mail.')
    }

    const normalizeAttachment = (a) => {
        if (!a?.filename) return null
        const content = a.content
        if (content == null) return null
        let buf
        if (Buffer.isBuffer(content)) buf = content
        else if (typeof content === 'string') buf = Buffer.from(content, 'base64')
        else buf = Buffer.from(content)
        const item = { filename: String(a.filename), content: buf }
        if (a.contentType) item.contentType = String(a.contentType)
        if (a.contentId) item.contentId = String(a.contentId).replace(/^<|>$/g, '')
        return item
    }

    const extras = Array.isArray(opts?.attachments)
        ? opts.attachments.map(normalizeAttachment).filter(Boolean)
        : []

    // Logos CID quando o HTML referencia cid:emerlab-logo-*
    const needsLogoCid = Boolean(
        (html && /cid:emerlab-logo-/i.test(html)) || opts?.embedLogos === true,
    )
    const logoAtts = needsLogoCid
        ? getEmailLogoAttachments().map(normalizeAttachment).filter(Boolean)
        : []

    const seen = new Set()
    const attachments = [...logoAtts, ...extras].filter((a) => {
        const key = a.contentId || a.filename
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    const resend = getResendClient()
    const payload = {
        from: opts?.from ? String(opts.from) : getResendFrom(),
        to: toList,
        subject,
    }
    if (html) payload.html = html
    if (text) payload.text = text
    if (attachments.length) payload.attachments = attachments
    // Envio agendado (repasse mensal): ISO 8601; a Resend dispara no horário.
    if (opts?.scheduledAt) payload.scheduledAt = new Date(opts.scheduledAt).toISOString()
    if (opts?.replyTo) payload.replyTo = String(opts.replyTo)

    const { data, error } = await resend.emails.send(payload)
    if (error) {
        const msg = String(error?.message || error || 'Falha ao enviar e-mail via Resend.')
        if (/api key is invalid|missing api key|invalid.?api.?key/i.test(msg)) {
            throw new Error(
                `${msg} — confira RESEND_API_KEY no Vercel/.env.local (sem aspas ao redor do valor) e se o projeto certo tem a variável.`,
            )
        }
        throw new Error(msg)
    }
    return data
}

/** Cancela um e-mail agendado na Resend (repasse mensal). */
export async function cancelarEmailAgendadoResend(emailId) {
    const resend = getResendClient()
    const { error } = await resend.emails.cancel(String(emailId))
    if (error) throw new Error(String(error?.message || error))
}

/**
 * Envia usando um modelo nomeado (invite | invite_existing | recovery | pipeline).
 * @param {{ to: string | string[], template: string, vars?: Record<string, unknown>, attachments?: unknown[], subject?: string }} opts
 */
export async function enviarEmailTemplate(opts) {
    const montado = montarEmailPorTemplate(opts.template, opts.vars || {})
    return enviarEmailResend({
        to: opts.to,
        subject: opts.subject || montado.subject,
        html: montado.html,
        text: montado.text,
        attachments: opts.attachments,
    })
}
