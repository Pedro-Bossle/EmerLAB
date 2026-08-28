import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clicksignRequest } from '../../lib/clicksign/clicksignClient'
import {
    CLICKSIGN_NOTIF_STORAGE_KEY,
    carregarNotificacoes,
    contarNotificacoesContratosTotal,
    listarNotificacoesContratosRecentes,
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

/** Fallback raro se Realtime do Supabase estiver indisponível. */
const INTERVALO_FALLBACK_MS = 120_000
/** Sync Clicksign API — intervalo mínimo alinhado ao throttle global (webhook cobre tempo real). */
const INTERVALO_SYNC_CONTRATOS_MS = 120_000
const TITULO_ABA_BASE = 'EmerLAB'

const POS_STORAGE_KEY = 'sfsc_notif_float_pos_v1'
const MODE_STORAGE_KEY = 'sfsc_notif_float_mode_v1'
const BTN = 52
const BTN_COMPACT_W = 24
const BTN_COMPACT_H = 54
const MARGIN = 8
const EDGE_GUTTER = 14
const DRAWER_GAP = 8
const DRAWER_W = 340
const DRAWER_MAX_H = 480

function viewportUtil() {
    if (typeof window === 'undefined') return { width: 1280, height: 720 }
    const doc = document.documentElement
    return {
        width: doc?.clientWidth || window.innerWidth,
        height: doc?.clientHeight || window.innerHeight,
    }
}

function lerPosicaoSalva() {
    try {
        const raw = localStorage.getItem(POS_STORAGE_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return { x: p.x, y: p.y }
    } catch {
        /* ignore */
    }
    return null
}

function salvarPosicao(pos) {
    try {
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos))
    } catch {
        /* ignore */
    }
}

function lerModoCompacto() {
    try {
        return localStorage.getItem(MODE_STORAGE_KEY) === 'compact'
    } catch {
        return false
    }
}

function salvarModoCompacto(compacto) {
    try {
        localStorage.setItem(MODE_STORAGE_KEY, compacto ? 'compact' : 'normal')
    } catch {
        /* ignore */
    }
}

function tamanhoBotao(compacto = false) {
    return compacto ? { w: BTN_COMPACT_W, h: BTN_COMPACT_H } : { w: BTN, h: BTN }
}

/** Canto superior direito — longe do chat (esq.) e Dev Tool (inf. dir.). */
function posicaoPadrao() {
    if (typeof window === 'undefined') return { x: 18, y: 58 }
    const { width } = viewportUtil()
    return {
        x: Math.max(MARGIN, width - BTN - 18),
        y: 58,
    }
}

function clamparPosicao(x, y, compacto = false) {
    const { w, h } = tamanhoBotao(compacto)
    const { width, height } = viewportUtil()
    const edge = compacto ? EDGE_GUTTER : MARGIN
    const maxX = Math.max(edge, width - w - edge)
    const maxY = Math.max(MARGIN, height - h - MARGIN)
    return {
        x: Math.min(maxX, Math.max(edge, x)),
        y: Math.min(maxY, Math.max(MARGIN, y)),
    }
}

function snapPosicaoCompacta(pos) {
    if (typeof window === 'undefined') return pos
    const { w } = tamanhoBotao(true)
    const { width } = viewportUtil()
    const ladoDireito = pos.x + w / 2 > width / 2
    const y = clamparPosicao(pos.x, pos.y, true).y
    return {
        x: ladoDireito ? Math.max(EDGE_GUTTER, width - w - EDGE_GUTTER) : EDGE_GUTTER,
        y,
    }
}

function detectarAncora(pos, compacto = false) {
    const { w, h } = tamanhoBotao(compacto)
    const { width, height } = viewportUtil()
    const cx = pos.x + w / 2
    const cy = pos.y + h / 2
    const distL = cx
    const distR = width - cx
    const distT = cy
    const distB = height - cy
    const min = Math.min(distL, distR, distT, distB)
    if (min === distR) return 'right'
    if (min === distL) return 'left'
    if (min === distT) return 'top'
    return 'bottom'
}

function calcularDrawerStyle(pos, ancora, compacto = false) {
    if (typeof window === 'undefined') return undefined

    const { w, h } = tamanhoBotao(compacto)
    const { width, height } = viewportUtil()
    const drawerW = Math.min(DRAWER_W, width - MARGIN * 3)
    const drawerH = Math.min(DRAWER_MAX_H, Math.floor(height * 0.68))
    const centroX = pos.x + w / 2
    const centroY = pos.y + h / 2
    const clampX = (value) => Math.min(width - drawerW - MARGIN, Math.max(MARGIN, value))
    const clampY = (value) => Math.min(height - drawerH - MARGIN, Math.max(MARGIN, value))

    let left = clampX(centroX - drawerW / 2)
    let top = clampY(centroY - drawerH / 2)

    if (ancora === 'left') {
        left = clampX(pos.x + w + DRAWER_GAP)
        top = clampY(centroY - drawerH / 2)
    } else if (ancora === 'right') {
        left = clampX(pos.x - DRAWER_GAP - drawerW)
        top = clampY(centroY - drawerH / 2)
    } else if (ancora === 'top') {
        left = clampX(centroX - drawerW / 2)
        top = clampY(pos.y + h + DRAWER_GAP)
    } else if (ancora === 'bottom') {
        left = clampX(centroX - drawerW / 2)
        top = clampY(pos.y - DRAWER_GAP - drawerH)
    }

    return {
        '--notif-drawer-left': `${left}px`,
        '--notif-drawer-top': `${top}px`,
        '--notif-drawer-width': `${drawerW}px`,
        '--notif-drawer-max-height': `${drawerH}px`,
    }
}

export default function FormularioInboxBell({
    mode = 'fab',
    open: openControlled,
    onOpenChange,
    onBadgeChange,
} = {}) {
    const podeNotifForm = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_FORMULARIO)
    const podeNotifContratos = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_CONTRATOS)
    const isDock = mode === 'dock'
    const controlled = typeof openControlled === 'boolean'

    const [countForm, setCountForm] = useState(0)
    const [countContratos, setCountContratos] = useState(0)
    const [recentesForm, setRecentesForm] = useState([])
    const [recentesContratos, setRecentesContratos] = useState([])
    const [abertoInterno, setAbertoInterno] = useState(false)
    const aberto = controlled ? openControlled : abertoInterno
    const setAberto = useCallback(
        (v) => {
            const next = typeof v === 'function' ? v(aberto) : v
            if (!controlled) setAbertoInterno(next)
            onOpenChange?.(next)
        },
        [aberto, controlled, onOpenChange],
    )
    const [loading, setLoading] = useState(false)
    const [syncContratos, setSyncContratos] = useState(false)
    const [limpando, setLimpando] = useState(false)
    const [compacto, setCompacto] = useState(() => lerModoCompacto())
    const [pos, setPos] = useState(() => {
        const compact = lerModoCompacto()
        const saved = lerPosicaoSalva() || posicaoPadrao()
        if (typeof window === 'undefined') return saved
        const next = clamparPosicao(saved.x, saved.y, compact)
        return compact ? snapPosicaoCompacta(next) : next
    })

    const rootRef = useRef(null)
    const dragRef = useRef({ ativo: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 })
    const ultimoSyncContratosRef = useRef(0)

    const countTotal = countForm + countContratos
    const temPermissao = podeNotifForm || podeNotifContratos
    const visivel = temPermissao && (isDock || countTotal > 0)
    const ancora = detectarAncora(pos, compacto)

    useEffect(() => {
        onBadgeChange?.(countTotal)
    }, [countTotal, onBadgeChange])

    useEffect(() => {
        if (!temPermissao) return undefined
        const n = countTotal > 0 ? (countTotal > 99 ? '99+' : String(countTotal)) : ''
        document.title = n ? `(${n}) ${TITULO_ABA_BASE}` : TITULO_ABA_BASE
        return () => {
            document.title = TITULO_ABA_BASE
        }
    }, [temPermissao, countTotal])

    const aplicarClamp = useCallback(() => {
        if (isDock) return
        setPos((p) => {
            const next = clamparPosicao(p.x, p.y, compacto)
            return compacto ? snapPosicaoCompacta(next) : next
        })
    }, [compacto, isDock])

    useEffect(() => {
        if (!visivel || isDock) return undefined
        aplicarClamp()
        const onResize = () => aplicarClamp()
        window.addEventListener('resize', onResize)
        const ro =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => aplicarClamp()) : null
        if (ro && document.documentElement) ro.observe(document.documentElement)
        return () => {
            window.removeEventListener('resize', onResize)
            ro?.disconnect()
        }
    }, [aplicarClamp, visivel, isDock])

    const lerContratosLocal = useCallback(async () => {
        const lista = carregarNotificacoes()
        const total = await contarNotificacoesContratosTotal()
        setCountContratos(total)
        return lista
    }, [])

    const sincronizarContratosSeDevido = useCallback(
        async (forcar = false) => {
            if (!podeNotifContratos) return
            const agora = Date.now()
            if (!forcar && agora - ultimoSyncContratosRef.current < INTERVALO_SYNC_CONTRATOS_MS) {
                await lerContratosLocal()
                return
            }
            ultimoSyncContratosRef.current = agora
            setSyncContratos(true)
            try {
                await sincronizarNotificacoesClicksign(clicksignRequest, { forcar })
                const total = await contarNotificacoesContratosTotal()
                setCountContratos(total)
                if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
            } catch {
                await lerContratosLocal()
            } finally {
                setSyncContratos(false)
            }
        },
        [podeNotifContratos, aberto, lerContratosLocal],
    )

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
        [
            temPermissao,
            podeNotifForm,
            podeNotifContratos,
            aberto,
            sincronizarContratosSeDevido,
            atualizarFormulario,
        ],
    )

    useEffect(() => {
        if (!temPermissao) return undefined
        void atualizar({ forcarContratos: true })
        const t = setInterval(() => void atualizar(), INTERVALO_FALLBACK_MS)
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
        if (!temPermissao || !podeNotifContratos) return undefined
        const onWebhook = () => {
            void (async () => {
                try {
                    const n = await contarNotificacoesContratosTotal()
                    setCountContratos(n)
                    if (aberto) setRecentesContratos(await listarNotificacoesContratosRecentes(8))
                } catch {
                    /* ignore */
                }
            })()
        }
        const channel = supabase
            .channel('form-inbox-bell-clicksign')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'clicksign_notificacoes_webhook' },
                onWebhook,
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [temPermissao, podeNotifContratos, aberto])

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
            const k = String(e.key || '')
            if (
                k &&
                k !== 'emerdog_clicksign_notificacoes_v1' &&
                !k.startsWith(CLICKSIGN_NOTIF_STORAGE_KEY)
            ) {
                return
            }
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
        if (!aberto || isDock) return undefined
        const onDoc = (e) => {
            if (rootRef.current?.contains(e.target)) return
            setAberto(false)
        }
        const onKey = (e) => {
            if (e.key === 'Escape') setAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onKey)
        }
    }, [aberto, isDock, setAberto])

    useEffect(() => {
        if (!isDock && countTotal === 0 && aberto) setAberto(false)
    }, [countTotal, aberto, isDock, setAberto])

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

    const onPointerDown = (e) => {
        if (isDock) return
        if (e.button != null && e.button !== 0) return
        const el = e.currentTarget
        el.setPointerCapture?.(e.pointerId)
        dragRef.current = {
            ativo: true,
            moved: false,
            ox: e.clientX,
            oy: e.clientY,
            sx: pos.x,
            sy: pos.y,
        }
    }

    const onPointerMove = (e) => {
        const d = dragRef.current
        if (!d.ativo) return
        const dx = e.clientX - d.ox
        const dy = e.clientY - d.oy
        if (!d.moved && dx * dx + dy * dy > 16) d.moved = true
        if (!d.moved) return
        e.preventDefault()
        const next = clamparPosicao(d.sx + dx, d.sy + dy, compacto)
        setPos(compacto ? snapPosicaoCompacta(next) : next)
    }

    const onPointerUp = (e) => {
        const d = dragRef.current
        if (!d.ativo) return
        d.ativo = false
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        if (d.moved) {
            setPos((p) => {
                const next = compacto ? snapPosicaoCompacta(p) : clamparPosicao(p.x, p.y, compacto)
                salvarPosicao(next)
                return next
            })
            return
        }
        setAberto((v) => !v)
    }

    const alternarModoCompacto = () => {
        const prox = !compacto
        setCompacto(prox)
        salvarModoCompacto(prox)
        setPos((p) => {
            const next = prox ? snapPosicaoCompacta(p) : clamparPosicao(p.x, p.y, false)
            salvarPosicao(next)
            return next
        })
        if (prox) setAberto(false)
    }

    if (!temPermissao) return null
    if (!visivel) return null

    const podeLimpar =
        (podeNotifContratos && countContratos > 0) || (podeNotifForm && countForm > 0)
    const vazio = !loading && !syncContratos && countTotal === 0
    const badge = countTotal > 99 ? '99+' : String(countTotal)
    const drawerStyle = isDock
        ? {
              '--notif-drawer-left': '0px',
              '--notif-drawer-top': 'auto',
              '--notif-drawer-bottom': 'var(--el-float-above-dock, calc(4.25rem + 2.75rem + env(safe-area-inset-bottom, 0px)))',
              '--notif-drawer-width': '100%',
              '--notif-drawer-max-height': 'min(70dvh, 480px)',
          }
        : calcularDrawerStyle(pos, ancora, compacto)
    const rotuloModo = compacto ? 'Restaurar ícone' : 'Minimizar'

    const drawerInner = (
                <div className="notif_float_drawer_inner">
                    <header className="notif_float_drawer_head">
                        <strong>Notificações</strong>
                        <div className="notif_float_head_acoes">
                            {podeLimpar && (
                                <button
                                    type="button"
                                    className="notif_float_clear"
                                    disabled={limpando || loading}
                                    onClick={() => void limparTudo()}
                                >
                                    {limpando ? 'Limpando…' : 'Limpar'}
                                </button>
                            )}
                            {!isDock ? (
                            <button
                                type="button"
                                className="notif_float_modo"
                                onClick={alternarModoCompacto}
                                title={
                                    compacto
                                        ? 'Voltar para o ícone de sino'
                                        : 'Esconder como aba na borda'
                                }
                            >
                                {rotuloModo}
                            </button>
                            ) : null}
                            <button
                                type="button"
                                className="notif_float_fechar"
                                aria-label="Fechar"
                                onClick={() => setAberto(false)}
                            >
                                ×
                            </button>
                        </div>
                    </header>

                    <div className="notif_float_body">
                        {loading && <p className="notif_float_muted">A carregar…</p>}
                        {syncContratos && !loading && (
                            <p className="notif_float_muted">A verificar contratos (Clicksign)…</p>
                        )}

                        {podeNotifForm && countForm > 0 && (
                            <section className="notif_float_sec" aria-labelledby="notif-sec-form">
                                <h3 id="notif-sec-form" className="notif_float_sec_tit">
                                    Formulário
                                    <span className="notif_float_sec_count">{countForm}</span>
                                </h3>
                                <ul className="notif_float_list">
                                    {recentesForm.map((e) => {
                                        const p = e.payload || {}
                                        return (
                                            <li key={e.id}>
                                                <Link
                                                    to={`/credenciamento/formulario/entradas?id=${e.id}`}
                                                    className="notif_float_item"
                                                    onClick={() => setAberto(false)}
                                                >
                                                    <span className="notif_float_item_nome">
                                                        {p.nome || 'Sem nome'}
                                                    </span>
                                                    <span className="notif_float_item_meta">
                                                        {rotuloTipoPerfil(e.tipo_perfil)} ·{' '}
                                                        {formatarCpfCnpjEntrada(e.cpf_cnpj)} ·{' '}
                                                        {formatarDataEntrada(e.criado_em)}
                                                    </span>
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                                <p className="notif_float_sec_foot">
                                    <Link
                                        to="/credenciamento/formulario/entradas"
                                        className="notif_float_link"
                                        onClick={() => setAberto(false)}
                                    >
                                        Ver inbox
                                    </Link>
                                </p>
                            </section>
                        )}

                        {podeNotifContratos && countContratos > 0 && (
                            <section
                                className="notif_float_sec"
                                aria-labelledby="notif-sec-contratos"
                            >
                                <h3 id="notif-sec-contratos" className="notif_float_sec_tit">
                                    Contratos
                                    <span className="notif_float_sec_count">{countContratos}</span>
                                </h3>
                                <ul className="notif_float_list">
                                    {recentesContratos.map((n) => (
                                        <li key={n.id}>
                                            <Link
                                                to="/contratos/clicksign"
                                                className="notif_float_item"
                                                onClick={() => setAberto(false)}
                                                title={n.envelopeName || ''}
                                            >
                                                <span className="notif_float_item_nome">{n.texto}</span>
                                                <span className="notif_float_item_meta">
                                                    {formatarDataPtBr(n.at)}
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                                <p className="notif_float_sec_foot">
                                    <Link
                                        to="/contratos/clicksign"
                                        className="notif_float_link"
                                        onClick={() => setAberto(false)}
                                    >
                                        Abrir contratos
                                    </Link>
                                </p>
                            </section>
                        )}

                        {vazio && <p className="notif_float_muted">Nada novo por aqui.</p>}
                    </div>
                </div>
    )

    if (isDock) {
        return (
            <div
                ref={rootRef}
                className={`notif_float notif_float--dock${aberto ? ' is-open' : ''}`}
                aria-live="polite"
            >
                <div
                    className={`notif_float_drawer notif_float_drawer--dock${aberto ? ' is-open' : ''}`}
                    style={drawerStyle}
                    role="dialog"
                    aria-label="Notificações"
                    aria-hidden={!aberto}
                >
                    {drawerInner}
                </div>
            </div>
        )
    }

    return (
        <div
            ref={rootRef}
            className={`notif_float is-anchor-${ancora}${aberto ? ' is-open' : ''}${compacto ? ' is-compact' : ''}`}
            style={{ left: pos.x, top: pos.y }}
            aria-live="polite"
        >
            <button
                type="button"
                className="notif_float_btn"
                aria-label={`Notificações, ${countTotal} pendente(s)`}
                aria-expanded={aberto}
                title={
                    compacto
                        ? 'Notificações — clique para abrir, arraste para mover'
                        : 'Notificações — arraste para mover, clique para abrir'
                }
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {compacto ? (
                    <span className="notif_float_btn_tab" aria-hidden="true">
                        {ancora === 'right' ? '‹' : '›'}
                    </span>
                ) : (
                    <>
                        <span className="notif_float_btn_ico" aria-hidden="true">
                            🔔
                        </span>
                        <span className="notif_float_btn_grip" aria-hidden="true" />
                    </>
                )}
                {countTotal > 0 ? (
                <span className="notif_float_badge" aria-hidden="true">
                    {badge}
                </span>
                ) : null}
            </button>

            <div
                className={`notif_float_drawer${aberto ? ' is-open' : ''}`}
                style={drawerStyle}
                role="dialog"
                aria-label="Notificações"
                aria-hidden={!aberto}
            >
                {drawerInner}
            </div>
        </div>
    )
}
