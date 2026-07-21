import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isBatePapoEnabled, useStoredAccessProfile } from '../../lib/accessControl'
import { supabase } from '../../lib/supabase'
import {
    contarNaoLidasBatePapo,
    enviarMensagemBatePapo,
    listarConversasBatePapo,
    listarMensagensBatePapoCom,
    listarUsuariosBatePapo,
    marcarMensagensBatePapoComoLidas,
} from '../../lib/homeBatePapo'
import './BatePapoFloating.css'

const POS_STORAGE_KEY = 'sfsc_bate_papo_float_pos_v1'
const MODE_STORAGE_KEY = 'sfsc_bate_papo_float_mode_v1'
const BTN = 52
const BTN_COMPACT_W = 24
const BTN_COMPACT_H = 54
const MARGIN = 8
const DRAWER_GAP = 8
const DRAWER_W = 340
const DRAWER_MAX_H = 520

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

/** Canto inferior esquerdo — evita colidir com Dev Tool (direita). */
function posicaoPadrao() {
    if (typeof window === 'undefined') return { x: 18, y: 18 }
    const { height } = viewportUtil()
    return {
        x: MARGIN + 10,
        y: Math.max(MARGIN, height - BTN - 18),
    }
}

function clamparPosicao(x, y, compacto = false) {
    const { w, h } = tamanhoBotao(compacto)
    const { width, height } = viewportUtil()
    const maxX = Math.max(MARGIN, width - w - MARGIN)
    const maxY = Math.max(MARGIN, height - h - MARGIN)
    return {
        x: Math.min(maxX, Math.max(MARGIN, x)),
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
        x: ladoDireito ? Math.max(0, width - w) : 0,
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
    const centroX = pos.x + w / 2
    const centroY = pos.y + h / 2
    const clampX = (value) => Math.min(width - drawerW - MARGIN, Math.max(MARGIN, value))

    let left = clampX(centroX - drawerW / 2)
    let top = null
    let bottom = null
    let maxH = Math.min(DRAWER_MAX_H, Math.floor(height * 0.72))

    if (ancora === 'left') {
        left = clampX(pos.x + w + DRAWER_GAP)
        // Cresce a partir do centro do botão, limitada ao viewport.
        const acima = Math.max(80, centroY - MARGIN)
        const abaixo = Math.max(80, height - centroY - MARGIN)
        maxH = Math.min(DRAWER_MAX_H, acima + abaixo)
        top = Math.min(height - MARGIN - 120, Math.max(MARGIN, centroY - maxH / 2))
        maxH = Math.min(maxH, height - top - MARGIN)
    } else if (ancora === 'right') {
        left = clampX(pos.x - DRAWER_GAP - drawerW)
        const acima = Math.max(80, centroY - MARGIN)
        const abaixo = Math.max(80, height - centroY - MARGIN)
        maxH = Math.min(DRAWER_MAX_H, acima + abaixo)
        top = Math.min(height - MARGIN - 120, Math.max(MARGIN, centroY - maxH / 2))
        maxH = Math.min(maxH, height - top - MARGIN)
    } else if (ancora === 'top') {
        // Ancora no topo do botão: gaveta cresce para baixo, colada no botão.
        left = clampX(centroX - drawerW / 2)
        top = pos.y + h + DRAWER_GAP
        maxH = Math.min(DRAWER_MAX_H, Math.max(160, height - top - MARGIN))
    } else {
        // ancora === 'bottom' (caso comum): colada acima do botão, cresce para cima.
        left = clampX(centroX - drawerW / 2)
        bottom = Math.max(MARGIN, height - pos.y + DRAWER_GAP)
        maxH = Math.min(DRAWER_MAX_H, Math.max(160, pos.y - DRAWER_GAP - MARGIN))
    }

    const style = {
        '--bate-papo-drawer-left': `${left}px`,
        '--bate-papo-drawer-width': `${drawerW}px`,
        '--bate-papo-drawer-max-height': `${maxH}px`,
    }
    if (bottom != null) {
        style['--bate-papo-drawer-top'] = 'auto'
        style['--bate-papo-drawer-bottom'] = `${bottom}px`
    } else {
        style['--bate-papo-drawer-top'] = `${top}px`
        style['--bate-papo-drawer-bottom'] = 'auto'
    }
    return style
}

function formatarHoraMensagem(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function mapRowRealtime(row, remetenteNome) {
    if (!row?.id) return null
    return {
        id: row.id,
        remetenteId: row.remetente_id,
        destinatarioId: row.destinatario_id,
        corpo: String(row.corpo || '').trim(),
        criadoEm: row.criado_em,
        lidaEm: row.lida_em || null,
        remetenteNome: remetenteNome || 'Usuário',
    }
}

export default function BatePapoFloating() {
    const profile = useStoredAccessProfile()
    const permitido = isBatePapoEnabled(profile)
    const { pathname } = useLocation()
    const acimaRodapeFormulario = /\/credenciamento\/cadastro\/[^/]+/.test(pathname)

    const [aberto, setAberto] = useState(false)
    const [compacto, setCompacto] = useState(() => lerModoCompacto())
    const [pos, setPos] = useState(() => {
        const compact = lerModoCompacto()
        const saved = lerPosicaoSalva() || posicaoPadrao()
        if (typeof window === 'undefined') return saved
        const next = clamparPosicao(saved.x, saved.y, compact)
        return compact ? snapPosicaoCompacta(next) : next
    })

    const [userId, setUserId] = useState(null)
    const [naoLidas, setNaoLidas] = useState(0)
    const [conversas, setConversas] = useState([])
    const [usuarios, setUsuarios] = useState([])
    const [busca, setBusca] = useState('')
    const [contatoId, setContatoId] = useState(null)
    const [contatoNome, setContatoNome] = useState('')
    const [mensagens, setMensagens] = useState([])
    const [texto, setTexto] = useState('')
    const [carregandoLista, setCarregandoLista] = useState(false)
    const [carregandoChat, setCarregandoChat] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState('')

    const rootRef = useRef(null)
    const dragRef = useRef({ ativo: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 })
    const fimRef = useRef(null)
    const nomesCacheRef = useRef(new Map())
    const contatoIdRef = useRef(null)
    const userIdRef = useRef(null)
    const abertoRef = useRef(false)

    const ancora = detectarAncora(pos, compacto)

    useEffect(() => {
        contatoIdRef.current = contatoId
    }, [contatoId])

    useEffect(() => {
        userIdRef.current = userId
    }, [userId])

    useEffect(() => {
        abertoRef.current = aberto
    }, [aberto])

    const aplicarClamp = useCallback(() => {
        setPos((p) => {
            let next = clamparPosicao(p.x, p.y, compacto)
            if (compacto) {
                next = snapPosicaoCompacta(next)
            } else if (acimaRodapeFormulario && next.y > viewportUtil().height - BTN - 74) {
                next = clamparPosicao(next.x, viewportUtil().height - BTN - 74, compacto)
            }
            return next
        })
    }, [acimaRodapeFormulario, compacto])

    useEffect(() => {
        aplicarClamp()
        const onResize = () => aplicarClamp()
        window.addEventListener('resize', onResize)
        const ro =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => aplicarClamp())
                : null
        if (ro && document.documentElement) {
            ro.observe(document.documentElement)
        }
        return () => {
            window.removeEventListener('resize', onResize)
            ro?.disconnect()
        }
    }, [aplicarClamp])

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            if (rootRef.current?.contains(e.target)) return
            setAberto(false)
        }
        const onKey = (e) => {
            if (e.key === 'Escape') {
                if (contatoIdRef.current) {
                    setContatoId(null)
                    setContatoNome('')
                    setMensagens([])
                    return
                }
                setAberto(false)
            }
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onKey)
        }
    }, [aberto])

    useEffect(() => {
        if (!permitido) return undefined
        let cancelado = false
        void (async () => {
            const { data } = await supabase.auth.getUser()
            if (cancelado) return
            setUserId(data?.user?.id || null)
        })()
        return () => {
            cancelado = true
        }
    }, [permitido])

    const atualizarBadge = useCallback(async () => {
        try {
            const n = await contarNaoLidasBatePapo({ userId: userIdRef.current })
            setNaoLidas(n)
        } catch {
            /* ignore */
        }
    }, [])

    const carregarLista = useCallback(async () => {
        const uid = userIdRef.current
        if (!uid) return
        setCarregandoLista(true)
        setErro('')
        try {
            const [conv, users] = await Promise.all([
                listarConversasBatePapo({ userId: uid }),
                listarUsuariosBatePapo({ excluirUserId: uid }),
            ])
            setConversas(conv)
            setUsuarios(users)
            for (const u of users) nomesCacheRef.current.set(u.id, u.nome)
            for (const c of conv) nomesCacheRef.current.set(c.userId, c.nome)
            await atualizarBadge()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setCarregandoLista(false)
        }
    }, [atualizarBadge])

    useEffect(() => {
        if (!permitido || !userId) return undefined
        void atualizarBadge()
        const onVis = () => {
            if (document.visibilityState === 'visible') void atualizarBadge()
        }
        document.addEventListener('visibilitychange', onVis)
        const t = setInterval(() => void atualizarBadge(), 120_000)
        return () => {
            document.removeEventListener('visibilitychange', onVis)
            clearInterval(t)
        }
    }, [permitido, userId, atualizarBadge])

    useEffect(() => {
        if (!aberto || !userId) return
        void carregarLista()
    }, [aberto, userId, carregarLista])

    useEffect(() => {
        if (!permitido || !userId) return undefined

        const channel = supabase
            .channel(`home-bate-papo:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'home_bate_papo_mensagens',
                },
                (payload) => {
                    void (async () => {
                        const row = payload?.new
                        if (!row?.id) return
                        const uid = userIdRef.current
                        if (!uid) return
                        if (row.remetente_id !== uid && row.destinatario_id !== uid) return

                        const outro =
                            row.remetente_id === uid ? row.destinatario_id : row.remetente_id
                        let nome = nomesCacheRef.current.get(outro)
                        if (!nome) {
                            const { data } = await supabase
                                .from('profiles')
                                .select('name')
                                .eq('id', outro)
                                .maybeSingle()
                            nome = data?.name || 'Usuário'
                            nomesCacheRef.current.set(outro, nome)
                        }

                        if (contatoIdRef.current === outro) {
                            const mapped = mapRowRealtime(
                                row,
                                row.remetente_id === uid ? 'Você' : nome,
                            )
                            if (mapped) {
                                setMensagens((prev) => {
                                    if (prev.some((m) => String(m.id) === String(mapped.id))) {
                                        return prev
                                    }
                                    return [...prev, mapped]
                                })
                            }
                            if (row.destinatario_id === uid) {
                                try {
                                    await marcarMensagensBatePapoComoLidas(outro)
                                } catch {
                                    /* ignore */
                                }
                            }
                        }

                        if (abertoRef.current) {
                            void carregarLista()
                        } else {
                            void atualizarBadge()
                        }
                    })()
                },
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'home_bate_papo_mensagens',
                },
                () => {
                    void atualizarBadge()
                    if (abertoRef.current) void carregarLista()
                },
            )
            .subscribe()

        return () => {
            void supabase.removeChannel(channel)
        }
    }, [permitido, userId, carregarLista, atualizarBadge])

    useEffect(() => {
        if (!contatoId || !aberto) {
            setMensagens([])
            setCarregandoChat(false)
            return undefined
        }

        let cancelado = false
        setCarregandoChat(true)
        setErro('')

        const carregar = async () => {
            try {
                const lista = await listarMensagensBatePapoCom(contatoId)
                if (cancelado) return
                setMensagens(lista)
                await marcarMensagensBatePapoComoLidas(contatoId)
                if (!cancelado) {
                    void atualizarBadge()
                    void carregarLista()
                }
            } catch (e) {
                if (!cancelado) setErro(e?.message || String(e))
            } finally {
                if (!cancelado) setCarregandoChat(false)
            }
        }

        void carregar()
        return () => {
            cancelado = true
        }
    }, [contatoId, aberto, atualizarBadge, carregarLista])

    useEffect(() => {
        if (carregandoChat || !contatoId) return
        fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [mensagens.length, carregandoChat, contatoId])

    const onPointerDown = (e) => {
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

    const abrirContato = (id, nome) => {
        setContatoId(id)
        setContatoNome(nome || nomesCacheRef.current.get(id) || 'Usuário')
        setTexto('')
        setErro('')
    }

    const voltarLista = () => {
        setContatoId(null)
        setContatoNome('')
        setMensagens([])
        setTexto('')
        void carregarLista()
    }

    const onEnviar = async (e) => {
        e.preventDefault()
        const corpo = texto.trim()
        if (!corpo || !contatoId || enviando) return
        setEnviando(true)
        setErro('')
        try {
            const nova = await enviarMensagemBatePapo(contatoId, corpo)
            setTexto('')
            setMensagens((prev) => {
                if (prev.some((m) => String(m.id) === String(nova.id))) return prev
                return [...prev, nova]
            })
            void carregarLista()
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setEnviando(false)
        }
    }

    const listaFiltrada = useMemo(() => {
        const q = busca.trim().toLowerCase()
        const idsComConversa = new Set(conversas.map((c) => c.userId))
        const base = usuarios.filter((u) => {
            if (!q) return true
            return String(u.nome || '')
                .toLowerCase()
                .includes(q)
        })
        const conversasFiltradas = conversas.filter((c) => {
            if (!q) return true
            return String(c.nome || '')
                .toLowerCase()
                .includes(q)
        })
        const semConversa = base.filter((u) => !idsComConversa.has(u.id))
        return { conversasFiltradas, semConversa }
    }, [busca, conversas, usuarios])

    if (!permitido) return null

    const drawerStyle = calcularDrawerStyle(pos, ancora, compacto)
    const rotuloModo = compacto ? 'Restaurar ícone' : 'Minimizar'
    const badge = naoLidas > 0
    const badgeTexto = naoLidas > 99 ? '99+' : String(naoLidas)

    return (
        <div
            ref={rootRef}
            className={`bate_papo_float is-anchor-${ancora}${aberto ? ' is-open' : ''}${badge ? ' is-active' : ''}${compacto ? ' is-compact' : ''}${acimaRodapeFormulario ? ' bate_papo_float--rodape_formo' : ''}`}
            style={{ left: pos.x, top: pos.y }}
            aria-live="polite"
        >
            <button
                type="button"
                className="bate_papo_float_btn"
                aria-label="Bate-papo"
                aria-expanded={aberto}
                title={
                    compacto
                        ? 'Emer-zap — clique para abrir, arraste para mover'
                        : 'Emer-zap — arraste para mover, clique para abrir'
                }
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {compacto ? (
                    <span className="bate_papo_float_btn_tab" aria-hidden="true">
                        {ancora === 'right' ? '<' : '>'}
                    </span>
                ) : (
                    <>
                        <span className="bate_papo_float_btn_ico" aria-hidden="true">
                            💬
                        </span>
                        <span className="bate_papo_float_btn_grip" aria-hidden="true" />
                    </>
                )}
                {badge ? (
                    <span className="bate_papo_float_badge" aria-label={`${naoLidas} não lidas`}>
                        {badgeTexto}
                    </span>
                ) : null}
            </button>

            <div
                className={`bate_papo_float_drawer${aberto ? ' is-open' : ''}`}
                style={drawerStyle}
                role="dialog"
                aria-label="Bate-papo entre usuários"
                aria-hidden={!aberto}
            >
                <div className="bate_papo_float_drawer_inner">
                    <header className="bate_papo_float_drawer_head">
                        {contatoId ? (
                            <button
                                type="button"
                                className="bate_papo_float_voltar"
                                onClick={voltarLista}
                                aria-label="Voltar à lista"
                            >
                                ←
                            </button>
                        ) : null}
                        <p className="bate_papo_float_titulo">
                            {contatoId ? contatoNome || 'Conversa' : 'Bate-papo'}
                        </p>
                        <div className="bate_papo_float_head_acoes">
                            <button
                                type="button"
                                className="bate_papo_float_modo"
                                onClick={alternarModoCompacto}
                                title={
                                    compacto
                                        ? 'Voltar para o ícone completo'
                                        : 'Esconder como aba na borda'
                                }
                            >
                                {rotuloModo}
                            </button>
                            <button
                                type="button"
                                className="bate_papo_float_fechar"
                                aria-label="Fechar"
                                onClick={() => setAberto(false)}
                            >
                                ×
                            </button>
                        </div>
                    </header>

                    {erro ? <p className="bate_papo_float_erro">{erro}</p> : null}

                    {!contatoId ? (
                        <div className="bate_papo_float_lista_wrap">
                            <input
                                type="search"
                                className="bate_papo_float_busca"
                                placeholder="Buscar usuário…"
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                aria-label="Buscar usuário"
                            />
                            {carregandoLista ? (
                                <p className="bate_papo_float_status">Carregando…</p>
                            ) : (
                                <>
                                    {listaFiltrada.conversasFiltradas.length > 0 ? (
                                        <ul className="bate_papo_float_contatos">
                                            {listaFiltrada.conversasFiltradas.map((c) => (
                                                <li key={c.userId}>
                                                    <button
                                                        type="button"
                                                        className="bate_papo_float_contato"
                                                        onClick={() => abrirContato(c.userId, c.nome)}
                                                    >
                                                        <span className="bate_papo_float_contato_nome">
                                                            {c.nome}
                                                            {c.naoLidas > 0 ? (
                                                                <span className="bate_papo_float_contato_badge">
                                                                    {c.naoLidas > 99
                                                                        ? '99+'
                                                                        : c.naoLidas}
                                                                </span>
                                                            ) : null}
                                                        </span>
                                                        <small>
                                                            {c.ultimaMensagem || 'Sem mensagens'}
                                                        </small>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                    {listaFiltrada.semConversa.length > 0 ? (
                                        <>
                                            <p className="bate_papo_float_subtitulo">
                                                Iniciar conversa
                                            </p>
                                            <ul className="bate_papo_float_contatos">
                                                {listaFiltrada.semConversa.map((u) => (
                                                    <li key={u.id}>
                                                        <button
                                                            type="button"
                                                            className="bate_papo_float_contato"
                                                            onClick={() => abrirContato(u.id, u.nome)}
                                                        >
                                                            <span className="bate_papo_float_contato_nome">
                                                                {u.nome}
                                                            </span>
                                                            <small>Nova conversa</small>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    ) : null}
                                    {!listaFiltrada.conversasFiltradas.length &&
                                    !listaFiltrada.semConversa.length ? (
                                        <p className="bate_papo_float_status">
                                            Nenhum usuário encontrado.
                                        </p>
                                    ) : null}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="bate_papo_float_chat">
                            <div className="bate_papo_float_chat_lista">
                                {carregandoChat ? (
                                    <p className="bate_papo_float_status">Carregando…</p>
                                ) : mensagens.length === 0 ? (
                                    <p className="bate_papo_float_status">
                                        Nenhuma mensagem ainda. Escreva abaixo.
                                    </p>
                                ) : (
                                    mensagens.map((m) => {
                                        const minha = m.remetenteId === userId
                                        return (
                                            <div
                                                key={m.id}
                                                className={`bate_papo_float_msg${minha ? ' is-mine' : ''}`}
                                            >
                                                <div className="bate_papo_float_msg_meta">
                                                    <span>
                                                        {minha ? 'Você' : m.remetenteNome}
                                                    </span>
                                                    <time dateTime={m.criadoEm || undefined}>
                                                        {formatarHoraMensagem(m.criadoEm)}
                                                    </time>
                                                </div>
                                                <p>{m.corpo}</p>
                                            </div>
                                        )
                                    })
                                )}
                                <div ref={fimRef} />
                            </div>
                            <form className="bate_papo_float_form" onSubmit={onEnviar}>
                                <input
                                    type="text"
                                    className="bate_papo_float_input"
                                    placeholder="Escreva uma mensagem…"
                                    value={texto}
                                    onChange={(e) => setTexto(e.target.value)}
                                    disabled={enviando}
                                    maxLength={2000}
                                    aria-label="Mensagem"
                                />
                                <button
                                    type="submit"
                                    className="bate_papo_float_enviar"
                                    disabled={enviando || !texto.trim()}
                                >
                                    Enviar
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
