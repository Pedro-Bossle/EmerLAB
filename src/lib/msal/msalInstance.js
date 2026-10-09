import { PublicClientApplication } from '@azure/msal-browser'
import { isMsalConfigured, msalConfig } from './msalConfig.js'

let instance = null
let initPromise = null

export function getMsalInstance() {
    if (!isMsalConfigured()) return null
    if (!instance) {
        instance = new PublicClientApplication(msalConfig)
    }
    return instance
}

/** Inicializa MSAL uma vez (redirect + cache). */
export async function initializeMsal() {
    const app = getMsalInstance()
    if (!app) return null
    if (!initPromise) {
        initPromise = (async () => {
            await app.initialize()
            try {
                const result = await app.handleRedirectPromise()
                if (result?.account) {
                    app.setActiveAccount(result.account)
                    if (typeof window !== 'undefined') {
                        // Limpa ?code= / hash do Azure para não reprocessar nem confundir o Auth.
                        try {
                            const clean = window.location.pathname + window.location.search
                                .replace(/[?&](code|state|session_state|client_info|error|error_description)=[^&]*/gi, '')
                                .replace(/^&/, '?')
                                .replace(/\?$/, '')
                            window.history.replaceState({}, document.title, clean || window.location.pathname)
                        } catch {
                            /* ignore */
                        }
                        window.dispatchEvent(new CustomEvent('emerlab-outlook-agenda-refresh'))
                    }
                }
            } catch (e) {
                console.warn('[msal] handleRedirectPromise:', e?.message || e)
            }
            const accounts = app.getAllAccounts()
            if (!app.getActiveAccount() && accounts.length) {
                app.setActiveAccount(accounts[0])
            }
            return app
        })()
    }
    return initPromise
}
