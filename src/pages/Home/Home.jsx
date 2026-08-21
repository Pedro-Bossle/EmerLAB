import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from '../../components/Footer/Footer'
import OutlookAgendaCard from '../../components/Outlook/OutlookAgendaCard'
import HomeNotifHelp from './HomeNotifHelp'
import HomeTarefaChat from './HomeTarefaChat'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    podeLerFerramenta,
    useStoredAccessProfile,
} from '../../lib/accessControl'
import { listarEnvelopesComAtualizacoes } from '../../lib/clicksign/clicksignNotificacoes'
import {
    contarEntradasFormularioPendentesNotificacao,
    formatarDataEntrada,
    listarEntradasFormularioNotificacao,
    rotuloTipoPerfil,
} from '../../lib/formularioCredenciamento'
import {
    alternarFavoritoHome,
    favoritosPadraoSugeridos,
    lerFavoritosHome,
    listarPaginasFavoritaveisPorGrupo,
    resolverFavoritosComMeta,
} from '../../lib/homeFavoritos'
import {
    MAX_ANEXOS_TAREFA,
    PRIORIDADES_TAREFA,
    STATUS_TAREFA,
    TAREFAS_POR_PAGINA,
    atualizarTarefaHome,
    anexarArquivosTarefa,
    buscarTarefasTexto,
    contarTarefasPorAba,
    criarTarefaHome,
    excluirTarefaHome,
    filtrarTarefasPorAba,
    formatarPrazoTarefa,
    lerOrdemTarefasHome,
    listarTarefasHome,
    listarUsuariosParaAtribuicao,
    listarNotificacoesMensagensTarefas,
    ordenarTarefasPorPreferencia,
    removerAnexoTarefa,
    reordenarIdsTarefas,
    salvarOrdemTarefasHome,
    tarefaAtrasada,
    urlAssinadaAnexoTarefa,
    validarArquivoAnexoTarefa,
    podeRemoverAnexoTarefa,
} from '../../lib/homeTarefas'
import {
    agruparPendenciasPorPrestador,
    listarPagamentosPendentesNota,
} from '../../lib/pagamentosRegistros'
import { formatarCpfCnpjEntrada } from '../../lib/prestadorCadastroHelpers'
import { exportarTarefasIcs } from '../../lib/calendarExport'
import { supabase } from '../../lib/supabase'
import './Home.css'

function IconCalendarioAdd({ className }) {
    return (
        <svg
            className={className}
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

const FILTRO_TAREFAS = [
    { id: 'abertas', label: 'Abertas', labelCurto: 'Abertas' },
    { id: 'em_andamento', label: 'Em andamento', labelCurto: 'Andamento' },
    { id: 'concluidas', label: 'Concluídas', labelCurto: 'Feitas' },
    { id: 'minhas', label: 'Para mim', labelCurto: 'Para mim' },
    { id: 'criadas', label: 'Que criei', labelCurto: 'Criei' },
    { id: 'todas', label: 'Todas', labelCurto: 'Todas' },
]

const Home = () => {
    const profile = useStoredAccessProfile() || getStoredAccessProfile()
    const userId = profile?.id || ''
    const permissions = profile?.permissions || {}
    const nome = profile?.name || 'Usuário'

    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [avisoTarefas, setAvisoTarefas] = useState('')

    const [favoritosIds, setFavoritosIds] = useState([])
    const [editandoFavoritos, setEditandoFavoritos] = useState(false)

    const [tarefas, setTarefas] = useState([])
    const [ordemTarefas, setOrdemTarefas] = useState([])
    const [usuarios, setUsuarios] = useState([])
    const [filtroTarefas, setFiltroTarefas] = useState('abertas')
    const [buscaTarefa, setBuscaTarefa] = useState('')
    const [paginaTarefas, setPaginaTarefas] = useState(1)
    const [tarefasExpandidas, setTarefasExpandidas] = useState(() => new Set())
    const [dragTarefaId, setDragTarefaId] = useState(null)
    const [dragOverTarefaId, setDragOverTarefaId] = useState(null)
    const dragMovedRef = useRef(false)
    const [modalTarefaAberto, setModalTarefaAberto] = useState(false)
    const [tarefaExcluir, setTarefaExcluir] = useState(null)
    const [excluindoTarefa, setExcluindoTarefa] = useState(false)
    const [formTarefa, setFormTarefa] = useState({
        titulo: '',
        observacoes: '',
        prazo: '',
        prioridade: 'normal',
        atribuidoA: '',
    })
    const [anexosPendentes, setAnexosPendentes] = useState([])
    const [salvandoTarefa, setSalvandoTarefa] = useState(false)
    const [anexoBusyId, setAnexoBusyId] = useState(null)
    const [anexoDragOverModal, setAnexoDragOverModal] = useState(false)
    const [anexoDragOverTarefaId, setAnexoDragOverTarefaId] = useState(null)
    const [exportandoAfazeres, setExportandoAfazeres] = useState(false)
    const inputAnexoTarefaRef = useRef(null)
    const anexoDragDepthModalRef = useRef(0)
    const anexoDragDepthTarefaRef = useRef(0)

    const [notifForm, setNotifForm] = useState(0)
    const [recentesForm, setRecentesForm] = useState([])
    const [envelopesAtualizacoes, setEnvelopesAtualizacoes] = useState([])
    const [notifMensagensTarefas, setNotifMensagensTarefas] = useState([])
    const [pendenciasPag, setPendenciasPag] = useState(0)
    const [pendenciasPagNomes, setPendenciasPagNomes] = useState([])

    const podeForm = podeLerFerramenta(permissions, 'credenciamento.formulario_inbox')
    const podeContratos = podeLerFerramenta(permissions, 'contratos.clicksign')
    const podePagamentos = hasPermission(profile, PERMISSION_KEYS.PAGAMENTOS_VIEW)

    const catalogoFavoritosPorGrupo = useMemo(
        () => listarPaginasFavoritaveisPorGrupo(permissions),
        [permissions],
    )

    const favoritos = useMemo(() => {
        const resolvidos = resolverFavoritosComMeta(userId, permissions)
        if (resolvidos.length) return resolvidos
        return favoritosPadraoSugeridos(permissions)
    }, [userId, permissions, favoritosIds])

    const carregarTudo = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const { data: userData } = await supabase.auth.getUser()
            const uid = userData?.user?.id || userId
            if (uid) setFavoritosIds(lerFavoritosHome(uid))

            const jobs = []

            jobs.push(
                listarTarefasHome({ userId: uid })
                    .then((r) => {
                        const lista = r.tarefas || []
                        const ordem = lerOrdemTarefasHome(uid)
                        setOrdemTarefas(ordem)
                        setTarefas(ordenarTarefasPorPreferencia(lista, ordem))
                        setAvisoTarefas(r.aviso || '')
                    })
                    .catch((e) => {
                        setTarefas([])
                        setAvisoTarefas(e?.message || String(e))
                    }),
            )

            jobs.push(
                listarUsuariosParaAtribuicao()
                    .then((lista) => {
                        setUsuarios(lista)
                        setFormTarefa((f) => ({
                            ...f,
                            atribuidoA: f.atribuidoA || uid || '',
                        }))
                    })
                    .catch(() => setUsuarios([])),
            )

            jobs.push(
                listarNotificacoesMensagensTarefas({ userId: uid })
                    .then((lista) => setNotifMensagensTarefas(lista || []))
                    .catch(() => setNotifMensagensTarefas([])),
            )

            if (podeForm) {
                jobs.push(
                    Promise.all([
                        contarEntradasFormularioPendentesNotificacao(),
                        listarEntradasFormularioNotificacao({
                            status: ['pendente', 'em_analise'],
                            limite: 5,
                        }),
                    ]).then(([n, lista]) => {
                        setNotifForm(n)
                        setRecentesForm(lista || [])
                    }).catch(() => {
                        setNotifForm(0)
                        setRecentesForm([])
                    }),
                )
            }

            if (podeContratos) {
                jobs.push(
                    listarEnvelopesComAtualizacoes(40)
                        .then((grupos) => setEnvelopesAtualizacoes(grupos || []))
                        .catch(() => setEnvelopesAtualizacoes([])),
                )
            }

            if (podePagamentos) {
                jobs.push(
                    listarPagamentosPendentesNota()
                        .then((rows) => {
                            const grupos = agruparPendenciasPorPrestador(rows || [])
                            setPendenciasPag(grupos.length)
                            setPendenciasPagNomes(
                                grupos
                                    .map((g) => String(g.prestadorNome || '').trim())
                                    .filter((n) => n && n !== '—'),
                            )
                        })
                        .catch(() => {
                            setPendenciasPag(0)
                            setPendenciasPagNomes([])
                        }),
                )
            }

            await Promise.all(jobs)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [userId, podeForm, podeContratos, podePagamentos])

    useEffect(() => {
        void carregarTudo()
    }, [carregarTudo])

    useEffect(() => {
        if (!modalTarefaAberto) return undefined
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setModalTarefaAberto(false)
                setAnexosPendentes([])
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [modalTarefaAberto])

    const fecharModalTarefa = () => {
        setModalTarefaAberto(false)
        setAnexosPendentes([])
        setAnexoDragOverModal(false)
        anexoDragDepthModalRef.current = 0
    }

    const adicionarAnexosPendentes = (fileList) => {
        const novos = Array.from(fileList || [])
        if (!novos.length) return
        setErro('')
        setAnexosPendentes((prev) => {
            const next = [...prev]
            for (const file of novos) {
                const check = validarArquivoAnexoTarefa(file)
                if (!check.ok) {
                    setErro(check.erro)
                    continue
                }
                if (next.length >= MAX_ANEXOS_TAREFA) {
                    setErro(`Máximo de ${MAX_ANEXOS_TAREFA} anexos por tarefa.`)
                    break
                }
                next.push(file)
            }
            return next
        })
    }

    const extrairArquivosDoDrop = (event) => {
        const dt = event?.dataTransfer
        if (!dt) return []
        if (dt.files?.length) return Array.from(dt.files)
        const items = Array.from(dt.items || [])
        return items
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter(Boolean)
    }

    const onDragEnterAnexosModal = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (salvandoTarefa || anexosPendentes.length >= MAX_ANEXOS_TAREFA) return
        anexoDragDepthModalRef.current += 1
        setAnexoDragOverModal(true)
    }

    const onDragOverAnexosModal = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeaveAnexosModal = (e) => {
        e.preventDefault()
        e.stopPropagation()
        anexoDragDepthModalRef.current = Math.max(0, anexoDragDepthModalRef.current - 1)
        if (anexoDragDepthModalRef.current === 0) setAnexoDragOverModal(false)
    }

    const onDropAnexosModal = (e) => {
        e.preventDefault()
        e.stopPropagation()
        anexoDragDepthModalRef.current = 0
        setAnexoDragOverModal(false)
        if (salvandoTarefa || anexosPendentes.length >= MAX_ANEXOS_TAREFA) return
        adicionarAnexosPendentes(extrairArquivosDoDrop(e))
    }

    const onDragEnterAnexosTarefa = (e, tarefa) => {
        e.preventDefault()
        e.stopPropagation()
        if (anexoBusyId === tarefa.id) return
        if ((tarefa.anexos || []).length >= MAX_ANEXOS_TAREFA) return
        anexoDragDepthTarefaRef.current += 1
        setAnexoDragOverTarefaId(tarefa.id)
    }

    const onDragOverAnexosTarefa = (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeaveAnexosTarefa = (e) => {
        e.preventDefault()
        e.stopPropagation()
        anexoDragDepthTarefaRef.current = Math.max(0, anexoDragDepthTarefaRef.current - 1)
        if (anexoDragDepthTarefaRef.current === 0) setAnexoDragOverTarefaId(null)
    }

    const onDropAnexosTarefa = (e, tarefa) => {
        e.preventDefault()
        e.stopPropagation()
        anexoDragDepthTarefaRef.current = 0
        setAnexoDragOverTarefaId(null)
        if (anexoBusyId === tarefa.id) return
        if ((tarefa.anexos || []).length >= MAX_ANEXOS_TAREFA) return
        void onAnexarNaTarefaExistente(tarefa, extrairArquivosDoDrop(e))
    }

    const mesclarTarefaNaLista = (atualizada) => {
        if (!atualizada?.id) return
        setTarefas((prev) =>
            (prev || []).map((t) =>
                String(t.id) === String(atualizada.id)
                    ? {
                          ...t,
                          ...atualizada,
                          criadorNome: atualizada.criadorNome || t.criadorNome,
                          atribuidoNome: atualizada.atribuidoNome || t.atribuidoNome,
                      }
                    : t,
            ),
        )
    }

    const onBaixarAnexoTarefa = async (anexo) => {
        try {
            const url = await urlAssinadaAnexoTarefa(anexo.storage_path)
            if (!url) throw new Error('Não foi possível gerar o link do anexo.')
            window.open(url, '_blank', 'noopener,noreferrer')
        } catch (err) {
            setErro(err?.message || String(err))
        }
    }

    const onAnexarNaTarefaExistente = async (tarefa, fileList) => {
        const files = Array.from(fileList || [])
        if (!files.length) return
        setAnexoBusyId(tarefa.id)
        setErro('')
        try {
            for (const file of files) {
                const check = validarArquivoAnexoTarefa(file)
                if (!check.ok) throw new Error(check.erro)
            }
            const atualizada = await anexarArquivosTarefa(tarefa.id, files)
            mesclarTarefaNaLista({
                ...atualizada,
                criadorNome: tarefa.criadorNome,
                atribuidoNome: tarefa.atribuidoNome,
            })
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setAnexoBusyId(null)
        }
    }

    const onRemoverAnexoTarefa = async (tarefa, storagePath) => {
        setAnexoBusyId(tarefa.id)
        setErro('')
        try {
            const atualizada = await removerAnexoTarefa(tarefa.id, storagePath)
            mesclarTarefaNaLista({
                ...atualizada,
                criadorNome: tarefa.criadorNome,
                atribuidoNome: tarefa.atribuidoNome,
            })
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setAnexoBusyId(null)
        }
    }

    const contagensFiltro = useMemo(
        () => contarTarefasPorAba(tarefas, userId),
        [tarefas, userId],
    )

    const tarefasFiltradas = useMemo(() => {
        const porAba = filtrarTarefasPorAba(tarefas, filtroTarefas, userId)
        return buscarTarefasTexto(porAba, buscaTarefa)
    }, [tarefas, filtroTarefas, userId, buscaTarefa])

    const totalPaginasTarefas = Math.max(
        1,
        Math.ceil(tarefasFiltradas.length / TAREFAS_POR_PAGINA),
    )

    const paginaTarefasSafe = Math.min(paginaTarefas, totalPaginasTarefas)

    const tarefasPagina = useMemo(() => {
        const inicio = (paginaTarefasSafe - 1) * TAREFAS_POR_PAGINA
        return tarefasFiltradas.slice(inicio, inicio + TAREFAS_POR_PAGINA)
    }, [tarefasFiltradas, paginaTarefasSafe])

    useEffect(() => {
        setPaginaTarefas(1)
    }, [filtroTarefas, buscaTarefa])

    useEffect(() => {
        if (paginaTarefas > totalPaginasTarefas) {
            setPaginaTarefas(totalPaginasTarefas)
        }
    }, [paginaTarefas, totalPaginasTarefas])

    const onToggleFavorito = (toolId) => {
        if (!userId) return
        const next = alternarFavoritoHome(userId, toolId)
        setFavoritosIds(next)
    }

    const onToggleExpandirTarefa = (id) => {
        setTarefasExpandidas((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const abrirTarefaDaNotificacao = (tarefaId) => {
        const id = String(tarefaId || '')
        if (!id) return
        setFiltroTarefas('todas')
        setBuscaTarefa('')
        setTarefasExpandidas((prev) => {
            const next = new Set(prev)
            next.add(id)
            return next
        })
        window.requestAnimationFrame(() => {
            document
                .getElementById(`home-tarefa-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
    }

    const refreshNotifMensagens = useCallback(async () => {
        try {
            const lista = await listarNotificacoesMensagensTarefas({ userId })
            setNotifMensagensTarefas(lista || [])
        } catch {
            /* ignore */
        }
    }, [userId])

    const refreshNotifForm = useCallback(async () => {
        if (!podeForm) return
        try {
            const [n, lista] = await Promise.all([
                contarEntradasFormularioPendentesNotificacao(),
                listarEntradasFormularioNotificacao({
                    status: ['pendente', 'em_analise'],
                    limite: 5,
                }),
            ])
            setNotifForm(n)
            setRecentesForm(lista || [])
        } catch {
            /* ignore */
        }
    }, [podeForm])

    const refreshNotifContratos = useCallback(async () => {
        if (!podeContratos) return
        try {
            const grupos = await listarEnvelopesComAtualizacoes(40)
            setEnvelopesAtualizacoes(grupos || [])
        } catch {
            /* ignore */
        }
    }, [podeContratos])

    const refreshNotifPagamentos = useCallback(async () => {
        if (!podePagamentos) return
        try {
            const rows = await listarPagamentosPendentesNota()
            const grupos = agruparPendenciasPorPrestador(rows || [])
            setPendenciasPag(grupos.length)
            setPendenciasPagNomes(
                grupos
                    .map((g) => String(g.prestadorNome || '').trim())
                    .filter((n) => n && n !== '—'),
            )
        } catch {
            /* ignore */
        }
    }, [podePagamentos])

    const refreshListaTarefas = useCallback(async () => {
        if (!userId) return
        try {
            const { tarefas: lista, aviso } = await listarTarefasHome({ userId })
            const ordem = lerOrdemTarefasHome(userId)
            setOrdemTarefas(ordem)
            setTarefas(ordenarTarefasPorPreferencia(lista || [], ordem))
            if (aviso) setAvisoTarefas(aviso)
        } catch {
            /* ignore */
        }
    }, [userId])

    /** Notificações e listas da Home via Supabase Realtime (sem polling). */
    useEffect(() => {
        if (!userId) return undefined

        let debounceTarefas = null
        let debouncePag = null
        const agendar = (refKey, fn, ms = 250) => {
            if (refKey === 'tarefas') {
                if (debounceTarefas) clearTimeout(debounceTarefas)
                debounceTarefas = setTimeout(() => {
                    debounceTarefas = null
                    void fn()
                }, ms)
            } else if (refKey === 'pag') {
                if (debouncePag) clearTimeout(debouncePag)
                debouncePag = setTimeout(() => {
                    debouncePag = null
                    void fn()
                }, ms)
            }
        }

        const channel = supabase
            .channel(`home-notifs-realtime:${userId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'home_tarefas_mensagens' },
                (payload) => {
                    if (payload?.new?.autor_id === userId) return
                    void refreshNotifMensagens()
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'home_tarefas_mensagens' },
                () => {
                    void refreshNotifMensagens()
                },
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'home_tarefas' },
                () => {
                    agendar('tarefas', refreshListaTarefas)
                },
            )

        if (podeForm) {
            channel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'formulario_cred_entradas' },
                () => {
                    void refreshNotifForm()
                },
            )
        }

        if (podeContratos) {
            channel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'clicksign_notificacoes_webhook' },
                () => {
                    void refreshNotifContratos()
                },
            )
        }

        if (podePagamentos) {
            channel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pagamentos_registros' },
                () => {
                    agendar('pag', refreshNotifPagamentos)
                },
            )
        }

        channel.subscribe()

        const onClicksignLocal = () => {
            void refreshNotifContratos()
        }
        const onStorage = (e) => {
            if (e.key && e.key !== 'emerdog_clicksign_notificacoes_v1') return
            onClicksignLocal()
        }
        if (podeContratos) {
            window.addEventListener('emerdog-clicksign-notif-change', onClicksignLocal)
            window.addEventListener('storage', onStorage)
        }

        return () => {
            if (debounceTarefas) clearTimeout(debounceTarefas)
            if (debouncePag) clearTimeout(debouncePag)
            void supabase.removeChannel(channel)
            if (podeContratos) {
                window.removeEventListener('emerdog-clicksign-notif-change', onClicksignLocal)
                window.removeEventListener('storage', onStorage)
            }
        }
    }, [
        userId,
        podeForm,
        podeContratos,
        podePagamentos,
        refreshNotifMensagens,
        refreshNotifForm,
        refreshNotifContratos,
        refreshNotifPagamentos,
        refreshListaTarefas,
    ])

    const aplicarListaTarefas = useCallback(
        (lista) => {
            const ordenada = ordenarTarefasPorPreferencia(lista || [], ordemTarefas)
            setTarefas(ordenada)
        },
        [ordemTarefas],
    )

    const onReordenarTarefa = (dragId, dropId) => {
        if (!dragId || !dropId || String(dragId) === String(dropId)) return
        setTarefas((prev) => {
            const baseIds = (prev || []).map((t) => String(t.id))
            const nextIds = reordenarIdsTarefas(baseIds, dragId, dropId)
            setOrdemTarefas(nextIds)
            if (userId) salvarOrdemTarefasHome(userId, nextIds)
            return ordenarTarefasPorPreferencia(prev, nextIds)
        })
    }

    const onCriarTarefa = async (e) => {
        e.preventDefault()
        setSalvandoTarefa(true)
        setErro('')
        try {
            await criarTarefaHome({
                titulo: formTarefa.titulo,
                observacoes: formTarefa.observacoes,
                prazo: formTarefa.prazo || null,
                prioridade: formTarefa.prioridade,
                atribuidoA: formTarefa.atribuidoA || userId,
                anexosFiles: anexosPendentes,
            })
            setFormTarefa((f) => ({
                ...f,
                titulo: '',
                observacoes: '',
                prazo: '',
                prioridade: 'normal',
            }))
            setAnexosPendentes([])
            setModalTarefaAberto(false)
            const { tarefas: lista } = await listarTarefasHome({ userId })
            aplicarListaTarefas(lista)
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setSalvandoTarefa(false)
        }
    }

    const onStatusTarefa = async (tarefa, status) => {
        try {
            await atualizarTarefaHome(tarefa.id, { status })
            const { tarefas: lista } = await listarTarefasHome({ userId })
            aplicarListaTarefas(lista)
        } catch (err) {
            setErro(err?.message || String(err))
        }
    }

    const onExcluirTarefa = (tarefa) => {
        setTarefaExcluir(tarefa)
    }

    const onExportarAfazeres = async () => {
        setExportandoAfazeres(true)
        setErro('')
        try {
            const lista =
                tarefasFiltradas.length > 0
                    ? tarefasFiltradas
                    : (tarefas || []).filter((t) => t.status !== 'cancelada')
            await exportarTarefasIcs(lista)
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setExportandoAfazeres(false)
        }
    }

    const confirmarExcluirTarefa = async () => {
        if (!tarefaExcluir) return
        setExcluindoTarefa(true)
        try {
            await excluirTarefaHome(tarefaExcluir.id)
            setTarefas((prev) => prev.filter((t) => t.id !== tarefaExcluir.id))
            setTarefasExpandidas((prev) => {
                const next = new Set(prev)
                next.delete(tarefaExcluir.id)
                return next
            })
            setTarefaExcluir(null)
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setExcluindoTarefa(false)
        }
    }

    const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || 'usuário'

    // Afazeres criados por outra pessoa para mim e ainda em aberto.
    const tarefasParaMim = useMemo(
        () =>
            (tarefas || []).filter(
                (t) =>
                    t.atribuidoA === userId &&
                    t.criadoPor !== userId &&
                    (t.status === 'pendente' || t.status === 'em_andamento'),
            ),
        [tarefas, userId],
    )

    const notifEnvelopes = envelopesAtualizacoes.length
    const notifTarefasParaMim = tarefasParaMim.length
    const notifMensagensCount = notifMensagensTarefas.reduce(
        (acc, n) => acc + (Number(n.quantidade) || 1),
        0,
    )

    const temNotificacoes =
        (podeForm && notifForm > 0) ||
        (podeContratos && notifEnvelopes > 0) ||
        (podePagamentos && pendenciasPag > 0) ||
        notifTarefasParaMim > 0 ||
        notifMensagensCount > 0

    const totalNotificacoes =
        (podeForm ? notifForm : 0) +
        (podeContratos ? notifEnvelopes : 0) +
        (podePagamentos ? pendenciasPag : 0) +
        notifTarefasParaMim +
        notifMensagensCount

    useEffect(() => {
        const base = 'EmerLAB'
        const n = totalNotificacoes > 0 ? (totalNotificacoes > 99 ? '99+' : totalNotificacoes) : ''
        document.title = n ? `(${n}) ${base}` : base
        return () => {
            document.title = base
        }
    }, [totalNotificacoes])

    return (
        <div className={`el-page home_dash${temNotificacoes ? ' home_dash--tem-notif' : ''}`}>
            <header className="mb-6 border-b border-line/60 pb-5 text-center dark:border-white/10 sm:text-left">
                <p className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-brand">Início</p>
                <h1 className="font-sans text-[1.75rem] font-extrabold leading-tight tracking-tight text-[#123e59] dark:text-[#e8f1f8] md:text-[2.1rem]">
                    Olá, {loading ? '…' : primeiroNome}
                </h1>
                <p className="mt-2 text-[0.98rem] font-medium leading-relaxed text-ink-soft dark:text-[#9eb4c8]">
                    O que faremos hoje?
                </p>
            </header>

            {erro ? <div className="home_dash_alerta is-erro">{erro}</div> : null}
            {avisoTarefas ? <div className="home_dash_alerta is-aviso">{avisoTarefas}</div> : null}

            <section className="home_dash_bookmarks" aria-label="Favoritos">
                <div className="home_dash_bookmarks_bar">
                    <div className="home_dash_bookmarks_top">
                        <span className="home_dash_bookmarks_label" title="Favoritos">
                            <span aria-hidden="true">★</span>
                            <span className="home_dash_bookmarks_label_txt">Favoritos</span>
                        </span>
                        <button
                            type="button"
                            className="home_dash_btn secondary home_dash_bookmarks_edit"
                            onClick={() => setEditandoFavoritos((v) => !v)}
                            aria-label={editandoFavoritos ? 'Concluir edição de favoritos' : 'Editar favoritos'}
                            title={editandoFavoritos ? 'Pronto' : 'Editar'}
                        >
                            {editandoFavoritos ? (
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.25"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <path d="M5 12.5 10 17.5 19 7.5" />
                                </svg>
                            ) : (
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                            )}
                        </button>
                    </div>
                    {!editandoFavoritos ? (
                        <div className="home_dash_bookmarks_track">
                            {favoritos.map((f) => (
                                <Link
                                    key={f.id}
                                    className="home_dash_bookmark"
                                    to={f.href}
                                    title={`${f.label} · ${f.grupo}`}
                                >
                                    <span className="home_dash_bookmark_ico" aria-hidden="true">
                                        {(f.label || '?').trim().charAt(0).toUpperCase()}
                                    </span>
                                    <span className="home_dash_bookmark_txt">{f.label}</span>
                                </Link>
                            ))}
                            {!favoritos.length ? (
                                <span className="home_dash_bookmarks_empty">
                                    Nenhum favorito — toque no ícone de editar
                                </span>
                            ) : null}
                        </div>
                    ) : (
                        <div className="home_dash_bookmarks_edit_hint">
                            Marque as páginas abaixo
                        </div>
                    )}
                </div>
                {editandoFavoritos ? (
                    <div className="home_dash_fav_edit">
                        {catalogoFavoritosPorGrupo.map((grupo) => (
                            <section
                                key={grupo.id}
                                className="home_dash_fav_edit_grupo"
                                aria-label={grupo.label}
                            >
                                <h3 className="home_dash_fav_edit_grupo_tit">{grupo.label}</h3>
                                <ul>
                                    {grupo.itens.map((p) => {
                                        const marcado = favoritosIds.includes(p.id)
                                        return (
                                            <li key={p.id}>
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={marcado}
                                                        onChange={() => onToggleFavorito(p.id)}
                                                    />
                                                    <span>
                                                        <strong>{p.label}</strong>
                                                    </span>
                                                </label>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </section>
                        ))}
                        {!catalogoFavoritosPorGrupo.length ? (
                            <p className="home_dash_muted">
                                Nenhuma página disponível para favoritar.
                            </p>
                        ) : null}
                    </div>
                ) : null}
            </section>

            <section
                className={`home_dash_grid${temNotificacoes ? ' home_dash_grid--com-notif' : ''}`}
            >
                <div className="home_dash_col home_dash_col_main">
                    <section className="home_dash_card home_dash_card--tarefas" aria-label="Afazeres">
                        <div className="home_dash_card_head home_dash_card_head--tarefas">
                            <h2>Afazeres</h2>
                            <div className="home_dash_card_head_actions">
                                <button
                                    type="button"
                                    className="home_dash_btn secondary home_dash_btn--export"
                                    disabled={exportandoAfazeres || !tarefas.length}
                                    onClick={() => void onExportarAfazeres()}
                                    aria-label={
                                        exportandoAfazeres
                                            ? 'A exportar para o calendário'
                                            : 'Adicionar afazeres ao calendário'
                                    }
                                    title="Adicionar ao calendário (.ics — iPhone, Google, Outlook)"
                                >
                                    {exportandoAfazeres ? (
                                        <span className="home_dash_btn_export_busy" aria-hidden="true">
                                            …
                                        </span>
                                    ) : (
                                        <IconCalendarioAdd />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    className="home_dash_btn home_dash_btn--nova_tarefa"
                                    onClick={() => setModalTarefaAberto(true)}
                                >
                                    <span className="home_dash_btn_nova_full">Nova tarefa</span>
                                    <span className="home_dash_btn_nova_short" aria-hidden="true">
                                        + Nova
                                    </span>
                                </button>
                            </div>
                        </div>
                        <div className="home_dash_tabs" role="tablist" aria-label="Filtros de afazeres">
                            {FILTRO_TAREFAS.map((f) => (
                                <button
                                    key={f.id}
                                    type="button"
                                    role="tab"
                                    className={filtroTarefas === f.id ? 'is-active' : ''}
                                    onClick={() => setFiltroTarefas(f.id)}
                                    aria-label={`${f.label}: ${contagensFiltro[f.id] ?? 0}`}
                                >
                                    <span className="home_dash_tab_label_full">{f.label}</span>
                                    <span className="home_dash_tab_label_short" aria-hidden="true">
                                        {f.labelCurto}
                                    </span>
                                    <span className="home_dash_tab_count">
                                        {contagensFiltro[f.id] ?? 0}
                                    </span>
                                </button>
                            ))}
                        </div>

                        <label className="home_dash_tarefa_filtro_wrap">
                            <span className="home_dash_tarefa_filtro_label">Filtrar</span>
                            <select
                                className="home_dash_input home_dash_tarefa_filtro_select"
                                value={filtroTarefas}
                                onChange={(e) => setFiltroTarefas(e.target.value)}
                                aria-label="Filtro de afazeres"
                            >
                                {FILTRO_TAREFAS.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label} ({contagensFiltro[f.id] ?? 0})
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="home_dash_tarefa_toolbar">
                            <input
                                type="search"
                                className="home_dash_input home_dash_tarefa_busca"
                                placeholder="Pesquisar tarefas…"
                                value={buscaTarefa}
                                onChange={(e) => setBuscaTarefa(e.target.value)}
                                aria-label="Pesquisar tarefas"
                            />
                        </div>

                        {loading && !tarefas.length ? (
                            <p className="home_dash_muted">Carregando afazeres…</p>
                        ) : tarefasFiltradas.length === 0 ? (
                            <p className="home_dash_muted">
                                {buscaTarefa.trim()
                                    ? 'Nenhuma tarefa encontrada na pesquisa.'
                                    : 'Nenhuma tarefa neste filtro.'}
                            </p>
                        ) : (
                            <>
                            <ul className="home_dash_tarefa_lista">
                                {tarefasPagina.map((t) => {
                                    const expandida = tarefasExpandidas.has(t.id)
                                    const temObs = Boolean(String(t.observacoes || '').trim())
                                    const isDragging = String(dragTarefaId) === String(t.id)
                                    const isDragOver =
                                        String(dragOverTarefaId) === String(t.id) &&
                                        String(dragTarefaId) !== String(t.id)
                                    return (
                                        <li
                                            key={t.id}
                                            id={`home-tarefa-${t.id}`}
                                            className={`home_dash_tarefa_item pri-${t.prioridade}${tarefaAtrasada(t) ? ' is-atrasada' : ''}${t.status === 'concluida' ? ' is-done' : ''}${expandida ? ' is-open' : ''}${isDragging ? ' is-dragging' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                                            draggable
                                            onDragStart={(e) => {
                                                dragMovedRef.current = false
                                                setDragTarefaId(t.id)
                                                e.dataTransfer.effectAllowed = 'move'
                                                e.dataTransfer.setData('text/plain', String(t.id))
                                            }}
                                            onDragOver={(e) => {
                                                e.preventDefault()
                                                e.dataTransfer.dropEffect = 'move'
                                                if (String(dragTarefaId) && String(dragTarefaId) !== String(t.id)) {
                                                    dragMovedRef.current = true
                                                }
                                                if (String(dragOverTarefaId) !== String(t.id)) {
                                                    setDragOverTarefaId(t.id)
                                                }
                                            }}
                                            onDragLeave={() => {
                                                if (String(dragOverTarefaId) === String(t.id)) {
                                                    setDragOverTarefaId(null)
                                                }
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault()
                                                dragMovedRef.current = true
                                                const dragId =
                                                    e.dataTransfer.getData('text/plain') ||
                                                    dragTarefaId
                                                onReordenarTarefa(dragId, t.id)
                                                setDragTarefaId(null)
                                                setDragOverTarefaId(null)
                                            }}
                                            onDragEnd={() => {
                                                setDragTarefaId(null)
                                                setDragOverTarefaId(null)
                                            }}
                                            onClick={() => {
                                                if (dragMovedRef.current) {
                                                    dragMovedRef.current = false
                                                    return
                                                }
                                                onToggleExpandirTarefa(t.id)
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={expandida}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    onToggleExpandirTarefa(t.id)
                                                }
                                            }}
                                        >
                                            <div className="home_dash_tarefa_row">
                                                <span
                                                    className="home_dash_tarefa_drag"
                                                    title="Arrastar para reordenar"
                                                    aria-hidden="true"
                                                >
                                                    ⋮⋮
                                                </span>
                                                <span
                                                    className="home_dash_tarefa_expand"
                                                    aria-hidden="true"
                                                >
                                                    {expandida ? '▾' : '▸'}
                                                </span>
                                                <div className="home_dash_tarefa_body">
                                                    <div className="home_dash_tarefa_top">
                                                        <strong>{t.titulo}</strong>
                                                        <span
                                                            className={`home_dash_pill status-${t.status}`}
                                                        >
                                                            {STATUS_TAREFA.find(
                                                                (s) => s.value === t.status,
                                                            )?.label || t.status}
                                                        </span>
                                                    </div>
                                                    {expandida ? (
                                                        <>
                                                            <div className="home_dash_tarefa_meta">
                                                                <span>
                                                                    Prazo:{' '}
                                                                    {formatarPrazoTarefa(t.prazo)}
                                                                </span>
                                                                <span>Para: {t.atribuidoNome}</span>
                                                                <span>Por: {t.criadorNome}</span>
                                                            </div>
                                                            {temObs ? (
                                                                <p className="home_dash_tarefa_obs">
                                                                    {t.observacoes}
                                                                </p>
                                                            ) : null}
                                                            <div
                                                                className={`home_dash_tarefa_anexos home_dash_tarefa_anexos--lista${
                                                                    String(anexoDragOverTarefaId) ===
                                                                    String(t.id)
                                                                        ? ' is-dragover'
                                                                        : ''
                                                                }`}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                                onDragEnter={(e) =>
                                                                    onDragEnterAnexosTarefa(e, t)
                                                                }
                                                                onDragOver={onDragOverAnexosTarefa}
                                                                onDragLeave={onDragLeaveAnexosTarefa}
                                                                onDrop={(e) => onDropAnexosTarefa(e, t)}
                                                            >
                                                                {(t.anexos || []).length > 0 ? (
                                                                    <ul className="home_dash_tarefa_anexo_lista">
                                                                        {(t.anexos || []).map((a) => {
                                                                            const podeRemover = podeRemoverAnexoTarefa(
                                                                                a,
                                                                                t,
                                                                                userId,
                                                                            )
                                                                            return (
                                                                            <li key={a.storage_path}>
                                                                                <button
                                                                                    type="button"
                                                                                    className="home_dash_tarefa_anexo_link"
                                                                                    onClick={() =>
                                                                                        void onBaixarAnexoTarefa(a)
                                                                                    }
                                                                                    title="Abrir anexo"
                                                                                >
                                                                                    {a.nome_arquivo}
                                                                                </button>
                                                                                {podeRemover ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="home_dash_btn ghost"
                                                                                    disabled={
                                                                                        anexoBusyId === t.id
                                                                                    }
                                                                                    onClick={() =>
                                                                                        void onRemoverAnexoTarefa(
                                                                                            t,
                                                                                            a.storage_path,
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    Remover
                                                                                </button>
                                                                                ) : null}
                                                                            </li>
                                                                            )
                                                                        })}
                                                                    </ul>
                                                                ) : (
                                                                    <p className="home_dash_tarefa_anexos_vazio">
                                                                        Sem anexos
                                                                    </p>
                                                                )}
                                                                {(t.anexos || []).length <
                                                                MAX_ANEXOS_TAREFA ? (
                                                                    <label className="home_dash_tarefa_anexo_add">
                                                                        <input
                                                                            type="file"
                                                                            multiple
                                                                            disabled={anexoBusyId === t.id}
                                                                            onChange={(e) => {
                                                                                void onAnexarNaTarefaExistente(
                                                                                    t,
                                                                                    e.target.files,
                                                                                )
                                                                                e.target.value = ''
                                                                            }}
                                                                        />
                                                                        <span>
                                                                            {anexoBusyId === t.id
                                                                                ? 'Enviando…'
                                                                                : String(anexoDragOverTarefaId) ===
                                                                                    String(t.id)
                                                                                  ? 'Solte para anexar'
                                                                                  : 'Anexar ou arrastar arquivo'}
                                                                        </span>
                                                                    </label>
                                                                ) : null}
                                                            </div>
                                                            <HomeTarefaChat
                                                                tarefaId={t.id}
                                                                userId={userId}
                                                                ativo={expandida}
                                                                onErro={setErro}
                                                                onMensagensLidas={refreshNotifMensagens}
                                                            />
                                                            <div
                                                                className="home_dash_tarefa_acoes"
                                                                onClick={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                            >
                                                                {t.status !== 'concluida' ? (
                                                                    <button
                                                                        type="button"
                                                                        className="home_dash_btn secondary"
                                                                        onClick={() =>
                                                                            void onStatusTarefa(
                                                                                t,
                                                                                'concluida',
                                                                            )
                                                                        }
                                                                    >
                                                                        Concluir
                                                                    </button>
                                                                ) : null}
                                                                {t.status === 'pendente' ? (
                                                                    <button
                                                                        type="button"
                                                                        className="home_dash_btn secondary"
                                                                        onClick={() =>
                                                                            void onStatusTarefa(
                                                                                t,
                                                                                'em_andamento',
                                                                            )
                                                                        }
                                                                    >
                                                                        Em andamento
                                                                    </button>
                                                                ) : null}
                                                                {t.status === 'concluida' ||
                                                                t.status === 'cancelada' ? (
                                                                    <button
                                                                        type="button"
                                                                        className="home_dash_btn secondary"
                                                                        onClick={() =>
                                                                            void onStatusTarefa(
                                                                                t,
                                                                                'pendente',
                                                                            )
                                                                        }
                                                                    >
                                                                        Reabrir
                                                                    </button>
                                                                ) : null}
                                                                {t.criadoPor === userId ? (
                                                                    <button
                                                                        type="button"
                                                                        className="home_dash_btn ghost"
                                                                        onClick={() => onExcluirTarefa(t)}
                                                                    >
                                                                        Excluir
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="home_dash_tarefa_meta home_dash_tarefa_meta--compact">
                                                            <span>
                                                                Prazo: {formatarPrazoTarefa(t.prazo)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                            {tarefasFiltradas.length > TAREFAS_POR_PAGINA ? (
                                <div className="home_dash_tarefa_paginacao">
                                    <button
                                        type="button"
                                        className="home_dash_btn secondary"
                                        disabled={paginaTarefasSafe <= 1}
                                        onClick={() =>
                                            setPaginaTarefas((p) => Math.max(1, p - 1))
                                        }
                                    >
                                        Anterior
                                    </button>
                                    <span className="home_dash_tarefa_pagina_info">
                                        Página {paginaTarefasSafe} de {totalPaginasTarefas}
                                        <small>
                                            {' '}
                                            ({tarefasFiltradas.length}{' '}
                                            {tarefasFiltradas.length === 1
                                                ? 'tarefa'
                                                : 'tarefas'}
                                            )
                                        </small>
                                    </span>
                                    <button
                                        type="button"
                                        className="home_dash_btn secondary"
                                        disabled={paginaTarefasSafe >= totalPaginasTarefas}
                                        onClick={() =>
                                            setPaginaTarefas((p) =>
                                                Math.min(totalPaginasTarefas, p + 1),
                                            )
                                        }
                                    >
                                        Próxima
                                    </button>
                                </div>
                            ) : null}
                            </>
                        )}
                    </section>
                </div>

                <div className="home_dash_col home_dash_col_side">
                    <section className="home_dash_card home_dash_card--notifs" aria-label="Notificações">
                        <div className="home_dash_card_head">
                            <h2>
                                Notificações
                                {temNotificacoes ? (
                                    <span className="home_dash_notif_badge_total" aria-hidden="true">
                                        {totalNotificacoes > 99 ? '99+' : totalNotificacoes}
                                    </span>
                                ) : null}
                            </h2>
                        </div>
                        {!temNotificacoes ? (
                            <p className="home_dash_empty">Nada por aqui</p>
                        ) : (
                            <div className="home_dash_notif_grid">
                                {podePagamentos && pendenciasPag > 0 ? (
                                    <div className="home_dash_notif home_dash_notif_pag">
                                        <Link
                                            className="home_dash_notif_main"
                                            to="/pagamentos/resumo"
                                        >
                                            <span className="home_dash_notif_n">{pendenciasPag}</span>
                                            <div>
                                                <strong>Pagamentos</strong>
                                                <span>
                                                    {pendenciasPag === 1
                                                        ? '1 prestador a pagar'
                                                        : `${pendenciasPag} prestadores a pagar`}
                                                </span>
                                            </div>
                                        </Link>
                                        <HomeNotifHelp
                                            title="Quem precisa receber"
                                            ariaLabel="Ver quem precisa receber"
                                        >
                                            <p className="home_dash_notif_help_title">
                                                Quem precisa receber
                                            </p>
                                            {pendenciasPagNomes.length ? (
                                                <ul>
                                                    {pendenciasPagNomes.map((nome) => (
                                                        <li key={nome}>{nome}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="home_dash_muted">
                                                    Sem nomes disponíveis.
                                                </p>
                                            )}
                                            <Link
                                                className="home_dash_notif_help_link"
                                                to="/pagamentos/resumo"
                                            >
                                                Abrir resumo
                                            </Link>
                                        </HomeNotifHelp>
                                    </div>
                                ) : null}

                                {podeContratos && notifEnvelopes > 0 ? (
                                    <div className="home_dash_notif home_dash_notif_pag">
                                        <Link
                                            className="home_dash_notif_main"
                                            to="/contratos/clicksign"
                                        >
                                            <span className="home_dash_notif_n">
                                                {notifEnvelopes}
                                            </span>
                                            <div>
                                                <strong>Contratos</strong>
                                                <span>
                                                    {notifEnvelopes === 1
                                                        ? '1 envelope atualizado'
                                                        : `${notifEnvelopes} envelopes atualizados`}
                                                </span>
                                            </div>
                                        </Link>
                                        <HomeNotifHelp
                                            title="Ver o que mudou"
                                            ariaLabel="Ver o que mudou nos envelopes"
                                        >
                                            <p className="home_dash_notif_help_title">
                                                Atualizações de envelopes
                                            </p>
                                            <ul>
                                                {envelopesAtualizacoes.map((env) => (
                                                    <li key={env.envelopeId || env.envelopeName}>
                                                        <strong>{env.envelopeName}</strong>
                                                        <span className="home_dash_notif_help_sub">
                                                            {env.resumo}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            <Link
                                                className="home_dash_notif_help_link"
                                                to="/contratos/clicksign"
                                            >
                                                Abrir contratos
                                            </Link>
                                        </HomeNotifHelp>
                                    </div>
                                ) : null}

                                {podeForm && notifForm > 0 ? (
                                    <div className="home_dash_notif home_dash_notif_pag">
                                        <Link
                                            className="home_dash_notif_main"
                                            to="/credenciamento/formulario/entradas"
                                        >
                                            <span className="home_dash_notif_n">{notifForm}</span>
                                            <div>
                                                <strong>Formulário</strong>
                                                <span>
                                                    {notifForm === 1
                                                        ? '1 formulário preenchido'
                                                        : `${notifForm} formulários preenchidos`}
                                                </span>
                                            </div>
                                        </Link>
                                        <HomeNotifHelp
                                            title="Ver preenchimentos"
                                            ariaLabel="Ver formulários preenchidos"
                                        >
                                            <p className="home_dash_notif_help_title">
                                                Formulários preenchidos
                                            </p>
                                            {recentesForm.length ? (
                                                <ul>
                                                    {recentesForm.map((e) => {
                                                        const pl = e.payload || {}
                                                        return (
                                                            <li key={e.id}>
                                                                <strong>
                                                                    {pl.nome ||
                                                                        formatarCpfCnpjEntrada(
                                                                            e.cpf_cnpj,
                                                                        ) ||
                                                                        'Entrada'}
                                                                </strong>
                                                                <span className="home_dash_notif_help_sub">
                                                                    {rotuloTipoPerfil(e.tipo_perfil)}{' '}
                                                                    ·{' '}
                                                                    {formatarDataEntrada(e.criado_em)}
                                                                </span>
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            ) : (
                                                <p className="home_dash_muted">
                                                    Sem detalhes disponíveis.
                                                </p>
                                            )}
                                            <Link
                                                className="home_dash_notif_help_link"
                                                to="/credenciamento/formulario/entradas"
                                            >
                                                Abrir inbox do formulário
                                            </Link>
                                        </HomeNotifHelp>
                                    </div>
                                ) : null}

                                {notifMensagensTarefas.map((n) => (
                                    <div
                                        key={`${n.tarefaId}-${n.deUserId}`}
                                        className="home_dash_notif home_dash_notif_pag"
                                    >
                                        <button
                                            type="button"
                                            className="home_dash_notif_main"
                                            onClick={() => abrirTarefaDaNotificacao(n.tarefaId)}
                                        >
                                            <span className="home_dash_notif_n">
                                                {n.quantidade || 1}
                                            </span>
                                            <div>
                                                <strong>Mensagem de {n.deNome}</strong>
                                                <span>{n.preview || 'Nova mensagem'}</span>
                                            </div>
                                        </button>
                                        <HomeNotifHelp
                                            title="Ver mensagem"
                                            ariaLabel={`Detalhes da mensagem de ${n.deNome}`}
                                        >
                                            <p className="home_dash_notif_help_title">
                                                Mensagem de {n.deNome}
                                            </p>
                                            <ul>
                                                <li>
                                                    <strong>{n.tarefaTitulo}</strong>
                                                    <span className="home_dash_notif_help_sub">
                                                        {n.preview || 'Sem preview'}
                                                    </span>
                                                </li>
                                            </ul>
                                            <button
                                                type="button"
                                                className="home_dash_notif_help_link"
                                                onClick={() => abrirTarefaDaNotificacao(n.tarefaId)}
                                            >
                                                Abrir tarefa
                                            </button>
                                        </HomeNotifHelp>
                                    </div>
                                ))}

                                {notifTarefasParaMim > 0 ? (
                                    <div className="home_dash_notif home_dash_notif_pag">
                                        <button
                                            type="button"
                                            className="home_dash_notif_main"
                                            onClick={() => setFiltroTarefas('minhas')}
                                        >
                                            <span className="home_dash_notif_n">
                                                {notifTarefasParaMim}
                                            </span>
                                            <div>
                                                <strong>Afazeres</strong>
                                                <span>
                                                    {notifTarefasParaMim === 1
                                                        ? '1 tarefa para você'
                                                        : `${notifTarefasParaMim} tarefas para você`}
                                                </span>
                                            </div>
                                        </button>
                                        <HomeNotifHelp
                                            title="Ver tarefas"
                                            ariaLabel="Ver tarefas atribuídas a você"
                                        >
                                            <p className="home_dash_notif_help_title">
                                                Tarefas atribuídas a você
                                            </p>
                                            <ul>
                                                {tarefasParaMim.map((t) => (
                                                    <li key={t.id}>
                                                        <strong>{t.titulo}</strong>
                                                        <span className="home_dash_notif_help_sub">
                                                            Por: {t.criadorNome} ·{' '}
                                                            {formatarPrazoTarefa(t.prazo)}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </HomeNotifHelp>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </section>

                    <section className="home_dash_card home_dash_card--agenda" aria-label="Agenda Outlook">
                        <div className="home_dash_card_head">
                            <h2>Agenda</h2>
                            <span className="home_dash_pill">Outlook</span>
                        </div>
                        <OutlookAgendaCard />
                    </section>
                </div>
            </section>

            {modalTarefaAberto ? (
                <div
                    className="home_dash_modal_backdrop"
                    role="presentation"
                    onClick={() => fecharModalTarefa()}
                >
                    <div
                        className="home_dash_modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="home-dash-modal-tarefa-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="home_dash_modal_head">
                            <h3 id="home-dash-modal-tarefa-title">Nova tarefa</h3>
                        </div>
                        <form className="home_dash_tarefa_form" onSubmit={onCriarTarefa}>
                            <div className="home_dash_tarefa_form_topo">
                                <label className="home_dash_tarefa_campo home_dash_tarefa_campo--titulo">
                                    <span>Título</span>
                                    <input
                                        className="home_dash_input"
                                        placeholder="Título da tarefa…"
                                        value={formTarefa.titulo}
                                        onChange={(e) =>
                                            setFormTarefa((f) => ({ ...f, titulo: e.target.value }))
                                        }
                                        required
                                        autoFocus
                                    />
                                </label>
                                <div className="home_dash_tarefa_form_meta">
                                    <label className="home_dash_tarefa_campo">
                                        <span>Atribuir</span>
                                        <select
                                            className="home_dash_input"
                                            value={formTarefa.atribuidoA || userId}
                                            onChange={(e) =>
                                                setFormTarefa((f) => ({
                                                    ...f,
                                                    atribuidoA: e.target.value,
                                                }))
                                            }
                                        >
                                            {usuarios.length === 0 ? (
                                                <option value={userId}>Eu</option>
                                            ) : (
                                                usuarios.map((u) => (
                                                    <option key={u.id} value={u.id}>
                                                        {u.nome}
                                                        {u.id === userId ? ' (eu)' : ''}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                    </label>
                                    <label className="home_dash_tarefa_campo">
                                        <span>Prazo</span>
                                        <input
                                            type="date"
                                            className="home_dash_input"
                                            value={formTarefa.prazo}
                                            onChange={(e) =>
                                                setFormTarefa((f) => ({ ...f, prazo: e.target.value }))
                                            }
                                        />
                                    </label>
                                    <label className="home_dash_tarefa_campo">
                                        <span>Prioridade</span>
                                        <select
                                            className="home_dash_input"
                                            value={formTarefa.prioridade}
                                            onChange={(e) =>
                                                setFormTarefa((f) => ({
                                                    ...f,
                                                    prioridade: e.target.value,
                                                }))
                                            }
                                        >
                                            {PRIORIDADES_TAREFA.map((p) => (
                                                <option key={p.value} value={p.value}>
                                                    {p.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            </div>
                            <label className="home_dash_tarefa_campo">
                                <span>Descrição</span>
                                <textarea
                                    className="home_dash_textarea"
                                    placeholder="Descrição (opcional)"
                                    rows={6}
                                    value={formTarefa.observacoes}
                                    onChange={(e) =>
                                        setFormTarefa((f) => ({ ...f, observacoes: e.target.value }))
                                    }
                                />
                            </label>
                            <div
                                className={`home_dash_tarefa_anexos${anexoDragOverModal ? ' is-dragover' : ''}`}
                                onDragEnter={onDragEnterAnexosModal}
                                onDragOver={onDragOverAnexosModal}
                                onDragLeave={onDragLeaveAnexosModal}
                                onDrop={onDropAnexosModal}
                            >
                                <input
                                    ref={inputAnexoTarefaRef}
                                    type="file"
                                    multiple
                                    className="home_dash_tarefa_anexo_input"
                                    onChange={(e) => {
                                        adicionarAnexosPendentes(e.target.files)
                                        e.target.value = ''
                                    }}
                                />
                                <button
                                    type="button"
                                    className="home_dash_tarefa_anexo_zone"
                                    disabled={
                                        salvandoTarefa || anexosPendentes.length >= MAX_ANEXOS_TAREFA
                                    }
                                    onClick={() => inputAnexoTarefaRef.current?.click()}
                                >
                                    <span className="home_dash_tarefa_anexo_ico_wrap" aria-hidden="true">
                                        <svg
                                            className="home_dash_tarefa_anexo_ico"
                                            viewBox="0 0 24 24"
                                            width="26"
                                            height="26"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M8 12.5V8.2a4 4 0 0 1 8 0v8.1a2.7 2.7 0 1 1-5.4 0V9.1a1.3 1.3 0 1 1 2.6 0v6.4" />
                                        </svg>
                                    </span>
                                    <span className="home_dash_tarefa_anexo_zone_txt">
                                        <strong>
                                            {anexoDragOverModal ? 'Solte os arquivos' : 'Arquivos'}
                                        </strong>
                                        <small>
                                            {anexoDragOverModal
                                                ? 'Largue aqui para anexar'
                                                : `Clique ou arraste · até ${MAX_ANEXOS_TAREFA} · máx. 10 MB`}
                                        </small>
                                    </span>
                                </button>
                                {anexosPendentes.length > 0 ? (
                                    <ul className="home_dash_tarefa_anexo_lista">
                                        {anexosPendentes.map((file, idx) => (
                                            <li key={`${file.name}-${file.size}-${idx}`}>
                                                <span title={file.name}>{file.name}</span>
                                                <button
                                                    type="button"
                                                    className="home_dash_btn ghost"
                                                    onClick={() =>
                                                        setAnexosPendentes((prev) =>
                                                            prev.filter((_, i) => i !== idx),
                                                        )
                                                    }
                                                >
                                                    Remover
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                            <div className="home_dash_modal_actions">
                                <button
                                    type="button"
                                    className="home_dash_btn secondary"
                                    onClick={() => fecharModalTarefa()}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="home_dash_btn"
                                    disabled={salvandoTarefa}
                                >
                                    {salvandoTarefa ? 'Salvando…' : 'Adicionar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}

            {tarefaExcluir ? (
                <div
                    className="home_dash_modal_backdrop"
                    role="presentation"
                    onClick={() => !excluindoTarefa && setTarefaExcluir(null)}
                >
                    <div
                        className="home_dash_modal home_dash_modal_confirm"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="home-dash-excluir-tarefa-title"
                        aria-describedby="home-dash-excluir-tarefa-desc"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="home_dash_confirm_icon" aria-hidden="true">
                            !
                        </div>
                        <h3 id="home-dash-excluir-tarefa-title">Excluir tarefa?</h3>
                        <p id="home-dash-excluir-tarefa-desc" className="home_dash_confirm_texto">
                            A tarefa <strong>«{tarefaExcluir.titulo}»</strong> será removida
                            permanentemente. Essa ação não pode ser desfeita.
                        </p>
                        <div className="home_dash_modal_actions">
                            <button
                                type="button"
                                className="home_dash_btn secondary"
                                disabled={excluindoTarefa}
                                onClick={() => setTarefaExcluir(null)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="home_dash_btn danger"
                                disabled={excluindoTarefa}
                                onClick={() => void confirmarExcluirTarefa()}
                            >
                                {excluindoTarefa ? 'Excluindo…' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="home_dash_footer_wrap">
                <Footer />
            </div>
        </div>
    )
}

export default Home
