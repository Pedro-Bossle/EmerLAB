const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || ''
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || ''

/**
 * Redirect URI tem de ser a MESMA origem da página em que o utilizador
 * clicou «Conectar» — o MSAL guarda o state no sessionStorage dessa origem.
 * Saltos vercel.app → emerlab.com.br (ou www → apex) partem o state e o login falha.
 */
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

/**
 * Origem da página atual (ou VITE_MSAL_REDIRECT_URI em local se apontar para localhost).
 */
function origemDeEnvOuJanela() {
    const atual = origemComBaseUrl(origemAtual())
    if (typeof window === 'undefined') {
        return normalizarOrigemRedirect(import.meta.env.VITE_MSAL_REDIRECT_URI) || ''
    }

    const host = String(window.location.hostname || '').toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') {
        const fromEnv = normalizarOrigemRedirect(import.meta.env.VITE_MSAL_REDIRECT_URI)
        if (fromEnv) {
            try {
                const envHost = new URL(fromEnv).hostname.toLowerCase()
                if (envHost === 'localhost' || envHost === '127.0.0.1') return fromEnv
            } catch {
                /* usa atual */
            }
        }
        return atual
    }

    // Produção / preview: sempre a origem onde a app está a correr.
    return atual
}

/**
 * Redirect único (loginRedirect + popup): página estática, sem React/Supabase.
 * Tem de estar registada no Azure AD (ex.: https://emerlab.com.br/auth-redirect.html).
 */
export function resolveMsalRedirectUri() {
    const origin = origemDeEnvOuJanela()
    if (!origin) return ''
    return `${origin}/auth-redirect.html`
}

/** @deprecated Preferir resolveMsalRedirectUri — popup e redirect usam a mesma URI. */
export function resolveMsalPopupRedirectUri() {
    return resolveMsalRedirectUri()
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
            return origemDeEnvOuJanela() || resolveMsalRedirectUri()
        },
    },
    cache: {
        cacheLocation: 'sessionStorage',
        // Ajuda a recuperar o state se o storage da sessão falhar no mesmo site.
        storeAuthStateInCookie: true,
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

/** loginPopup / acquireTokenPopup — mesma URI estática. */
export function buildPopupLoginRequest() {
    return {
        scopes: [...graphCalendarScopes],
        redirectUri: resolveMsalRedirectUri(),
    }
}

export function buildGraphTokenRequest(account) {
    const req = {
        scopes: [...graphCalendarScopes],
        redirectUri: resolveMsalRedirectUri(),
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
        return resolveMsalRedirectUri()
    },
}
