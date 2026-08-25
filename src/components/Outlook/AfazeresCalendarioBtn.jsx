import React, { useCallback, useState } from 'react'
import { InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { exportarTarefasIcs } from '../../lib/calendarExport'
import { buildLoginRequest, buildGraphTokenRequest, isMsalConfigured } from '../../lib/msal/msalConfig'
import {
    adicionarTarefasAoOutlook,
    solicitarRefreshAgendaOutlook,
} from '../../lib/outlookCalendar'
import { useMsalReady } from './MsalAppProvider'

function IconCalendarioAdd() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 10h18" />
            <path d="M12 13v5M9.5 15.5h5" />
        </svg>
    )
}

function AfazeresCalendarioBtnIcs({ tarefas, disabled, onErro, onOk }) {
    const [busy, setBusy] = useState(false)
    const onClick = async () => {
        setBusy(true)
        try {
            await exportarTarefasIcs(tarefas)
            onOk?.('Arquivo .ics gerado. Abra no Calendário / Outlook / Google.')
        } catch (e) {
            onErro?.(e?.message || String(e))
        } finally {
            setBusy(false)
        }
    }
    return (
        <button
            type="button"
            className="home_dash_btn secondary home_dash_btn--export"
            disabled={disabled || busy || !(tarefas || []).length}
            onClick={() => void onClick()}
            aria-label={busy ? 'A exportar para o calendário' : 'Adicionar afazeres ao calendário'}
            title="Adicionar ao calendário só as suas tarefas em aberto (.ics — iPhone, Google, Outlook)"
        >
            {busy ? (
                <span className="home_dash_btn_export_busy" aria-hidden="true">
                    …
                </span>
            ) : (
                <IconCalendarioAdd />
            )}
        </button>
    )
}

function AfazeresCalendarioBtnOutlook({ tarefas, disabled, onErro, onOk }) {
    const { instance, accounts, inProgress } = useMsal()
    const account = accounts[0]
    const [busy, setBusy] = useState(false)
    const msalBusy = inProgress !== InteractionStatus.None

    const obterToken = useCallback(async () => {
        let acc = account || instance.getActiveAccount()
        if (!acc) {
            sessionStorage.setItem('emerlab-outlook-connecting', '1')
            await instance.loginRedirect(buildLoginRequest())
            return null
        }
        try {
            const silent = await instance.acquireTokenSilent(buildGraphTokenRequest(acc))
            return silent.accessToken
        } catch {
            const popup = await instance.acquireTokenPopup(buildGraphTokenRequest(acc))
            return popup.accessToken
        }
    }, [account, instance])

    const onClick = async () => {
        setBusy(true)
        try {
            const token = await obterToken()
            if (!token) return // loginRedirect em andamento
            const { criados, falhas } = await adicionarTarefasAoOutlook(token, tarefas)
            solicitarRefreshAgendaOutlook()
            if (falhas.length) {
                onOk?.(
                    `${criados} afazer(es) no Outlook. ${falhas.length} falha(s): ${falhas[0].erro}`,
                )
            } else {
                onOk?.(`${criados} afazer(es) adicionados ao calendário Outlook.`)
            }
        } catch (e) {
            if (e?.errorCode === 'user_cancelled') return
            // Fallback .ics se Graph falhar
            try {
                await exportarTarefasIcs(tarefas)
                onErro?.(
                    `${e?.message || String(e)} — exportado .ics como alternativa.`,
                )
            } catch (e2) {
                onErro?.(e?.message || e2?.message || String(e))
            }
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            type="button"
            className="home_dash_btn secondary home_dash_btn--export"
            disabled={disabled || busy || msalBusy || !(tarefas || []).length}
            onClick={() => void onClick()}
            aria-label={
                busy ? 'A adicionar ao calendário Outlook' : 'Adicionar afazeres ao calendário Outlook'
            }
            title={
                account
                    ? 'Adicionar ao Outlook só as suas tarefas em aberto'
                    : 'Conectar Outlook e adicionar só as suas tarefas em aberto'
            }
        >
            {busy ? (
                <span className="home_dash_btn_export_busy" aria-hidden="true">
                    …
                </span>
            ) : (
                <IconCalendarioAdd />
            )}
        </button>
    )
}

/**
 * Preferência: cria eventos no Outlook (Graph). Sem MSAL → .ics.
 */
export default function AfazeresCalendarioBtn({ tarefas, disabled, onErro, onOk }) {
    const msalReady = useMsalReady()

    if (!isMsalConfigured()) {
        return (
            <AfazeresCalendarioBtnIcs
                tarefas={tarefas}
                disabled={disabled}
                onErro={onErro}
                onOk={onOk}
            />
        )
    }

    if (!msalReady) {
        return (
            <button
                type="button"
                className="home_dash_btn secondary home_dash_btn--export"
                disabled
                aria-label="Preparando Microsoft…"
                title="Preparando Microsoft…"
            >
                <IconCalendarioAdd />
            </button>
        )
    }

    return (
        <AfazeresCalendarioBtnOutlook
            tarefas={tarefas}
            disabled={disabled}
            onErro={onErro}
            onOk={onOk}
        />
    )
}
