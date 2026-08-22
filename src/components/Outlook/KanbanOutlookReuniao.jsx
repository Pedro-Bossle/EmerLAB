import React, { useCallback, useMemo, useState } from 'react'
import { InteractionStatus } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { graphTokenRequest, isMsalConfigured, loginRequest } from '../../lib/msal/msalConfig'
import { useMsalReady } from './MsalAppProvider'
import {
    criarEventoOutlook,
    parseEmailsConvidados,
} from '../../lib/outlookCalendar'
import {
    lerMetaOutlookReuniao,
    escreverMetaOutlookReuniao,
    corpoVisivelSemMetaOutlook,
} from '../../lib/credenciamento/kanbanOutlookMeta.js'

function defaultInicioLocal() {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return d
}

function toDatetimeLocalValue(d) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function KanbanOutlookReuniaoInner({ card, usuarios = [], corpoAtual, onSalvarCorpo }) {
    const { instance, accounts, inProgress } = useMsal()
    const account = accounts[0]
    const meta = useMemo(() => lerMetaOutlookReuniao(card.corpo || corpoAtual), [card.corpo, corpoAtual])

    const [assunto, setAssunto] = useState(() => `Reunião — ${card.nome || 'credenciamento'}`)
    const [inicio, setInicio] = useState(() => toDatetimeLocalValue(defaultInicioLocal()))
    const [fim, setFim] = useState(() => {
        const d = defaultInicioLocal()
        d.setHours(d.getHours() + 1)
        return toDatetimeLocalValue(d)
    })
    const [local, setLocal] = useState(() =>
        [card.cidade, card.uf].filter(Boolean).join(' / ') || '',
    )
    const [emailsLivre, setEmailsLivre] = useState('')
    const [convidadosIds, setConvidadosIds] = useState(() => new Set())
    const [online, setOnline] = useState(true)
    const [busy, setBusy] = useState(false)
    const [erro, setErro] = useState('')
    const [okMsg, setOkMsg] = useState('')

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

    const toggleConvidado = (id) => {
        setConvidadosIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const onConectar = async () => {
        setErro('')
        try {
            await instance.loginPopup(loginRequest)
        } catch (e) {
            if (e?.errorCode === 'user_cancelled') return
            setErro(e?.message || String(e))
        }
    }

    const criar = async () => {
        setBusy(true)
        setErro('')
        setOkMsg('')
        try {
            const token = await obterToken()
            if (!token) throw new Error('Conecte o Outlook para criar o evento.')

            const daEquipe = usuarios
                .filter((u) => convidadosIds.has(u.id) && u.email)
                .map((u) => ({ email: u.email, name: u.nome }))
            const extras = parseEmailsConvidados(emailsLivre)
            const attendees = [...daEquipe, ...extras]

            const start = new Date(inicio)
            const end = new Date(fim)
            const bodyHtml = [
                `<p>Reunião de credenciamento: <strong>${escape(card.nome || '')}</strong></p>`,
                card.cidade || card.uf
                    ? `<p>Local do prestador: ${escape([card.cidade, card.uf].filter(Boolean).join(' / '))}</p>`
                    : '',
                card.telefone ? `<p>Telefone: ${escape(card.telefone)}</p>` : '',
                card.prestadorId
                    ? `<p>Prestador vinculado: #${card.prestadorId}</p>`
                    : '',
                `<p>Card Kanban #${card.id} (coluna Reunião).</p>`,
            ]
                .filter(Boolean)
                .join('')

            const ev = await criarEventoOutlook(token, {
                subject: assunto,
                start,
                end,
                location: local,
                body: bodyHtml,
                attendees,
                isOnlineMeeting: online,
            })

            const baseCorpo = corpoVisivelSemMetaOutlook(corpoAtual || card.corpo || '')
            const novoCorpo = escreverMetaOutlookReuniao(baseCorpo, {
                eventId: ev.id,
                webLink: ev.webLink,
                subject: ev.subject,
                start: ev.start?.toISOString?.() || start.toISOString(),
                end: ev.end?.toISOString?.() || end.toISOString(),
                attendees: attendees.map((a) => a.email),
            })
            await onSalvarCorpo(novoCorpo)
            setOkMsg(
                attendees.length
                    ? `Evento criado no Outlook. Convite enviado a ${attendees.length} pessoa(s).`
                    : 'Evento criado no Outlook.',
            )
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="cred_kanban_outlook" aria-label="Agenda Outlook">
            <h3>Outlook — Reunião</h3>
            {meta?.eventId ? (
                <div className="cred_kanban_outlook_ok">
                    <p>
                        Evento na agenda
                        {meta.subject ? `: «${meta.subject}»` : ''}.
                    </p>
                    {meta.start ? (
                        <p className="cred_kanban_outlook_meta">
                            {new Date(meta.start).toLocaleString('pt-BR')}
                            {meta.attendees?.length
                                ? ` · ${meta.attendees.length} convidado(s)`
                                : ''}
                        </p>
                    ) : null}
                    {meta.webLink ? (
                        <a href={meta.webLink} target="_blank" rel="noopener noreferrer">
                            Abrir no Outlook
                        </a>
                    ) : null}
                </div>
            ) : null}

            {!account ? (
                <div className="cred_kanban_outlook_connect">
                    <p>Conecte o Outlook para criar o evento e convidar pessoas.</p>
                    <button
                        type="button"
                        disabled={inProgress !== InteractionStatus.None}
                        onClick={() => void onConectar()}
                    >
                        Conectar Outlook
                    </button>
                </div>
            ) : (
                <div className="cred_kanban_outlook_form">
                    <p className="cred_kanban_outlook_user" title={account.username}>
                        Conta: {account.username}
                    </p>
                    <label>
                        <span>Assunto</span>
                        <input value={assunto} onChange={(e) => setAssunto(e.target.value)} />
                    </label>
                    <div className="cred_kanban_outlook_datas">
                        <label>
                            <span>Início</span>
                            <input
                                type="datetime-local"
                                value={inicio}
                                onChange={(e) => setInicio(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Fim</span>
                            <input
                                type="datetime-local"
                                value={fim}
                                onChange={(e) => setFim(e.target.value)}
                            />
                        </label>
                    </div>
                    <label>
                        <span>Local</span>
                        <input
                            value={local}
                            onChange={(e) => setLocal(e.target.value)}
                            placeholder="Endereço ou sala"
                        />
                    </label>
                    <label className="cred_kanban_outlook_check">
                        <input
                            type="checkbox"
                            checked={online}
                            onChange={(e) => setOnline(e.target.checked)}
                        />
                        <span>Reunião online (Teams)</span>
                    </label>

                    {usuarios.some((u) => u.email) ? (
                        <div className="cred_kanban_outlook_equipe">
                            <span className="cred_kanban_outlook_label">Convidar equipe</span>
                            <ul>
                                {usuarios
                                    .filter((u) => u.email)
                                    .map((u) => (
                                        <li key={u.id}>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={convidadosIds.has(u.id)}
                                                    onChange={() => toggleConvidado(u.id)}
                                                />
                                                <span>
                                                    {u.nome}{' '}
                                                    <em>({u.email})</em>
                                                </span>
                                            </label>
                                        </li>
                                    ))}
                            </ul>
                        </div>
                    ) : null}

                    <label>
                        <span>Outros e-mails (convidados)</span>
                        <input
                            value={emailsLivre}
                            onChange={(e) => setEmailsLivre(e.target.value)}
                            placeholder="email1@…, email2@…"
                        />
                    </label>

                    <button
                        type="button"
                        className="is-primary"
                        disabled={busy || !assunto.trim()}
                        onClick={() => void criar()}
                    >
                        {busy
                            ? 'A criar…'
                            : meta?.eventId
                              ? 'Criar outro evento no Outlook'
                              : 'Criar no Outlook e convidar'}
                    </button>
                </div>
            )}

            {erro ? <p className="cred_kanban_outlook_erro">{erro}</p> : null}
            {okMsg ? <p className="cred_kanban_outlook_sucesso">{okMsg}</p> : null}
        </section>
    )
}

function escape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

export default function KanbanOutlookReuniao(props) {
    const msalReady = useMsalReady()

    if (!isMsalConfigured()) {
        return (
            <section className="cred_kanban_outlook" aria-label="Agenda Outlook">
                <h3>Outlook — Reunião</h3>
                <p className="cred_kanban_outlook_hint">
                    Quando o Outlook estiver configurado (`VITE_MSAL_CLIENT_ID` / `VITE_MSAL_TENANT_ID`),
                    dá para criar o evento na agenda e convidar pessoas daqui.
                </p>
            </section>
        )
    }

    if (!msalReady) {
        return (
            <section className="cred_kanban_outlook">
                <h3>Outlook — Reunião</h3>
                <p className="cred_kanban_outlook_hint">A carregar Microsoft…</p>
            </section>
        )
    }

    return <KanbanOutlookReuniaoInner {...props} />
}
