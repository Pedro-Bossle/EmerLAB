import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clicksignRequest } from '../../lib/clicksign/clicksignClient'
import {
    CLICKSIGN_NOTIF_STORAGE_KEY,
    carregarNotificacoes,
    contarNotificacoesContratosTotal,
    listarNotificacoesContratosRecentes,
    contarNotificacoesArmazenadas,
    listarNotificacoesRecentes,
    limparTodasNotificacoesContratos,
    sincronizarNotificacoesClicksign,
} from '../../lib/clicksign/clicksignNotificacoes'
import { PERMISSION_KEYS, useStoredPermission } from '../../lib/accessControl'
import {
    FORMULARIO_ENTRADAS_CHANGE_EVENT,
    contarEntradasFormularioPendentesNotificacao,
    formatarDataEntrada,
    limparNotificacoesFormularioBell,
    listarEntradasFormularioNotificacao,
    rotuloTipoPerfil,
} from '../../lib/formularioCredenciamento'
import { supabase } from '../../lib/supabase'
import { formatarCpfCnpjEntrada } from '../../lib/prestadorCadastroHelpers'
import { formatarDataPtBr } from '../../pages/Contratos/contratosUi'
import './FormularioInboxBell.css'

/** Fallback se Realtime do Supabase estiver indisponível. */
const INTERVALO_MS = 30_000
/** Intervalo mínimo entre chamadas à API Clicksign (polling). */
const INTERVALO_SYNC_CONTRATOS_MS = 45_000
const TITULO_ABA_BASE = 'Emerdog AIO'

export default function FormularioInboxBell() {
    const podeNotifForm = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_FORMULARIO)
    const podeNotifContratos = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_CONTRATOS)

    const [countForm, setCountForm] = useState(0)
    const [countContratos, setCountContratos] = useState(0)
    const [recentesForm, setRecentesForm] = useState([])
    const [recentesContratos, setRecentesContratos] = useState([])
    const [aberto, setAberto] = useState(false)
    const [loading, setLoading] = useState(false)
    const [syncContratos, setSyncContratos] = useState(false)
    const [limpando, setLimpando] = useState(false)
    const painelRef = useRef(null)
    const btnRef = useRef(null)
    const ultimoSyncContratosRef = useRef(0)

    const countTotal = countForm + countContratos
    const temPermissao = podeNotifForm || podeNotifContratos
    const visivel = temPermissao && countTotal > 0

    useEffect(() => {
        if (!temPermissao) return undefined
        const n = countTotal > 0 ? (countTotal > 99 ? '99+' : String(countTotal)) : ''
        document.title = n ? `(${n}) ${TITULO_ABA_BASE}` : TITULO_ABA_BASE
        return () => {
            document.title = TITULO_ABA_BASE
        }
    }, [temPermissao, countTotal])

    const lerContratosLocal = useCallback(async () => {
        const lista = carregarNotificacoes()
        const total = await contarNotificacoesContratosTotal()
        setCountContratos(total)
        return lista
    }, [])

    const sincronizarContratosSeDevido = useCallback(async (forcar = false) => {
        if (!podeNotifContratos) return
        const agora = Date.now()
        if (!forcar && agora - ultimoSyncContratosRef.current < INTERVALO_SYNC_CONTRATOS_MS) {
            await lerContratosLocal()
            return
        }
        ultimoSyncContratosRef.current = agora
        setSyncContratos(true)
        try {
            const { lista } = await sincronizarNotificacoesClicksign(clicksignRequest)
            const total = await contarNotificacoesContratosTotal()
            setCountContratos(total)
            if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
        } catch {
            await lerContratosLocal()
        } finally {
            setSyncContratos(false)
        }
    }, [podeNotifContratos, aberto, lerContratosLocal])

    const atualizarFormulario = useCallback(async () => {
        if (!podeNotifForm) return
        const n = await contarEntradasFormularioPendentesNotificacao()
        setCountForm(n)
        if (aberto) {
            const lista = await listarEntradasFormularioNotificacao({
                status: ['pendente', 'em_analise'],
                limite: 6,
            })
            setRecentesForm(lista)
        }
    }, [podeNotifForm, aberto])

    const atualizar = useCallback(
        async (opts = {}) => {
            if (!temPermissao) return
            const forcarContratos = Boolean(opts.forcarContratos)
            try {
                if (podeNotifForm) await atualizarFormulario()
                if (podeNotifContratos) {
                    await sincronizarContratosSeDevido(forcarContratos)
                    const n = await contarNotificacoesContratosTotal()
                    setCountContratos(n)
                    if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
                }
            } catch {
                /* silencioso no polling */
            }
        },
        [temPermissao, podeNotifForm, podeNotifContratos, aberto, sincronizarContratosSeDevido, atualizarFormulario],
    )

    useEffect(() => {
        if (!temPermissao) return undefined
        void atualizar({ forcarContratos: true })
        const t = setInterval(() => void atualizar(), INTERVALO_MS)
        return () => clearInterval(t)
    }, [temPermissao, atualizar])

    useEffect(() => {
        if (!temPermissao || !podeNotifForm) return undefined
        const onCustom = () => {
            void atualizarFormulario().catch(() => {})
        }
        window.addEventListener(FORMULARIO_ENTRADAS_CHANGE_EVENT, onCustom)
        const channel = supabase
            .channel('form-inbox-bell-entradas')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'formulario_cred_entradas' },
                onCustom,
            )
            .subscribe()
        return () => {
            window.removeEventListener(FORMULARIO_ENTRADAS_CHANGE_EVENT, onCustom)
            void supabase.removeChannel(channel)
        }
    }, [temPermissao, podeNotifForm, atualizarFormulario])

    useEffect(() => {
        if (!temPermissao) return undefined
        const onVis = () => {
            if (document.visibilityState !== 'visible') return
            ultimoSyncContratosRef.current = 0
            void atualizar({ forcarContratos: true })
        }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [temPermissao, atualizar])

    const refreshContratosUi = useCallback(() => {
        void (async () => {
            const n = await contarNotificacoesContratosTotal()
            setCountContratos(n)
            if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
        })()
    }, [aberto])

    useEffect(() => {
        if (!temPermissao) return undefined
        const onStorage = (e) => {
            if (e.key && e.key !== CLICKSIGN_NOTIF_STORAGE_KEY) return
            refreshContratosUi()
        }
        const onCustom = () => refreshContratosUi()
        window.addEventListener('storage', onStorage)
        window.addEventListener('emerdog-clicksign-notif-change', onCustom)
        return () => {
            window.removeEventListener('storage', onStorage)
            window.removeEventListener('emerdog-clicksign-notif-change', onCustom)
        }
    }, [temPermissao, refreshContratosUi])

    useEffect(() => {
        if (!aberto || !temPermissao) return undefined
        setLoading(true)
        void (async () => {
            try {
                if (podeNotifForm) {
                    const lista = await listarEntradasFormularioNotificacao({
                        status: ['pendente', 'em_analise'],
                        limite: 6,
                    })
                    setRecentesForm(lista)
                    const n = await contarEntradasFormularioPendentesNotificacao()
                    setCountForm(n)
                }
                if (podeNotifContratos) {
                    ultimoSyncContratosRef.current = 0
                    await sincronizarContratosSeDevido(true)
                    setRecentesContratos(await listarNotificacoesContratosRecentes(8))
                    setCountContratos(await contarNotificacoesContratosTotal())
                }
            } finally {
                setLoading(false)
            }
        })()
    }, [aberto, temPermissao, podeNotifForm, podeNotifContratos, sincronizarContratosSeDevido])

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            if (painelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
            setAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [aberto])

    const limparTudo = useCallback(async () => {
        setLimpando(true)
        try {
            if (podeNotifContratos) {
                await limparTodasNotificacoesContratos()
                ultimoSyncContratosRef.current = Date.now()
            }
            setCountContratos(0)
            setRecentesContratos([])
            if (podeNotifForm) {
                limparNotificacoesFormularioBell()
                setCountForm(0)
                setRecentesForm([])
            }
        } finally {
            setLimpando(false)
        }
    }, [podeNotifContratos, podeNotifForm])

    if (!temPermissao) return null
    if (!visivel) return null

    const podeLimpar =
        (podeNotifContratos && countContratos > 0) || (podeNotifForm && countForm > 0)

    const vazio = !loading && !syncContratos && countTotal === 0

    return (
        <div className="form_inbox_bell_wrap" aria-live="polite">
            <button
                ref={btnRef}
                type="button"
                className={`form_inbox_bell_btn ${aberto ? 'is-open' : ''} ${countTotal > 0 ? 'has-alert' : ''}`}
                aria-label={`Notificações${countTotal ? `, ${countTotal} pendente(s)` : ''}`}
                aria-expanded={aberto}
                onClick={() => setAberto((v) => !v)}
            >
                <span className="form_inbox_bell_ico" aria-hidden>
                    🔔
                </span>
                {countTotal > 0 && (
                    <span className="form_inbox_bell_badge">{countTotal > 99 ? '99+' : countTotal}</span>
                )}
            </button>

            {aberto && (
                <div ref={painelRef} className="form_inbox_bell_panel" role="dialog" aria-label="Notificações">
                    <header className="form_inbox_bell_head">
                        <strong>Notificações</strong>
                        <div className="form_inbox_bell_head_actions">
                            {podeLimpar && (
                                <button
                                    type="button"
                                    className="form_inbox_bell_clear"
                                    disabled={limpando || loading}
                                    onClick={() => void limparTudo()}
                                >
                                    {limpando ? 'Limpando…' : 'Limpar'}
                                </button>
                            )}
                            <button type="button" className="form_inbox_bell_close" onClick={() => setAberto(false)}>
                                ×
                            </button>
                        </div>
                    </header>

                    <div className="form_inbox_bell_body">
                        {loading && <p className="form_inbox_bell_muted form_inbox_bell_pad">A carregar…</p>}
                        {syncContratos && !loading && (
                            <p className="form_inbox_bell_muted form_inbox_bell_pad">
                                A verificar contratos (Clicksign)…
                            </p>
                        )}

                        {podeNotifForm && countForm > 0 && (
                        <section className="form_inbox_bell_sec" aria-labelledby="bell-sec-form">
                            <h3 id="bell-sec-form" className="form_inbox_bell_sec_tit">
                                Formulário público
                                <span className="form_inbox_bell_sec_count">{countForm}</span>
                            </h3>
                            <ul className="form_inbox_bell_list">
                                {recentesForm.map((e) => {
                                    const p = e.payload || {}
                                    return (
                                        <li key={e.id}>
                                            <Link
                                                to={`/credenciamento/formulario/entradas?id=${e.id}`}
                                                className="form_inbox_bell_item"
                                                onClick={() => setAberto(false)}
                                            >
                                                <span className="form_inbox_bell_item_nome">
                                                    {p.nome || 'Sem nome'}
                                                </span>
                                                <span className="form_inbox_bell_item_meta">
                                                    {rotuloTipoPerfil(e.tipo_perfil)} ·{' '}
                                                    {formatarCpfCnpjEntrada(e.cpf_cnpj)} ·{' '}
                                                    {formatarDataEntrada(e.criado_em)}
                                                </span>
                                            </Link>
                                        </li>
                                    )
                                })}
                            </ul>
                            <p className="form_inbox_bell_sec_foot">
                                <Link
                                    to="/credenciamento/formulario/entradas"
                                    className="form_inbox_bell_link_all"
                                    onClick={() => setAberto(false)}
                                >
                                    Ver inbox do formulário
                                </Link>
                            </p>
                        </section>
                    )}

                    {podeNotifContratos && countContratos > 0 && (
                        <section className="form_inbox_bell_sec" aria-labelledby="bell-sec-contratos">
                            <h3 id="bell-sec-contratos" className="form_inbox_bell_sec_tit">
                                Contratos (Clicksign)
                                <span className="form_inbox_bell_sec_count">{countContratos}</span>
                            </h3>
                            <ul className="form_inbox_bell_list">
                                {recentesContratos.map((n) => (
                                    <li key={n.id}>
                                        <Link
                                            to="/contratos/clicksign"
                                            className="form_inbox_bell_item"
                                            onClick={() => setAberto(false)}
                                            title={n.envelopeName || ''}
                                        >
                                            <span className="form_inbox_bell_item_nome">{n.texto}</span>
                                            <span className="form_inbox_bell_item_meta">
                                                {formatarDataPtBr(n.at)}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                            <p className="form_inbox_bell_sec_foot">
                                <Link
                                    to="/contratos/clicksign"
                                    className="form_inbox_bell_link_all"
                                    onClick={() => setAberto(false)}
                                >
                                    Abrir painel de contratos
                                </Link>
                            </p>
                        </section>
                    )}

                        {vazio && (
                            <p className="form_inbox_bell_muted form_inbox_bell_pad">Nada novo por aqui.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
