/**
 * Fluxo de redefinição/convite via link Supabase (hash type=recovery|invite).
 * Sem isto, o link cria sessão e o utilizador entra na app sem definir senha.
 */

const STORAGE_KEY = 'emerlab-password-recovery'

export function markPasswordRecoveryPending(motivo = 'recovery') {
    if (typeof window === 'undefined') return
    try {
        window.sessionStorage.setItem(STORAGE_KEY, String(motivo || 'recovery'))
    } catch {
        /* private mode */
    }
}

export function clearPasswordRecoveryPending() {
    if (typeof window === 'undefined') return
    try {
        window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
        /* ignore */
    }
}

export function isPasswordRecoveryPending() {
    if (typeof window === 'undefined') return false
    try {
        return Boolean(window.sessionStorage.getItem(STORAGE_KEY))
    } catch {
        return false
    }
}

/** Lê type=recovery|invite|signup na URL (antes do client limpar o hash). */
export function urlIndicaRecuperacaoSenha() {
    if (typeof window === 'undefined') return false
    const blob = `${window.location.hash || ''}${window.location.search || ''}`
    return /(?:^|[&#?])type=(recovery|invite|signup|magiclink)\b/i.test(blob)
}

/**
 * Chamar cedo (ex.: no arranque do cliente Supabase).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
export function installPasswordRecoveryListener(client) {
    if (!client?.auth?.onAuthStateChange) return () => {}

    if (urlIndicaRecuperacaoSenha()) {
        markPasswordRecoveryPending('url')
    }

    const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            markPasswordRecoveryPending('recovery')
        }
    })

    return () => {
        data?.subscription?.unsubscribe?.()
    }
}

export function destinoAlterarSenhaAposRecuperacao(nextRaw) {
    const next = String(nextRaw || '').trim()
    if (next && next.startsWith('/') && !next.startsWith('//') && next !== '/' && next !== '/alterar-senha') {
        return `/alterar-senha?next=${encodeURIComponent(next)}`
    }
    return '/alterar-senha'
}
