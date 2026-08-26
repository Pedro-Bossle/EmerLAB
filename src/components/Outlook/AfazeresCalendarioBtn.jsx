import React, { useState } from 'react'
import { InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { exportarTarefasIcs } from '../../lib/calendarExport'
import { isMsalConfigured } from '../../lib/msal/msalConfig'
import { obterTokenGraphCalendario } from '../../lib/msal/obterTokenGraph'
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

function tarefasComPrazo(tarefas) {
    return (tarefas || []).filter((t) => String(t?.prazo || '').trim())
}

function AfazeresCalendarioBtnIcs({ tarefas, disabled, onErro, onOk }) {
    const [busy, setBusy] = useState(false)
    const comPrazo = tarefasComPrazo(tarefas)
    const onClick = async () => {
        setBusy(true)
        try {
            await exportarTarefasIcs(comPrazo)
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
            disabled={disabled || busy || !comPrazo.length}
            onClick={() => void onClick()}
            aria-label={busy ? 'A exportar para o calendário' : 'Adicionar afazeres com prazo ao calendário'}
            title="Adicionar ao calendário só afazeres com data de prazo (.ics)"
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
    const comPrazo = tarefasComPrazo(tarefas)

    const onClick = async () => {
        setBusy(true)
        try {
            const token = await obterTokenGraphCalendario(instance, { account, inProgress })
            if (!token) return
            const { criados, falhas } = await adicionarTarefasAoOutlook(token, comPrazo)
            solicitarRefreshAgendaOutlook()
            if (falhas.length) {
                onOk?.(
                    `${criados} prazo(s) no Outlook. ${falhas.length} falha(s): ${falhas[0].erro}`,
                )
            } else {
                onOk?.(`${criados} afazer(es) com prazo adicionados à agenda Outlook.`)
            }
        } catch (e) {
            if (e?.errorCode === 'user_cancelled') return
            try {
                await exportarTarefasIcs(comPrazo)
                onErro?.(`${e?.message || String(e)} — exportado .ics como alternativa.`)
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
            disabled={disabled || busy || msalBusy || !comPrazo.length}
            onClick={() => void onClick()}
            aria-label={
                busy
                    ? 'A adicionar prazos ao calendário Outlook'
                    : 'Adicionar afazeres com prazo ao calendário Outlook'
            }
            title={
                account
                    ? 'Adicionar à agenda Outlook só afazeres em aberto com data de prazo'
                    : 'Conectar Outlook e adicionar só afazeres com data de prazo'
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
 * Preferência: cria eventos no Outlook (Graph) só para afazeres com prazo.
 * Sem MSAL → .ics.
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
