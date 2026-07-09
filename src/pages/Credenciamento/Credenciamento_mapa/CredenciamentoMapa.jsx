import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Popup, useMapEvents, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../../../lib/supabase'
import {
    atualizarCoordenadasPrestadorManual,
    coordenadasValidasBrasil,
    filtrarPrestadoresParaMapaEndereco,
    parseCoordenadaEntrada,
} from '../../../lib/credenciamento/prestadorEnderecoGeocode'
import { geocodificarEnderecoNominatim, buscarSugestoesNominatim } from '../../../lib/credenciamento/geocodeNominatim'
import {
    formatarLocalidadeMarcador,
    montarIndiceLocalidadesMarcadores,
    sugerirLocalidadesCadastroMapa,
} from '../../../lib/credenciamento/mapaBuscaSugestoes'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import {
    montarEstabelecimentoPorVeterinarioDeListas,
    resolverLocalidadeEfetivaPrestador,
} from '../../../lib/prestadorLocalidadeVinculo.js'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    hasStoredDevTools,
    useStoredPermission,
} from '../../../lib/accessControl'
import { useDevToolsUi } from '../../../lib/devToolsUi'
import { resolverEmojiMapaEspecialidade } from '../../../lib/credenciamento/mapaEspecialidadeIcones'
import { iconeLeafletEmojiMapa } from '../../../lib/credenciamento/mapaPinEmojiLeaflet'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoMapa.css'
import 'leaflet/dist/leaflet.css'

const CORES = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a3a3', '#7f8c8d', '#6d4c41']
const CENTRO_PADRAO_RS = [-29.7, -53.2]
const ZOOM_PADRAO_MAPA = 7

const pinEdicao = new L.Icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
})

const normalizarNum = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

const coordenadaValida = (lat, lng) => lat != null && lng != null && coordenadasValidasBrasil(lat, lng)

function MapClickParaCoordenadas({ ativo, onPick }) {
    useMapEvents({
        click(e) {
            if (!ativo) return
            onPick(e.latlng.lat, e.latlng.lng)
        },
    })
    return null
}

function MapaFlyPara({ alvo }) {
    const map = useMap()
    useEffect(() => {
        if (!alvo || !Number.isFinite(alvo.lat) || !Number.isFinite(alvo.lng)) return
        map.flyTo([alvo.lat, alvo.lng], alvo.zoom ?? 14, { duration: 0.7 })
    }, [alvo, map])
    return null
}

function textoMarcadorParaBusca(m) {
    return [
        m.nome,
        m.especialidadeNome,
        m.cidade,
        m.uf,
        m.bairro,
        m.logradouro,
        m.numero,
        m.raw?.cep,
    ]
        .filter(Boolean)
        .join(' ')
}

function marcadorCombinaBusca(m, termoNorm) {
    if (!termoNorm) return true
    return normalizarTextoBusca(textoMarcadorParaBusca(m)).includes(termoNorm)
}

function marcadorNomeMatchExato(m, termoNorm) {
    if (!termoNorm) return false
    return normalizarTextoBusca(m.nome) === termoNorm
}

function distanciaKm(lat1, lng1, lat2, lng2) {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

function usePopupAutoFechar(markerRef) {
    useEffect(() => {
        const marker = markerRef.current
        if (!marker) return undefined
        let timer
        const onPopupOpen = () => {
            window.clearTimeout(timer)
            timer = window.setTimeout(() => marker.closePopup(), TOAST_AUTO_DISMISS_MS)
        }
        const onPopupClose = () => window.clearTimeout(timer)
        marker.on('popupopen', onPopupOpen)
        marker.on('popupclose', onPopupClose)
        return () => {
            marker.off('popupopen', onPopupOpen)
            marker.off('popupclose', onPopupClose)
            window.clearTimeout(timer)
        }
    }, [markerRef])
}

function MarcadorCredenciadoMapa({ m, destaque, cor, emoji }) {
    const markerRef = useRef(null)
    usePopupAutoFechar(markerRef)
    return (
        <Marker
            ref={markerRef}
            position={[m.lat, m.lng]}
            icon={iconeLeafletEmojiMapa(emoji, cor, { destaque })}
            zIndexOffset={destaque ? 500 : 0}
        >
            <Popup>
                <strong>{m.nome}</strong>
                <br />
                {m.especialidadeNome}
                <br />
                {[m.logradouro, m.numero, m.bairro].filter(Boolean).join(', ')}
                <br />
                {[m.cidade, m.uf].filter(Boolean).join(' / ')}
            </Popup>
        </Marker>
    )
}

function PinBuscaTemporarioMapa({ pin }) {
    const markerRef = useRef(null)
    usePopupAutoFechar(markerRef)
    useEffect(() => {
        const marker = markerRef.current
        if (!marker || !pin) return
        marker.openPopup()
    }, [pin])
    if (!pin) return null
    return (
        <Marker ref={markerRef} position={[pin.lat, pin.lng]} icon={pinEdicao} zIndexOffset={800}>
            <Popup>
                <strong>Local buscado</strong>
                <br />
                {pin.rotulo}
            </Popup>
        </Marker>
    )
}

const CredenciamentoMapa = () => {
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [dados, setDados] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidadeAtiva, setEspecialidadeAtiva] = useState('')
    const [editandoId, setEditandoId] = useState(null)
    const [latInput, setLatInput] = useState('')
    const [lngInput, setLngInput] = useState('')
    const [salvandoCoord, setSalvandoCoord] = useState(false)
    const [modoCliqueMapa, setModoCliqueMapa] = useState(false)
    const [buscaLegenda, setBuscaLegenda] = useState('')
    const [especialidadesExpandidas, setEspecialidadesExpandidas] = useState({})
    const [flyAlvo, setFlyAlvo] = useState(null)
    const [marcadorDestaqueId, setMarcadorDestaqueId] = useState(null)
    const [pinBuscaTemp, setPinBuscaTemp] = useState(null)
    const buscaMapaInicialRef = useRef(true)
    const [buscaFocada, setBuscaFocada] = useState(false)
    const [sugestoesNominatim, setSugestoesNominatim] = useState([])
    const buscaWrapRef = useRef(null)

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : true
    }, [])

    const podeDevToolPerfil = useStoredPermission(PERMISSION_KEYS.DEV_TOOLS)
    const { ui: devToolsUi } = useDevToolsUi()
    const mostrarCoordenadasDev =
        hasStoredDevTools() && podeDevToolPerfil && devToolsUi.colunasCadastro?.coordenadasMapa
    const podeEditarCoordenadasMapa = !somenteLeitura || mostrarCoordenadasDev

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [
                { data: prestadoresData, error: errP },
                { data: especialidadesData, error: errE },
                { data: situacoesData, error: errS },
                { data: peEst, error: errPe },
            ] = await Promise.all([
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, especialidade_id, situacao_id, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, latitude, longitude',
                        )
                        .eq('ativo', true),
                    supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                    supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
                    supabase.from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal'),
                ])
            const erros = [errP, errE, errS, errPe].map((e) => e?.message).filter(Boolean)
            if (erros.length) {
                setErro(erros.join(' | '))
                return
            }
            setDados(prestadoresData || [])
            setPrestadorEstabelecimentos(peEst || [])
            setEspecialidades(especialidadesData || [])
            setSituacoes(situacoesData || [])
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const espPorId = useMemo(() => new Map((especialidades || []).map((e) => [Number(e.id), e.nome || ''])), [especialidades])

    const estabelecimentoPorVeterinario = useMemo(
        () => montarEstabelecimentoPorVeterinarioDeListas(dados, prestadorEstabelecimentos),
        [dados, prestadorEstabelecimentos],
    )

    const credenciadosLocal = useMemo(
        () =>
            filtrarPrestadoresParaMapaEndereco(dados, especialidades, {
                apenasLocal: true,
                apenasCredenciados: true,
                situacoes,
            }),
        [dados, especialidades, situacoes],
    )

    const semCoordenadas = useMemo(
        () =>
            credenciadosLocal
                .filter((p) => !coordenadaValida(normalizarNum(p.latitude), normalizarNum(p.longitude)))
                .map((p) => {
                    const { prestador: pLoc } = resolverLocalidadeEfetivaPrestador(p, estabelecimentoPorVeterinario)
                    return {
                    id: Number(p.id),
                    nome: p.nome || `#${p.id}`,
                    especialidade: espPorId.get(Number(p.especialidade_id)) || '—',
                    cidade: pLoc.endereco_cidade || '',
                    uf: pLoc.endereco_uf || '',
                    endereco: p.endereco_logradouro || p.endereco || '',
                }
                })
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
        [credenciadosLocal, espPorId, estabelecimentoPorVeterinario],
    )

    const marcadores = useMemo(() => {
        return credenciadosLocal
            .map((p) => {
                const lat = normalizarNum(p.latitude)
                const lng = normalizarNum(p.longitude)
                const { prestador: pLoc } = resolverLocalidadeEfetivaPrestador(p, estabelecimentoPorVeterinario)
                return {
                    id: Number(p.id),
                    nome: p.nome || `#${p.id}`,
                    lat,
                    lng,
                    especialidadeId: Number(p.especialidade_id),
                    especialidadeNome: espPorId.get(Number(p.especialidade_id)) || 'Sem especialidade',
                    cidade: pLoc.endereco_cidade || '',
                    uf: pLoc.endereco_uf || '',
                    logradouro: p.endereco_logradouro || p.endereco || '',
                    numero: p.endereco_numero || '',
                    bairro: p.endereco_bairro || '',
                    raw: p,
                }
            })
            .filter((p) => coordenadaValida(p.lat, p.lng))
    }, [credenciadosLocal, espPorId, estabelecimentoPorVeterinario])

    const especialidadesMapa = useMemo(() => {
        const mapa = new Map()
        marcadores.forEach((m) => {
            if (!mapa.has(m.especialidadeId)) {
                mapa.set(m.especialidadeId, {
                    id: m.especialidadeId,
                    nome: m.especialidadeNome,
                    itens: [],
                })
            }
            mapa.get(m.especialidadeId).itens.push(m)
        })
        return [...mapa.values()]
            .map((esp) => ({
                ...esp,
                itens: [...esp.itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    }, [marcadores])

    const termoBuscaLegenda = useMemo(() => normalizarTextoBusca(buscaLegenda), [buscaLegenda])

    const especialidadesFiltradas = useMemo(() => {
        if (!termoBuscaLegenda) return especialidadesMapa
        return especialidadesMapa
            .map((esp) => {
                const nomeEsp = normalizarTextoBusca(esp.nome)
                const itens = esp.itens.filter((it) => marcadorCombinaBusca(it, termoBuscaLegenda))
                if (nomeEsp.includes(termoBuscaLegenda)) return esp
                if (itens.length) return { ...esp, itens }
                return null
            })
            .filter(Boolean)
    }, [especialidadesMapa, termoBuscaLegenda])

    const todasEspecialidadesLegendaExpandidas = useMemo(() => {
        if (!especialidadesFiltradas.length) return false
        return especialidadesFiltradas.every((esp) => !!especialidadesExpandidas[esp.id])
    }, [especialidadesFiltradas, especialidadesExpandidas])

    const alternarExpandirTodasEspecialidadesLegenda = useCallback(() => {
        setEspecialidadesExpandidas((prev) => {
            const expandir = !especialidadesFiltradas.every((esp) => !!prev[esp.id])
            const next = { ...prev }
            for (const esp of especialidadesFiltradas) {
                next[esp.id] = expandir
            }
            return next
        })
    }, [especialidadesFiltradas])

    const marcadoresVisiveis = useMemo(() => {
        if (!especialidadeAtiva) return marcadores
        return marcadores.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
    }, [marcadores, especialidadeAtiva])

    /** Credenciados que batem com o texto da busca — só para centralizar o mapa; não esconde os demais pins. */
    const marcadoresAlvoBusca = useMemo(() => {
        if (!termoBuscaLegenda) return []
        let list = marcadores
        if (especialidadeAtiva) {
            list = list.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
        }
        const porNomeExato = list.filter((m) => marcadorNomeMatchExato(m, termoBuscaLegenda))
        if (porNomeExato.length) return porNomeExato
        return list.filter((m) => marcadorCombinaBusca(m, termoBuscaLegenda))
    }, [marcadores, especialidadeAtiva, termoBuscaLegenda])

    const credenciadosNomeExato = useMemo(() => {
        if (!termoBuscaLegenda) return []
        return marcadores.filter((m) => marcadorNomeMatchExato(m, termoBuscaLegenda))
    }, [marcadores, termoBuscaLegenda])

    const marcadoresProximosBusca = useMemo(() => {
        if (!pinBuscaTemp || !termoBuscaLegenda || marcadoresAlvoBusca.length > 0) return []
        let base = marcadores
        if (especialidadeAtiva) {
            base = base.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
        }
        return [...base]
            .map((m) => ({
                ...m,
                distanciaKm: distanciaKm(pinBuscaTemp.lat, pinBuscaTemp.lng, m.lat, m.lng),
            }))
            .sort((a, b) => a.distanciaKm - b.distanciaKm || a.nome.localeCompare(b.nome, 'pt-BR'))
            .slice(0, 8)
    }, [pinBuscaTemp, termoBuscaLegenda, marcadoresAlvoBusca.length, marcadores, especialidadeAtiva])

    const indiceLocalidades = useMemo(() => montarIndiceLocalidadesMarcadores(marcadores), [marcadores])

    const sugestoesLocalidadesCadastro = useMemo(
        () => sugerirLocalidadesCadastroMapa(indiceLocalidades, buscaLegenda, { limite: 5 }),
        [indiceLocalidades, buscaLegenda],
    )

    const temCredenciadoNaBusca = marcadoresAlvoBusca.length > 0

    const sugestoesNominatimVisiveis = temCredenciadoNaBusca ? [] : sugestoesNominatim

    const mostrarPainelSugestoes =
        buscaFocada &&
        String(buscaLegenda || '').trim().length >= 2 &&
        !temCredenciadoNaBusca &&
        (sugestoesLocalidadesCadastro.length > 0 || sugestoesNominatimVisiveis.length > 0)

    const corPorEspecialidade = useMemo(() => {
        const m = new Map()
        especialidadesMapa.forEach((esp, idx) => m.set(esp.id, CORES[idx % CORES.length]))
        return m
    }, [especialidadesMapa])

    const emojiPorEspecialidade = useMemo(() => {
        const m = new Map()
        especialidadesMapa.forEach((esp) => {
            m.set(esp.id, resolverEmojiMapaEspecialidade(esp.nome))
        })
        return m
    }, [especialidadesMapa])

    const prestadorEmEdicao = useMemo(
        () => credenciadosLocal.find((p) => Number(p.id) === Number(editandoId)) || null,
        [credenciadosLocal, editandoId],
    )

    const selecionarParaEdicao = (id) => {
        const p = credenciadosLocal.find((x) => Number(x.id) === Number(id))
        setEditandoId(Number(id))
        setMarcadorDestaqueId(Number(id))
        setLatInput(p?.latitude != null ? String(p.latitude) : '')
        setLngInput(p?.longitude != null ? String(p.longitude) : '')
        setModoCliqueMapa(true)
        setFeedback('')
        const la = normalizarNum(p?.latitude)
        const lo = normalizarNum(p?.longitude)
        if (coordenadaValida(la, lo)) {
            setFlyAlvo({ lat: la, lng: lo, zoom: 15, seq: Date.now() })
        }
    }

    const irParaCredenciadoNoMapa = (it) => {
        if (!coordenadaValida(it.lat, it.lng)) return
        setMarcadorDestaqueId(it.id)
        setEspecialidadeAtiva(String(it.especialidadeId))
        setFlyAlvo({ lat: it.lat, lng: it.lng, zoom: 15, seq: Date.now() })
    }

    const aplicarSugestaoLocalidade = (rotulo, lat, lng, { temporario = false } = {}) => {
        setBuscaLegenda(rotulo)
        setBuscaFocada(false)
        setSugestoesNominatim([])
        setMarcadorDestaqueId(null)
        if (temporario && coordenadasValidasBrasil(lat, lng)) {
            setPinBuscaTemp({
                lat,
                lng,
                rotulo,
                seq: Date.now(),
            })
            setFlyAlvo({ lat, lng, zoom: 12, seq: Date.now() })
            return
        }
        if (coordenadasValidasBrasil(lat, lng)) {
            setPinBuscaTemp(null)
            setFlyAlvo({ lat, lng, zoom: 12, seq: Date.now() })
        }
    }

    const BUSCA_MAPA_DELAY_MS = 400
    const BUSCA_SUGESTOES_DELAY_MS = 350

    useEffect(() => {
        const bruto = String(buscaLegenda || '').trim()
        if (bruto.length < 2) {
            setSugestoesNominatim([])
            return
        }
        const termo = normalizarTextoBusca(bruto)
        let list = marcadores
        if (especialidadeAtiva) {
            list = list.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
        }
        if (list.some((m) => marcadorCombinaBusca(m, termo))) {
            setSugestoesNominatim([])
            return
        }
        let cancelado = false
        const t = window.setTimeout(() => {
            void (async () => {
                const r = await buscarSugestoesNominatim(bruto, { limite: 4 })
                if (cancelado) return
                if (r.ok) setSugestoesNominatim(r.itens || [])
                else setSugestoesNominatim([])
            })()
        }, BUSCA_SUGESTOES_DELAY_MS)
        return () => {
            cancelado = true
            window.clearTimeout(t)
        }
    }, [buscaLegenda, marcadores, especialidadeAtiva])

    useEffect(() => {
        if (!termoBuscaLegenda) return
        setEspecialidadesExpandidas((prev) => {
            const next = { ...prev }
            for (const esp of especialidadesFiltradas) {
                next[esp.id] = true
            }
            return next
        })
    }, [termoBuscaLegenda, especialidadesFiltradas])

    useEffect(() => {
        if (!termoBuscaLegenda) return
        if (credenciadosNomeExato.length === 1) {
            setMarcadorDestaqueId(credenciadosNomeExato[0].id)
        }
    }, [termoBuscaLegenda, credenciadosNomeExato])

    useEffect(() => {
        const onDocClick = (e) => {
            if (!buscaWrapRef.current) return
            if (!buscaWrapRef.current.contains(e.target)) setBuscaFocada(false)
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [])

    useEffect(() => {
        const bruto = String(buscaLegenda || '').trim()
        if (!bruto) {
            setPinBuscaTemp(null)
            if (buscaMapaInicialRef.current) {
                buscaMapaInicialRef.current = false
                return
            }
            setFlyAlvo({
                lat: CENTRO_PADRAO_RS[0],
                lng: CENTRO_PADRAO_RS[1],
                zoom: ZOOM_PADRAO_MAPA,
                seq: Date.now(),
            })
            return
        }

        let cancelado = false

        const t = window.setTimeout(() => {
            if (marcadoresAlvoBusca.length > 0) {
                setErro('')
                setPinBuscaTemp(null)
                const latMedia =
                    marcadoresAlvoBusca.reduce((acc, m) => acc + m.lat, 0) / marcadoresAlvoBusca.length
                const lngMedia =
                    marcadoresAlvoBusca.reduce((acc, m) => acc + m.lng, 0) / marcadoresAlvoBusca.length
                setFlyAlvo({
                    lat: latMedia,
                    lng: lngMedia,
                    zoom: marcadoresAlvoBusca.length === 1 ? 15 : 11,
                    seq: Date.now(),
                })
                return
            }

            if (bruto.length < 3) {
                setPinBuscaTemp(null)
                return
            }

            void (async () => {
                try {
                    const r = await geocodificarEnderecoNominatim(`${bruto}, Brasil`)
                    if (cancelado) return
                    if (!r.ok) {
                        setPinBuscaTemp(null)
                        setErro(r.erro || 'Local não encontrado.')
                        return
                    }
                    if (!coordenadasValidasBrasil(r.latitude, r.longitude)) {
                        setPinBuscaTemp(null)
                        setErro('Local encontrado está fora da área do mapa (Brasil).')
                        return
                    }
                    setErro('')
                    setMarcadorDestaqueId(null)
                    setPinBuscaTemp({
                        lat: r.latitude,
                        lng: r.longitude,
                        rotulo: r.rotuloCurto || r.displayName || bruto,
                        seq: Date.now(),
                    })
                    setFlyAlvo({ lat: r.latitude, lng: r.longitude, zoom: 12, seq: Date.now() })
                } catch (e) {
                    if (!cancelado) {
                        setPinBuscaTemp(null)
                        setErro(e?.message || String(e))
                    }
                }
            })()
        }, BUSCA_MAPA_DELAY_MS)

        return () => {
            cancelado = true
            window.clearTimeout(t)
        }
    }, [buscaLegenda, marcadoresAlvoBusca])

    const salvarCoordenadas = async () => {
        if (!podeEditarCoordenadasMapa || !editandoId || !prestadorEmEdicao) return
        setSalvandoCoord(true)
        setFeedback('')
        setErro('')
        try {
            await atualizarCoordenadasPrestadorManual(supabase, editandoId, latInput, lngInput, prestadorEmEdicao)
            setFeedback('Coordenadas salvas.')
            setModoCliqueMapa(false)
            setEditandoId(null)
            await carregar()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setSalvandoCoord(false)
        }
    }

    const previewLat = parseCoordenadaEntrada(latInput)
    const previewLng = parseCoordenadaEntrada(lngInput)

    return (
        <div className="credenciamento_main credenciamento_mapa_page">
            <div className="credenciamento_mapa_top">
            <h1>Mapa de credenciados</h1>
            <p className="pcad_muted credenciamento_mapa_import_link">
                <Link to="/credenciamento/import-kmz" className="credenciamento_main_action_btn secondary">
                    Importar coordenadas (KMZ)
                </Link>
            </p>
            <hr />

            {semCoordenadas.length > 0 && (
                <CredenciamentoMainAlert
                    className="credenciamento_mapa_alert_sem_coord"
                    role="status"
                    persist
                    message={
                        <>
                            <strong>{semCoordenadas.length}</strong> credenciado(s) LOCAL com endereço, mas{' '}
                            <strong>sem latitude/longitude válidas</strong> no mapa. Selecione abaixo para preencher.
                        </>
                    }
                />
            )}

            <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            <CredenciamentoMainAlert message={feedback} onClose={() => setFeedback('')} role="status" />

            <div className="credenciamento_mapa_header">
                <div className="credenciamento_mapa_kpi">
                    <strong>{marcadores.length}</strong> com coordenadas
                </div>
                {semCoordenadas.length > 0 ? (
                    <div className="credenciamento_mapa_kpi credenciamento_mapa_kpi_warn">
                        <strong>{semCoordenadas.length}</strong> sem coordenadas
                    </div>
                ) : null}
                <div className="credenciamento_mapa_kpi">
                    <strong>{especialidadesMapa.length}</strong> especialidade(s) no mapa
                </div>
                <label className="credenciamento_mapa_filtro">
                    Especialidade
                    <select
                        className="credenciamento_main_select"
                        value={especialidadeAtiva}
                        onChange={(e) => {
                            setEspecialidadeAtiva(e.target.value)
                        }}
                    >
                        <option value="">Todas</option>
                        {especialidadesMapa.map((esp) => (
                            <option key={esp.id} value={esp.id}>
                                {esp.nome} ({esp.itens.length})
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            </div>

            <div className="credenciamento_mapa_layout">
                <aside className="credenciamento_mapa_legenda">
                    <div className="credenciamento_mapa_legenda_titulo">
                        <h3>Especialidades</h3>
                        {especialidadesFiltradas.length > 0 ? (
                            <button
                                type="button"
                                className="credenciamento_mapa_legenda_expand_tudo_btn"
                                title={
                                    todasEspecialidadesLegendaExpandidas
                                        ? 'Recolher todas as listas'
                                        : 'Expandir todas as listas'
                                }
                                aria-expanded={todasEspecialidadesLegendaExpandidas}
                                aria-label={
                                    todasEspecialidadesLegendaExpandidas
                                        ? 'Recolher todas as especialidades'
                                        : 'Expandir todas as especialidades'
                                }
                                onClick={alternarExpandirTodasEspecialidadesLegenda}
                            >
                                <span
                                    className={`credenciamento_mapa_legenda_chevron ${
                                        todasEspecialidadesLegendaExpandidas ? 'is-open' : ''
                                    }`}
                                />
                            </button>
                        ) : null}
                    </div>
                    <div className="credenciamento_mapa_busca_wrap" ref={buscaWrapRef}>
                        <input
                            className="credenciamento_main_input credenciamento_mapa_busca_especialidade"
                            placeholder="Estabelecimento, cidade, bairro, CEP, UF…"
                            value={buscaLegenda}
                            autoComplete="off"
                            onFocus={() => setBuscaFocada(true)}
                            onChange={(e) => setBuscaLegenda(e.target.value)}
                        />
                        {mostrarPainelSugestoes ? (
                            <div className="credenciamento_mapa_sugestoes" role="listbox">
                                {sugestoesLocalidadesCadastro.length > 0 ? (
                                    <div className="credenciamento_mapa_sugestoes_sec">
                                        <p className="credenciamento_mapa_sugestoes_tit">
                                            Localidades (rede)
                                        </p>
                                        <ul>
                                            {sugestoesLocalidadesCadastro.map((loc) => (
                                                <li key={`sug-loc-${loc.rotulo}`}>
                                                    <button
                                                        type="button"
                                                        className="credenciamento_mapa_sugestao_btn"
                                                        onClick={() =>
                                                            aplicarSugestaoLocalidade(
                                                                loc.rotulo,
                                                                loc.lat,
                                                                loc.lng,
                                                            )
                                                        }
                                                    >
                                                        <span className="credenciamento_mapa_sugestao_icone">
                                                            📍
                                                        </span>
                                                        <span className="credenciamento_mapa_sugestao_txt">
                                                            <strong>{loc.rotulo}</strong>
                                                            <span>Credenciados nesta região</span>
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                                {sugestoesNominatimVisiveis.length > 0 ? (
                                    <div className="credenciamento_mapa_sugestoes_sec">
                                        <p className="credenciamento_mapa_sugestoes_tit">
                                            Lugares fora da rede
                                        </p>
                                        <ul>
                                            {sugestoesNominatimVisiveis.map((loc, idx) => (
                                                <li key={`sug-nom-${idx}-${loc.rotulo}`}>
                                                    <button
                                                        type="button"
                                                        className="credenciamento_mapa_sugestao_btn"
                                                        onClick={() =>
                                                            aplicarSugestaoLocalidade(
                                                                loc.rotulo,
                                                                loc.lat,
                                                                loc.lng,
                                                                { temporario: true },
                                                            )
                                                        }
                                                    >
                                                        <span className="credenciamento_mapa_sugestao_icone">
                                                            🗺️
                                                        </span>
                                                        <span className="credenciamento_mapa_sugestao_txt">
                                                            <strong>{loc.rotulo}</strong>
                                                            <span>
                                                                {loc.ehPoiOuComercio
                                                                    ? 'Comércio ou local (não credenciado) · '
                                                                    : ''}
                                                                {loc.rotuloCompleto}
                                                            </span>
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    {especialidadesFiltradas.length === 0 ? (
                        marcadoresProximosBusca.length > 0 ? (
                            <div className="credenciamento_mapa_proximos">
                                <p className="pcad_muted credenciamento_mapa_proximos_tit">
                                    Locais mais próximos de {pinBuscaTemp?.rotulo || buscaLegenda}:
                                </p>
                                <ul className="credenciamento_mapa_proximos_lista">
                                    {marcadoresProximosBusca.map((m) => (
                                        <li key={`prox-${m.id}`}>
                                            <button
                                                type="button"
                                                className="credenciamento_mapa_proximos_btn"
                                                onClick={() => irParaCredenciadoNoMapa(m)}
                                            >
                                                <strong>{m.nome}</strong>
                                                <span>
                                                    {formatarLocalidadeMarcador(m)} · {m.distanciaKm.toFixed(1)} km
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="pcad_muted">Sem coordenadas para exibir no mapa.</p>
                        )
                    ) : (
                        especialidadesFiltradas.map((esp) => {
                            const expandido = !!especialidadesExpandidas[esp.id]
                            const cor = corPorEspecialidade.get(esp.id) || '#999'
                            const emojiEsp = emojiPorEspecialidade.get(esp.id) || resolverEmojiMapaEspecialidade(esp.nome)
                            return (
                                <div key={esp.id} className="credenciamento_mapa_legenda_bloco">
                                    <div
                                        className={`credenciamento_mapa_legenda_item ${
                                            String(especialidadeAtiva) === String(esp.id) ? 'is-active' : ''
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            className="credenciamento_mapa_legenda_corpo"
                                            onClick={() => {
                                                setEspecialidadeAtiva((atual) =>
                                                    String(atual) === String(esp.id) ? '' : String(esp.id),
                                                )
                                            }}
                                        >
                                            <span
                                                className="credenciamento_mapa_legenda_emoji"
                                                style={{ borderColor: cor }}
                                                title={esp.nome}
                                            >
                                                {emojiEsp}
                                            </span>
                                            <span className="credenciamento_mapa_legenda_nome">{esp.nome}</span>
                                        </button>
                                        <div className="credenciamento_mapa_legenda_qtd_expand">
                                            <span className="credenciamento_mapa_legenda_qtd">{esp.itens.length}</span>
                                            <button
                                                type="button"
                                                className="credenciamento_mapa_legenda_expand_btn"
                                                style={{ color: cor }}
                                                title={expandido ? 'Ocultar credenciados' : 'Mostrar credenciados'}
                                                aria-expanded={expandido}
                                                aria-label={
                                                    expandido
                                                        ? `Recolher lista de ${esp.nome}`
                                                        : `Expandir lista de ${esp.nome}`
                                                }
                                                onClick={() =>
                                                    setEspecialidadesExpandidas((prev) => ({
                                                        ...prev,
                                                        [esp.id]: !prev[esp.id],
                                                    }))
                                                }
                                            >
                                                <span
                                                    className={`credenciamento_mapa_legenda_chevron ${
                                                        expandido ? 'is-open' : ''
                                                    }`}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                    {expandido && (
                                        <ul className="credenciamento_mapa_legenda_nomes">
                                            {esp.itens.map((it) => {
                                                const matchExato =
                                                    termoBuscaLegenda &&
                                                    marcadorNomeMatchExato(it, termoBuscaLegenda)
                                                return (
                                                <li
                                                    key={`${esp.id}-${it.id}`}
                                                    className={[
                                                        marcadorDestaqueId === it.id ? 'is-destaque' : '',
                                                        matchExato ? 'is-match-exato' : '',
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                >
                                                    <button
                                                        type="button"
                                                        className="credenciamento_mapa_legenda_nome_btn"
                                                        onClick={() => irParaCredenciadoNoMapa(it)}
                                                    >
                                                        <span
                                                            className="credenciamento_mapa_legenda_emoji credenciamento_mapa_legenda_emoji_mini"
                                                            style={{ borderColor: cor }}
                                                        >
                                                            {emojiEsp}
                                                        </span>
                                                        {it.nome}
                                                        {matchExato ? (
                                                            <span className="credenciamento_mapa_match_exato_badge">
                                                                nome exato
                                                            </span>
                                                        ) : null}
                                                    </button>
                                                    {podeEditarCoordenadasMapa ? (
                                                        <button
                                                            type="button"
                                                            className="credenciamento_mapa_legenda_edit_btn"
                                                            title="Editar coordenadas"
                                                            onClick={() => selecionarParaEdicao(it.id)}
                                                        >
                                                            Editar
                                                        </button>
                                                    ) : null}
                                                </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            )
                        })
                    )}

                    {semCoordenadas.length > 0 ? (
                        <>
                            <h3 className="credenciamento_mapa_subtitulo_pend">Sem coordenadas</h3>
                            <ul className="credenciamento_mapa_lista_pend">
                                {semCoordenadas.map((p) => (
                                    <li key={p.id}>
                                        <button
                                            type="button"
                                            className={`credenciamento_mapa_pend_btn ${
                                                editandoId === p.id ? 'is-active' : ''
                                            }`}
                                            onClick={() => selecionarParaEdicao(p.id)}
                                            disabled={!podeEditarCoordenadasMapa}
                                        >
                                            <strong>{p.nome}</strong>
                                            <span>
                                                {p.especialidade} · {[p.cidade, p.uf].filter(Boolean).join('/')}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}

                    {editandoId && prestadorEmEdicao && (
                        <div className="credenciamento_mapa_editor">
                            <p className="credenciamento_mapa_editor_titulo">Preencher: {prestadorEmEdicao.nome}</p>
                            <label className="credenciamento_mapa_editor_label">
                                Latitude
                                <input
                                    className="credenciamento_main_input"
                                    value={latInput}
                                    onChange={(e) => setLatInput(e.target.value)}
                                    disabled={!podeEditarCoordenadasMapa || salvandoCoord}
                                />
                            </label>
                            <label className="credenciamento_mapa_editor_label">
                                Longitude
                                <input
                                    className="credenciamento_main_input"
                                    value={lngInput}
                                    onChange={(e) => setLngInput(e.target.value)}
                                    disabled={!podeEditarCoordenadasMapa || salvandoCoord}
                                />
                            </label>
                            <p className="pcad_muted credenciamento_mapa_editor_hint">
                                {modoCliqueMapa
                                    ? 'Clique no mapa para capturar lat/lng ou digite manualmente.'
                                    : 'Digite as coordenadas ou clique no mapa.'}
                            </p>
                            <div className="credenciamento_mapa_editor_acoes">
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn"
                                    disabled={!podeEditarCoordenadasMapa || salvandoCoord}
                                    onClick={() => void salvarCoordenadas()}
                                >
                                    {salvandoCoord ? 'Salvando…' : 'Salvar coordenadas'}
                                </button>
                                <Link
                                    className="credenciamento_main_action_btn secondary"
                                    to={`/credenciamento/cadastro/${editandoId}`}
                                >
                                    Abrir cadastro
                                </Link>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary"
                                    onClick={() => {
                                        setEditandoId(null)
                                        setModoCliqueMapa(false)
                                    }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}
                </aside>

                <section className="credenciamento_mapa_container">
                    {loading ? (
                        <p>Carregando mapa...</p>
                    ) : (
                        <MapContainer
                            center={CENTRO_PADRAO_RS}
                            zoom={ZOOM_PADRAO_MAPA}
                            scrollWheelZoom
                            className="credenciamento_mapa_leaflet"
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            />
                            <MapClickParaCoordenadas
                                ativo={modoCliqueMapa && podeEditarCoordenadasMapa}
                                onPick={(lat, lng) => {
                                    setLatInput(String(lat))
                                    setLngInput(String(lng))
                                }}
                            />
                            <MapaFlyPara alvo={flyAlvo} />
                            {marcadoresVisiveis.map((m) => {
                                const destaque = marcadorDestaqueId === m.id
                                const cor = corPorEspecialidade.get(m.especialidadeId) || '#2f80ed'
                                const emoji =
                                    emojiPorEspecialidade.get(m.especialidadeId) ||
                                    resolverEmojiMapaEspecialidade(m.especialidadeNome)
                                return (
                                    <MarcadorCredenciadoMapa
                                        key={m.id}
                                        m={m}
                                        destaque={destaque}
                                        cor={cor}
                                        emoji={emoji}
                                    />
                                )
                            })}
                            <PinBuscaTemporarioMapa pin={pinBuscaTemp} />
                            {previewLat != null && previewLng != null && editandoId ? (
                                <Marker position={[previewLat, previewLng]} icon={pinEdicao} />
                            ) : null}
                        </MapContainer>
                    )}
                </section>
            </div>
        </div>
    )
}

export default CredenciamentoMapa
