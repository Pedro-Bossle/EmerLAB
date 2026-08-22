import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isDevToolsEnabled, useStoredAccessProfile } from '../../lib/accessControl'
import {
    alternarColunaDevTools,
    alternarDevToolsUiFlag,
    useDevToolsUi,
} from '../../lib/devToolsUi'
import './DevToolsFloating.css'

const POS_STORAGE_KEY = 'sfsc_dev_tools_float_pos_v1'
const MODE_STORAGE_KEY = 'sfsc_dev_tools_float_mode_v1'
const BTN = 52
const BTN_COMPACT_W = 24
const BTN_COMPACT_H = 54
const MARGIN = 8
const EDGE_GUTTER = 14
const DRAWER_GAP = 8
const DRAWER_W = 300
const DRAWER_MAX_H = 480

/** Viewport útil (sem a faixa da scrollbar — evita cobrir a gaveta). */
function viewportUtil() {
    if (typeof window === 'undefined') return { width: 1280, height: 720 }
    const doc = document.documentElement
    return {
        width: doc?.clientWidth || window.innerWidth,
        height: doc?.clientHeight || window.innerHeight,
    }
}

const ITENS_GLOBAIS = [
    {
        chave: 'exclusaoMassa',
        rotulo: 'Exclusão por lista',
        descricao: 'Somente Super-Tabela › Planos (modo Ver diferenças).',
    },
]

const ITENS_CADASTRO = [
    { chave: 'perfil', rotulo: 'Coluna Perfil %', descricao: 'Cadastro de prestadores: barra de completude da ficha.' },
    { chave: 'crmv', rotulo: 'Coluna CRMV', descricao: 'Cadastro de prestadores: exibe CRMV na lista.' },
    {
        chave: 'procs',
        rotulo: 'Coluna Procedimentos',
        descricao: 'Cadastro de prestadores: quantidade de procedimentos (vets e clínicas).',
    },
    {
        chave: 'ocultarVetsClinica',
        rotulo: 'Ocultar vets em clínicas',
        descricao: 'Cadastro: esconde veterinários vinculados a estabelecimentos.',
    },
]

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

function posicaoPadrao() {
    if (typeof window === 'undefined') return { x: 18, y: 18 }
    const { width, height } = viewportUtil()
    return {
        x: Math.max(MARGIN, width - BTN - 18),
        y: Math.max(MARGIN, height - BTN - 18),
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

/** Borda dominante para abrir a gaveta para “dentro” da tela. */
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
        '--dev-tools-drawer-left': `${left}px`,
        '--dev-tools-drawer-top': `${top}px`,
        '--dev-tools-drawer-width': `${drawerW}px`,
        '--dev-tools-drawer-max-height': `${drawerH}px`,
    }
}

export default function DevToolsFloating({
    mode = 'fab',
    open: openControlled,
    onOpenChange,
} = {}) {
    const profile = useStoredAccessProfile()
    const permitido = isDevToolsEnabled(profile)
    const { pathname } = useLocation()
    const acimaRodapeFormulario = /\/credenciamento\/cadastro\/[^/]+/.test(pathname)
    const isDock = mode === 'dock'
    const controlled = typeof openControlled === 'boolean'

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
    const [compacto, setCompacto] = useState(() => lerModoCompacto())
    const [pos, setPos] = useState(() => {
        const compact = lerModoCompacto()
        const saved = lerPosicaoSalva() || posicaoPadrao()
        if (typeof window === 'undefined') return saved
        const next = clamparPosicao(saved.x, saved.y, compact)
        return compact ? snapPosicaoCompacta(next) : next
    })
    const { ui } = useDevToolsUi()

    const rootRef = useRef(null)
    const dragRef = useRef({ ativo: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 })

    const ancora = detectarAncora(pos, compacto)

    const aplicarClamp = useCallback(() => {
        if (isDock) return
        setPos((p) => {
            let next = clamparPosicao(p.x, p.y, compacto)
            if (compacto) {
                next = snapPosicaoCompacta(next)
            } else if (acimaRodapeFormulario && next.y > viewportUtil().height - BTN - 74) {
                next = clamparPosicao(next.x, viewportUtil().height - BTN - 74, compacto)
            }
            return next
        })
    }, [acimaRodapeFormulario, compacto, isDock])

    useEffect(() => {
        if (isDock) return undefined
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
    }, [aplicarClamp, isDock])

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

    if (!permitido) return null

    const colCad = ui.colunasCadastro || {}
    const algumAtivo =
        ui.exclusaoMassa ||
        Object.values(ui.colunasProcessos || {}).some(Boolean) ||
        colCad.perfil ||
        colCad.crmv ||
        colCad.procs ||
        colCad.ocultarVetsClinica
    const drawerStyle = isDock
        ? {
              '--dev-tools-drawer-left': '0px',
              '--dev-tools-drawer-top': 'auto',
              '--dev-tools-drawer-bottom': 'var(--el-float-above-dock, calc(4.25rem + 2.75rem + env(safe-area-inset-bottom, 0px)))',
              '--dev-tools-drawer-width': '100%',
              '--dev-tools-drawer-max-height': 'min(70dvh, 480px)',
          }
        : calcularDrawerStyle(pos, ancora, compacto)
    const rotuloModo = compacto ? 'Restaurar ícone' : 'Minimizar'

    const drawerBody = (
                <div className="dev_tools_float_drawer_inner">
                    <header className="dev_tools_float_drawer_head">
                        <p className="dev_tools_float_titulo">Dev Tool</p>
                        <div className="dev_tools_float_head_acoes">
                            {!isDock ? (
                            <button
                                type="button"
                                className="dev_tools_float_modo"
                                onClick={alternarModoCompacto}
                                title={compacto ? 'Voltar para o ícone completo' : 'Esconder como aba na borda'}
                            >
                                {rotuloModo}
                            </button>
                            ) : null}
                            <button
                                type="button"
                                className="dev_tools_float_fechar"
                                aria-label="Fechar"
                                onClick={() => setAberto(false)}
                            >
                                ×
                            </button>
                        </div>
                    </header>

                    <ul className="dev_tools_float_lista">
                        {ITENS_GLOBAIS.map((item) => (
                            <li key={item.chave}>
                                <label className="dev_tools_float_item">
                                    <input
                                        type="checkbox"
                                        className="dev_tools_float_checkbox"
                                        checked={Boolean(ui[item.chave])}
                                        onChange={() => alternarDevToolsUiFlag(item.chave)}
                                    />
                                    <span className="dev_tools_float_item_texto">
                                        <strong>{item.rotulo}</strong>
                                        <small>{item.descricao}</small>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>

                    <p className="dev_tools_float_subtitulo">Cadastro de prestadores</p>
                    <ul className="dev_tools_float_lista">
                        {ITENS_CADASTRO.map((item) => (
                            <li key={item.chave}>
                                <label className="dev_tools_float_item">
                                    <input
                                        type="checkbox"
                                        className="dev_tools_float_checkbox"
                                        checked={Boolean(colCad[item.chave])}
                                        onChange={() => alternarColunaDevTools('cadastro', item.chave)}
                                    />
                                    <span className="dev_tools_float_item_texto">
                                        <strong>{item.rotulo}</strong>
                                        <small>{item.descricao}</small>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </div>
    )

    if (isDock) {
        return (
            <div
                ref={rootRef}
                className={`dev_tools_float dev_tools_float--dock${aberto ? ' is-open' : ''}`}
                aria-live="polite"
            >
                <div
                    className={`dev_tools_float_drawer dev_tools_float_drawer--dock${aberto ? ' is-open' : ''}`}
                    style={drawerStyle}
                    role="dialog"
                    aria-label="Ferramentas de desenvolvimento"
                    aria-hidden={!aberto}
                >
                    {drawerBody}
                </div>
            </div>
        )
    }

    return (
        <div
            ref={rootRef}
            className={`dev_tools_float is-anchor-${ancora}${aberto ? ' is-open' : ''}${algumAtivo ? ' is-active' : ''}${compacto ? ' is-compact' : ''}${acimaRodapeFormulario ? ' dev_tools_float--rodape_formo' : ''}`}
            style={{ left: pos.x, top: pos.y }}
            aria-live="polite"
        >
            <button
                type="button"
                className="dev_tools_float_btn"
                aria-label="Ferramentas Dev Tool"
                aria-expanded={aberto}
                title={compacto ? 'Dev Tool — clique para abrir, arraste para mover' : 'Dev Tool — arraste para mover, clique para abrir'}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {compacto ? (
                    <span className="dev_tools_float_btn_tab" aria-hidden="true">
                        {ancora === 'right' ? '<' : '>'}
                    </span>
                ) : (
                    <>
                        <span className="dev_tools_float_btn_ico" aria-hidden="true">
                            🔧
                        </span>
                        <span className="dev_tools_float_btn_grip" aria-hidden="true" />
                    </>
                )}
            </button>

            <div
                className={`dev_tools_float_drawer${aberto ? ' is-open' : ''}`}
                style={drawerStyle}
                role="dialog"
                aria-label="Ferramentas de desenvolvimento"
                aria-hidden={!aberto}
            >
                {drawerBody}
            </div>
        </div>
    )
}
