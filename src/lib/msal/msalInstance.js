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
                        const path = window.location.pathname || '/'
                        const base = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '')
                        const homePath = `${base}/home`.replace(/\/+/g, '/') || '/home'
                        // Retorno do Azure costuma cair na raiz (`/`) — vai para a Home
                        if (path === '/' || path === base || path === `${base}/`) {
                            window.location.replace(homePath.startsWith('/') ? homePath : `/${homePath}`)
                            return app
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
