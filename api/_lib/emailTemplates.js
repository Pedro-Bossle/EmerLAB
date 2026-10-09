/**
 * Modelos HTML/texto dos e-mails EmerLAB (Resend).
 * Casos: invite | invite_existing | recovery | pipeline | welcome
 */

import { EMAIL_BRAND } from './emailBrand.js'
import { emailLogoCidSrc } from './emailLogoCid.js'
import { blocoAssinaturaEmailHtml, blocoAssinaturaEmailText } from './emailAssinaturas/index.js'

const BRAND = EMAIL_BRAND

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

const primeiroNome = (nomeOuEmail) => {
    const raw = String(nomeOuEmail || '').trim()
    if (!raw) return 'olá'
    if (raw.includes('@')) return raw.split('@')[0] || 'olá'
    return raw.split(/\s+/)[0] || raw
}

/**
 * Envelope visual comum (cores da plataforma + logo Emerdog).
 * @param {{ preheader: string, titulo: string, corpoHtml: string, ctaLabel?: string, ctaHref?: string, rodapeExtra?: string, produto?: string }} opts
 */
function envelopeHtml(opts) {
    const preheader = escapeHtml(opts.preheader)
    const titulo = escapeHtml(opts.titulo)
    const ctaLabel = opts.ctaLabel ? escapeHtml(opts.ctaLabel) : ''
    const ctaHref = opts.ctaHref ? String(opts.ctaHref) : ''
    const rodapeExtra = opts.rodapeExtra || ''
    const produto = escapeHtml(opts.produto || `${BRAND.productLine} · Credenciamento`)
    const logoBranco = emailLogoCidSrc('branco')
    const assinatura = blocoAssinaturaEmailHtml({ produto: opts.produto })

    const botao =
        ctaLabel && ctaHref
            ? `<p style="margin:0 0 28px;">
        <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:650;font-size:15px;">${ctaLabel}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
        <a href="${escapeHtml(ctaHref)}" style="color:${BRAND.accent};">${escapeHtml(ctaHref)}</a>
      </p>`
            : ''

    // bgcolor + color-scheme:light ajudam Outlook (dark mode) a não inverter o layout.
    return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${titulo}</title>
  <style type="text/css">
    :root { color-scheme: light only; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};" bgcolor="${BRAND.bg}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${BRAND.bg}" style="background-color:${BRAND.bg};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${BRAND.card}" style="max-width:560px;background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
        <tr>
          <td bgcolor="${BRAND.accentDeep}" style="background-color:${BRAND.accentDeep};padding:18px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="${logoBranco}" alt="${escapeHtml(BRAND.productLine)}" width="132" style="display:block;width:132px;max-width:45%;height:auto;border:0;" />
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(BRAND.name)}</p>
                  <p style="margin:4px 0 0;color:#e7f4fc;font-size:12px;">${produto}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="padding:28px 24px 8px;background-color:${BRAND.card};color:${BRAND.ink};">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${BRAND.ink};">${titulo}</h1>
            ${opts.corpoHtml}
            ${botao}
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="padding:8px 24px 24px;border-top:1px solid ${BRAND.border};background-color:${BRAND.card};">
            ${rodapeExtra}
            ${assinatura}
            <p style="margin:12px 0 0;font-size:12px;color:${BRAND.faint};line-height:1.45;">
              Este e-mail foi enviado automaticamente por ${escapeHtml(BRAND.name)} (&lt;${escapeHtml(BRAND.fromEmail)}&gt;). Não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function blocoSenhaTemporariaHtml(senha, emailConta) {
    const s = escapeHtml(senha)
    const em = escapeHtml(emailConta || '')
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border:1px solid #d8e6ef;border-radius:12px;background:#f7fbfe;">
        <tr><td style="padding:16px 18px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Senha temporária (uso único)</p>
          ${em ? `<p style="margin:0 0 6px;font-size:13px;color:${BRAND.muted};">Conta: <strong style="color:${BRAND.ink};">${em}</strong></p>` : ''}
          <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:0.06em;color:${BRAND.ink};">${s}</p>
          <p style="margin:10px 0 0;font-size:13px;line-height:1.45;color:${BRAND.muted};">No primeiro acesso será obrigatório trocar esta senha. Não partilhe este e-mail.</p>
        </td></tr>
      </table>`
}

/** Texto de boas-vindas padrão para convidados (com senha temporária). */
export function textoBoasVindasConvidado(nome, opts = {}) {
    const n = primeiroNome(nome)
    const senha = String(opts.senhaTemporaria || '').trim()
    const emailConta = String(opts.email || '').trim()
    return {
        html: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(n)}</strong>.</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Seja bem-vindo(a) ao <strong>${escapeHtml(BRAND.name)}</strong> — a plataforma da <strong>${escapeHtml(BRAND.productLine)}</strong> para credenciamento, compras, auditoria e operações do dia a dia.</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Sua conta foi criada por um administrador. Use o e-mail e a <strong>senha temporária</strong> abaixo para entrar; no primeiro acesso pediremos que defina uma senha nova (a temporária deixa de valer).</p>
      ${senha ? blocoSenhaTemporariaHtml(senha, emailConta) : ''}
      <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted};line-height:1.5;">Se você não esperava este convite, ignore este e-mail e avise o administrador.</p>`,
        text: `Olá, ${n}.\n\nSeja bem-vindo(a) ao ${BRAND.name}.\n\nConta: ${emailConta || '(seu e-mail)'}\nSenha temporária (uso único): ${senha || '(no e-mail HTML)'}\n\nNo primeiro acesso terá de definir uma senha nova.\n`,
    }
}

/** @param {'invite' | 'invite_existing' | 'recovery' | 'welcome'} tipo */
export function montarEmailAuth(tipo, opts = {}) {
    const nome = primeiroNome(opts.nome)
    const link = String(opts.actionLink || opts.loginUrl || '').trim()
    const senha = String(opts.senhaTemporaria || '').trim()
    const emailConta = String(opts.email || '').trim()
    const loginUrl =
        String(opts.loginUrl || '').trim() ||
        String(process.env.SITE_URL || 'https://emerlab.com.br').replace(/\/$/, '') ||
        'https://emerlab.com.br'

    if (tipo === 'invite' || tipo === 'welcome') {
        if (!senha) throw new Error('senhaTemporaria é obrigatória no convite.')
        const subject = 'Bem-vindo(a) ao EmerLAB — senha temporária de acesso'
        const boas = textoBoasVindasConvidado(opts.nome, {
            senhaTemporaria: senha,
            email: emailConta,
        })
        const html = envelopeHtml({
            preheader: 'Senha temporária de uso único — troque no primeiro acesso',
            titulo: 'Bem-vindo(a) ao EmerLAB',
            corpoHtml: boas.html,
            ctaLabel: 'Entrar no EmerLAB',
            ctaHref: loginUrl,
        })
        const text = `${subject}\n\n${boas.text}\nEntrar: ${loginUrl}\n\n${blocoAssinaturaEmailText()}\n`
        return { subject, html, text }
    }

    if (tipo === 'invite_existing') {
        if (!senha) throw new Error('senhaTemporaria é obrigatória no convite.')
        const subject = 'Acesso ao EmerLAB — nova senha temporária'
        const corpoHtml = `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Sua conta no <strong>EmerLAB</strong> já existia. Um administrador gerou uma <strong>senha temporária de uso único</strong> — entre com ela e defina uma senha nova no primeiro acesso.</p>
          ${blocoSenhaTemporariaHtml(senha, emailConta)}
          <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted};line-height:1.5;">Se você não solicitou isso, fale com o administrador do sistema.</p>`
        const html = envelopeHtml({
            preheader: 'Nova senha temporária — troque no primeiro acesso',
            titulo: 'Novo acesso à sua conta',
            corpoHtml,
            ctaLabel: 'Entrar no EmerLAB',
            ctaHref: loginUrl,
        })
        const text = `${subject}\n\nOlá, ${nome}.\n\nConta: ${emailConta}\nSenha temporária (uso único): ${senha}\n\nEntrar: ${loginUrl}\n\n${blocoAssinaturaEmailText()}\n`
        return { subject, html, text }
    }

    if (!link) {
        throw new Error('actionLink é obrigatório no template de recuperação.')
    }

    const subject = 'Redefinição de senha — EmerLAB'
    const corpoHtml = `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Recebemos um pedido para redefinir a senha da sua conta no <strong>EmerLAB</strong>.</p>
      <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted};line-height:1.5;">Se não foi você, ignore este e-mail — sua senha atual permanece a mesma.</p>`
    const html = envelopeHtml({
        preheader: 'Pedido de redefinição de senha no EmerLAB',
        titulo: 'Redefinir sua senha',
        corpoHtml,
        ctaLabel: 'Redefinir senha',
        ctaHref: link,
    })
    const text = `${subject}\n\nOlá, ${nome}.\n\nRecebemos um pedido para redefinir sua senha no EmerLAB.\n\nLink: ${link}\n\nSe não foi você, ignore este e-mail.\n\n${blocoAssinaturaEmailText()}\n`
    return { subject, html, text }
}

/**
 * Relatório / aviso do pipeline Emer-Radar.
 * @param {{ nome?: string, cidade?: string, uf?: string, resumo?: string, appUrl?: string }} opts
 */
export function montarEmailPipeline(opts = {}) {
    const nome = primeiroNome(opts.nome || 'equipe')
    const cidade = String(opts.cidade || '').trim()
    const uf = String(opts.uf || '').trim().toUpperCase()
    const local = [cidade, uf].filter(Boolean).join(' / ')
    const resumo = String(opts.resumo || '').trim()
    const appUrl = String(opts.appUrl || process.env.SITE_URL || 'https://emerlab.com.br').trim()

    const subject = local
        ? `Pipeline Emer-Radar — ${local}`
        : 'Pipeline Emer-Radar — relatório disponível'

    const localHtml = local
        ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Local processado: <strong>${escapeHtml(local)}</strong>.</p>`
        : ''
    const resumoHtml = resumo
        ? `<p style="margin:0 0 12px;font-size:14px;color:${BRAND.muted};line-height:1.55;white-space:pre-wrap;">${escapeHtml(resumo)}</p>`
        : `<p style="margin:0 0 12px;font-size:14px;color:${BRAND.muted};line-height:1.55;">O processamento do pipeline foi concluído. Os arquivos anexos (quando houver) acompanham este e-mail.</p>`

    const corpoHtml = `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">O <strong>pipeline Emer-Radar</strong> gerou um novo relatório.</p>
      ${localHtml}
      ${resumoHtml}`

    const html = envelopeHtml({
        preheader: subject,
        titulo: 'Relatório do pipeline',
        corpoHtml,
        ctaLabel: 'Abrir EmerLAB',
        ctaHref: appUrl,
        rodapeExtra: `<p style="margin:0;font-size:12px;color:${BRAND.muted};">Anexos (Excel/HTML) podem acompanhar esta mensagem, conforme a configuração do worker.</p>`,
    })

    const text = `${subject}\n\nOlá, ${nome}.\n\nO pipeline Emer-Radar gerou um novo relatório.${local ? `\nLocal: ${local}` : ''}${resumo ? `\n\n${resumo}` : ''}\n\nAbrir EmerLAB: ${appUrl}\n\n${blocoAssinaturaEmailText()}\n`
    return { subject, html, text }
}

/**
 * Resolve template por nome.
 * @param {string} template
 * @param {Record<string, unknown>} vars
 */
export function montarEmailPorTemplate(template, vars = {}) {
    const key = String(template || '')
        .trim()
        .toLowerCase()
        .replace(/[-_\s]+/g, '_')

    if (key === 'invite' || key === 'convite' || key === 'welcome' || key === 'boas_vindas') {
        return montarEmailAuth(key === 'welcome' || key === 'boas_vindas' ? 'welcome' : 'invite', vars)
    }
    if (key === 'invite_existing' || key === 'convite_existente' || key === 'acesso') {
        return montarEmailAuth('invite_existing', vars)
    }
    if (key === 'recovery' || key === 'reset' || key === 'senha' || key === 'password') {
        return montarEmailAuth('recovery', vars)
    }
    if (key === 'pipeline' || key === 'emer_radar' || key === 'emerradar') {
        return montarEmailPipeline(vars)
    }

    throw new Error(
        `Template de e-mail desconhecido: «${template}». Use invite, invite_existing, recovery, welcome ou pipeline.`,
    )
}

/** @deprecated use montarEmailAuth */
export function montarEmailAuthHtml(tipo, opts) {
    return montarEmailAuth(tipo === 'invite' ? 'invite' : 'recovery', opts)
}
