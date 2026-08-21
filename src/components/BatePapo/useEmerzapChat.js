import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isBatePapoEnabled, useStoredAccessProfile } from '../../lib/accessControl'
import { supabase } from '../../lib/supabase'
import {
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
import { chaveDia, rotuloDia } from './batePapoUi'
import { observarThreadEmerzap } from './observarThreadEmerzap'
import { useEmerzapChaveConta } from './EmerzapChaveContaModal'

/**
 * Estado e ações do Emerzap (gaveta ou página web).
 * @param {{ ativo?: boolean, onBadgeChange?: (n: number) => void }} opts
 *   ativo — carrega lista/thread (na gaveta = aberto; na página = sempre true)
 */
export function useEmerzapChat({ ativo = true, onBadgeChange } = {}) {
  const profile = useStoredAccessProfile()
  const permitido = isBatePapoEnabled(profile)
  const chaveConta = useEmerzapChaveConta(permitido)

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

  const fimRef = useRef(null)
  const fileRef = useRef(null)
  const inputRef = useRef(null)
  const conversaIdRef = useRef(null)
  const userIdRef = useRef(null)
  const ativoRef = useRef(ativo)

  useEffect(() => {
    conversaIdRef.current = conversaId
  }, [conversaId])
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])
  useEffect(() => {
    ativoRef.current = ativo
  }, [ativo])

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
        /* setup/unlock tratado pelo modal */
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
    if (!ativo || !userId || !chaveConta.chavePronta) return
    void carregarLista()
  }, [ativo, userId, carregarLista, chaveConta.chavePronta])

  useEffect(() => {
    if (!permitido || !userId) return undefined
    const channel = supabase
      .channel(`emerzap-web:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'home_bate_papo_mensagens_v2' },
        () => {
          // Thread aberta: observarThreadEmerzap já atualiza mensagens
          if (conversaIdRef.current && ativoRef.current) {
            void carregarListaRef.current({ silencioso: true })
            return
          }
          if (ativoRef.current) void carregarListaRef.current({ silencioso: true })
          else void atualizarBadge()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [permitido, userId, atualizarBadge])

  useEffect(() => {
    if (!conversaId || !ativo) {
      if (!ativo) {
        setMensagens([])
        setCarregandoChat(false)
      }
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
  }, [conversaId, ativo, userId, atualizarBadge])

  useEffect(() => {
    if (!conversaId || !ativo || tipoThread !== 'grupo') return undefined
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
  }, [conversaId, ativo, tipoThread])

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

  const carregarParticipantes = useCallback(async (cid) => {
    if (!cid) {
      setParticipantes([])
      return
    }
    setCarregandoInfo(true)
    try {
      const lista = await listarParticipantesConversa(cid)
      setParticipantes(lista)
    } catch (e) {
      setErro(e?.message || String(e))
      setParticipantes([])
    } finally {
      setCarregandoInfo(false)
    }
  }, [])

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
    setConversaId(null)
    setTituloThread('')
    setTipoThread(null)
    setMostrarInfo(false)
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
    await carregarParticipantes(conversaId)
  }

  const fecharInfoConversa = () => {
    setMostrarInfo(false)
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
      void carregarLista({ silencioso: true })
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
      void carregarLista({ silencioso: true })
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

  return {
    permitido,
    chaveConta,
    userId,
    naoLidas,
    erro,
    setErro,
    conversas,
    usuarios,
    busca,
    setBusca,
    conversaId,
    tituloThread,
    tipoThread,
    mostrarInfo,
    participantes,
    carregandoInfo,
    mensagensComDias,
    texto,
    setTexto,
    previewImg,
    setPreviewImg,
    carregandoLista,
    carregandoChat,
    enviando,
    modoGrupo,
    setModoGrupo,
    nomeGrupo,
    setNomeGrupo,
    membrosGrupo,
    setMembrosGrupo,
    listaFiltrada,
    fimRef,
    fileRef,
    inputRef,
    abrirConversa,
    iniciarDm,
    voltarLista,
    abrirInfoConversa,
    fecharInfoConversa,
    onEnviar,
    onCriarGrupo,
    carregarLista,
  }
}
