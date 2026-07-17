import React, { createContext, useContext, useEffect, useState } from 'react'
import { MsalProvider } from '@azure/msal-react'
import { initializeMsal, getMsalInstance } from '../../lib/msal/msalInstance'
import { isMsalConfigured } from '../../lib/msal/msalConfig'

const MsalReadyContext = createContext(true)

export function useMsalReady() {
    return useContext(MsalReadyContext)
}

const MsalAppProvider = ({ children }) => {
    const [instance, setInstance] = useState(() => getMsalInstance())
    const [ready, setReady] = useState(!isMsalConfigured())

    useEffect(() => {
        if (!isMsalConfigured()) return undefined
        let cancelled = false
        ;(async () => {
            const app = await initializeMsal()
            if (!cancelled && app) {
                setInstance(app)
                setReady(true)
            }
        })().catch(() => {
            if (!cancelled) setReady(true)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const msalReady = !isMsalConfigured() || ready

    if (!isMsalConfigured()) {
        return (
            <MsalReadyContext.Provider value={msalReady}>{children}</MsalReadyContext.Provider>
        )
    }

    if (!ready || !instance) {
        return (
            <MsalReadyContext.Provider value={false}>{children}</MsalReadyContext.Provider>
        )
    }

    return (
        <MsalReadyContext.Provider value={msalReady}>
            <MsalProvider instance={instance}>{children}</MsalProvider>
        </MsalReadyContext.Provider>
    )
}

export default MsalAppProvider
