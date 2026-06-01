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
import { PERMISSION_KEYS, hasStoredPermission } from '../../lib/accessControl'
import {
    FORMULARIO_ENTRADAS_CHANGE_EVENT,
    contarEntradasFormularioPendentes,
    formatarDataEntrada,
    listarEntradasFormulario,
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

export default function FormularioInboxBell() {
    const [podeCred] = useState(() => hasStoredPermission(PERMISSION_KEYS.CREDENCIAMENTO_VIEW))
    const [podeContratos] = useState(() => hasStoredPermission(PERMISSION_KEYS.CONTRATOS_VIEW))

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
    const visivel = podeCred || podeContratos

    const lerContratosLocal = useCallback(async () => {
        const lista = carregarNotificacoes()
        const total = await contarNotificacoesContratosTotal()
        setCountContratos(total)
        return lista
    }, [])

    const sincronizarContratosSeDevido = useCallback(async (forcar = false) => {
        if (!podeContratos) return
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
    }, [podeContratos, aberto, lerContratosLocal])

    const atualizarFormulario = useCallback(async () => {
        if (!podeCred) return
        const n = await contarEntradasFormularioPendentes()
        setCountForm(n)
        if (aberto) {
            const lista = await listarEntradasFormulario({
                status: ['pendente', 'em_analise'],
                limite: 6,
            })
            setRecentesForm(lista)
        }
    }, [podeCred, aberto])

    const atualizar = useCallback(
        async (opts = {}) => {
            if (!visivel) return
            const forcarContratos = Boolean(opts.forcarContratos)
            try {
                if (podeCred) await atualizarFormulario()
                if (podeContratos) {
                    await sincronizarContratosSeDevido(forcarContratos)
                    const n = await contarNotificacoesContratosTotal()
                    setCountContratos(n)
                    if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
                }
            } catch {
                /* silencioso no polling */
            }
        },
        [visivel, podeCred, podeContratos, aberto, sincronizarContratosSeDevido, atualizarFormulario],
    )

    useEffect(() => {
        if (!visivel) return undefined
        void atualizar({ forcarContratos: true })
        const t = setInterval(() => void atualizar(), INTERVALO_MS)
        return () => clearInterval(t)
    }, [visivel, atualizar])

    useEffect(() => {
        if (!visivel || !podeCred) return undefined
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
    }, [visivel, podeCred, atualizarFormulario])

    useEffect(() => {
        if (!visivel) return undefined
        const onVis = () => {
            if (document.visibilityState !== 'visible') return
            ultimoSyncContratosRef.current = 0
            void atualizar({ forcarContratos: true })
        }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [visivel, atualizar])

    const refreshContratosUi = useCallback(() => {
        void (async () => {
            const n = await contarNotificacoesContratosTotal()
            setCountContratos(n)
            if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
        })()
    }, [aberto])

    useEffect(() => {
        if (!visivel) return undefined
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
    }, [visivel, refreshContratosUi])

    useEffect(() => {
        if (!aberto || !visivel) return undefined
        setLoading(true)
        void (async () => {
            try {
                if (podeCred) {
                    const lista = await listarEntradasFormulario({
                        status: ['pendente', 'em_analise'],
                        limite: 6,
                    })
                    setRecentesForm(lista)
                    const n = await contarEntradasFormularioPendentes()
                    setCountForm(n)
                }
                if (podeContratos) {
                    ultimoSyncContratosRef.current = 0
                    await sincronizarContratosSeDevido(true)
                    setRecentesContratos(await listarNotificacoesContratosRecentes(8))
                    setCountContratos(await contarNotificacoesContratosTotal())
                }
            } finally {
                setLoading(false)
            }
        })()
    }, [aberto, visivel, podeCred, podeContratos, sincronizarContratosSeDevido])

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
            if (podeContratos) {
                await limparTodasNotificacoesContratos()
                ultimoSyncContratosRef.current = Date.now()
            }
            setCountContratos(0)
            setRecentesContratos([])
            /* entradas do formulário não são “notificações” apagáveis aqui */
        } finally {
            setLimpando(false)
        }
    }, [podeContratos])

    if (!visivel) return null

    const podeLimparContratos = podeContratos && countContratos > 0

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
                            {podeLimparContratos && (
                                <button
                                    type="button"
                                    className="form_inbox_bell_clear"
                                    disabled={limpando || loading}
                                    onClick={() => void limparTudo()}
                                >
                                    {limpando ? 'A limpar…' : 'Limpar'}
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

                        {podeCred && countForm > 0 && (
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

                    {podeContratos && countContratos > 0 && (
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
