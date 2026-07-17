const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || ''
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || ''

export function resolveMsalRedirectUri() {
    const fromEnv = import.meta.env.VITE_MSAL_REDIRECT_URI
    if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim().replace(/\/$/, '')
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin.replace(/\/$/, '')
    }
    return ''
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
        redirectUri: resolveMsalRedirectUri(),
        navigateToLoginRequestUrl: true,
    },
    cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
    },
}

/** Delegated: leitura e escrita de calendário (Graph). */
export const graphCalendarScopes = ['User.Read', 'Calendars.ReadWrite']

export const loginRequest = {
    scopes: graphCalendarScopes,
}

export const graphTokenRequest = {
    scopes: graphCalendarScopes,
}
