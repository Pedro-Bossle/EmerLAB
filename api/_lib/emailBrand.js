/**
 * Identidade visual dos e-mails EmerLAB (cores da plataforma + logo).
 * Assets públicos: /email/logo-azul.png, /email/logo-branco.png
 * Assinaturas HTML: /email/assinaturas/
 */

export const EMAIL_BRAND = Object.freeze({
    name: 'EmerLAB',
    productLine: 'Emerdog',
    fromEmail: 'noreply@emerlab.com.br',
    /** Cores alinhadas a src/index.css (--azul-*) */
    accent: '#2F87C6',
    accentDeep: '#1E3148',
    ink: '#1E3148',
    muted: '#5b6b7c',
    faint: '#8a97a5',
    bg: '#E7F4FC',
    card: '#ffffff',
    border: '#d7e1ea',
})

const isLocalOrigin = (origin) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(origin || ''))

/**
 * Apex emerlab.com.br responde 308 → www; clientes de e-mail (Outlook) muitas
 * vezes não seguem o redirect nas <img>. Sempre usar www para assets.
 */
const canonicalizeEmailOrigin = (origin) => {
    try {
        const u = new URL(origin)
        if (u.hostname === 'emerlab.com.br') {
            u.hostname = 'www.emerlab.com.br'
        }
        return u.origin.replace(/\/$/, '')
    } catch {
        return origin
    }
}

/** Origem pública para links/imagens nos e-mails (nunca localhost). */
export function emailAssetOrigin() {
    const candidates = [
        process.env.EMAIL_PUBLIC_URL,
        process.env.EMAIL_ASSET_ORIGIN,
        process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? `https://${String(process.env.VERCEL_PROJECT_PRODUCTION_URL).replace(/^https?:\/\//i, '')}`
            : '',
        process.env.SITE_URL,
        process.env.VITE_SITE_URL,
    ]

    for (const raw of candidates) {
        const s = String(raw || '').trim()
        if (!s) continue
        try {
            const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`
            const origin = new URL(withProto).origin.replace(/\/$/, '')
            if (isLocalOrigin(origin)) continue
            return canonicalizeEmailOrigin(origin)
        } catch {
            /* próximo candidato */
        }
    }
    return 'https://www.emerlab.com.br'
}

export function emailLogoUrl(variant = 'azul') {
    const file = variant === 'branco' ? 'logo-branco.png' : 'logo-azul.png'
    return `${emailAssetOrigin()}/email/${file}`
}

export function emailAssinaturaUrl(nomeArquivo = 'emerlab.html') {
    const safe = String(nomeArquivo || 'emerlab.html').replace(/[^a-zA-Z0-9._-]/g, '')
    return `${emailAssetOrigin()}/email/assinaturas/${safe || 'emerlab.html'}`
}
