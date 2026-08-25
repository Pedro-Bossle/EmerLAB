import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { isMsalConfigured, buildLoginRequest, buildGraphTokenRequest, resolveMsalRedirectUri } from '../../lib/msal/msalConfig'
import { exportarAgendaIcs } from '../../lib/calendarExport'
import {
    OUTLOOK_AGENDA_REFRESH_EVENT,
    formatarHorarioEvento,
    intervaloSemanaAtual,
    listarEventosOutlook,
    montarDiasSemanaAgenda,
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
    const account = instance.getActiveAccount() || accounts[0] || null

    const semana = useMemo(() => intervaloSemanaAtual(), [])
    const [eventos, setEventos] = useState([])
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [exportando, setExportando] = useState(false)
    const [diaFoco, setDiaFoco] = useState(() => {
        const dias = montarDiasSemanaAgenda([], semana)
        return dias.find((d) => d.isHoje)?.key || dias[0]?.key || ''
    })

    // Garante conta ativa quando o cache já tem login
    useEffect(() => {
        if (!accounts.length) return
        if (!instance.getActiveAccount()) {
            instance.setActiveAccount(accounts[0])
        }
    }, [accounts, instance])

    const obterToken = useCallback(
        async (conta) => {
            const acc = conta || instance.getActiveAccount() || accounts[0]
            if (!acc) return null
            try {
                const silent = await instance.acquireTokenSilent({
                    ...buildGraphTokenRequest(acc),
                })
                return silent.accessToken
            } catch (e) {
                if (!(e instanceof InteractionRequiredAuthError)) throw e
                if (inProgress !== InteractionStatus.None) {
                    throw new Error('Autenticação Microsoft em andamento. Tente novamente em instantes.')
                }
                const popup = await instance.acquireTokenPopup({
                    ...buildGraphTokenRequest(acc),
                })
                return popup.accessToken
            }
        },
        [accounts, instance, inProgress],
    )

    const carregarEventos = useCallback(
        async (contaOverride = null) => {
            const acc = contaOverride || instance.getActiveAccount() || accounts[0]
            if (!acc) {
                setEventos([])
                return
            }
            // Evita setState síncrono quando chamado a partir de useEffect
            await Promise.resolve()
            setLoading(true)
            setErro('')
            try {
                const token = await obterToken(acc)
                if (!token) throw new Error('Não foi possível obter token Microsoft.')
                const lista = await listarEventosOutlook(token, {
                    semanaAtual: true,
                    limite: 100,
                })
                setEventos(lista)
            } catch (e) {
                setEventos([])
                setErro(e?.message || String(e))
            } finally {
                setLoading(false)
            }
        },
        [accounts, instance, obterToken],
    )

    useEffect(() => {
        if (!account || inProgress !== InteractionStatus.None) return
        void carregarEventos(account)
    }, [account?.homeAccountId, inProgress, carregarEventos])

    useEffect(() => {
        const onRefresh = () => {
            if (!account || inProgress !== InteractionStatus.None) return
            void carregarEventos(account)
        }
        window.addEventListener(OUTLOOK_AGENDA_REFRESH_EVENT, onRefresh)
        return () => window.removeEventListener(OUTLOOK_AGENDA_REFRESH_EVENT, onRefresh)
    }, [account, inProgress, carregarEventos])

    const diasSemana = useMemo(
        () => montarDiasSemanaAgenda(eventos, semana),
        [eventos, semana],
    )

    const diaSelecionado =
        diasSemana.find((d) => d.key === diaFoco) ||
        diasSemana.find((d) => d.isHoje) ||
        diasSemana[0] ||
        null

    const rotuloSemana = useMemo(() => {
        const a = semana.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
        const b = semana.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
        return `${a} – ${b}`
    }, [semana])

    const onConectar = async () => {
        setErro('')
        setLoading(true)
        const redirectUri = resolveMsalRedirectUri()
        try {
            // Redirect (não popup): evita timed_out por COOP/Brave/Chrome.
            // A página recarrega; handleRedirectPromise ativa a conta e a agenda carrega.
            sessionStorage.setItem('emerlab-outlook-connecting', '1')
            await instance.loginRedirect(buildLoginRequest())
            // Não chega aqui — o browser navega para a Microsoft
        } catch (e) {
            sessionStorage.removeItem('emerlab-outlook-connecting')
            if (e?.errorCode === 'user_cancelled' || e?.errorCode === 'user_cancelled_login') {
                setLoading(false)
                return
            }
            const msg = e?.message || String(e)
            setErro(`${msg} Redirect URI: ${redirectUri}`)
            setLoading(false)
        }
    }

    // Após loginRedirect, se a flag existir, recarrega a agenda
    useEffect(() => {
        if (!account || inProgress !== InteractionStatus.None) return
        const pending = sessionStorage.getItem('emerlab-outlook-connecting')
        if (pending) {
            sessionStorage.removeItem('emerlab-outlook-connecting')
            void carregarEventos(account)
        }
    }, [account?.homeAccountId, inProgress, carregarEventos])

    const onDesconectar = async () => {
        setErro('')
        try {
            const acc = instance.getActiveAccount() || accounts[0]
            await instance.logoutPopup({
                account: acc || undefined,
                postLogoutRedirectUri: window.location.origin,
            })
            instance.setActiveAccount(null)
            setEventos([])
        } catch (e) {
            if (e?.errorCode === 'user_cancelled') {
                instance.setActiveAccount(null)
                setEventos([])
                return
            }
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
                                    : 'Exportar agenda (.ics)'
                            }
                            title="Exportar .ics (iPhone, Google, Outlook)"
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
                        disabled={busy || loading}
                        onClick={() => void onConectar()}
                    >
                        {loading ? 'Conectando…' : 'Conectar Outlook'}
                    </button>
                )}
            </div>

            {erro ? <div className="home_dash_alerta is-erro">{erro}</div> : null}

            {!account ? (
                <p className="home_dash_empty">Nada por aqui</p>
            ) : loading && !eventos.length ? (
                <p className="home_dash_muted">Carregando agenda…</p>
            ) : (
                <div className="home_dash_agenda_semana">
                    <p className="home_dash_agenda_semana_rotulo">Semana atual · {rotuloSemana}</p>
                    <div className="home_dash_agenda_dias" role="tablist" aria-label="Dias da semana">
                        {diasSemana.map((dia) => {
                            const ativo = dia.key === diaFoco
                            return (
                                <button
                                    key={dia.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={ativo}
                                    className={`home_dash_agenda_dia${ativo ? ' is-active' : ''}${dia.isHoje ? ' is-hoje' : ''}`}
                                    onClick={() => setDiaFoco(dia.key)}
                                >
                                    <span className="home_dash_agenda_dia_wd">{dia.labelCurto}</span>
                                    <strong className="home_dash_agenda_dia_num">{dia.labelDia}</strong>
                                    <span className="home_dash_agenda_dia_count">
                                        {dia.eventos.length ? `${dia.eventos.length}` : '·'}
                                    </span>
                                </button>
                            )
                        })}
                    </div>

                    <div className="home_dash_agenda_dia_painel" role="tabpanel">
                        {diaSelecionado ? (
                            <>
                                <h3 className="home_dash_agenda_dia_titulo">
                                    {diaSelecionado.date.toLocaleDateString('pt-BR', {
                                        weekday: 'long',
                                        day: '2-digit',
                                        month: 'long',
                                    })}
                                    {diaSelecionado.isHoje ? (
                                        <span className="home_dash_agenda_hoje_tag">Hoje</span>
                                    ) : null}
                                </h3>
                                {diaSelecionado.eventos.length === 0 ? (
                                    <p className="home_dash_empty">Nenhum compromisso neste dia</p>
                                ) : (
                                    <ul className="home_dash_agenda_lista">
                                        {diaSelecionado.eventos.map((ev) => (
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
                                                        </span>
                                                        <span className="home_dash_agenda_title">
                                                            {ev.subject}
                                                        </span>
                                                        {ev.location ? (
                                                            <small className="home_dash_agenda_loc">
                                                                {ev.location}
                                                            </small>
                                                        ) : null}
                                                    </a>
                                                ) : (
                                                    <div className="home_dash_agenda_link">
                                                        <span className="home_dash_agenda_when">
                                                            <strong>{formatarHorarioEvento(ev)}</strong>
                                                        </span>
                                                        <span className="home_dash_agenda_title">
                                                            {ev.subject}
                                                        </span>
                                                        {ev.location ? (
                                                            <small className="home_dash_agenda_loc">
                                                                {ev.location}
                                                            </small>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        ) : null}
                    </div>
                </div>
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
