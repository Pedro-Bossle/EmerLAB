// E-mails do Emerzap via API REST da Resend — mesmo envelope visual dos e-mails do EmerLAB (api/_lib/emailTemplates.js)
import { getEnv } from './env.js'
import { LOGO_AZUL, LOGO_BRANCO } from './emailLogos.js'

const BRAND = {
    name: 'Emerzap',
    productLine: 'Emerdog',
    produto: 'Emerdog · Atendimento',
    accent: '#2F87C6',
    accentDeep: '#1E3148',
    ink: '#1E3148',
    muted: '#5b6b7c',
    faint: '#8a97a5',
    bg: '#E7F4FC',
    card: '#ffffff',
    border: '#d7e1ea',
}

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || 'olá'

const host = (url) => String(url).replace(/^https?:\/\//, '').replace(/\/$/, '')

function envelopeHtml({ preheader, titulo, corpoHtml, ctaLabel, ctaHref, fromEmail, siteUrl }) {
    const href = escapeHtml(ctaHref)
    return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(titulo)}</title>
  <style type="text/css">
    :root { color-scheme: light only; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};" bgcolor="${BRAND.bg}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${BRAND.bg}" style="background-color:${BRAND.bg};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${BRAND.card}" style="max-width:560px;background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
        <tr>
          <td bgcolor="${BRAND.accentDeep}" style="background-color:${BRAND.accentDeep};padding:18px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="cid:emerlab-logo-branco" alt="${BRAND.productLine}" width="132" style="display:block;width:132px;max-width:45%;height:auto;border:0;" />
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.02em;">${BRAND.name}</p>
                  <p style="margin:4px 0 0;color:#e7f4fc;font-size:12px;">${escapeHtml(BRAND.produto)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="padding:28px 24px 8px;background-color:${BRAND.card};color:${BRAND.ink};">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${BRAND.ink};">${escapeHtml(titulo)}</h1>
            ${corpoHtml}
            <p style="margin:0 0 28px;">
              <a href="${href}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:650;font-size:15px;">${escapeHtml(ctaLabel)}</a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Se o botão não funcionar, copie e cole este link no navegador:</p>
            <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
              <a href="${href}" style="color:${BRAND.accent};">${href}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="padding:8px 24px 24px;border-top:1px solid ${BRAND.border};background-color:${BRAND.card};">
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-collapse:collapse;">
              <tr>
                <td style="padding:0 12px 0 0;vertical-align:middle;">
                  <img src="cid:emerlab-logo-azul" alt="${BRAND.productLine}" width="96" style="display:block;width:96px;height:auto;border:0;" />
                </td>
                <td style="vertical-align:middle;border-left:3px solid ${BRAND.accent};padding:2px 0 2px 12px;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:${BRAND.ink};">${BRAND.productLine} · ${BRAND.name}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:${BRAND.muted};">
                    <a href="${escapeHtml(siteUrl)}" style="color:${BRAND.accent};text-decoration:none;">${escapeHtml(host(siteUrl))}</a>
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:12px;color:${BRAND.faint};line-height:1.45;">
              Este e-mail foi enviado automaticamente por ${BRAND.name} (&lt;${escapeHtml(fromEmail)}&gt;). Não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function emailConfigurado() {
    return Boolean(getEnv().resendKey)
}

// { nome, email, link, tenantId, validadeDias }
export function montarEmailConvite({ nome, email, link, tenantId, validadeDias }) {
    const { emailFrom, publicUrl } = getEnv()
    const n = primeiroNome(nome)
    const site = host(publicUrl)
    const subject = `Você foi convidado(a) para o ${BRAND.name} — crie sua senha`
    const p = (conteudo, extra = '') => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;${extra}">${conteudo}</p>`
    const corpoHtml = `
      ${p(`Olá, <strong>${escapeHtml(n)}</strong>.`)}
      ${p(`Você foi convidado(a) para entrar no <strong>${BRAND.name}</strong> (<a href="${escapeHtml(publicUrl)}" style="color:${BRAND.accent};">${escapeHtml(site)}</a>), o painel de atendimento WhatsApp da <strong>${BRAND.productLine}</strong>.`)}
      ${p('Para começar, clique no botão abaixo e crie a sua senha de acesso.')}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border:1px solid #d8e6ef;border-radius:12px;background:#f7fbfe;">
        <tr><td style="padding:16px 18px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Seus dados de acesso</p>
          <p style="margin:0 0 6px;font-size:13px;color:${BRAND.muted};">E-mail: <strong style="color:${BRAND.ink};">${escapeHtml(email)}</strong></p>
          ${tenantId ? `<p style="margin:0;font-size:13px;color:${BRAND.muted};">ID da conta: <strong style="color:${BRAND.ink};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(tenantId)}</strong></p>` : ''}
          <p style="margin:10px 0 0;font-size:13px;line-height:1.45;color:${BRAND.muted};">O link vale por ${validadeDias} dias e só funciona uma vez. Não compartilhe este e-mail.</p>
        </td></tr>
      </table>
      ${p('Se você não esperava este convite, ignore este e-mail e avise o administrador.', `font-size:14px;color:${BRAND.muted};line-height:1.5;margin-bottom:20px;`)}`
    const html = envelopeHtml({
        preheader: `Crie sua senha para entrar no ${BRAND.name}`,
        titulo: `Bem-vindo(a) ao ${BRAND.name}`,
        corpoHtml,
        ctaLabel: 'Criar minha senha',
        ctaHref: link,
        fromEmail: emailFrom,
        siteUrl: publicUrl,
    })
    const text = `${subject}\n\nOlá, ${n}.\n\nVocê foi convidado(a) para entrar no ${BRAND.name} (${site}), o painel de atendimento WhatsApp da ${BRAND.productLine}.\n\nE-mail: ${email}${tenantId ? `\nID da conta: ${tenantId}` : ''}\n\nCrie sua senha (link válido por ${validadeDias} dias, uso único):\n${link}\n\nSe você não esperava este convite, ignore este e-mail.\n\n—\n${BRAND.productLine} · ${BRAND.name}\n${site}\n`
    return { subject, html, text }
}

export async function enviarEmail({ to, subject, html, text }) {
    const { resendKey, emailFrom, emailFromNome } = getEnv()
    if (!resendKey) throw new Error('Envio de e-mail desativado: falta RESEND_API_KEY no .env.')
    if (!/^re_/i.test(resendKey)) {
        throw new Error('RESEND_API_KEY com formato inválido (deve começar com re_). Remova aspas extras no .env / Vercel.')
    }
    // User-Agent é obrigatório na API Resend; sem ele a borda devolve 403 e parece falha de chave
    const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'emerlab-zap/1.0',
        },
        body: JSON.stringify({
            from: `${emailFromNome} <${emailFrom}>`,
            to: [to],
            subject,
            html,
            text,
            attachments: [
                { filename: 'logo-branco.png', content: LOGO_BRANCO, content_type: 'image/png', content_id: 'emerlab-logo-branco' },
                { filename: 'logo-azul.png', content: LOGO_AZUL, content_type: 'image/png', content_id: 'emerlab-logo-azul' },
            ],
        }),
    })
    const dados = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        const msg = dados.message || `A Resend recusou o e-mail (HTTP ${resp.status}).`
        if (/api key is invalid|missing api key|invalid.?api.?key/i.test(msg)) {
            throw new Error(
                `${msg} — confira RESEND_API_KEY no projeto Vercel do zap (sem aspas) e se o domínio do remetente está verificado.`,
            )
        }
        throw new Error(msg)
    }
    return dados
}
