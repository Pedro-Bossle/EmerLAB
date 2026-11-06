import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { InteractionRequiredAuthError, InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { isMsalConfigured, buildLoginRequest, buildGraphTokenRequest, resolveMsalRedirectUri } from '../../lib/msal/msalConfig'
import {
    OUTLOOK_AGENDA_REFRESH_EVENT,
    formatarHorarioEvento,
    intervaloSemanaAtual,
    listarEventosOutlook,
    montarDiasSemanaAgenda,
} from '../../lib/outlookCalendar'
import { useMsalReady } from './MsalAppProvider'

const MAX_ITENS_AGENDA = 4

function IconeAtualizar() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 4v7h-7" />
        </svg>
    )
}

function IconeSair() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H10" />
            <path d="M14.5 8.5 18 12l-3.5 3.5M18 12H9.5" />
        </svg>
    )
}

/**
 * Decide o que a agenda mostra. «Hoje» lista os compromissos de hoje; se hoje está vazio só existe a semana.
 * Na semana, um dia só abre se tiver compromisso.
 */
export function visaoAgenda(diasSemana, modo, diaFoco) {
    const hoje = (diasSemana || []).find((d) => d.isHoje) || null
    const hojeVazio = !hoje || hoje.eventos.length === 0
    const modoEfetivo = hojeVazio ? 'semana' : modo
    const diaAberto =
        modoEfetivo === 'semana'
            ? (diasSemana || []).find((d) => d.key === diaFoco && d.eventos.length > 0) || null
            : null
    return { hoje, hojeVazio, modoEfetivo, diaAberto }
}

function ListaDia({ dia }) {
    const lista = dia.eventos.slice(0, MAX_ITENS_AGENDA)
    const extras = dia.eventos.length - lista.length
    return (
        <>
            <h3 className="home_dash_agenda_dia_titulo">
                {dia.date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                {dia.isHoje ? <span className="home_dash_agenda_hoje_tag">Hoje</span> : null}
            </h3>
            <ul className="home_dash_agenda_lista">
                {lista.map((ev) => (
                    <li key={ev.id} className="home_dash_agenda_item">
                                {ev.webLink ? (
                                    <a className="home_dash_agenda_link" href={ev.webLink} target="_blank" rel="noopener noreferrer">
                                        <span className="home_dash_agenda_when"><strong>{formatarHorarioEvento(ev)}</strong></span>
                                        <span className="home_dash_agenda_title">{ev.subject}</span>
                                        {ev.location ? <small className="home_dash_agenda_loc">{ev.location}</small> : null}
                                    </a>
                                ) : (
                                    <div className="home_dash_agenda_link">
                                        <span className="home_dash_agenda_when"><strong>{formatarHorarioEvento(ev)}</strong></span>
                                        <span className="home_dash_agenda_title">{ev.subject}</span>
                                        {ev.location ? <small className="home_dash_agenda_loc">{ev.location}</small> : null}
                                    </div>
                                )}
                            </li>
                ))}
            </ul>
            {extras > 0 ? <p className="home_dash_muted home_dash_agenda_mais">+{extras} no mesmo dia</p> : null}
        </>
    )
}

const OutlookAgendaCardInner = () => {
    const { instance, accounts, inProgress } = useMsal()
    const account = instance.getActiveAccount() || accounts[0] || null

    const [eventos, setEventos] = useState([])
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const semana = useMemo(() => intervaloSemanaAtual(), [])
    const [modo, setModo] = useState('hoje')
    const [diaFoco, setDiaFoco] = useState(null)

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

    const diasSemana = useMemo(() => montarDiasSemanaAgenda(eventos, semana), [eventos, semana])
    const visao = useMemo(() => visaoAgenda(diasSemana, modo, diaFoco), [diasSemana, modo, diaFoco])

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
                postLogoutRedirectUri: resolveMsalRedirectUri().replace(/\/auth-redirect\.html$/i, '') ||
                    window.location.origin,
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

    const busy = inProgress !== InteractionStatus.None

    return (
        <>
            <div className="home_dash_agenda_toolbar">
                {account ? (
                    <>
                        {!visao.hojeVazio ? (
                            <div className="home_dash_agenda_modo" role="group" aria-label="Visão da agenda">
                                {['hoje', 'semana'].map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        className={visao.modoEfetivo === m ? 'is-active' : ''}
                                        aria-pressed={visao.modoEfetivo === m}
                                        onClick={() => {
                                            setModo(m)
                                            setDiaFoco(null)
                                        }}
                                    >
                                        {m === 'hoje' ? 'Hoje' : 'Semana'}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <span className="home_dash_agenda_user">Semana</span>
                        )}
                        <span className="home_dash_agenda_espaco" />
                        <button
                            type="button"
                            className="home_dash_btn secondary home_dash_agenda_icone"
                            disabled={busy || loading}
                            onClick={() => void carregarEventos()}
                            aria-label="Atualizar agenda"
                            title="Atualizar agenda"
                        >
                            <IconeAtualizar />
                        </button>
                        <button
                            type="button"
                            className="home_dash_btn ghost home_dash_agenda_icone"
                            disabled={busy}
                            onClick={() => void onDesconectar()}
                            aria-label="Desconectar do Outlook"
                            title={`Desconectar do Outlook (${account.username})`}
                        >
                            <IconeSair />
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
                    {visao.modoEfetivo === 'hoje' && visao.hoje ? (
                        <ListaDia dia={visao.hoje} />
                    ) : (
                        <>
                            <div className="home_dash_agenda_dias" role="group" aria-label="Dias da semana">
                                {diasSemana.map((dia) => {
                                    const vazio = dia.eventos.length === 0
                                    const ativo = visao.diaAberto?.key === dia.key
                                    return (
                                        <button
                                            key={dia.key}
                                            type="button"
                                            disabled={vazio}
                                            aria-pressed={ativo}
                                            className={`home_dash_agenda_dia${ativo ? ' is-active' : ''}${dia.isHoje ? ' is-hoje' : ''}${vazio ? ' is-vazio' : ''}`}
                                            onClick={() => setDiaFoco(ativo ? null : dia.key)}
                                            title={vazio ? 'Sem compromissos' : `${dia.eventos.length} compromisso(s)`}
                                        >
                                            <span className="home_dash_agenda_dia_wd">{dia.labelCurto}</span>
                                            <strong className="home_dash_agenda_dia_num">{dia.labelDia}</strong>
                                            <span className="home_dash_agenda_dia_count">{vazio ? '·' : dia.eventos.length}</span>
                                        </button>
                                    )
                                })}
                            </div>
                            {visao.diaAberto ? <ListaDia dia={visao.diaAberto} /> : null}
                        </>
                    )}
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
