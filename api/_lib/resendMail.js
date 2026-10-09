import { Resend } from 'resend'
import { montarEmailAuth, montarEmailAuthHtml, montarEmailPorTemplate } from './emailTemplates.js'

export { montarEmailAuth, montarEmailAuthHtml, montarEmailPorTemplate }

const DEFAULT_FROM_EMAIL = 'noreply@emerlab.com.br'
const DEFAULT_FROM_NAME = 'EmerLAB'

export function getResendFrom() {
    const email = String(process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim() || DEFAULT_FROM_EMAIL
    const name = String(process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME
    return `${name} <${email}>`
}

function getResendClient() {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim()
    if (!apiKey) {
        throw new Error('Defina RESEND_API_KEY para enviar e-mails.')
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

    const attachments = Array.isArray(opts?.attachments)
        ? opts.attachments
              .map((a) => {
                  if (!a?.filename) return null
                  const content = a.content
                  if (content == null) return null
                  let buf
                  if (Buffer.isBuffer(content)) buf = content
                  else if (typeof content === 'string') buf = Buffer.from(content, 'base64')
                  else buf = Buffer.from(content)
                  const item = { filename: String(a.filename), content: buf }
                  if (a.contentType) item.contentType = String(a.contentType)
                  return item
              })
              .filter(Boolean)
        : undefined

    const resend = getResendClient()
    const payload = {
        from: getResendFrom(),
        to: toList,
        subject,
    }
    if (html) payload.html = html
    if (text) payload.text = text
    if (attachments?.length) payload.attachments = attachments

    const { data, error } = await resend.emails.send(payload)
    if (error) {
        const msg = String(error?.message || error || 'Falha ao enviar e-mail via Resend.')
        throw new Error(msg)
    }
    return data
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
