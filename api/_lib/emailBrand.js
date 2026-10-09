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

/** Origem canônica para links e imagens nos e-mails. */
export function emailAssetOrigin() {
    const raw = String(
        process.env.SITE_URL ||
            process.env.VITE_SITE_URL ||
            process.env.VERCEL_PROJECT_PRODUCTION_URL ||
            '',
    ).trim()
    if (raw) {
        try {
            const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
            return new URL(withProto).origin.replace(/\/$/, '')
        } catch {
            /* fallback */
        }
    }
    return 'https://emerlab.com.br'
}

export function emailLogoUrl(variant = 'azul') {
    const file = variant === 'branco' ? 'logo-branco.png' : 'logo-azul.png'
    return `${emailAssetOrigin()}/email/${file}`
}

export function emailAssinaturaUrl(nomeArquivo = 'emerlab.html') {
    const safe = String(nomeArquivo || 'emerlab.html').replace(/[^a-zA-Z0-9._-]/g, '')
    return `${emailAssetOrigin()}/email/assinaturas/${safe || 'emerlab.html'}`
}
