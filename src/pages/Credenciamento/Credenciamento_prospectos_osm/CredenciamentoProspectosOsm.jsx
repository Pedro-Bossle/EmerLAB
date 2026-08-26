import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import {
    PERMISSION_KEYS,
    hasPermission,
    podeLerFerramenta,
    usuarioPodeEditarFerramenta,
    useStoredAccessProfile,
} from '../../../lib/accessControl'
import {
    PROSPECTOS_OSM_CATEGORIAS,
    labelProspectoOsmCategoria,
} from '../../../lib/credenciamento/prospectosOsmCategorias.js'
import {
    STATUS_PROSPECCAO_OPCOES,
    listarProspectosOsm,
    atualizarStatusProspectoOsm,
    atualizarProspectoOsm,
    listarCidadesUfProspectosOsm,
} from '../../../lib/credenciamento/prospectosOsmRepo.js'
import {
    colunaKanbanParaStatusProspecto,
    enviarProspectoOsmParaKanban,
} from '../../../lib/credKanban.js'
import { exportarProspectosOsmParaExcel } from '../../../lib/credenciamento/exportProspectosOsmExcel.js'
import { postServerApiJson } from '../../../lib/api/serverBackend.js'
import { prospectoIndicaAtendimento24h } from '../../../lib/credenciamento/prospectosOsmHorario.js'
import { formatarEnderecoLinhaTabela } from '../../../lib/credenciamento/prospectosOsmQualidade.js'
import { filtrarPrestadoresParaImportCoordenadas } from '../../../lib/credenciamento/prestadorEnderecoGeocode.js'
import {
    lerAlertasCredenciadoDismissed,
    mapearAlertasCredenciadoProspectos,
    salvarAlertasCredenciadoDismissed,
} from '../../../lib/credenciamento/prospectosOsmSimilaridadeCredenciados.js'
import { formatarLinhaTelefonesContato } from '../../../lib/telefoneBrasil.js'
import {
    preencherPinsProspectosOsm,
    prospectoSemPin,
} from '../../../lib/credenciamento/prospectosOsmGeocode.js'
import { supabase } from '../../../lib/supabase'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import { PageHeader } from '../../../components/ui'
import { useGeminiRate } from '../../../hooks/useGemini.js'
import '../Credenciamento_main/Credenciamento_main.css'
import '../Credenciamento_cadastro/CredenciamentoCadastro.css'
import '../Credenciamento_mapa/CredenciamentoMapa.css'
import './CredenciamentoProspectosOsm.css'
import 'leaflet/dist/leaflet.css'

const TODAS_CATEGORIAS_IDS = PROSPECTOS_OSM_CATEGORIAS.map((c) => c.id)
const SPLIT_STORAGE_KEY = 'emerlab-prospectos-osm-split-pct'
const SPLIT_MIN = 28
const SPLIT_MAX = 72

function normalizarNomeCidadeChave(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

/** IBGE da UF + cidades já presentes no catálogo (fallback se IBGE falhar). */
async function carregarOpcoesMunicipioProspectos(ufSigla) {
    const uf = String(ufSigla || '').trim().toUpperCase()
    if (!uf) return []

    let ibge = []
    try {
        ibge = await buscarMunicipiosPorUf(uf)
    } catch {
        ibge = []
    }

    let doCatalogo = []
    try {
        const r = await listarCidadesUfProspectosOsm()
        if (r.ok) {
            doCatalogo = (r.pares || [])
                .filter((p) => String(p.uf || '').trim().toUpperCase() === uf)
                .map((p) => String(p.cidade || '').trim())
                .filter(Boolean)
        }
    } catch {
        doCatalogo = []
    }

    const porChave = new Map()
    for (const m of ibge || []) {
        const nome = String(m?.nome || '').trim()
        const chave = normalizarNomeCidadeChave(nome)
        if (!chave) continue
        porChave.set(chave, { id: m.id ?? nome, nome })
    }
    for (const nomeRaw of doCatalogo) {
        const nome = String(nomeRaw || '').trim()
        const chave = normalizarNomeCidadeChave(nome)
        if (!chave || porChave.has(chave)) continue
        porChave.set(chave, { id: nome, nome })
    }

    return [...porChave.values()].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    )
}

function lerSplitInicial() {
    if (typeof window === 'undefined') return 50
    const v = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY))
    return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : 50
}

function MapaRedimensionar({ dep }) {
    const map = useMap()
    useEffect(() => {
        const t = window.setTimeout(() => map.invalidateSize(), 0)
        return () => window.clearTimeout(t)
    }, [dep, map])
    return null
}

const pinProspecto = new L.DivIcon({
    className: 'cred_prospectos_osm_pin_leaflet',
    html: '<div class="cred_prospectos_osm_pin" aria-hidden="true"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
})

function indicadorOrdenacao(ordenarColuna, ordenarDir, coluna) {
    if (ordenarColuna !== coluna) return ''
    return ordenarDir === 'asc' ? ' ▲' : ' ▼'
}

const CredenciamentoProspectosOsm = () => {
    const profile = useStoredAccessProfile()
    const podeLer =
        podeLerFerramenta(profile?.permissions, 'credenciamento.prospectos_osm') ||
        hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_VIEW)
    const podeEditar =
        (profile && usuarioPodeEditarFerramenta(profile.permissions, 'credenciamento.prospectos_osm')) ||
        (profile ? hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false)

    const [uf, setUf] = useState('RS')
    const [cidade, setCidade] = useState('')
    const [municipios, setMunicipios] = useState([])
    const [municipiosEdit, setMunicipiosEdit] = useState([])
    const [loadingMunEdit, setLoadingMunEdit] = useState(false)
    /** true no arranque: UF default RS — evita abrir o select com lista vazia antes do fetch */
    const [loadingMun, setLoadingMun] = useState(true)
    const [catsAtivas, setCatsAtivas] = useState(() => new Set(TODAS_CATEGORIAS_IDS))
    const [catPainelAberto, setCatPainelAberto] = useState(false)
    const catPainelRef = useRef(null)
    const [status, setStatus] = useState('')
    const [busca, setBusca] = useState('')
    const [itens, setItens] = useState([])
    const [loading, setLoading] = useState(false)
    const [coletando, setColetando] = useState(false)
    const [coletaPasso, setColetaPasso] = useState(0)
    const [coletaPassosTotais, setColetaPassosTotais] = useState(1)
    const [preenchendoPins, setPreenchendoPins] = useState(false)
    const abortPinsRef = useRef(null)
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [destaqueId, setDestaqueId] = useState(null)
    const [mostrarMapa, setMostrarMapa] = useState(true)
    const [painelMobile, setPainelMobile] = useState('lista')
    const [splitListaPct, setSplitListaPct] = useState(lerSplitInicial)
    const layoutRef = useRef(null)
    const arrastandoSplitRef = useRef(false)
    const splitPctRef = useRef(splitListaPct)
    const [ordenarColuna, setOrdenarColuna] = useState('nome')
    const [ordenarDir, setOrdenarDir] = useState('asc')
    const [credenciadosBase, setCredenciadosBase] = useState([])
    const [alertaDismissed, setAlertaDismissed] = useState(() => lerAlertasCredenciadoDismissed())
    const [enviandoKanbanId, setEnviandoKanbanId] = useState(null)
    const [editando, setEditando] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [salvandoEdit, setSalvandoEdit] = useState(false)
    const { rate: geminiRate, erro: erroGeminiRate, loading: loadingGeminiRate, recarregar: recarregarGeminiRate } =
        useGeminiRate()

    useEffect(() => {
        splitPctRef.current = splitListaPct
    }, [splitListaPct])

    const coletaProgressoPct = useMemo(() => {
        if (!coletando) return 0
        const total = Math.max(1, coletaPassosTotais)
        const passo = Math.max(0, coletaPasso)
        if (passo >= total) return 100
        return Math.min(100, Math.round((passo / total) * 100))
    }, [coletando, coletaPasso, coletaPassosTotais])

    const coletaProgressoPassoLabel = useMemo(() => {
        if (!coletando) return ''
        const total = Math.max(1, coletaPassosTotais)
        const passo = Math.min(Math.max(0, coletaPasso), total)
        const atual = passo >= total ? total : Math.max(1, passo + 1)
        return `Etapa ${atual} de ${total}`
    }, [coletando, coletaPasso, coletaPassosTotais])

    const sincronizarProgressoColeta = useCallback((body) => {
        const total = Number(body.passosTotais)
        const passo = Number(body.passoAtual)
        if (Number.isFinite(total) && total > 0) setColetaPassosTotais(total)
        if (body.status === 'done') {
            setColetaPasso(Number.isFinite(total) && total > 0 ? total : Math.max(0, passo))
            return
        }
        if (Number.isFinite(passo) && passo >= 0) setColetaPasso(passo)
    }, [])

    useEffect(() => {
        const onMove = (e) => {
            if (!arrastandoSplitRef.current || !layoutRef.current) return
            const rect = layoutRef.current.getBoundingClientRect()
            const pct = ((e.clientX - rect.left) / rect.width) * 100
            const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct))
            splitPctRef.current = clamped
            setSplitListaPct(clamped)
        }
        const onUp = () => {
            if (!arrastandoSplitRef.current) return
            arrastandoSplitRef.current = false
            document.body.classList.remove('cred_prospectos_osm_arrastando_split')
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPctRef.current))
            }
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [])

    const iniciarArrasteSplit = (e) => {
        e.preventDefault()
        arrastandoSplitRef.current = true
        document.body.classList.add('cred_prospectos_osm_arrastando_split')
    }

    const categoriaIdsFiltro = useMemo(() => {
        if (catsAtivas.size === 0) return null
        if (catsAtivas.size >= TODAS_CATEGORIAS_IDS.length) return []
        return TODAS_CATEGORIAS_IDS.filter((id) => catsAtivas.has(id))
    }, [catsAtivas])

    useEffect(() => {
        if (!uf) {
            setMunicipios([])
            setCidade('')
            setLoadingMun(false)
            return undefined
        }
        let cancelado = false
        setLoadingMun(true)
        void carregarOpcoesMunicipioProspectos(uf)
            .then((lista) => {
                if (!cancelado) setMunicipios(lista || [])
            })
            .catch(() => {
                if (!cancelado) setMunicipios([])
            })
            .finally(() => {
                if (!cancelado) setLoadingMun(false)
            })
        return () => {
            cancelado = true
        }
    }, [uf])

    useEffect(() => {
        const ufEdit = String(editForm?.uf || '').trim().toUpperCase()
        if (!editForm || !ufEdit) {
            setMunicipiosEdit([])
            setLoadingMunEdit(false)
            return undefined
        }
        let cancel = false
        setLoadingMunEdit(true)
        void carregarOpcoesMunicipioProspectos(ufEdit)
            .then((lista) => {
                if (!cancel) setMunicipiosEdit(lista || [])
            })
            .catch(() => {
                if (!cancel) setMunicipiosEdit([])
            })
            .finally(() => {
                if (!cancel) setLoadingMunEdit(false)
            })
        return () => {
            cancel = true
        }
    }, [editForm?.uf])

    useEffect(() => {
        if (!cidade) return
        if (loadingMun) return
        const chave = normalizarNomeCidadeChave(cidade)
        const hit = municipios.find((m) => {
            const n = normalizarNomeCidadeChave(m.nome)
            return n === chave || m.nome === cidade
        })
        if (!hit) setCidade('')
        else if (hit.nome !== cidade) setCidade(hit.nome)
    }, [cidade, municipios, loadingMun])

    useEffect(() => {
        if (!catPainelAberto) return undefined
        const onDoc = (e) => {
            if (catPainelRef.current && !catPainelRef.current.contains(e.target)) {
                setCatPainelAberto(false)
            }
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [catPainelAberto])

    const carregar = useCallback(async () => {
        if (!podeLer) return
        if (categoriaIdsFiltro === null) {
            setItens([])
            return
        }
        setLoading(true)
        setErro('')
        try {
            const r = await listarProspectosOsm({
                uf,
                cidade,
                categoriaIds: categoriaIdsFiltro,
                status,
                busca,
                limite: 800,
            })
            if (!r.ok) throw new Error(r.erro || 'Falha ao listar.')
            setItens(r.itens || [])
        } catch (e) {
            setErro(e?.message || String(e))
            setItens([])
        } finally {
            setLoading(false)
        }
    }, [podeLer, uf, cidade, categoriaIdsFiltro, status, busca])

    useEffect(() => {
        void carregar()
    }, [carregar])

    useEffect(() => {
        if (!podeLer) return undefined
        let cancelado = false
        void (async () => {
            try {
                const [{ data: prestadores }, { data: situacoes }, { data: especialidades }] = await Promise.all([
                    supabase
                        .from('prestadores')
                        .select('id, nome, especialidade_id, situacao_id, ativo, endereco_cidade, endereco_uf')
                        .eq('ativo', true),
                    supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
                    supabase.from('especialidades').select('id, descricao, tipo').eq('ativo', true),
                ])
                if (cancelado) return
                const base = filtrarPrestadoresParaImportCoordenadas(prestadores || [], especialidades || [], {
                    apenasLocal: true,
                    apenasCredenciados: true,
                    situacoes: situacoes || [],
                })
                setCredenciadosBase(base)
            } catch {
                if (!cancelado) setCredenciadosBase([])
            }
        })()
        return () => {
            cancelado = true
        }
    }, [podeLer])

    const alertasCredenciado = useMemo(
        () =>
            mapearAlertasCredenciadoProspectos(itens, credenciadosBase, {
                dismissedIds: alertaDismissed,
            }),
        [itens, credenciadosBase, alertaDismissed],
    )

    const limparAlertaCredenciado = useCallback((prospectoId, e) => {
        e?.stopPropagation?.()
        const id = String(prospectoId || '')
        if (!id) return
        setAlertaDismissed((prev) => {
            const next = new Set(prev)
            next.add(id)
            salvarAlertasCredenciadoDismissed(next)
            return next
        })
    }, [])

    const alternarOrdenacao = (coluna) => {
        if (ordenarColuna === coluna) {
            setOrdenarDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setOrdenarColuna(coluna)
            setOrdenarDir('asc')
        }
    }

    const itensOrdenados = useMemo(() => {
        const lista = [...(itens || [])]
        const fator = ordenarDir === 'asc' ? 1 : -1
        const chave =
            ordenarColuna === 'categoria'
                ? 'categoria_label'
                : ordenarColuna === 'endereco'
                  ? 'endereco'
                  : ordenarColuna === 'contato'
                    ? 'telefone'
                    : ordenarColuna === 'status'
                      ? 'status_prospeccao'
                      : 'nome'
        lista.sort((a, b) => {
            const va = String(a[chave] ?? a.categoria_id ?? '').trim()
            const vb = String(b[chave] ?? b.categoria_id ?? '').trim()
            return fator * va.localeCompare(vb, 'pt-BR', { sensitivity: 'base' })
        })
        return lista
    }, [itens, ordenarColuna, ordenarDir])

    const comCoordenadas = useMemo(
        () => itensOrdenados.filter((i) => !prospectoSemPin(i)),
        [itensOrdenados],
    )

    const semPin = useMemo(() => itensOrdenados.filter((i) => prospectoSemPin(i)), [itensOrdenados])

    const centroMapa = useMemo(() => {
        if (!comCoordenadas.length) return [-29.7, -53.2]
        const lat = comCoordenadas.reduce((a, i) => a + i.lat, 0) / comCoordenadas.length
        const lng = comCoordenadas.reduce((a, i) => a + i.lng, 0) / comCoordenadas.length
        return [lat, lng]
    }, [comCoordenadas])

    const rotuloCategorias = useMemo(() => {
        if (catsAtivas.size === 0) return 'Nenhuma'
        if (catsAtivas.size >= TODAS_CATEGORIAS_IDS.length) return 'Todas'
        return `${catsAtivas.size} selecionada(s)`
    }, [catsAtivas])

    const alternarCategoria = (id) => {
        setCatsAtivas((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const coletarCidade = async () => {
        const c = String(cidade || '').trim()
        if (!c) {
            setErro('Selecione a cidade para prospectar.')
            return
        }
        setColetando(true)
        setColetaPasso(0)
        setColetaPassosTotais(1)
        setErro('')
        setFeedback('Coleta em andamento (Gemini, até 20 estabelecimentos)…')
        const ctrl = new AbortController()
        const timeoutId = setTimeout(() => ctrl.abort(), 6 * 60 * 1000)

        const montarMsgSucesso = (body) => {
            const fonte = body.fonte || body.resultado?.fonte
            const aviso = body.aviso || body.resultado?.aviso || ''
            let msg = `${body.inseridos ?? body.resultado?.inseridos ?? 0} local(is) atualizado(s).`
            if (fonte === 'gemini' || !fonte) {
                msg += ' Coleta via Gemini.'
            } else if (fonte === 'osm') {
                msg += ' Coleta via mapa (fallback).'
            }
            if (aviso) msg += ` ${aviso}`
            return msg
        }

        try {
            const respStart = await postServerApiJson(
                'prospectos-osm-coletar',
                {
                    action: 'start',
                    cidade: c,
                    uf: String(uf || '').trim(),
                    fonte: 'gemini',
                },
                { signal: ctrl.signal },
            )
            const startBody = await respStart.json().catch(() => ({}))
            if (!respStart.ok) throw new Error(startBody.error || `HTTP ${respStart.status}`)
            const jobId = startBody.jobId
            if (!jobId) throw new Error('Resposta sem jobId.')

            sincronizarProgressoColeta(startBody)

            let body = startBody
            let guard = 0
            const maxPassos = (startBody.passosTotais || 8) + 4
            while (body.status !== 'done' && body.status !== 'failed' && guard < maxPassos) {
                guard += 1
                if (body.progresso) setFeedback(String(body.progresso))
                const respStep = await postServerApiJson(
                    'prospectos-osm-coletar',
                    { action: 'step', jobId },
                    { signal: ctrl.signal },
                )
                body = await respStep.json().catch(() => ({}))
                sincronizarProgressoColeta(body)
                if (body.progresso) setFeedback(String(body.progresso))
                if (body.status === 'failed' || (!respStep.ok && body.status !== 'running')) {
                    throw new Error(body.error || body.erro || `HTTP ${respStep.status}`)
                }
            }
            if (body.status !== 'done') {
                throw new Error('Coleta não concluiu. Tente novamente.')
            }
            sincronizarProgressoColeta({ ...body, status: 'done' })
            setFeedback(montarMsgSucesso(body))
            await carregar()
        } catch (e) {
            if (e?.name === 'AbortError') {
                setErro(
                    'A coleta passou de 6 minutos. Tente de novo em instantes.',
                )
            } else {
                setErro(e?.message || String(e))
            }
            setFeedback('')
        } finally {
            clearTimeout(timeoutId)
            setColetando(false)
            setColetaPasso(0)
            setColetaPassosTotais(1)
            void recarregarGeminiRate()
        }
    }

    const exportarXls = async () => {
        setExportando(true)
        setErro('')
        try {
            const base = ['prospectos', cidade || 'lista', uf].filter(Boolean).join('-')
            const r = await exportarProspectosOsmParaExcel(itensOrdenados, base)
            if (!r.ok) setErro(r.erro || 'Falha ao exportar.')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setExportando(false)
        }
    }

    const preencherPinsSemCoordenadas = async () => {
        if (!podeEditar || preenchendoPins || coletando) return
        const pendentes = itensOrdenados.filter((i) => prospectoSemPin(i))
        if (!pendentes.length) {
            setFeedback('Todos os registros filtrados já têm pin no mapa.')
            return
        }
        abortPinsRef.current?.abort()
        const ctrl = new AbortController()
        abortPinsRef.current = ctrl
        setPreenchendoPins(true)
        setErro('')
        setFeedback(`Preenchendo pins: 0/${pendentes.length}…`)
        try {
            const r = await preencherPinsProspectosOsm(pendentes, {
                signal: ctrl.signal,
                onProgress: ({ msg, atual, total }) => {
                    setFeedback(msg || `Preenchendo pins: ${atual}/${total}…`)
                },
            })
            if (r.itensAtualizados?.length) {
                const porId = new Map(r.itensAtualizados.map((it) => [it.id, it]))
                setItens((prev) => prev.map((row) => (porId.has(row.id) ? { ...row, ...porId.get(row.id) } : row)))
            }
            let msg = `Pins: ${r.preenchidos}/${r.total} preenchido(s).`
            if (r.aproximados) msg += ` ${r.aproximados} com centro da cidade.`
            if (r.falhas) msg += ` ${r.falhas} sem resultado.`
            setFeedback(msg)
        } catch (e) {
            if (e?.name === 'AbortError') {
                setFeedback('Preenchimento de pins cancelado.')
            } else {
                setErro(e?.message || String(e))
                setFeedback('')
            }
        } finally {
            if (abortPinsRef.current === ctrl) abortPinsRef.current = null
            setPreenchendoPins(false)
        }
    }

    const cancelarPreencherPins = () => {
        abortPinsRef.current?.abort()
    }

    const salvarStatus = async (id, status_prospeccao, observacao) => {
        const r = await atualizarStatusProspectoOsm(id, { status_prospeccao, observacao })
        if (!r.ok) {
            setErro(r.erro || 'Não foi possível salvar.')
            return
        }
        setItens((prev) => prev.map((row) => (row.id === id ? { ...row, ...r.item } : row)))
    }

    const abrirEdicao = (row, e) => {
        e?.stopPropagation?.()
        if (!row?.id) return
        setErro('')
        setEditando(row)
        setEditForm({
            nome: row.nome || '',
            categoria_id: row.categoria_id || '',
            endereco: row.endereco || '',
            cidade: row.cidade || '',
            uf: row.uf || '',
            telefone: row.telefone || '',
            website: row.website || '',
            horario_atendimento: row.horario_atendimento || '',
            status_prospeccao: row.status_prospeccao || 'novo',
            observacao: row.observacao || '',
            lat: row.lat != null && Number.isFinite(Number(row.lat)) ? String(row.lat) : '',
            lng: row.lng != null && Number.isFinite(Number(row.lng)) ? String(row.lng) : '',
        })
    }

    const fecharEdicao = () => {
        if (salvandoEdit) return
        setEditando(null)
        setEditForm(null)
    }

    const setCampoEdit = (campo, valor) => {
        setEditForm((prev) => {
            if (!prev) return prev
            if (campo === 'uf') return { ...prev, uf: valor, cidade: '' }
            return { ...prev, [campo]: valor }
        })
    }

    const salvarEdicao = async () => {
        if (!editando?.id || !editForm) return
        const nome = String(editForm.nome || '').trim()
        if (!nome) {
            setErro('Informe o nome do prospecto.')
            return
        }
        const latRaw = String(editForm.lat ?? '').trim()
        const lngRaw = String(editForm.lng ?? '').trim()
        const latVazia = !latRaw
        const lngVazia = !lngRaw
        if (latVazia !== lngVazia) {
            setErro('Informe latitude e longitude juntas, ou deixe ambas vazias.')
            return
        }
        let lat = latRaw
        let lng = lngRaw
        if (!latVazia && !lngVazia) {
            const latN = Number(latRaw)
            const lngN = Number(lngRaw)
            if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
                setErro('Latitude e longitude devem ser números válidos.')
                return
            }
            lat = latN
            lng = lngN
        }
        setSalvandoEdit(true)
        setErro('')
        try {
            const catId = String(editForm.categoria_id || '').trim()
            const r = await atualizarProspectoOsm(editando.id, {
                nome,
                categoria_id: catId,
                categoria_label: labelProspectoOsmCategoria(catId) || editando.categoria_label || catId,
                endereco: editForm.endereco,
                cidade: editForm.cidade,
                uf: String(editForm.uf || '').trim().toUpperCase(),
                telefone: editForm.telefone,
                website: editForm.website,
                horario_atendimento: editForm.horario_atendimento,
                status_prospeccao: editForm.status_prospeccao || 'novo',
                observacao: editForm.observacao,
                lat: latVazia ? '' : lat,
                lng: lngVazia ? '' : lng,
            })
            if (!r.ok) {
                setErro(r.erro || 'Não foi possível salvar o prospecto.')
                return
            }
            setItens((prev) => prev.map((row) => (row.id === editando.id ? { ...row, ...r.item } : row)))
            setFeedback(`«${r.item?.nome || nome}» atualizado.`)
            setEditando(null)
            setEditForm(null)
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setSalvandoEdit(false)
        }
    }

    const enviarAoKanban = async (row, e) => {
        e?.stopPropagation?.()
        if (!row?.id || enviandoKanbanId === row.id) return
        setEnviandoKanbanId(row.id)
        try {
            setErro('')
            const card = await enviarProspectoOsmParaKanban(row)
            const colLabel =
                card?.coluna === 'contatado'
                    ? 'Contatado'
                    : card?.coluna === 'nao_contatado'
                      ? 'Não contatado'
                      : colunaKanbanParaStatusProspecto(row.status_prospeccao) === 'contatado'
                        ? 'Contatado'
                        : 'Não contatado'
            setFeedback(`«${row.nome || 'Prospecto'}» enviado ao Kanban → ${colLabel}.`)
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setEnviandoKanbanId(null)
        }
    }

    if (!podeLer) {
        return (
            <div className="el-page credenciamento_main">
                <p className="pcad_muted">Sem permissão para o catálogo de prospectos OSM.</p>
            </div>
        )
    }

    return (
        <div className="el-page credenciamento_main cred_prospectos_osm_page">
            <div className="cred_prospectos_osm_top">
                <PageHeader kicker="Credenciamento" title="Catálogo de prospectos" />

                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
                <CredenciamentoMainAlert message={feedback} onClose={() => setFeedback('')} role="status" />

                <div className="cred_prospectos_osm_filtros_bar">
                <section className="cred_prospectos_osm_filtros_flutuantes" aria-label="Filtros">
                    <div className="cred_prospectos_osm_filtro_linha1">
                        <label className="pcad_field cred_prospectos_osm_field_uf">
                            <span>UF</span>
                            <SelectUfBusca
                                value={uf}
                                inputClassName="credenciamento_main_input"
                                emptyLabel="—"
                                onChange={(u) => {
                                    setUf(u)
                                    setCidade('')
                                }}
                            />
                        </label>
                        <label className="pcad_field cred_prospectos_osm_field_cidade">
                            <span>Cidade</span>
                            <SelectMunicipioBusca
                                value={cidade}
                                valueKey="nome"
                                options={municipios}
                                disabled={!uf || loadingMun}
                                loading={loadingMun}
                                inputClassName="credenciamento_main_input"
                                placeholder={!uf ? 'Selecione a UF' : 'Buscar cidade…'}
                                onChange={setCidade}
                            />
                        </label>
                        <div className="pcad_field cred_prospectos_osm_cat_field" ref={catPainelRef}>
                            <span>Categoria</span>
                            <button
                                type="button"
                                className="credenciamento_main_input cred_prospectos_osm_cat_trigger"
                                aria-expanded={catPainelAberto}
                                onClick={() => setCatPainelAberto((v) => !v)}
                            >
                                {rotuloCategorias}
                            </button>
                            {catPainelAberto ? (
                                <div className="cred_prospectos_osm_cat_checks" role="group" aria-label="Categorias">
                                    {PROSPECTOS_OSM_CATEGORIAS.map((c) => (
                                        <label key={c.id} className="cred_prospectos_osm_cat_check">
                                            <input
                                                type="checkbox"
                                                checked={catsAtivas.has(c.id)}
                                                onChange={() => alternarCategoria(c.id)}
                                            />
                                            <span>{c.label}</span>
                                        </label>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                        <label className="pcad_field cred_prospectos_osm_field_status">
                            <span>Status</span>
                            <select
                                className="credenciamento_main_select"
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                            >
                                <option value="">Todos</option>
                                {STATUS_PROSPECCAO_OPCOES.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="cred_prospectos_osm_linha1_acoes">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_xls"
                                disabled={exportando || !itensOrdenados.length}
                                onClick={() => void exportarXls()}
                            >
                                {exportando ? 'Exportando…' : 'Exportar XLS'}
                            </button>
                            {podeEditar ? (
                                preenchendoPins ? (
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_pins"
                                        onClick={cancelarPreencherPins}
                                    >
                                        Cancelar pins
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_pins"
                                        disabled={coletando || !semPin.length}
                                        title={
                                            semPin.length
                                                ? `Geocodificar ${semPin.length} registro(s) sem coordenadas`
                                                : 'Nenhum registro filtrado sem pin'
                                        }
                                        onClick={() => void preencherPinsSemCoordenadas()}
                                    >
                                        Preencher pins{semPin.length ? ` (${semPin.length})` : ''}
                                    </button>
                                )
                            ) : null}
                        </div>
                    </div>
                    <div className="cred_prospectos_osm_filtro_linha2">
                        <label className="pcad_field cred_prospectos_osm_field_busca">
                            <span>Pesquisa</span>
                            <CampoBuscaComLimpar
                                className="credenciamento_main_input"
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder="Nome ou endereço…"
                            />
                        </label>
                        <div className="cred_prospectos_osm_linha2_acoes">
                            <span
                                className={`cred_prospectos_osm_gemini_rate${geminiRate?.bloqueadoAte ? ' is-bloqueado' : ''}`}
                                title={
                                    geminiRate?.bloqueadoAte
                                        ? `Rate limit até ${geminiRate.bloqueadoAte}`
                                        : erroGeminiRate
                                          ? erroGeminiRate
                                          : 'Pedidos deste processo contra GEMINI_RPM / GEMINI_RPD (reset diário à meia-noite Pacific)'
                                }
                            >
                                {geminiRate
                                    ? `Gemini ${geminiRate.rpmUsados ?? 0}/${geminiRate.rpmLimite ?? '—'} RPM · ${geminiRate.rpdUsados ?? 0}/${geminiRate.rpdLimite ?? '—'} hoje`
                                    : loadingGeminiRate
                                      ? 'Gemini — …'
                                      : erroGeminiRate
                                        ? 'Gemini — indisponível'
                                        : 'Gemini — RPM'}
                            </span>
                            {podeEditar ? (
                                <div
                                    className={`cred_prospectos_osm_prospectar_wrap${coletando ? ' is-coletando' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className={`credenciamento_main_action_btn cred_prospectos_osm_btn_prospectar${coletando ? ' is-coletando' : ''}`}
                                        disabled={coletando || preenchendoPins || !cidade.trim()}
                                        onClick={() => void coletarCidade()}
                                        aria-busy={coletando}
                                    >
                                        {coletando ? 'Prospectando…' : 'Prospectar'}
                                    </button>
                                    {coletando ? (
                                        <div
                                            className="cred_prospectos_osm_coleta_progress"
                                            role="progressbar"
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={coletaProgressoPct}
                                            aria-label={`Progresso da coleta: ${coletaProgressoPct}%`}
                                        >
                                            <div className="cred_prospectos_osm_coleta_progress_head">
                                                <span className="cred_prospectos_osm_coleta_progress_etapa">
                                                    {coletaProgressoPassoLabel}
                                                </span>
                                                <span className="cred_prospectos_osm_coleta_progress_pct">
                                                    {coletaProgressoPct}%
                                                </span>
                                            </div>
                                            <div className="cred_prospectos_osm_coleta_progress_track">
                                                <div
                                                    className="cred_prospectos_osm_coleta_progress_fill"
                                                    style={{ width: `${coletaProgressoPct}%` }}
                                                />
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </section>
                </div>

                <div className="cred_prospectos_osm_header">
                    <div className="credenciamento_mapa_kpi" role="status">
                        {loading ? (
                            'Carregando…'
                        ) : (
                            <>
                                <strong>{itensOrdenados.length}</strong> registro(s)
                            </>
                        )}
                    </div>
                    {comCoordenadas.length > 0 ? (
                        <div className="credenciamento_mapa_kpi">
                            <strong>{comCoordenadas.length}</strong> no mapa
                        </div>
                    ) : null}
                    {semPin.length > 0 ? (
                        <div className="credenciamento_mapa_kpi">
                            <strong>{semPin.length}</strong> sem pin
                        </div>
                    ) : null}
                    <label className="cred_prospectos_osm_toggle_mapa">
                        <input
                            type="checkbox"
                            checked={mostrarMapa}
                            onChange={(e) => {
                                const on = e.target.checked
                                setMostrarMapa(on)
                                if (on) setPainelMobile('mapa')
                                else setPainelMobile('lista')
                            }}
                        />
                        Mostrar mapa
                    </label>
                </div>

                {mostrarMapa ? (
                    <div className="cred_prospectos_osm_mobile_tabs" role="group" aria-label="Lista ou mapa">
                        <button
                            type="button"
                            aria-pressed={painelMobile === 'lista'}
                            className={painelMobile === 'lista' ? 'is-ativo' : ''}
                            onClick={() => setPainelMobile('lista')}
                        >
                            Lista
                        </button>
                        <button
                            type="button"
                            aria-pressed={painelMobile === 'mapa'}
                            className={painelMobile === 'mapa' ? 'is-ativo' : ''}
                            onClick={() => setPainelMobile('mapa')}
                        >
                            Mapa
                        </button>
                    </div>
                ) : null}
            </div>

            <div
                ref={layoutRef}
                className={[
                    'cred_prospectos_osm_layout',
                    mostrarMapa ? '' : 'cred_prospectos_osm_layout--sem-mapa',
                    mostrarMapa ? `cred_prospectos_osm_layout--mobile-${painelMobile}` : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                style={
                    mostrarMapa
                        ? ({ '--cred-prospectos-split-pct': `${splitListaPct}%` })
                        : undefined
                }
            >
                <section className="cred_prospectos_osm_lista" aria-label="Lista de prospectos">
                    <h3 className="cred_prospectos_osm_lista_titulo">Prospectos</h3>
                    <div className="cred_prospectos_osm_tabela_wrap overflow-x-auto">
                        {!loading && !itensOrdenados.length ? (
                            <p className="pcad_muted cred_prospectos_osm_vazio">
                                Nenhum registro para os filtros atuais. Selecione cidade/UF ou use «Prospectar».
                            </p>
                        ) : (
                            <table className="table_main cred_prospectos_osm_table">
                                <thead>
                                    <tr>
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('nome')}
                                            >
                                                Nome{indicadorOrdenacao(ordenarColuna, ordenarDir, 'nome')}
                                            </button>
                                        </th>
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('categoria')}
                                            >
                                                Categoria
                                                {indicadorOrdenacao(ordenarColuna, ordenarDir, 'categoria')}
                                            </button>
                                        </th>
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('endereco')}
                                            >
                                                Endereço
                                                {indicadorOrdenacao(ordenarColuna, ordenarDir, 'endereco')}
                                            </button>
                                        </th>
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('contato')}
                                            >
                                                Contato
                                                {indicadorOrdenacao(ordenarColuna, ordenarDir, 'contato')}
                                            </button>
                                        </th>
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('status')}
                                            >
                                                Status
                                                {indicadorOrdenacao(ordenarColuna, ordenarDir, 'status')}
                                            </button>
                                        </th>
                                        {podeEditar ? (
                                            <>
                                                <th className="table_header">Editar</th>
                                                <th className="table_header">Kanban</th>
                                            </>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {itensOrdenados.map((row) => (
                                        <tr
                                            key={row.id}
                                            className={destaqueId === row.id ? 'is-destaque' : ''}
                                            onClick={() => {
                                                setDestaqueId(row.id)
                                                if (
                                                    mostrarMapa &&
                                                    Number.isFinite(row.lat) &&
                                                    Number.isFinite(row.lng)
                                                ) {
                                                    setPainelMobile('mapa')
                                                }
                                            }}
                                            onDoubleClick={(e) => {
                                                if (podeEditar) abrirEdicao(row, e)
                                            }}
                                        >
                                            <td>
                                                <span className="cred_prospectos_osm_nome_cel">
                                                    {row.nome || '—'}
                                                    {prospectoIndicaAtendimento24h(row) ? (
                                                        <span
                                                            className="cred_prospectos_osm_badge_24h"
                                                            title={
                                                                row.horario_atendimento
                                                                    ? `Horário: ${row.horario_atendimento}`
                                                                    : 'Atendimento 24 horas'
                                                            }
                                                        >
                                                            24h
                                                        </span>
                                                    ) : null}
                                                    {alertasCredenciado.has(String(row.id)) ? (
                                                        <button
                                                            type="button"
                                                            className="cred_prospectos_osm_badge_cred"
                                                            title={`Talvez já credenciado: ${alertasCredenciado.get(String(row.id)).nome}. Clique para limpar.`}
                                                            aria-label="Talvez já credenciado. Clique para limpar a flag."
                                                            onClick={(e) => limparAlertaCredenciado(row.id, e)}
                                                        >
                                                            ⚑
                                                        </button>
                                                    ) : null}
                                                </span>
                                            </td>
                                            <td>{row.categoria_label || row.categoria_id}</td>
                                            <td>{formatarEnderecoLinhaTabela(row)}</td>
                                            <td>
                                                {formatarLinhaTelefonesContato(row.telefone) || row.website || '—'}
                                            </td>
                                            <td>
                                                {podeEditar ? (
                                                    <select
                                                        className="credenciamento_main_select cred_prospectos_osm_status_sel"
                                                        value={row.status_prospeccao || 'novo'}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) =>
                                                            void salvarStatus(row.id, e.target.value, row.observacao)
                                                        }
                                                    >
                                                        {STATUS_PROSPECCAO_OPCOES.map((s) => (
                                                            <option key={s.id} value={s.id}>
                                                                {s.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    row.status_prospeccao
                                                )}
                                            </td>
                                            {podeEditar ? (
                                                <>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_edit"
                                                            title="Editar prospecto"
                                                            onClick={(e) => abrirEdicao(row, e)}
                                                        >
                                                            Editar
                                                        </button>
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_kanban"
                                                            disabled={enviandoKanbanId === row.id}
                                                            title={
                                                                colunaKanbanParaStatusProspecto(row.status_prospeccao) ===
                                                                'contatado'
                                                                    ? 'Envia para coluna Contatado (com dados do prospecto)'
                                                                    : 'Envia para coluna Não contatado (com dados do prospecto)'
                                                            }
                                                            onClick={(e) => void enviarAoKanban(row, e)}
                                                        >
                                                            {colunaKanbanParaStatusProspecto(row.status_prospeccao) ===
                                                            'contatado'
                                                                ? '→ Contatado'
                                                                : '→ Não contatado'}
                                                        </button>
                                                    </td>
                                                </>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>

                {mostrarMapa ? (
                    <>
                        <div
                            className="cred_prospectos_osm_split"
                            role="separator"
                            aria-orientation="vertical"
                            aria-valuenow={Math.round(splitListaPct)}
                            aria-label="Ajustar largura da lista e do mapa"
                            title="Arraste para redimensionar"
                            onMouseDown={iniciarArrasteSplit}
                        />
                        <aside className="cred_prospectos_osm_mapa_col" aria-label="Mapa dos prospectos">
                        <section className="credenciamento_mapa_container cred_prospectos_osm_mapa_box">
                            <MapContainer
                                center={centroMapa}
                                zoom={comCoordenadas.length ? 12 : 7}
                                className="credenciamento_mapa_leaflet cred_prospectos_osm_mapa"
                                scrollWheelZoom
                            >
                                <MapaRedimensionar dep={`${splitListaPct}-${painelMobile}-${mostrarMapa}`} />
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                                />
                                {comCoordenadas.map((row) => (
                                    <Marker
                                        key={row.id}
                                        position={[row.lat, row.lng]}
                                        icon={pinProspecto}
                                        opacity={destaqueId && destaqueId !== row.id ? 0.45 : 1}
                                        eventHandlers={{
                                            click: () => setDestaqueId(row.id),
                                        }}
                                    >
                                <Popup>
                                    <strong>{row.nome}</strong>
                                    {prospectoIndicaAtendimento24h(row) ? (
                                        <>
                                            {' '}
                                            <span className="cred_prospectos_osm_badge_24h">24h</span>
                                        </>
                                    ) : null}
                                    {alertasCredenciado.has(String(row.id)) ? (
                                        <>
                                            {' '}
                                            <button
                                                type="button"
                                                className="cred_prospectos_osm_badge_cred"
                                                title={`Talvez já credenciado: ${alertasCredenciado.get(String(row.id)).nome}. Clique para limpar.`}
                                                aria-label="Talvez já credenciado. Clique para limpar a flag."
                                                onClick={(e) => limparAlertaCredenciado(row.id, e)}
                                            >
                                                ⚑
                                            </button>
                                        </>
                                    ) : null}
                                    <br />
                                    {row.categoria_label}
                                    <br />
                                    {row.endereco}
                                    {row.horario_atendimento ? (
                                        <>
                                            <br />
                                            <small>{row.horario_atendimento}</small>
                                        </>
                                    ) : null}
                                </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        </section>
                    </aside>
                    </>
                ) : null}
            </div>

            {editando && editForm ? (
                <div className="credenciamento_modal_backdrop" onClick={fecharEdicao}>
                    <div
                        className="credenciamento_modal cred_prospectos_osm_edit_modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cred-prospectos-edit-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="cred-prospectos-edit-title">Editar prospecto</h3>
                        <div className="credenciamento_modal_grid">
                            <label>
                                <span>Nome *</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.nome}
                                    onChange={(e) => setCampoEdit('nome', e.target.value)}
                                />
                            </label>
                            <label>
                                <span>Categoria</span>
                                <select
                                    className="credenciamento_main_input"
                                    value={editForm.categoria_id}
                                    onChange={(e) => setCampoEdit('categoria_id', e.target.value)}
                                >
                                    {PROSPECTOS_OSM_CATEGORIAS.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.label}
                                        </option>
                                    ))}
                                    {editForm.categoria_id &&
                                    !PROSPECTOS_OSM_CATEGORIAS.some((c) => c.id === editForm.categoria_id) ? (
                                        <option value={editForm.categoria_id}>
                                            {editando.categoria_label || editForm.categoria_id}
                                        </option>
                                    ) : null}
                                </select>
                            </label>
                            <label className="credenciamento_modal_full">
                                <span>Endereço</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.endereco}
                                    onChange={(e) => setCampoEdit('endereco', e.target.value)}
                                />
                            </label>
                            <label>
                                <span>UF</span>
                                <SelectUfBusca
                                    value={editForm.uf}
                                    inputClassName="credenciamento_main_input"
                                    emptyLabel="—"
                                    onChange={(u) => {
                                        setCampoEdit('uf', u)
                                        setCampoEdit('cidade', '')
                                    }}
                                />
                            </label>
                            <label>
                                <span>Cidade</span>
                                <SelectMunicipioBusca
                                    value={editForm.cidade}
                                    valueKey="nome"
                                    options={municipiosEdit}
                                    disabled={!editForm.uf?.trim() || loadingMunEdit}
                                    loading={loadingMunEdit}
                                    inputClassName="credenciamento_main_input"
                                    placeholder={!editForm.uf?.trim() ? 'Selecione a UF' : 'Buscar cidade…'}
                                    onChange={(nome) => setCampoEdit('cidade', nome)}
                                />
                            </label>
                            <label>
                                <span>Telefone</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.telefone}
                                    onChange={(e) => setCampoEdit('telefone', e.target.value)}
                                />
                            </label>
                            <label>
                                <span>Website</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.website}
                                    onChange={(e) => setCampoEdit('website', e.target.value)}
                                />
                            </label>
                            <label className="credenciamento_modal_full">
                                <span>Horário de atendimento</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.horario_atendimento}
                                    onChange={(e) => setCampoEdit('horario_atendimento', e.target.value)}
                                    placeholder="Ex.: Seg–Sex 8h–18h / 24h"
                                />
                            </label>
                            <label>
                                <span>Latitude</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.lat}
                                    onChange={(e) => setCampoEdit('lat', e.target.value)}
                                    inputMode="decimal"
                                />
                            </label>
                            <label>
                                <span>Longitude</span>
                                <input
                                    type="text"
                                    className="credenciamento_main_input"
                                    value={editForm.lng}
                                    onChange={(e) => setCampoEdit('lng', e.target.value)}
                                    inputMode="decimal"
                                />
                            </label>
                            <label>
                                <span>Status</span>
                                <select
                                    className="credenciamento_main_input"
                                    value={editForm.status_prospeccao}
                                    onChange={(e) => setCampoEdit('status_prospeccao', e.target.value)}
                                >
                                    {STATUS_PROSPECCAO_OPCOES.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="credenciamento_modal_full">
                                <span>Observação</span>
                                <textarea
                                    className="credenciamento_main_input"
                                    rows={3}
                                    value={editForm.observacao}
                                    onChange={(e) => setCampoEdit('observacao', e.target.value)}
                                />
                            </label>
                        </div>
                        <div className="credenciamento_modal_actions">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={salvandoEdit}
                                onClick={fecharEdicao}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                disabled={salvandoEdit}
                                onClick={() => void salvarEdicao()}
                            >
                                {salvandoEdit ? 'A guardar…' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default CredenciamentoProspectosOsm
