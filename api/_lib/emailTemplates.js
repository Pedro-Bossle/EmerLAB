/**
 * Modelos HTML/texto dos e-mails EmerLAB (Resend).
 * Casos: invite | invite_existing | recovery | pipeline
 */

const BRAND = {
    name: 'EmerLAB',
    accent: '#0f766e',
    accentDeep: '#0b5f59',
    ink: '#122033',
    muted: '#5b6b7c',
    faint: '#8a97a5',
    bg: '#eef3f7',
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

const primeiroNome = (nomeOuEmail) => {
    const raw = String(nomeOuEmail || '').trim()
    if (!raw) return 'olá'
    if (raw.includes('@')) return raw.split('@')[0] || 'olá'
    return raw.split(/\s+/)[0] || raw
}

/**
 * Envelope visual comum a todos os modelos.
 * @param {{ preheader: string, titulo: string, corpoHtml: string, ctaLabel?: string, ctaHref?: string, rodapeExtra?: string }} opts
 */
function envelopeHtml(opts) {
    const preheader = escapeHtml(opts.preheader)
    const titulo = escapeHtml(opts.titulo)
    const ctaLabel = opts.ctaLabel ? escapeHtml(opts.ctaLabel) : ''
    const ctaHref = opts.ctaHref ? String(opts.ctaHref) : ''
    const rodapeExtra = opts.rodapeExtra || ''

    const botao =
        ctaLabel && ctaHref
            ? `<p style="margin:0 0 28px;">
        <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:650;font-size:15px;">${ctaLabel}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
        <a href="${escapeHtml(ctaHref)}" style="color:${BRAND.accentDeep};">${escapeHtml(ctaHref)}</a>
      </p>`
            : ''

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.bg};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND.accentDeep} 0%,${BRAND.accent} 100%);padding:20px 24px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(BRAND.name)}</p>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:12px;">Emerdog · Credenciamento</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${BRAND.ink};">${titulo}</h1>
            ${opts.corpoHtml}
            ${botao}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 24px;border-top:1px solid ${BRAND.border};">
            ${rodapeExtra}
            <p style="margin:12px 0 0;font-size:12px;color:${BRAND.faint};line-height:1.45;">
              Este e-mail foi enviado automaticamente por ${escapeHtml(BRAND.name)} (&lt;noreply@emerlab.com.br&gt;). Não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** @param {'invite' | 'invite_existing' | 'recovery'} tipo */
export function montarEmailAuth(tipo, opts = {}) {
    const nome = primeiroNome(opts.nome)
    const link = String(opts.actionLink || '').trim()
    if (!link) throw new Error('actionLink é obrigatório no template de Auth.')

    if (tipo === 'invite') {
        const subject = 'Convite para acessar o EmerLAB'
        const corpoHtml = `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Você foi convidado(a) a usar o <strong>EmerLAB</strong>. Para começar, defina sua senha e entre na plataforma.</p>
          <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted};line-height:1.5;">O link é pessoal e expira conforme a política de segurança do sistema. Se você não esperava este convite, ignore este e-mail.</p>`
        const html = envelopeHtml({
            preheader: 'Defina sua senha e acesse o EmerLAB',
            titulo: 'Bem-vindo(a) ao EmerLAB',
            corpoHtml,
            ctaLabel: 'Aceitar convite e definir senha',
            ctaHref: link,
        })
        const text = `${subject}\n\nOlá, ${nome}.\n\nVocê foi convidado(a) a usar o EmerLAB. Defina sua senha neste link:\n${link}\n\nSe não esperava este convite, ignore este e-mail.\n`
        return { subject, html, text }
    }

    if (tipo === 'invite_existing') {
        const subject = 'Acesso ao EmerLAB — reative sua senha'
        const corpoHtml = `
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong>${escapeHtml(nome)}</strong>.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Sua conta no <strong>EmerLAB</strong> já existe. Um administrador enviou um novo acesso — use o botão abaixo para definir ou redefinir a senha e entrar.</p>
          <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted};line-height:1.5;">Se você não solicitou isso, fale com o administrador do sistema.</p>`
        const html = envelopeHtml({
            preheader: 'Sua conta EmerLAB já existe — reative o acesso',
            titulo: 'Novo acesso à sua conta',
            corpoHtml,
            ctaLabel: 'Definir senha e entrar',
            ctaHref: link,
        })
        const text = `${subject}\n\nOlá, ${nome}.\n\nSua conta no EmerLAB já existe. Defina ou redefina a senha neste link:\n${link}\n`
        return { subject, html, text }
    }

    // recovery (admin reset ou resetOwnPassword)
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
    const text = `${subject}\n\nOlá, ${nome}.\n\nRecebemos um pedido para redefinir sua senha no EmerLAB.\n\nLink: ${link}\n\nSe não foi você, ignore este e-mail.\n`
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
    const appUrl = String(opts.appUrl || process.env.SITE_URL || 'https://emerlab.vercel.app').trim()

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

    const text = `${subject}\n\nOlá, ${nome}.\n\nO pipeline Emer-Radar gerou um novo relatório.${local ? `\nLocal: ${local}` : ''}${resumo ? `\n\n${resumo}` : ''}\n\nAbrir EmerLAB: ${appUrl}\n`
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

    if (key === 'invite' || key === 'convite') {
        return montarEmailAuth('invite', vars)
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
        `Template de e-mail desconhecido: «${template}». Use invite, invite_existing, recovery ou pipeline.`,
    )
}

/** @deprecated use montarEmailAuth */
export function montarEmailAuthHtml(tipo, opts) {
    return montarEmailAuth(tipo === 'invite' ? 'invite' : 'recovery', opts)
}
