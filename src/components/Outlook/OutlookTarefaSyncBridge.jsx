import { useEffect } from 'react'
import { InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { obterTokenGraphCalendario } from '../../lib/msal/obterTokenGraph.js'
import {
    adicionarTarefasAoOutlook,
    solicitarRefreshAgendaOutlook,
} from '../../lib/outlookCalendar.js'

/**
 * Expõe sync de 1+ afazeres (com prazo) → Outlook via `onBind(fn)`.
 * Só montar dentro de MsalProvider.
 */
export default function OutlookTarefaSyncBridge({ onBind }) {
    const { instance, accounts, inProgress } = useMsal()
    const account = accounts[0]

    useEffect(() => {
        if (typeof onBind !== 'function') return undefined
        const sync = async (tarefas) => {
            const lista = Array.isArray(tarefas) ? tarefas : [tarefas]
            const token = await obterTokenGraphCalendario(instance, {
                account: account || instance.getActiveAccount(),
                inProgress,
            })
            if (!token) return { criados: 0, falhas: [], loginRedirect: true }
            const r = await adicionarTarefasAoOutlook(token, lista)
            solicitarRefreshAgendaOutlook()
            return r
        }
        onBind(sync)
        return () => onBind(null)
    }, [onBind, instance, account, inProgress])

    return null
}
