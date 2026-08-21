import React, { useCallback, useEffect, useState } from 'react'
import { InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { graphTokenRequest, isMsalConfigured, loginRequest } from '../../lib/msal/msalConfig'
import { exportarAgendaIcs } from '../../lib/calendarExport'
import {
    formatarDataEvento,
    formatarHorarioEvento,
    listarEventosOutlook,
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

const OutlookAgendaCardInner = () => {
    const { instance, accounts, inProgress } = useMsal()
    const account = accounts[0]

    const [eventos, setEventos] = useState([])
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [exportando, setExportando] = useState(false)

    const obterToken = useCallback(async () => {
        if (!account) return null
        try {
            const silent = await instance.acquireTokenSilent({
                ...graphTokenRequest,
                account,
            })
            return silent.accessToken
        } catch {
            const popup = await instance.acquireTokenPopup(graphTokenRequest)
            return popup.accessToken
        }
    }, [account, instance])

    const carregarEventos = useCallback(async () => {
        if (!account) {
            setEventos([])
            return
        }
        setLoading(true)
        setErro('')
        try {
            const token = await obterToken()
            const lista = await listarEventosOutlook(token, { dias: 7, limite: 15 })
            setEventos(lista)
        } catch (e) {
            setEventos([])
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [account, obterToken])

    useEffect(() => {
        if (!account || inProgress !== InteractionStatus.None) return
        void carregarEventos()
    }, [account, inProgress, carregarEventos])

    const onConectar = async () => {
        setErro('')
        try {
            await instance.loginPopup(loginRequest)
        } catch (e) {
            if (e?.errorCode === 'user_cancelled') return
            setErro(e?.message || String(e))
        }
    }

    const onDesconectar = async () => {
        setErro('')
        try {
            await instance.logoutPopup({ account })
            setEventos([])
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }

    const onExportar = async () => {
        setExportando(true)
        setErro('')
        try {
            await exportarAgendaIcs(eventos)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setExportando(false)
        }
    }

    const busy = inProgress !== InteractionStatus.None

    return (
        <>
            <div className="home_dash_agenda_toolbar">
                {account ? (
                    <>
                        <span className="home_dash_agenda_user" title={account.username}>
                            {account.username}
                        </span>
                        <button
                            type="button"
                            className="home_dash_btn secondary home_dash_btn--export"
                            disabled={busy || loading || exportando || !eventos.length}
                            onClick={() => void onExportar()}
                            aria-label={
                                exportando
                                    ? 'A exportar para o calendário'
                                    : 'Adicionar agenda ao calendário'
                            }
                            title="Adicionar ao calendário (.ics — iPhone, Google, Outlook)"
                        >
                            {exportando ? (
                                <span className="home_dash_btn_export_busy" aria-hidden="true">
                                    …
                                </span>
                            ) : (
                                <IconCalendarioAdd />
                            )}
                        </button>
                        <button
                            type="button"
                            className="home_dash_btn secondary"
                            disabled={busy || loading}
                            onClick={() => void carregarEventos()}
                        >
                            Atualizar
                        </button>
                        <button
                            type="button"
                            className="home_dash_btn ghost"
                            disabled={busy}
                            onClick={() => void onDesconectar()}
                        >
                            Desconectar
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="home_dash_btn"
                        disabled={busy}
                        onClick={() => void onConectar()}
                    >
                        Conectar Outlook
                    </button>
                )}
            </div>

            {erro ? <div className="home_dash_alerta is-erro">{erro}</div> : null}

            {!account ? (
                <p className="home_dash_empty">Nada por aqui</p>
            ) : loading && !eventos.length ? (
                <p className="home_dash_muted">Carregando agenda…</p>
            ) : eventos.length === 0 ? (
                <p className="home_dash_empty">Nada por aqui</p>
            ) : (
                <ul className="home_dash_agenda_lista">
                    {eventos.map((ev) => (
                        <li key={ev.id} className="home_dash_agenda_item">
                            {ev.webLink ? (
                                <a
                                    className="home_dash_agenda_link"
                                    href={ev.webLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <span className="home_dash_agenda_when">
                                        <strong>{formatarHorarioEvento(ev)}</strong>
                                        <small>{formatarDataEvento(ev)}</small>
                                    </span>
                                    <span className="home_dash_agenda_title">{ev.subject}</span>
                                    {ev.location ? (
                                        <small className="home_dash_agenda_loc">{ev.location}</small>
                                    ) : null}
                                </a>
                            ) : (
                                <div className="home_dash_agenda_link">
                                    <span className="home_dash_agenda_when">
                                        <strong>{formatarHorarioEvento(ev)}</strong>
                                        <small>{formatarDataEvento(ev)}</small>
                                    </span>
                                    <span className="home_dash_agenda_title">{ev.subject}</span>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </>
    )
}

const OutlookAgendaCard = () => {
    const msalReady = useMsalReady()

    if (!isMsalConfigured()) {
        return (
            <>
                <p className="home_dash_empty">Nada por aqui</p>
                <p className="home_dash_muted home_dash_agenda_hint">
                    Configure VITE_MSAL_CLIENT_ID e VITE_MSAL_TENANT_ID para conectar o Outlook.
                </p>
            </>
        )
    }

    if (!msalReady) {
        return <p className="home_dash_muted">Preparando Microsoft…</p>
    }

    return <OutlookAgendaCardInner />
}

export default OutlookAgendaCard
