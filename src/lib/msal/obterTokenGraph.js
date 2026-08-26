import { InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser'
import { buildLoginRequest, buildGraphTokenRequest } from './msalConfig.js'

/**
 * Obtém access token Graph (Calendars). Se não houver conta, inicia loginRedirect e devolve null.
 * @param {import('@azure/msal-browser').IPublicClientApplication} instance
 * @param {{ account?: import('@azure/msal-browser').AccountInfo|null, inProgress?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export async function obterTokenGraphCalendario(instance, opts = {}) {
    if (!instance) throw new Error('MSAL não inicializado.')
    let acc = opts.account || instance.getActiveAccount()
    const accounts = instance.getAllAccounts?.() || []
    if (!acc && accounts.length) acc = accounts[0]

    if (!acc) {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('emerlab-outlook-connecting', '1')
        }
        await instance.loginRedirect(buildLoginRequest())
        return null
    }

    try {
        const silent = await instance.acquireTokenSilent(buildGraphTokenRequest(acc))
        return silent.accessToken
    } catch (e) {
        if (!(e instanceof InteractionRequiredAuthError)) throw e
        if (opts.inProgress && opts.inProgress !== InteractionStatus.None) {
            throw new Error('Autenticação Microsoft em andamento. Tente novamente em instantes.')
        }
        const popup = await instance.acquireTokenPopup(buildGraphTokenRequest(acc))
        return popup.accessToken
    }
}
