const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || ''
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || ''

/** Redirect canônico registado no Azure (agenda Outlook). */
export const MSAL_PRODUCTION_REDIRECT_ORIGIN = 'https://emerlab.com.br'

function origemAtual() {
    if (typeof window === 'undefined' || !window.location?.origin) return ''
    return window.location.origin.replace(/\/$/, '')
}

function origemComBaseUrl(origin) {
    const base = String(import.meta.env.BASE_URL || '/').trim() || '/'
    if (!origin) return ''
    if (!base || base === '/') return origin.replace(/\/$/, '')
    const path = `/${base.replace(/^\/+|\/+$/g, '')}`
    return `${origin.replace(/\/$/, '')}${path}`
}

function normalizarOrigemRedirect(raw) {
    const from = String(raw || '').trim()
    if (!from) return ''
    try {
        const u = new URL(from)
        const path = u.pathname.replace(/\/$/, '')
        return `${u.origin}${path === '/' ? '' : path}`.replace(/\/$/, '') || u.origin
    } catch {
        return ''
    }
}

/** Domínios de produção / preview Vercel → redirect canónico no Azure. */
function isHostProducaoEmerlab(host) {
    return (
        host === 'emerlab.com.br' ||
        host === 'www.emerlab.com.br' ||
        host === 'emerlab.vercel.app' ||
        host.endsWith('.vercel.app')
    )
}

/**
 * Origem (+ path) para redirect MSAL.
 * Em produção/preview: sempre https://emerlab.com.br (registado no Azure).
 * Em local: VITE_MSAL_REDIRECT_URI ou origem atual.
 */
function origemDeEnvOuJanela() {
    if (typeof window !== 'undefined') {
        const host = String(window.location.hostname || '').toLowerCase()
        if (isHostProducaoEmerlab(host)) {
            return MSAL_PRODUCTION_REDIRECT_ORIGIN
        }
    }

    const fromEnv = normalizarOrigemRedirect(import.meta.env.VITE_MSAL_REDIRECT_URI)
    if (fromEnv) {
        // Evita AADSTS50011 se a env apontar para *.vercel.app sem registo no Azure.
        try {
            const envHost = new URL(fromEnv).hostname.toLowerCase()
            if (isHostProducaoEmerlab(envHost)) return MSAL_PRODUCTION_REDIRECT_ORIGIN
        } catch {
            /* usa fromEnv */
        }
        return fromEnv
    }

    return origemComBaseUrl(origemAtual())
}

/**
 * Redirect da SPA (loginRedirect / retorno do Azure).
 * Produção Azure: https://emerlab.com.br (+ /auth-redirect.html no popup).
 */
export function resolveMsalRedirectUri() {
    return origemDeEnvOuJanela()
}

/**
 * Redirect do popup (página estática). Evita carregar o React no popup.
 */
export function resolveMsalPopupRedirectUri() {
    const origin = origemDeEnvOuJanela()
    if (!origin) return ''
    return `${origin}/auth-redirect.html`
}

export function isMsalConfigured() {
    return Boolean(clientId && tenantId)
}

export const msalConfig = {
    auth: {
        clientId,
        authority: tenantId
            ? `https://login.microsoftonline.com/${tenantId}`
            : 'https://login.microsoftonline.com/common',
        get redirectUri() {
            return resolveMsalRedirectUri()
        },
        navigateToLoginRequestUrl: false,
        get postLogoutRedirectUri() {
            return resolveMsalRedirectUri()
        },
    },
    cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
    },
    system: {
        allowRedirectInIframe: false,
        windowHashTimeout: 120000,
        iframeHashTimeout: 120000,
        loadFrameTimeout: 120000,
    },
}

/** Delegated: leitura e escrita de calendário (Graph). */
export const graphCalendarScopes = ['User.Read', 'Calendars.ReadWrite']

/** loginRedirect — mais fiável (Brave/Chrome não quebram com COOP). */
export function buildLoginRequest() {
    return {
        scopes: [...graphCalendarScopes],
        redirectUri: resolveMsalRedirectUri(),
    }
}

/** loginPopup / acquireTokenPopup — usa página estática. */
export function buildPopupLoginRequest() {
    return {
        scopes: [...graphCalendarScopes],
        redirectUri: resolveMsalPopupRedirectUri(),
    }
}

export function buildGraphTokenRequest(account) {
    const req = {
        scopes: [...graphCalendarScopes],
        redirectUri: resolveMsalPopupRedirectUri(),
    }
    if (account) req.account = account
    return req
}

export const loginRequest = {
    get scopes() {
        return [...graphCalendarScopes]
    },
    get redirectUri() {
        return resolveMsalRedirectUri()
    },
}

export const graphTokenRequest = {
    get scopes() {
        return [...graphCalendarScopes]
    },
    get redirectUri() {
        return resolveMsalPopupRedirectUri()
    },
}
