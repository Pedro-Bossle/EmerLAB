/**
 * Assinaturas HTML usadas no rodapé dos e-mails.
 * Arquivos editáveis em public/email/assinaturas/ (referência para o time).
 */

import { EMAIL_BRAND, emailAssetOrigin, emailLogoUrl } from '../emailBrand.js'

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

/**
 * Bloco de assinatura padrão EmerLAB (inline, para Resend).
 * @param {{ produto?: string }} [opts]
 */
export function blocoAssinaturaEmailHtml(opts = {}) {
    const produto = escapeHtml(opts.produto || `${EMAIL_BRAND.productLine} · ${EMAIL_BRAND.name}`)
    const logo = emailLogoUrl('azul')
    const site = emailAssetOrigin()

    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-collapse:collapse;">
  <tr>
    <td style="padding:0 12px 0 0;vertical-align:middle;">
      <img src="${escapeHtml(logo)}" alt="${escapeHtml(EMAIL_BRAND.productLine)}" width="96" style="display:block;width:96px;height:auto;border:0;" />
    </td>
    <td style="vertical-align:middle;border-left:3px solid ${EMAIL_BRAND.accent};padding:2px 0 2px 12px;">
      <p style="margin:0;font-size:13px;font-weight:700;color:${EMAIL_BRAND.ink};">${produto}</p>
      <p style="margin:4px 0 0;font-size:12px;color:${EMAIL_BRAND.muted};">
        <a href="${escapeHtml(site)}" style="color:${EMAIL_BRAND.accent};text-decoration:none;">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a>
      </p>
    </td>
  </tr>
</table>`
}

export function blocoAssinaturaEmailText() {
    const site = emailAssetOrigin().replace(/^https?:\/\//, '')
    return `—\n${EMAIL_BRAND.productLine} · ${EMAIL_BRAND.name}\n${site}`
}
