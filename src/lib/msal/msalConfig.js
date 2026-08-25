const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || ''
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || ''

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

/** Origem (+ path) para redirect MSAL: preserva path do env; no fallback usa BASE_URL. */
function origemDeEnvOuJanela() {
    const fromEnv = String(import.meta.env.VITE_MSAL_REDIRECT_URI || '').trim()
    if (fromEnv) {
        try {
            const u = new URL(fromEnv)
            const path = u.pathname.replace(/\/$/, '')
            return `${u.origin}${path === '/' ? '' : path}`.replace(/\/$/, '') || u.origin
        } catch {
            /* fallback */
        }
    }
    return origemComBaseUrl(origemAtual())
}

/**
 * Redirect da SPA (loginRedirect / retorno do Azure).
 * Tem de estar registado no Azure (ex.: http://localhost:5173).
 */
export function resolveMsalRedirectUri() {
    return origemDeEnvOuJanela()
}

/**
 * Redirect do popup (página estática). Evita carregar o React no popup.
 * Tem de estar registado no Azure (ex.: http://localhost:5173/auth-redirect.html).
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
        // Token popup também deve voltar à página estática
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
