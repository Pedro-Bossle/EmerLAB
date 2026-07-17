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
            await app.handleRedirectPromise()
            return app
        })()
    }
    return initPromise
}
