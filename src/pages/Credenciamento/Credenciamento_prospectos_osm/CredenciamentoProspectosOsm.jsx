import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import {
    PERMISSION_KEYS,
    hasPermission,
    podeLerFerramenta,
    usuarioPodeEditarFerramenta,
    useStoredAccessProfile,
} from '../../../lib/accessControl'
import { PROSPECTOS_OSM_CATEGORIAS } from '../../../lib/credenciamento/prospectosOsmCategorias.js'
import {
    STATUS_PROSPECCAO_OPCOES,
    listarProspectosOsm,
    atualizarStatusProspectoOsm,
} from '../../../lib/credenciamento/prospectosOsmRepo.js'
import { exportarProspectosOsmParaExcel } from '../../../lib/credenciamento/exportProspectosOsmExcel.js'
import { prospectoIndicaAtendimento24h } from '../../../lib/credenciamento/prospectosOsmHorario.js'
import {
    GEMINI_COTA_ESGOTADA_LS_KEY,
    GEMINI_DESCANSO_LS_KEY,
    descansoAteFromRetrySec,
    formatarTimerDescansoGeminiLive,
    msRestantesDescanso,
    segundosRestantesDescanso,
} from '../../../lib/credenciamento/geminiDescanso.js'
import { formatarEnderecoLinhaTabela } from '../../../lib/credenciamento/prospectosOsmQualidade.js'
import { formatarLinhaTelefonesContato } from '../../../lib/telefoneBrasil.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import '../Credenciamento_main/Credenciamento_main.css'
import '../Credenciamento_cadastro/CredenciamentoCadastro.css'
import '../Credenciamento_mapa/CredenciamentoMapa.css'
import './CredenciamentoProspectosOsm.css'
import 'leaflet/dist/leaflet.css'

const TODAS_CATEGORIAS_IDS = PROSPECTOS_OSM_CATEGORIAS.map((c) => c.id)
const SPLIT_STORAGE_KEY = 'sfsc-prospectos-osm-split-pct'
const SPLIT_MIN = 28
const SPLIT_MAX = 72

function lerGeminiCotaInicial() {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(GEMINI_COTA_ESGOTADA_LS_KEY) === '1'
}

function lerGeminiDescansoInicial() {
    if (typeof window === 'undefined') return ''
    const ate = window.localStorage.getItem(GEMINI_DESCANSO_LS_KEY) || ''
    if (!ate || segundosRestantesDescanso(ate) <= 0) {
        window.localStorage.removeItem(GEMINI_DESCANSO_LS_KEY)
        return ''
    }
    return ate
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
    const [loadingMun, setLoadingMun] = useState(false)
    const [catsAtivas, setCatsAtivas] = useState(() => new Set(TODAS_CATEGORIAS_IDS))
    const [catPainelAberto, setCatPainelAberto] = useState(false)
    const catPainelRef = useRef(null)
    const [status, setStatus] = useState('')
    const [busca, setBusca] = useState('')
    const [itens, setItens] = useState([])
    const [loading, setLoading] = useState(false)
    const [coletando, setColetando] = useState(false)
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [geminiDescansoAte, setGeminiDescansoAte] = useState(lerGeminiDescansoInicial)
    const [geminiCotaEsgotada, setGeminiCotaEsgotada] = useState(lerGeminiCotaInicial)
    const [geminiChecando, setGeminiChecando] = useState(false)
    const [geminiDescansoTick, setGeminiDescansoTick] = useState(0)
    const [destaqueId, setDestaqueId] = useState(null)
    const [mostrarMapa, setMostrarMapa] = useState(true)
    const [splitListaPct, setSplitListaPct] = useState(lerSplitInicial)
    const layoutRef = useRef(null)
    const arrastandoSplitRef = useRef(false)
    const splitPctRef = useRef(splitListaPct)
    const [ordenarColuna, setOrdenarColuna] = useState('nome')
    const [ordenarDir, setOrdenarDir] = useState('asc')

    useEffect(() => {
        splitPctRef.current = splitListaPct
    }, [splitListaPct])

    useEffect(() => {
        const id = window.setInterval(() => setGeminiDescansoTick((n) => n + 1), 100)
        return () => window.clearInterval(id)
    }, [])

    const geminiMsRestantes = useMemo(
        () => msRestantesDescanso(geminiDescansoAte),
        [geminiDescansoAte, geminiDescansoTick],
    )

    const geminiEmDescanso = geminiMsRestantes > 0 && !geminiCotaEsgotada

    const marcarGeminiCotaEsgotada = useCallback((ativo) => {
        setGeminiCotaEsgotada(ativo)
        if (typeof window === 'undefined') return
        if (ativo) {
            window.localStorage.setItem(GEMINI_COTA_ESGOTADA_LS_KEY, '1')
            setGeminiDescansoAte('')
            window.localStorage.removeItem(GEMINI_DESCANSO_LS_KEY)
        } else {
            window.localStorage.removeItem(GEMINI_COTA_ESGOTADA_LS_KEY)
        }
    }, [])

    const geminiWidgetEstado = useMemo(() => {
        if (geminiChecando) return 'checando'
        if (geminiEmDescanso) return 'pausa'
        if (geminiCotaEsgotada) return 'sem-cota'
        return 'pronto'
    }, [geminiChecando, geminiEmDescanso, geminiCotaEsgotada])

    const verificarGeminiLive = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        setGeminiChecando(true)
        try {
            const resp = await fetch('/api/prospectos-gemini-status', {
                headers: { Accept: 'application/json' },
            })
            const body = await resp.json().catch(() => ({}))
            if (!resp.ok) return
            if (body.disponivel) {
                marcarGeminiCotaEsgotada(false)
                setGeminiDescansoAte('')
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(GEMINI_DESCANSO_LS_KEY)
                }
                return
            }
            if (body.geminiIndisponivelPorCota || body.quotaExceeded) {
                marcarGeminiCotaEsgotada(true)
            }
            if (body.geminiDescansoAte || body.geminiRetryAfterSec) {
                let ate = body.geminiDescansoAte ? String(body.geminiDescansoAte) : ''
                if (!ate && body.geminiRetryAfterSec) {
                    ate = descansoAteFromRetrySec(body.geminiRetryAfterSec)
                }
                if (ate && segundosRestantesDescanso(ate) > 0 && !body.geminiIndisponivelPorCota) {
                    setGeminiDescansoAte(ate)
                    if (typeof window !== 'undefined') {
                        window.localStorage.setItem(GEMINI_DESCANSO_LS_KEY, ate)
                    }
                }
            }
        } catch {
            /* rede / dev sem API */
        } finally {
            setGeminiChecando(false)
        }
    }, [marcarGeminiCotaEsgotada])

    useEffect(() => {
        void verificarGeminiLive()
        const id = window.setInterval(() => void verificarGeminiLive(), 90_000)
        const onVis = () => {
            if (document.visibilityState === 'visible') void verificarGeminiLive()
        }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            window.clearInterval(id)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [verificarGeminiLive])

    const aplicarEstadoGeminiResposta = useCallback(
        (body) => {
            if (body.fonte === 'gemini' && !body.fallbackDeGemini) {
                marcarGeminiCotaEsgotada(false)
                setGeminiDescansoAte('')
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(GEMINI_DESCANSO_LS_KEY)
                }
                return
            }
            if (body.geminiIndisponivelPorCota || body.geminiQuotaPausa) {
                marcarGeminiCotaEsgotada(true)
                return
            }
            if (body.geminiDescansoAte || body.geminiRetryAfterSec) {
                let ate = body.geminiDescansoAte ? String(body.geminiDescansoAte) : ''
                if (!ate && body.geminiRetryAfterSec) {
                    ate = descansoAteFromRetrySec(body.geminiRetryAfterSec)
                }
                if (ate && segundosRestantesDescanso(ate) > 0) {
                    setGeminiDescansoAte(ate)
                    if (typeof window !== 'undefined') {
                        window.localStorage.setItem(GEMINI_DESCANSO_LS_KEY, ate)
                    }
                }
            }
        },
        [marcarGeminiCotaEsgotada],
    )

    useEffect(() => {
        if (!geminiDescansoAte) return
        if (segundosRestantesDescanso(geminiDescansoAte) <= 0) {
            setGeminiDescansoAte('')
            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(GEMINI_DESCANSO_LS_KEY)
            }
        }
    }, [geminiDescansoAte, geminiDescansoTick])

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
            return
        }
        setLoadingMun(true)
        buscarMunicipiosPorUf(uf)
            .then((lista) => setMunicipios(lista || []))
            .catch(() => setMunicipios([]))
            .finally(() => setLoadingMun(false))
    }, [uf])

    useEffect(() => {
        if (!cidade) return
        const ok = municipios.some((m) => m.nome === cidade)
        if (!ok) setCidade('')
    }, [cidade, municipios])

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
        () => itensOrdenados.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng)),
        [itensOrdenados],
    )

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
        setErro('')
        setFeedback(
            geminiCotaEsgotada
                ? 'Coleta em andamento (modo auto: OpenStreetMap — Gemini sem cota)…'
                : 'Coleta em andamento (modo auto: Gemini → OpenStreetMap se necessário; pode levar 1–4 min)…',
        )
        const ctrl = new AbortController()
        const timeoutId = setTimeout(() => ctrl.abort(), 6 * 60 * 1000)
        try {
            const resp = await fetch('/api/prospectos-osm-coletar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    cidade: c,
                    uf: String(uf || '').trim(),
                    omitirGemini: geminiCotaEsgotada,
                }),
                signal: ctrl.signal,
            })
            const body = await resp.json().catch(() => ({}))
            aplicarEstadoGeminiResposta(body)
            if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
            let msg = `${body.inseridos ?? 0} local(is) atualizado(s).`
            if (body.coletaDiretaOsm) {
                msg += ' Modo auto: coleta via OpenStreetMap (Gemini sem cota no plano).'
            } else if (body.fallbackDeGemini) {
                msg += ' Modo auto: Gemini sem cota → concluído via OpenStreetMap.'
            } else if (body.fonte === 'gemini') {
                msg += ' Coleta via Gemini.'
            } else if (body.fonte === 'osm') {
                msg += ' Coleta via OpenStreetMap.'
            }
            if (body.aviso) msg += ` ${body.aviso}`
            setFeedback(msg)
            await carregar()
        } catch (e) {
            if (e?.name === 'AbortError') {
                setErro(
                    'A coleta passou de 6 minutos. O servidor de mapas pode estar lento; tente de novo em instantes.',
                )
            } else {
                setErro(e?.message || String(e))
            }
            setFeedback('')
        } finally {
            clearTimeout(timeoutId)
            setColetando(false)
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

    const salvarStatus = async (id, status_prospeccao, observacao) => {
        const r = await atualizarStatusProspectoOsm(id, { status_prospeccao, observacao })
        if (!r.ok) {
            setErro(r.erro || 'Não foi possível salvar.')
            return
        }
        setItens((prev) => prev.map((row) => (row.id === id ? { ...row, ...r.item } : row)))
    }

    if (!podeLer) {
        return (
            <div className="credenciamento_main">
                <p className="pcad_muted">Sem permissão para o catálogo de prospectos OSM.</p>
            </div>
        )
    }

    return (
        <div className="credenciamento_main cred_prospectos_osm_page">
            <div className="cred_prospectos_osm_top">
                <h1>Catálogo de prospectos</h1>
                <hr />

                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
                <CredenciamentoMainAlert message={feedback} onClose={() => setFeedback('')} role="status" />

                <div className="cred_prospectos_osm_filtros_bar">
                <section className="cred_prospectos_osm_filtros_flutuantes" aria-label="Filtros">
                    <div className="cred_prospectos_osm_filtro_linha1">
                        <label className="pcad_field cred_prospectos_osm_field_uf">
                            <span>UF</span>
                            <select
                                className="credenciamento_main_input"
                                value={uf}
                                onChange={(e) => setUf(e.target.value)}
                            >
                                <option value="">—</option>
                                {UFS_BRASIL.map((sigla) => (
                                    <option key={sigla} value={sigla}>
                                        {sigla}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="pcad_field cred_prospectos_osm_field_cidade">
                            <span>Cidade</span>
                            <select
                                className="credenciamento_main_input"
                                value={cidade}
                                disabled={!uf || loadingMun}
                                onChange={(e) => setCidade(e.target.value)}
                            >
                                <option value="">{loadingMun ? 'A carregar…' : '—'}</option>
                                {municipios.map((m) => (
                                    <option key={m.id} value={m.nome}>
                                        {m.nome}
                                    </option>
                                ))}
                            </select>
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
                        <label className="pcad_field">
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
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary cred_prospectos_osm_btn_xls"
                            disabled={exportando || !itensOrdenados.length}
                            onClick={() => void exportarXls()}
                        >
                            {exportando ? 'Exportando…' : 'Exportar XLS'}
                        </button>
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
                            {podeEditar ? (
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn cred_prospectos_osm_btn_prospectar"
                                    disabled={coletando || !cidade.trim()}
                                    onClick={() => void coletarCidade()}
                                >
                                    {coletando ? 'Prospectando…' : 'Prospectar'}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </section>

                <aside
                    className={`cred_prospectos_osm_gemini_descanso_live is-${geminiWidgetEstado}`}
                    role="timer"
                    aria-live="polite"
                    title={
                        geminiWidgetEstado === 'sem-cota'
                            ? 'Cota Gemini esgotada. Prospectar usa OSM. Duplo clique para tentar Gemini de novo.'
                            : undefined
                    }
                    onDoubleClick={() => {
                        if (geminiWidgetEstado === 'sem-cota') marcarGeminiCotaEsgotada(false)
                    }}
                    aria-label={
                        geminiWidgetEstado === 'pausa'
                            ? `Gemini em descanso, ${formatarTimerDescansoGeminiLive(geminiMsRestantes)} restantes`
                            : geminiWidgetEstado === 'sem-cota'
                              ? 'Gemini sem cota; coleta via OpenStreetMap'
                              : 'Gemini pronto para tentativa na coleta'
                    }
                >
                    <span className="cred_prospectos_osm_gemini_descanso_live_titulo">Gemini</span>
                    <span className="cred_prospectos_osm_gemini_descanso_live_sub">
                        {geminiWidgetEstado === 'checando'
                            ? 'verificando'
                            : geminiWidgetEstado === 'pausa'
                              ? 'descanso'
                              : geminiWidgetEstado === 'sem-cota'
                                ? 'sem cota'
                                : 'pronto'}
                    </span>
                    <span className="cred_prospectos_osm_gemini_descanso_live_valor" key={geminiDescansoTick}>
                        {geminiWidgetEstado === 'checando'
                            ? '…'
                            : geminiWidgetEstado === 'pausa'
                              ? formatarTimerDescansoGeminiLive(geminiMsRestantes)
                              : geminiWidgetEstado === 'sem-cota'
                                ? 'OSM'
                                : '—'}
                    </span>
                </aside>
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
                    <label className="cred_prospectos_osm_toggle_mapa">
                        <input
                            type="checkbox"
                            checked={mostrarMapa}
                            onChange={(e) => setMostrarMapa(e.target.checked)}
                        />
                        Mostrar mapa
                    </label>
                </div>
            </div>

            <div
                ref={layoutRef}
                className={`cred_prospectos_osm_layout${mostrarMapa ? '' : ' cred_prospectos_osm_layout--sem-mapa'}`}
                style={
                    mostrarMapa
                        ? ({ '--cred-prospectos-split-pct': `${splitListaPct}%` })
                        : undefined
                }
            >
                <section className="cred_prospectos_osm_lista" aria-label="Lista de prospectos">
                    <h3 className="cred_prospectos_osm_lista_titulo">Prospectos</h3>
                    <div className="cred_prospectos_osm_tabela_wrap">
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
                                    </tr>
                                </thead>
                                <tbody>
                                    {itensOrdenados.map((row) => (
                                        <tr
                                            key={row.id}
                                            className={destaqueId === row.id ? 'is-destaque' : ''}
                                            onClick={() => setDestaqueId(row.id)}
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
                                <MapaRedimensionar dep={splitListaPct} />
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
        </div>
    )
}

export default CredenciamentoProspectosOsm
