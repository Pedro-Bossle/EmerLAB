import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHref, useLocation } from 'react-router-dom'
import { isBatePapoEnabled, useStoredAccessProfile } from '../../lib/accessControl'
import { supabase } from '../../lib/supabase'
import {
  baixarImagemDescriptografada,
  contarNaoLidasBatePapo,
  criarGrupo,
  enviarImagemConversa,
  enviarMensagemTexto,
  garantirChavesUsuario,
  listarConversasBatePapo,
  listarParticipantesConversa,
  listarUsuariosBatePapo,
  marcarConversaComoLida,
  obterOuCriarDm,
  tentarMigrarDmsLegado,
} from '../../lib/homeBatePapo'
import EmerzapComposer from './EmerzapComposer'
import EmerzapChaveContaModal, { useEmerzapChaveConta } from './EmerzapChaveContaModal'
import { observarThreadEmerzap } from './observarThreadEmerzap'
import './BatePapoFloating.css'

const POS_STORAGE_KEY = 'sfsc_bate_papo_float_pos_v1'
const MODE_STORAGE_KEY = 'sfsc_bate_papo_float_mode_v1'
const SIZE_STORAGE_KEY = 'sfsc_bate_papo_float_size_v1'
const BTN = 52
const BTN_COMPACT_W = 24
const BTN_COMPACT_H = 54
const MARGIN = 8
const EDGE_GUTTER = 14 /* margem vs. scrollbar do ecrã */
const DRAWER_GAP = 8
const DRAWER_W_DEFAULT = 360
const DRAWER_H_DEFAULT = 480
const DRAWER_W_MIN = 280
const DRAWER_H_MIN = 280
const DRAWER_W_MAX = 640
const DRAWER_H_MAX = 720

function viewportUtil() {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  const doc = document.documentElement
  // clientWidth já exclui a scrollbar do documento; margem extra evita clipar FABs/gavetas
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

function lerTamanhoSalvo() {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY)
    if (!raw) return { w: DRAWER_W_DEFAULT, h: DRAWER_H_DEFAULT }
    const p = JSON.parse(raw)
    return {
      w: Math.min(DRAWER_W_MAX, Math.max(DRAWER_W_MIN, Number(p?.w) || DRAWER_W_DEFAULT)),
      h: Math.min(DRAWER_H_MAX, Math.max(DRAWER_H_MIN, Number(p?.h) || DRAWER_H_DEFAULT)),
    }
  } catch {
    return { w: DRAWER_W_DEFAULT, h: DRAWER_H_DEFAULT }
  }
}

function salvarTamanho(size) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size))
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
  const { height } = viewportUtil()
  return { x: MARGIN + 10, y: Math.max(MARGIN, height - BTN - 18) }
}

function clamparPosicao(x, y, compacto = false) {
  const { w, h } = tamanhoBotao(compacto)
  const { width, height } = viewportUtil()
  const edge = compacto ? EDGE_GUTTER : MARGIN
  return {
    x: Math.min(Math.max(edge, width - w - edge), Math.max(edge, x)),
    y: Math.min(Math.max(MARGIN, height - h - MARGIN), Math.max(MARGIN, y)),
  }
}

function snapPosicaoCompacta(pos) {
  if (typeof window === 'undefined') return pos
  const { w } = tamanhoBotao(true)
  const { width } = viewportUtil()
  const ladoDireito = pos.x + w / 2 > width / 2
  return {
    x: ladoDireito ? Math.max(EDGE_GUTTER, width - w - EDGE_GUTTER) : EDGE_GUTTER,
    y: clamparPosicao(pos.x, pos.y, true).y,
  }
}

function detectarAncora(pos, compacto = false) {
  const { w, h } = tamanhoBotao(compacto)
  const { width, height } = viewportUtil()
  const cx = pos.x + w / 2
  const cy = pos.y + h / 2
  const dists = [cx, width - cx, cy, height - cy]
  const min = Math.min(...dists)
  if (min === width - cx) return 'right'
  if (min === cx) return 'left'
  if (min === cy) return 'top'
  return 'bottom'
}

/**
 * Geometria da janela branca (gaveta) no viewport.
 */
function calcularDrawerGeom(pos, ancora, compacto, size) {
  const { w, h } = tamanhoBotao(compacto)
  const { width, height } = viewportUtil()
  const edge = MARGIN + EDGE_GUTTER
  const drawerW = Math.min(size.w, width - edge * 2)
  const drawerH = Math.min(size.h, Math.floor(height * 0.85))
  const centroX = pos.x + w / 2
  const clampX = (value) => Math.min(width - drawerW - edge, Math.max(edge, value))

  let left = clampX(centroX - drawerW / 2)
  let top = MARGIN

  if (ancora === 'left') {
    left = clampX(pos.x + w + DRAWER_GAP)
    top = Math.min(height - drawerH - MARGIN, Math.max(MARGIN, pos.y + h / 2 - drawerH / 2))
  } else if (ancora === 'right') {
    const preferido = pos.x - DRAWER_GAP - drawerW
    left = clampX(Math.min(preferido, width - edge - drawerW - (compacto ? w : 0)))
    top = Math.min(height - drawerH - MARGIN, Math.max(MARGIN, pos.y + h / 2 - drawerH / 2))
  } else if (ancora === 'top') {
    top = Math.min(height - drawerH - MARGIN, Math.max(MARGIN, pos.y + h + DRAWER_GAP))
    left = clampX(centroX - drawerW / 2)
  } else {
    top = Math.max(MARGIN, Math.min(height - drawerH - MARGIN, pos.y - DRAWER_GAP - drawerH))
    left = clampX(centroX - drawerW / 2)
  }

  return { left, top, drawerW, drawerH, width, height, edge }
}

/**
 * Handle no canto livre da janela branca (não do balão / lista):
 * esquerda → BR (em cima) / TR (em baixo)
 * direita  → BL (em cima) / TL (em baixo)
 */
function resizeHandlePorJanela(geom) {
  const cx = geom.left + geom.drawerW / 2
  const cy = geom.top + geom.drawerH / 2
  const naEsquerda = cx <= geom.width / 2
  const emCima = cy <= geom.height / 2

  if (naEsquerda && emCima) {
    return { corner: 'se', sx: 1, sy: 1, cursor: 'nwse-resize' } // BR
  }
  if (naEsquerda && !emCima) {
    return { corner: 'ne', sx: 1, sy: -1, cursor: 'nesw-resize' } // TR
  }
  if (!naEsquerda && emCima) {
    return { corner: 'sw', sx: -1, sy: 1, cursor: 'nesw-resize' } // BL
  }
  return { corner: 'nw', sx: -1, sy: -1, cursor: 'nwse-resize' } // TL
}

function calcularDrawerStyle(pos, ancora, compacto, size) {
  if (typeof window === 'undefined') return undefined
  const { left, top, drawerW, drawerH } = calcularDrawerGeom(pos, ancora, compacto, size)
  return {
    '--bate-papo-drawer-left': `${left}px`,
    '--bate-papo-drawer-top': `${top}px`,
    '--bate-papo-drawer-bottom': 'auto',
    '--bate-papo-drawer-width': `${drawerW}px`,
    '--bate-papo-drawer-max-height': `${drawerH}px`,
    '--bate-papo-drawer-height': `${drawerH}px`,
  }
}

function formatarHoraMensagem(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function chaveDia(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function rotuloDia(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (chaveDia(iso) === chaveDia(hoje.toISOString())) return 'Hoje'
  if (chaveDia(iso) === chaveDia(ontem.toISOString())) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function MensagemImagem({ msg }) {
  const [url, setUrl] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let alive = true
    let objectUrl = null
    void (async () => {
      try {
        objectUrl = await baixarImagemDescriptografada(msg)
        if (alive) setUrl(objectUrl)
      } catch (e) {
        if (alive) setErro(e?.message || 'Falha ao abrir imagem')
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [msg])
  if (erro) return <p className="bate_papo_float_msg_erro">{erro}</p>
  if (!url) return <p className="bate_papo_float_status">A carregar imagem…</p>
  return <img src={url} alt="" className="bate_papo_float_msg_img" />
}

/**
 * @param {{ mode?: 'fab'|'dock', open?: boolean, onOpenChange?: (v:boolean)=>void, onBadgeChange?: (n:number)=>void }} props
 */
export default function BatePapoFloating({
  mode = 'fab',
  open: openControlled,
  onOpenChange,
  onBadgeChange,
} = {}) {
  const profile = useStoredAccessProfile()
  const permitido = isBatePapoEnabled(profile)
  const chaveConta = useEmerzapChaveConta(permitido)
  const { pathname } = useLocation()
  const emerzapHref = useHref('/emerzap')
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
  const [drawerSize, setDrawerSize] = useState(() => lerTamanhoSalvo())

  const [userId, setUserId] = useState(null)
  const [naoLidas, setNaoLidas] = useState(0)
  const [conversas, setConversas] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [busca, setBusca] = useState('')
  const [conversaId, setConversaId] = useState(null)
  const [tituloThread, setTituloThread] = useState('')
  const [tipoThread, setTipoThread] = useState(null)
  const [mostrarInfo, setMostrarInfo] = useState(false)
  const [participantes, setParticipantes] = useState([])
  const [carregandoInfo, setCarregandoInfo] = useState(false)
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [carregandoLista, setCarregandoLista] = useState(false)
  const [carregandoChat, setCarregandoChat] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [modoGrupo, setModoGrupo] = useState(false)
  const [nomeGrupo, setNomeGrupo] = useState('')
  const [membrosGrupo, setMembrosGrupo] = useState(() => new Set())
  const [previewImg, setPreviewImg] = useState(null)

  const rootRef = useRef(null)
  const dragRef = useRef({ ativo: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 })
  const resizeRef = useRef({ ativo: false, ox: 0, oy: 0, sw: 0, sh: 0 })
  const fimRef = useRef(null)
  const fileRef = useRef(null)
  const inputRef = useRef(null)
  const conversaIdRef = useRef(null)
  const userIdRef = useRef(null)
  const abertoRef = useRef(false)

  const ancora = detectarAncora(pos, compacto)
  const drawerGeom =
    typeof window !== 'undefined' ? calcularDrawerGeom(pos, ancora, compacto, drawerSize) : null
  const resizeHandle = drawerGeom
    ? resizeHandlePorJanela(drawerGeom)
    : { corner: 'se', sx: 1, sy: 1, cursor: 'nwse-resize' }

  useEffect(() => {
    conversaIdRef.current = conversaId
  }, [conversaId])
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])
  useEffect(() => {
    abertoRef.current = aberto
  }, [aberto])

  const aplicarClamp = useCallback(() => {
    if (isDock) return
    setPos((p) => {
      let next = clamparPosicao(p.x, p.y, compacto)
      if (compacto) next = snapPosicaoCompacta(next)
      else if (acimaRodapeFormulario && next.y > viewportUtil().height - BTN - 74) {
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
    return () => window.removeEventListener('resize', onResize)
  }, [aplicarClamp, isDock])

  useEffect(() => {
    if (!aberto || isDock) return undefined
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return
      setAberto(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (conversaIdRef.current) {
          setConversaId(null)
          setTituloThread('')
          setTipoThread(null)
          setMostrarInfo(false)
          setParticipantes([])
          setMensagens([])
          setModoGrupo(false)
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
  }, [aberto, isDock, setAberto])

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

  useEffect(() => {
    if (!permitido || !chaveConta.chavePronta) return undefined
    let cancelado = false
    void (async () => {
      try {
        await garantirChavesUsuario()
        if (cancelado) return
        await tentarMigrarDmsLegado()
      } catch {
        /* setup/unlock no modal */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [permitido, chaveConta.chavePronta])

  const atualizarBadge = useCallback(async () => {
    try {
      const n = await contarNaoLidasBatePapo({ userId: userIdRef.current })
      setNaoLidas(n)
      onBadgeChange?.(n)
    } catch {
      /* ignore */
    }
  }, [onBadgeChange])

  const carregarLista = useCallback(async (opts = {}) => {
    const uid = userIdRef.current
    if (!uid) return
    const silencioso = opts.silencioso === true
    if (!silencioso) {
      setCarregandoLista(true)
      setErro('')
    }
    try {
      const [conv, users] = await Promise.all([
        listarConversasBatePapo({ userId: uid }),
        listarUsuariosBatePapo({ excluirUserId: uid }),
      ])
      setConversas(conv)
      setUsuarios(users)
      await atualizarBadge()
    } catch (e) {
      if (!silencioso) setErro(e?.message || String(e))
    } finally {
      if (!silencioso) setCarregandoLista(false)
    }
  }, [atualizarBadge])

  const carregarListaRef = useRef(carregarLista)
  useEffect(() => {
    carregarListaRef.current = carregarLista
  }, [carregarLista])

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
      .channel(`home-bate-papo-v2:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'home_bate_papo_mensagens_v2' },
        () => {
          if (conversaIdRef.current && abertoRef.current) {
            void carregarListaRef.current({ silencioso: true })
            return
          }
          if (abertoRef.current) void carregarListaRef.current({ silencioso: true })
          else void atualizarBadge()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [permitido, userId, atualizarBadge])

  useEffect(() => {
    if (!conversaId || !aberto) {
      setMensagens([])
      setCarregandoChat(false)
      return undefined
    }
    return observarThreadEmerzap({
      conversaId,
      userId,
      ativo: true,
      onMensagens: setMensagens,
      onErro: setErro,
      onCarregando: setCarregandoChat,
      onAposOk: async () => {
        await marcarConversaComoLida(conversaId)
        setConversas((prev) =>
          prev.map((c) => (c.conversaId === conversaId ? { ...c, naoLidas: 0 } : c)),
        )
        await atualizarBadge()
        await carregarListaRef.current({ silencioso: true })
      },
    })
  }, [conversaId, aberto, userId, atualizarBadge])

  useEffect(() => {
    if (!conversaId || !aberto || tipoThread !== 'grupo') return undefined
    let cancelado = false
    void (async () => {
      try {
        const lista = await listarParticipantesConversa(conversaId)
        if (!cancelado) setParticipantes(lista)
      } catch {
        /* info sob demanda */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [conversaId, aberto, tipoThread])

  useEffect(() => {
    if (carregandoChat || !conversaId) return
    const el = fimRef.current
    const scroller = el?.parentElement
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
      return
    }
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [mensagens.length, carregandoChat, conversaId])

  const onPointerDown = (e) => {
    if (isDock) return
    if (e.button != null && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { ativo: true, moved: false, ox: e.clientX, oy: e.clientY, sx: pos.x, sy: pos.y }
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

  const onResizeDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const handle = resizeHandlePorJanela(calcularDrawerGeom(pos, ancora, compacto, drawerSize))
    resizeRef.current = {
      ativo: true,
      ox: e.clientX,
      oy: e.clientY,
      sw: drawerSize.w,
      sh: drawerSize.h,
      sx: handle.sx,
      sy: handle.sy,
    }
  }
  const onResizeMove = (e) => {
    const r = resizeRef.current
    if (!r.ativo) return
    const { width, height } = viewportUtil()
    const dw = (e.clientX - r.ox) * (r.sx || 1)
    const dh = (e.clientY - r.oy) * (r.sy || 1)
    const w = Math.min(DRAWER_W_MAX, Math.max(DRAWER_W_MIN, r.sw + dw))
    const h = Math.min(DRAWER_H_MAX, Math.max(DRAWER_H_MIN, r.sh + dh))
    setDrawerSize({
      w: Math.min(w, width - MARGIN * 2),
      h: Math.min(h, height - MARGIN * 2),
    })
  }
  const onResizeUp = (e) => {
    if (!resizeRef.current.ativo) return
    resizeRef.current.ativo = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDrawerSize((s) => {
      salvarTamanho(s)
      return s
    })
  }

  const abrirConversa = async (c) => {
    setModoGrupo(false)
    setMostrarInfo(false)
    setParticipantes([])
    setErro('')
    setTexto('')
    setPreviewImg(null)
    if (c.conversaId || c.peerId) {
      setConversas((prev) =>
        prev.map((row) => {
          const mesmo =
            (c.conversaId && row.conversaId === c.conversaId) ||
            (c.peerId && row.peerId === c.peerId)
          return mesmo ? { ...row, naoLidas: 0 } : row
        }),
      )
    }
    if (c.conversaId) {
      setConversaId(c.conversaId)
      setTituloThread(c.nome)
      setTipoThread(c.tipo || null)
      return
    }
    if (c.peerId) {
      try {
        const id = await obterOuCriarDm(c.peerId)
        setConversaId(id)
        setTituloThread(c.nome)
        setTipoThread('dm')
        void carregarListaRef.current({ silencioso: true })
      } catch (e) {
        setErro(e?.message || String(e))
      }
    }
  }

  const iniciarDm = async (user) => {
    setErro('')
    try {
      const id = await obterOuCriarDm(user.id)
      setConversaId(id)
      setTituloThread(user.nome)
      setTipoThread('dm')
      setMostrarInfo(false)
      setModoGrupo(false)
      void carregarListaRef.current({ silencioso: true })
    } catch (e) {
      setErro(e?.message || String(e))
    }
  }

  const voltarLista = () => {
    if (mostrarInfo) {
      setMostrarInfo(false)
      return
    }
    setConversaId(null)
    setTituloThread('')
    setTipoThread(null)
    setParticipantes([])
    setMensagens([])
    setTexto('')
    setPreviewImg(null)
    setModoGrupo(false)
    void carregarLista({ silencioso: true })
  }

  const abrirInfoConversa = async () => {
    if (!conversaId) return
    setMostrarInfo(true)
    setCarregandoInfo(true)
    try {
      const lista = await listarParticipantesConversa(conversaId)
      setParticipantes(lista)
    } catch (e) {
      setErro(e?.message || String(e))
      setParticipantes([])
    } finally {
      setCarregandoInfo(false)
    }
  }

  const onEnviar = async (e) => {
    e.preventDefault()
    if (!conversaId || enviando) return
    setEnviando(true)
    setErro('')
    try {
      if (previewImg?.file) {
        const nova = await enviarImagemConversa(conversaId, previewImg.file)
        setPreviewImg(null)
        setMensagens((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]))
      }
      const corpo = texto.trim()
      if (corpo) {
        const nova = await enviarMensagemTexto(conversaId, corpo)
        setTexto('')
        setMensagens((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]))
      }
      void carregarListaRef.current({ silencioso: true })
    } catch (err) {
      setErro(err?.message || String(err))
    } finally {
      setEnviando(false)
      queueMicrotask(() => inputRef.current?.focus())
    }
  }

  const onCriarGrupo = async (e) => {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    try {
      const id = await criarGrupo({ nome: nomeGrupo, memberIds: [...membrosGrupo] })
      setModoGrupo(false)
      setNomeGrupo('')
      setMembrosGrupo(new Set())
      setConversaId(id)
      setTituloThread(nomeGrupo.trim())
      setTipoThread('grupo')
      setMostrarInfo(false)
      void carregarListaRef.current({ silencioso: true })
    } catch (err) {
      setErro(err?.message || String(err))
    } finally {
      setEnviando(false)
    }
  }

  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const conversasFiltradas = conversas.filter((c) => {
      if (!q) return true
      return String(c.nome || '')
        .toLowerCase()
        .includes(q)
    })
    const idsEmConv = new Set(conversas.filter((c) => c.peerId).map((c) => c.peerId))
    const semConversa = usuarios.filter((u) => {
      if (idsEmConv.has(u.id)) return false
      if (!q) return true
      return String(u.nome || '')
        .toLowerCase()
        .includes(q)
    })
    return { conversasFiltradas, semConversa }
  }, [busca, conversas, usuarios])

  const mensagensComDias = useMemo(() => {
    const out = []
    let last = ''
    for (const m of mensagens) {
      const k = chaveDia(m.criadoEm)
      if (k && k !== last) {
        out.push({ kind: 'day', id: `day-${k}`, label: rotuloDia(m.criadoEm) })
        last = k
      }
      out.push({ kind: 'msg', ...m })
    }
    return out
  }, [mensagens])

  if (!permitido) return null

  const drawerStyle = isDock
    ? {
        '--bate-papo-drawer-left': '0px',
        '--bate-papo-drawer-top': 'auto',
        '--bate-papo-drawer-bottom': 'var(--el-float-above-dock, calc(4.25rem + 2.75rem + env(safe-area-inset-bottom, 0px)))',
        '--bate-papo-drawer-width': '100%',
        '--bate-papo-drawer-max-height': 'min(70dvh, 520px)',
        '--bate-papo-drawer-height': 'min(70dvh, 520px)',
      }
    : calcularDrawerStyle(pos, ancora, compacto, drawerSize)

  const badge = naoLidas > 0
  const badgeTexto = naoLidas > 99 ? '99+' : String(naoLidas)

  const drawerInner = (
    <div className="bate_papo_float_drawer_inner">
      <EmerzapChaveContaModal
        open={chaveConta.modalAberto}
        modo={chaveConta.modo}
        mensagem={chaveConta.mensagem}
        onResolvido={chaveConta.onResolvido}
      />
      <header className="bate_papo_float_drawer_head">
        {conversaId || modoGrupo ? (
          <button type="button" className="bate_papo_float_voltar" onClick={voltarLista} aria-label="Voltar">
            ←
          </button>
        ) : null}
        <p className="bate_papo_float_titulo">
          {modoGrupo ? (
            'Novo grupo'
          ) : conversaId ? (
            <button
              type="button"
              className="bate_papo_float_titulo_btn"
              onClick={() => {
                if (mostrarInfo) setMostrarInfo(false)
                else void abrirInfoConversa()
              }}
              title={tipoThread === 'grupo' ? 'Ver participantes' : 'Info da conversa'}
            >
              <span className="bate_papo_float_titulo_main">
                {tipoThread === 'grupo' ? '👥 ' : ''}
                {tituloThread || 'Conversa'}
              </span>
              {tipoThread === 'grupo' ? (
                <small>
                  {mostrarInfo
                    ? 'Dados do grupo'
                    : participantes.length
                      ? `${participantes.length} participantes`
                      : 'Toque para ver participantes'}
                </small>
              ) : (
                <small>{mostrarInfo ? 'Dados da conversa' : 'Toque para info'}</small>
              )}
            </button>
          ) : (
            'Emer-zap'
          )}
        </p>
        <div className="bate_papo_float_head_acoes">
          {!conversaId && !modoGrupo ? (
            <a
              className="bate_papo_float_modo"
              href={emerzapHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir Emerzap em nova aba"
              onClick={() => setAberto(false)}
            >
              Nova aba
            </a>
          ) : null}
          {!isDock && !conversaId && !modoGrupo ? (
            <button
              type="button"
              className="bate_papo_float_modo"
              onClick={() => {
                const prox = !compacto
                setCompacto(prox)
                salvarModoCompacto(prox)
                if (prox) setAberto(false)
              }}
            >
              {compacto ? 'Restaurar' : 'Minimizar'}
            </button>
          ) : null}
          <button type="button" className="bate_papo_float_fechar" aria-label="Fechar" onClick={() => setAberto(false)}>
            ×
          </button>
        </div>
      </header>

      {erro ? <p className="bate_papo_float_erro">{erro}</p> : null}

      {modoGrupo ? (
        <form className="bate_papo_float_grupo" onSubmit={onCriarGrupo}>
          <input
            className="bate_papo_float_busca"
            placeholder="Nome do grupo"
            value={nomeGrupo}
            onChange={(e) => setNomeGrupo(e.target.value)}
            required
          />
          <p className="bate_papo_float_subtitulo">Participantes</p>
          <ul className="bate_papo_float_contatos bate_papo_float_contatos--check">
            {usuarios.map((u) => (
              <li key={u.id}>
                <label className="bate_papo_float_contato">
                  <input
                    type="checkbox"
                    checked={membrosGrupo.has(u.id)}
                    onChange={() => {
                      setMembrosGrupo((prev) => {
                        const next = new Set(prev)
                        if (next.has(u.id)) next.delete(u.id)
                        else next.add(u.id)
                        return next
                      })
                    }}
                  />
                  <span className="bate_papo_float_contato_nome">{u.nome}</span>
                </label>
              </li>
            ))}
          </ul>
          <button type="submit" className="bate_papo_float_enviar" disabled={enviando || !nomeGrupo.trim() || !membrosGrupo.size}>
            Criar grupo
          </button>
        </form>
      ) : !conversaId ? (
        <div className="bate_papo_float_lista_wrap">
          <div className="bate_papo_float_lista_acoes">
            <input
              type="search"
              className="bate_papo_float_busca"
              placeholder="Buscar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <button type="button" className="bate_papo_float_btn_grupo" onClick={() => setModoGrupo(true)}>
              Novo grupo
            </button>
          </div>
          {carregandoLista ? (
            <p className="bate_papo_float_status">Carregando…</p>
          ) : (
            <>
              {listaFiltrada.conversasFiltradas.length > 0 ? (
                <ul className="bate_papo_float_contatos">
                  {listaFiltrada.conversasFiltradas.map((c) => (
                    <li key={c.conversaId || c.peerId}>
                      <button type="button" className="bate_papo_float_contato" onClick={() => void abrirConversa(c)}>
                        <span className="bate_papo_float_contato_nome">
                          {c.tipo === 'grupo' ? '👥 ' : ''}
                          {c.nome}
                          {c.naoLidas > 0 ? (
                            <span className="bate_papo_float_contato_badge">
                              {c.naoLidas > 99 ? '99+' : c.naoLidas}
                            </span>
                          ) : null}
                        </span>
                        <small>
                          {c.tipo === 'grupo' && c.participantesCount
                            ? `${c.participantesCount} participantes · ${c.ultimaMensagem || 'Sem mensagens'}`
                            : c.ultimaMensagem || 'Sem mensagens'}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {listaFiltrada.semConversa.length > 0 ? (
                <>
                  <p className="bate_papo_float_subtitulo">Iniciar conversa</p>
                  <ul className="bate_papo_float_contatos">
                    {listaFiltrada.semConversa.map((u) => (
                      <li key={u.id}>
                        <button type="button" className="bate_papo_float_contato" onClick={() => void iniciarDm(u)}>
                          <span className="bate_papo_float_contato_nome">{u.nome}</span>
                          <small>Nova conversa</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="bate_papo_float_chat">
          {mostrarInfo ? (
            <div className="bate_papo_float_info">
              <p className="bate_papo_float_subtitulo">
                Participantes
                {participantes.length ? ` · ${participantes.length}` : ''}
              </p>
              {carregandoInfo ? (
                <p className="bate_papo_float_status">Carregando…</p>
              ) : participantes.length === 0 ? (
                <p className="bate_papo_float_status">Nenhum participante encontrado.</p>
              ) : (
                <ul className="bate_papo_float_info_list">
                  {participantes.map((p) => (
                    <li key={p.id} className="bate_papo_float_info_item">
                      <span className="bate_papo_float_contato_nome">{p.nome}</span>
                      <small>{p.papel === 'admin' ? 'Admin' : 'Participante'}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="bate_papo_float_chat_lista">
                {carregandoChat ? (
                  <p className="bate_papo_float_status">Carregando…</p>
                ) : mensagensComDias.length === 0 ? (
                  <p className="bate_papo_float_status">Nenhuma mensagem ainda.</p>
                ) : (
                  mensagensComDias.map((item) => {
                    if (item.kind === 'day') {
                      return (
                        <div key={item.id} className="bate_papo_float_day">
                          <span>{item.label}</span>
                        </div>
                      )
                    }
                    const minha = item.remetenteId === userId
                    return (
                      <div key={item.id} className={`bate_papo_float_msg${minha ? ' is-mine' : ''}`}>
                        <div className="bate_papo_float_msg_meta">
                          <span>{minha ? 'Você' : item.remetenteNome}</span>
                          <time dateTime={item.criadoEm || undefined}>{formatarHoraMensagem(item.criadoEm)}</time>
                        </div>
                        {item.tipo === 'imagem' ? <MensagemImagem msg={item} /> : <p>{item.corpo}</p>}
                      </div>
                    )
                  })
                )}
                <div ref={fimRef} />
              </div>
              <EmerzapComposer
                variant="float"
                texto={texto}
                onTextoChange={setTexto}
                previewImg={previewImg}
                onPreviewChange={setPreviewImg}
                enviando={enviando}
                onSubmit={onEnviar}
                fileRef={fileRef}
                inputRef={inputRef}
              />
            </>
          )}
        </div>
      )}
    </div>
  )

  const resizeBtn =
    !isDock ? (
      <button
        type="button"
        className={`bate_papo_float_resize is-corner-${resizeHandle.corner}`}
        style={{ cursor: resizeHandle.cursor }}
        aria-label="Redimensionar janela"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
      />
    ) : null

  if (isDock) {
    return (
      <div
        ref={rootRef}
        className={`bate_papo_float bate_papo_float--dock${aberto ? ' is-open' : ''}`}
        aria-live="polite"
      >
        <div
          className={`bate_papo_float_drawer bate_papo_float_drawer--dock${aberto ? ' is-open' : ''}`}
          style={drawerStyle}
          role="dialog"
          aria-label="Emer-zap"
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
      className={`bate_papo_float is-anchor-${ancora}${aberto ? ' is-open' : ''}${badge ? ' is-active' : ''}${compacto ? ' is-compact' : ''}${acimaRodapeFormulario ? ' bate_papo_float--rodape_formo' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      aria-live="polite"
    >
      <button
        type="button"
        className="bate_papo_float_btn"
        aria-label="Emer-zap"
        aria-expanded={aberto}
        title="Emer-zap"
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
        aria-label="Emer-zap"
        aria-hidden={!aberto}
      >
        {drawerInner}
        {resizeBtn}
      </div>
    </div>
  )
}
