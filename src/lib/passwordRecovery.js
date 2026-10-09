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

/** Resposta OAuth da Microsoft (MSAL) — não confundir com PKCE do Supabase. */
export function urlIndicaCallbackMicrosoft() {
    if (typeof window === 'undefined') return false
    const blob = `${window.location.hash || ''}${window.location.search || ''}`
    return /[?&#]client_info=/i.test(blob) || /[?&#]session_state=/i.test(blob)
}

/**
 * Lê type=recovery|invite|… na URL (antes do client limpar o hash),
 * ou tokens implícitos / PKCE na rota de alterar senha.
 * Ignora callbacks MSAL (?code=…&client_info=…).
 */
export function urlIndicaRecuperacaoSenha() {
    if (typeof window === 'undefined') return false
    if (urlIndicaCallbackMicrosoft()) return false
    const path = String(window.location.pathname || '')
    const blob = `${window.location.hash || ''}${window.location.search || ''}`
    if (/(?:^|[&#?])type=(recovery|invite|signup|magiclink)\b/i.test(blob)) return true
    if (/(?:^|[&#?])from=recovery\b/i.test(blob)) return true
    // Hash Supabase (recovery/invite) — exige type= para não apanhar outros IdPs.
    if (
        /[&#?]access_token=/i.test(blob) &&
        /[&#?]refresh_token=/i.test(blob) &&
        /[&#?]type=(recovery|invite|signup|magiclink)\b/i.test(blob)
    ) {
        return true
    }
    // PKCE Supabase: ?code=… só em /alterar-senha e sem client_info MSAL.
    if (/[?&]code=/i.test(blob) && /alterar-senha/i.test(path)) return true
    return false
}

/**
 * Consome ?code= / hash do Supabase Auth sem interferir no MSAL.
 * Chamado com detectSessionInUrl: false no cliente.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
export async function consumirCallbackSupabaseDaUrl(client) {
    if (typeof window === 'undefined' || !client?.auth) return
    if (urlIndicaCallbackMicrosoft()) return

    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
    const type =
        url.searchParams.get('type') || hashParams.get('type') || ''
    const code = url.searchParams.get('code')
    const path = String(window.location.pathname || '')

    const isRecoveryPath =
        /alterar-senha/i.test(path) ||
        url.searchParams.get('from') === 'recovery' ||
        /^(recovery|invite|signup|magiclink)$/i.test(type)

    if (code && isRecoveryPath) {
        try {
            await client.auth.exchangeCodeForSession(code)
            markPasswordRecoveryPending('recovery')
        } catch (e) {
            console.warn('[auth] exchangeCodeForSession:', e?.message || e)
        }
        return
    }

    const access = hashParams.get('access_token')
    const refresh = hashParams.get('refresh_token')
    if (access && refresh && /^(recovery|invite|signup|magiclink)$/i.test(type)) {
        try {
            await client.auth.setSession({ access_token: access, refresh_token: refresh })
            markPasswordRecoveryPending(type || 'recovery')
        } catch (e) {
            console.warn('[auth] setSession (hash):', e?.message || e)
        }
    }
}

/**
 * Espera o Supabase processar tokens da URL (INITIAL_SESSION / PASSWORD_RECOVERY)
 * antes de decidir se redireciona para home ou alterar-senha.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function waitForAuthBootstrap(client, opts = {}) {
    const timeoutMs = Math.max(500, Number(opts.timeoutMs) || 2500)
    if (typeof window === 'undefined' || !client?.auth?.onAuthStateChange) {
        return
    }

    // MSAL na Home: não esperar / não marcar recovery.
    if (urlIndicaCallbackMicrosoft()) return

    try {
        await consumirCallbackSupabaseDaUrl(client)
    } catch {
        /* ignore */
    }

    if (urlIndicaRecuperacaoSenha()) {
        markPasswordRecoveryPending('url')
    }

    await new Promise((resolve) => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            try {
                subscription?.unsubscribe?.()
            } catch {
                /* ignore */
            }
            resolve()
        }

        const { data } = client.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                markPasswordRecoveryPending('recovery')
                finish()
                return
            }
            if (
                event === 'INITIAL_SESSION' ||
                event === 'SIGNED_IN' ||
                event === 'TOKEN_REFRESHED' ||
                event === 'USER_UPDATED'
            ) {
                if (urlIndicaRecuperacaoSenha()) {
                    markPasswordRecoveryPending('url')
                }
                // INITIAL_SESSION chega cedo; dá um tick para PASSWORD_RECOVERY.
                if (event === 'INITIAL_SESSION') {
                    window.setTimeout(finish, 150)
                } else {
                    finish()
                }
            }
        })
        const subscription = data?.subscription

        window.setTimeout(finish, timeoutMs)
    })
}

/**
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
        // Sessão criada a partir de tokens na URL de alterar-senha.
        if (
            (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
            urlIndicaRecuperacaoSenha()
        ) {
            markPasswordRecoveryPending('url')
        }
    })

    return () => {
        data?.subscription?.unsubscribe?.()
    }
}

export function destinoAlterarSenhaAposRecuperacao(nextRaw) {
    const next = String(nextRaw || '').trim()
    if (
        next &&
        next.startsWith('/') &&
        !next.startsWith('//') &&
        next !== '/' &&
        next !== '/alterar-senha'
    ) {
        return `/alterar-senha?next=${encodeURIComponent(next)}`
    }
    return '/alterar-senha'
}
