import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Popup, useMapEvents, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../../../lib/supabase'
import {
    atualizarCoordenadasPrestadorManual,
    coordenadasValidasBrasil,
    especialidadePorIdMap,
    filtrarPrestadoresParaMapaEndereco,
    parseCoordenadaEntrada,
} from '../../../lib/credenciamento/prestadorEnderecoGeocode'
import {
    geocodificarEnderecoNominatim,
    buscarSugestoesNominatim,
} from '../../../lib/credenciamento/geocodeNominatim'
import { extrairCepDigitosBuscaMapa, geocodificarCepParaMapa } from '../../../lib/credenciamento/mapaBuscaTermo'
import { filtrarItensNominatimPorTermo } from '../../../lib/credenciamento/mapaBuscaPoi.js'
import {
    formatarLocalidadeMarcador,
    montarIndiceLocalidadesMarcadores,
    sugerirLocalidadesCadastroMapa,
} from '../../../lib/credenciamento/mapaBuscaSugestoes'
import { normalizarTextoBusca, blobContemTermoBusca } from '../../../lib/prestadorCadastroHelpers'
import {
    montarEstabelecimentoPorVeterinarioDeListas,
    resolverLocalidadeEfetivaPrestador,
} from '../../../lib/prestadorLocalidadeVinculo.js'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    podeLerFerramenta,
    useStoredAccessProfile,
} from '../../../lib/accessControl'
import { resolverEmojiMapaEspecialidade } from '../../../lib/credenciamento/mapaEspecialidadeIcones'
import { idsEspecialidadesPrestadorLocal, especialidadeCatalogoEhLocal } from '../../../lib/credenciamento/especialidadesPorCidade.js'
import { iconeLeafletEmojiMapa } from '../../../lib/credenciamento/mapaPinEmojiLeaflet'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi'
import { formatarContatoSeTelefone, formatarLinhaTelefonesContato } from '../../../lib/telefoneBrasil.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import { PageHeader } from '../../../components/ui'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoMapa.css'
import 'leaflet/dist/leaflet.css'

const CORES = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a3a3', '#7f8c8d', '#6d4c41']
const CENTRO_PADRAO_RS = [-29.7, -53.2]
const ZOOM_PADRAO_MAPA = 7
/** Raio máximo para listar credenciados «próximos» ao pin de busca (Nominatim / local temporário). */
const RAIO_LOCAIS_PROXIMOS_BUSCA_KM = 5
/** Referência estável — evita reexecutar efeitos quando não há alvos de busca. */
const MARCADORES_ALVO_BUSCA_VAZIO = Object.freeze([])

const pinPoiBusca = new L.DivIcon({
    className: 'cred_mapa_pin_poi_busca_leaflet',
    html: '<div class="cred_mapa_pin_poi_busca" aria-hidden="true"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
})

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

function MapaBoundsObserver({ onBounds }) {
    const map = useMap()
    useEffect(() => {
        const reportar = () => {
            const b = map.getBounds()
            onBounds({
                south: b.getSouth(),
                west: b.getWest(),
                north: b.getNorth(),
                east: b.getEast(),
            })
        }
        reportar()
        map.on('moveend', reportar)
        map.on('zoomend', reportar)
        return () => {
            map.off('moveend', reportar)
            map.off('zoomend', reportar)
        }
    }, [map, onBounds])
    return null
}

function MapaAjustarBounds({ alvo }) {
    const map = useMap()
    useEffect(() => {
        if (!alvo?.seq) return
        const { south, west, north, east } = alvo
        if (![south, west, north, east].every(Number.isFinite)) return
        map.fitBounds(
            [
                [south, west],
                [north, east],
            ],
            { padding: [48, 48], maxZoom: 16, duration: 0.65 },
        )
    }, [alvo, map])
    return null
}

function MapaRedimensionar({ dep }) {
    const map = useMap()
    useEffect(() => {
        const t1 = window.setTimeout(() => map.invalidateSize(), 0)
        const t2 = window.setTimeout(() => map.invalidateSize(), 350)
        return () => {
            window.clearTimeout(t1)
            window.clearTimeout(t2)
        }
    }, [dep, map])
    return null
}

function useMatchMedia(query) {
    const [matches, setMatches] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(query).matches,
    )
    useEffect(() => {
        const mq = window.matchMedia(query)
        const onChange = () => setMatches(mq.matches)
        onChange()
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [query])
    return matches
}

function textoMarcadorParaBusca(m) {
    return [
        m.nome,
        m.especialidadeNome,
        m.especialidadeNomesTodas,
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
    return blobContemTermoBusca(normalizarTextoBusca(textoMarcadorParaBusca(m)), termoNorm)
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

function marcadorTemEspecialidadeAtiva(m, especialidadeAtiva) {
    if (!especialidadeAtiva) return true
    const alvo = Number(especialidadeAtiva)
    return m.especialidadeIds?.has(alvo)
}

function resolverEspecialidadeExibicaoMarcador(m, especialidadeAtiva, espPorId) {
    const principal = Number(m.especialidadeId)
    const ativa = especialidadeAtiva ? Number(especialidadeAtiva) : null
    if (ativa && m.especialidadeIds?.has(ativa)) {
        return {
            id: ativa,
            nome: espPorId.get(ativa) || m.especialidadeNome,
        }
    }
    return { id: principal, nome: m.especialidadeNome }
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

function enderecoLinhaMarcador(m) {
    const log = [m.logradouro, m.numero, m.bairro].filter(Boolean).join(', ')
    const loc = [m.cidade, m.uf].filter(Boolean).join(' / ')
    return [log, loc].filter(Boolean).join(' — ')
}

function PopupBalaoMapa({ titulo, subtitulo, endereco, telefone }) {
    const tel = String(telefone || '').trim()
    const telFmt = tel.includes('·') ? tel : formatarContatoSeTelefone(tel)
    return (
        <>
            <strong>{titulo}</strong>
            {subtitulo ? (
                <>
                    <br />
                    {subtitulo}
                </>
            ) : null}
            {endereco ? (
                <>
                    <br />
                    {endereco}
                </>
            ) : null}
            {telFmt ? (
                <>
                    <br />
                    {telFmt}
                </>
            ) : null}
        </>
    )
}

function MarcadorCredenciadoMapa({ m, destaque, cor, emoji, especialidadePopup }) {
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
                <PopupBalaoMapa
                    titulo={m.nome}
                    subtitulo={especialidadePopup || m.especialidadeNome}
                    endereco={enderecoLinhaMarcador(m)}
                    telefone={m.telefoneContato}
                />
            </Popup>
        </Marker>
    )
}

function tituloPopupPinBusca(pin) {
    if (pin.nome) return pin.nome
    return pin.ehPoi ? 'Local (fora da rede)' : 'Local buscado'
}

function PinsBuscaTemporariosMapa({ pins }) {
    if (!pins?.length) return null
    return pins.map((pin) => (
        <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={pinPoiBusca}
            zIndexOffset={780}
        >
            <Popup>
                <PopupBalaoMapa
                    titulo={tituloPopupPinBusca(pin)}
                    subtitulo={
                        pin.nome && pin.rotulo && pin.rotulo !== pin.nome ? pin.rotulo : ''
                    }
                    endereco={pin.endereco || pin.rotulo || ''}
                    telefone={pin.telefone}
                />
            </Popup>
        </Marker>
    ))
}

const CredenciamentoMapa = () => {
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [dados, setDados] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [prestadorEspecialidades, setPrestadorEspecialidades] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidadeAtiva, setEspecialidadeAtiva] = useState('')
    const [editandoId, setEditandoId] = useState(null)
    const [latInput, setLatInput] = useState('')
    const [lngInput, setLngInput] = useState('')
    const [salvandoCoord, setSalvandoCoord] = useState(false)
    const [modoCliqueMapa, setModoCliqueMapa] = useState(false)
    const [buscaLegenda, setBuscaLegenda] = useState('')
    const [buscaGeocodeSubmetida, setBuscaGeocodeSubmetida] = useState('')
    const [especialidadesExpandidas, setEspecialidadesExpandidas] = useState({})
    const [flyAlvo, setFlyAlvo] = useState(null)
    const [marcadorDestaqueId, setMarcadorDestaqueId] = useState(null)
    const [pinsBuscaTemp, setPinsBuscaTemp] = useState([])
    const mapViewBoundsRef = useRef(null)
    const [fitBoundsAlvo, setFitBoundsAlvo] = useState(null)
    const onMapBounds = useCallback((b) => {
        mapViewBoundsRef.current = b
    }, [])
    const buscaMapaInicialRef = useRef(true)
    const [buscaFocada, setBuscaFocada] = useState(false)
    const layoutMobile = useMatchMedia('(max-width: 980px)')
    const [mobileAba, setMobileAba] = useState('mapa')
    const [sugestoesNominatim, setSugestoesNominatim] = useState([])
    const buscaWrapRef = useRef(null)

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : true
    }, [])

    const accessProfile = useStoredAccessProfile()
    const podeImportarKmz = podeLerFerramenta(accessProfile?.permissions, 'credenciamento.import_kmz')

    const podeEditarCoordenadasMapa = !somenteLeitura

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [
                { data: prestadoresData, error: errP },
                { data: especialidadesData, error: errE },
                { data: situacoesData, error: errS },
                { data: peEst, error: errPe },
                { data: peEsp, error: errPeEsp },
            ] = await Promise.all([
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, especialidade_id, situacao_id, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, latitude, longitude, telefone, celular',
                        )
                        .eq('ativo', true),
                    supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                    supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
                    supabase.from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal'),
                    supabase
                        .from('prestador_especialidades')
                        .select('prestador_id, especialidade_id, principal'),
                ])
            const erros = [errP, errE, errS, errPe, errPeEsp].map((e) => e?.message).filter(Boolean)
            if (erros.length) {
                setErro(erros.join(' | '))
                return
            }
            setDados(prestadoresData || [])
            setPrestadorEstabelecimentos(peEst || [])
            setPrestadorEspecialidades(peEsp || [])
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

    const mapaEsp = useMemo(() => especialidadePorIdMap(especialidades), [especialidades])

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

    const linhasEspPorPrestador = useMemo(() => {
        const m = new Map()
        for (const row of prestadorEspecialidades || []) {
            const pid = Number(row.prestador_id)
            if (!pid) continue
            if (!m.has(pid)) m.set(pid, [])
            m.get(pid).push(row)
        }
        return m
    }, [prestadorEspecialidades])

    const marcadores = useMemo(() => {
        return credenciadosLocal
            .map((p) => {
                const lat = normalizarNum(p.latitude)
                const lng = normalizarNum(p.longitude)
                const { prestador: pLoc } = resolverLocalidadeEfetivaPrestador(p, estabelecimentoPorVeterinario)
                const especialidadeIds = idsEspecialidadesPrestadorLocal(
                    p,
                    linhasEspPorPrestador.get(Number(p.id)) || [],
                    mapaEsp,
                )
                const principalCadastro = Number(p.especialidade_id)
                const especialidadeIdExib =
                    especialidadeIds.has(principalCadastro)
                        ? principalCadastro
                        : [...especialidadeIds][0] ?? principalCadastro
                const nomesEsp = [...especialidadeIds]
                    .map((id) => espPorId.get(id))
                    .filter(Boolean)
                if (!especialidadeIds.size) return null
                return {
                    id: Number(p.id),
                    nome: p.nome || `#${p.id}`,
                    lat,
                    lng,
                    especialidadeId: especialidadeIdExib,
                    especialidadeNome: espPorId.get(especialidadeIdExib) || 'Sem especialidade',
                    especialidadeIds,
                    especialidadeNomesTodas: nomesEsp.join(' '),
                    cidade: pLoc.endereco_cidade || '',
                    uf: pLoc.endereco_uf || '',
                    logradouro: p.endereco_logradouro || p.endereco || '',
                    numero: p.endereco_numero || '',
                    bairro: p.endereco_bairro || '',
                    telefoneContato: formatarLinhaTelefonesContato(p.celular, p.telefone),
                    raw: p,
                }
            })
            .filter(Boolean)
            .filter((p) => coordenadaValida(p.lat, p.lng))
    }, [credenciadosLocal, espPorId, estabelecimentoPorVeterinario, linhasEspPorPrestador, mapaEsp])

    const especialidadesMapa = useMemo(() => {
        const mapa = new Map()
        marcadores.forEach((m) => {
            for (const eid of m.especialidadeIds) {
                if (!eid) continue
                const espCat = mapaEsp.get(eid)
                if (!espCat || !especialidadeCatalogoEhLocal(espCat)) continue
                if (!mapa.has(eid)) {
                    mapa.set(eid, {
                        id: eid,
                        nome: espPorId.get(eid) || `Especialidade ${eid}`,
                        itens: [],
                    })
                }
                const grupo = mapa.get(eid)
                if (!grupo.itens.some((it) => it.id === m.id)) {
                    grupo.itens.push(m)
                }
            }
        })
        return [...mapa.values()]
            .map((esp) => ({
                ...esp,
                itens: [...esp.itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    }, [marcadores, espPorId, mapaEsp])

    const termoBuscaLegenda = useMemo(() => normalizarTextoBusca(buscaLegenda), [buscaLegenda])

    const especialidadesFiltradas = useMemo(() => {
        if (!termoBuscaLegenda) return especialidadesMapa
        return especialidadesMapa
            .map((esp) => {
                const nomeEsp = normalizarTextoBusca(esp.nome)
                const itens = esp.itens.filter((it) => marcadorCombinaBusca(it, termoBuscaLegenda))
                if (blobContemTermoBusca(nomeEsp, termoBuscaLegenda)) return esp
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
        return marcadores.filter((m) => marcadorTemEspecialidadeAtiva(m, especialidadeAtiva))
    }, [marcadores, especialidadeAtiva])

    /** Credenciados que batem com o texto da busca — só para centralizar o mapa; não esconde os demais pins. */
    const marcadoresAlvoBusca = useMemo(() => {
        if (!termoBuscaLegenda) return MARCADORES_ALVO_BUSCA_VAZIO
        let list = marcadores
        if (especialidadeAtiva) {
            list = list.filter((m) => marcadorTemEspecialidadeAtiva(m, especialidadeAtiva))
        }
        const cepDigits = extrairCepDigitosBuscaMapa(buscaLegenda)
        if (cepDigits) {
            const porCep = list.filter(
                (m) => String(m.raw?.cep || '').replace(/\D/g, '') === cepDigits,
            )
            if (porCep.length) return porCep
        }
        const porNomeExato = list.filter((m) => marcadorNomeMatchExato(m, termoBuscaLegenda))
        if (porNomeExato.length) return porNomeExato
        return list.filter((m) => marcadorCombinaBusca(m, termoBuscaLegenda))
    }, [marcadores, especialidadeAtiva, termoBuscaLegenda, buscaLegenda])

    const pontoReferenciaBusca = useMemo(() => {
        if (!pinsBuscaTemp.length) return null
        if (pinsBuscaTemp.length === 1) return pinsBuscaTemp[0]
        const lat = pinsBuscaTemp.reduce((acc, p) => acc + p.lat, 0) / pinsBuscaTemp.length
        const lng = pinsBuscaTemp.reduce((acc, p) => acc + p.lng, 0) / pinsBuscaTemp.length
        return {
            lat,
            lng,
            rotulo: buscaLegenda,
        }
    }, [pinsBuscaTemp, buscaLegenda])

    const marcadoresProximosBusca = useMemo(() => {
        if (!pontoReferenciaBusca || !termoBuscaLegenda || marcadoresAlvoBusca.length > 0) return []
        let base = marcadores
        if (especialidadeAtiva) {
            base = base.filter((m) => marcadorTemEspecialidadeAtiva(m, especialidadeAtiva))
        }
        return [...base]
            .map((m) => ({
                ...m,
                distanciaKm: distanciaKm(
                    pontoReferenciaBusca.lat,
                    pontoReferenciaBusca.lng,
                    m.lat,
                    m.lng,
                ),
            }))
            .filter((m) => m.distanciaKm <= RAIO_LOCAIS_PROXIMOS_BUSCA_KM)
            .sort((a, b) => a.distanciaKm - b.distanciaKm || a.nome.localeCompare(b.nome, 'pt-BR'))
            .slice(0, 8)
    }, [
        pontoReferenciaBusca,
        termoBuscaLegenda,
        marcadoresAlvoBusca.length,
        marcadores,
        especialidadeAtiva,
    ])

    const credenciadosNomeExato = useMemo(() => {
        if (!termoBuscaLegenda) return []
        return marcadores.filter((m) => marcadorNomeMatchExato(m, termoBuscaLegenda))
    }, [marcadores, termoBuscaLegenda])

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
        setMobileAba('mapa')
    }

    const irParaCredenciadoNoMapa = (it, especialidadeLegendaId) => {
        if (!coordenadaValida(it.lat, it.lng)) return
        setMobileAba('mapa')
        setMarcadorDestaqueId(it.id)
        const espExibir =
            especialidadeLegendaId != null && it.especialidadeIds?.has(Number(especialidadeLegendaId))
                ? String(especialidadeLegendaId)
                : String(it.especialidadeId)
        setEspecialidadeAtiva(espExibir)
        setFlyAlvo({ lat: it.lat, lng: it.lng, zoom: 15, seq: Date.now() })
    }

    const irParaPinBuscaNoMapa = (pin) => {
        if (!coordenadaValida(pin.lat, pin.lng)) return
        setMobileAba('mapa')
        setMarcadorDestaqueId(null)
        setFlyAlvo({ lat: pin.lat, lng: pin.lng, zoom: 16, seq: Date.now() })
    }

    const onBuscaLegendaChange = (e) => {
        const v = e.target.value
        setBuscaLegenda(v)
        if (!String(v || '').trim()) {
            setBuscaGeocodeSubmetida('')
            setMarcadorDestaqueId(null)
            setErro('')
            setSugestoesNominatim([])
        }
    }

    const executarBuscaGeocodeNoMapa = useCallback(() => {
        const b = String(buscaLegenda || '').trim()
        if (!b) return
        setMobileAba('mapa')
        setBuscaGeocodeSubmetida(b)
        setBuscaFocada(false)
        setSugestoesNominatim([])
    }, [buscaLegenda])

    const onBuscaLegendaKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            executarBuscaGeocodeNoMapa()
        }
    }

    const aplicarSugestaoLocalidade = (
        rotulo,
        lat,
        lng,
        { temporario = false, ehPoi = true, nome = '', telefone = '', endereco = '', horaAtendimento = '' } = {},
    ) => {
        setBuscaLegenda(rotulo)
        setBuscaFocada(false)
        setSugestoesNominatim([])
        setMarcadorDestaqueId(null)
        if (temporario && coordenadasValidasBrasil(lat, lng)) {
            setPinsBuscaTemp([
                {
                    id: `pin-sel-${Date.now()}`,
                    lat,
                    lng,
                    rotulo,
                    ehPoi,
                    nome: nome || '',
                    telefone: telefone || '',
                    endereco: endereco || rotulo,
                    horaAtendimento: horaAtendimento || '',
                },
            ])
            setFlyAlvo({ lat, lng, zoom: 14, seq: Date.now() })
            setMobileAba('mapa')
            return
        }
        if (coordenadasValidasBrasil(lat, lng)) {
            setPinsBuscaTemp([])
            setFlyAlvo({ lat, lng, zoom: 12, seq: Date.now() })
            setMobileAba('mapa')
        }
    }

    const BUSCA_MAPA_DELAY_MS = 400
    const BUSCA_SUGESTOES_DELAY_MS = 700

    useEffect(() => {
        const bruto = String(buscaLegenda || '').trim()
        if (extrairCepDigitosBuscaMapa(bruto)) {
            setSugestoesNominatim([])
            return
        }
        if (bruto.length < 2) {
            setSugestoesNominatim([])
            return
        }
        const termo = normalizarTextoBusca(bruto)
        let list = marcadores
        if (especialidadeAtiva) {
            list = list.filter((m) => marcadorTemEspecialidadeAtiva(m, especialidadeAtiva))
        }
        if (list.some((m) => marcadorCombinaBusca(m, termo))) {
            setSugestoesNominatim([])
            return
        }
        let cancelado = false
        const t = window.setTimeout(() => {
            void (async () => {
                const r = await buscarSugestoesNominatim(bruto, { limite: 8 })
                if (cancelado) return
                if (r.ok) {
                    setSugestoesNominatim(filtrarItensNominatimPorTermo(r.itens || [], bruto))
                } else setSugestoesNominatim([])
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
        if (!String(buscaLegenda || '').trim()) {
            setPinsBuscaTemp([])
            setFitBoundsAlvo(null)
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
        }
    }, [buscaLegenda])

    useEffect(() => {
        if (!marcadoresAlvoBusca.length) return
        const bruto = String(buscaLegenda || '').trim()
        if (!bruto) return
        setErro('')
        setPinsBuscaTemp([])
        setFitBoundsAlvo(null)
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
    }, [buscaLegenda, marcadoresAlvoBusca])

    useEffect(() => {
        const bruto = String(buscaGeocodeSubmetida || '').trim()
        if (!bruto) return

        if (marcadoresAlvoBusca.length > 0) return

        let cancelado = false

        void (async () => {
                try {
                const cepDigits = extrairCepDigitosBuscaMapa(bruto)
                if (cepDigits) {
                        const r = await geocodificarCepParaMapa(cepDigits)
                        if (cancelado) return
                        if (!r.ok) {
                            setPinsBuscaTemp([])
                            setErro(r.erro || 'CEP não encontrado.')
                            return
                        }
                        if (!coordenadasValidasBrasil(r.latitude, r.longitude)) {
                            setPinsBuscaTemp([])
                            setErro('CEP fora da área do mapa (Brasil).')
                            return
                        }
                        setErro('')
                        setMarcadorDestaqueId(null)
                        setPinsBuscaTemp([
                            {
                                id: `cep-${cepDigits}`,
                                lat: r.latitude,
                                lng: r.longitude,
                                rotulo: r.rotulo,
                                ehPoi: false,
                                endereco: r.enderecoLinha || r.rotulo,
                                telefone: r.telefone || '',
                            },
                        ])
                        setFitBoundsAlvo(null)
                        setFlyAlvo({
                            lat: r.latitude,
                            lng: r.longitude,
                            zoom: 16,
                            seq: Date.now(),
                        })
                        return
                    }

                    if (bruto.length < 2) {
                        setPinsBuscaTemp([])
                        return
                    }

                    const r = await geocodificarEnderecoNominatim(`${bruto}, Brasil`)
                    if (cancelado) return
                    if (!r.ok) {
                        setPinsBuscaTemp([])
                        setErro(r.erro || 'Local não encontrado.')
                        return
                    }
                    if (!coordenadasValidasBrasil(r.latitude, r.longitude)) {
                        setPinsBuscaTemp([])
                        setErro('Local encontrado está fora da área do mapa (Brasil).')
                        return
                    }
                    setErro('')
                    setMarcadorDestaqueId(null)
                    setPinsBuscaTemp([
                        {
                            id: `geo-${Date.now()}`,
                            lat: r.latitude,
                            lng: r.longitude,
                            rotulo: r.rotuloCurto || r.displayName || bruto,
                            ehPoi: true,
                            nome: r.nome || '',
                            endereco: r.enderecoLinha || r.displayName || r.rotuloCurto || bruto,
                            telefone: r.telefone || '',
                            horaAtendimento: r.horaAtendimento || '',
                        },
                    ])
                    setFitBoundsAlvo(null)
                    setFlyAlvo({ lat: r.latitude, lng: r.longitude, zoom: 12, seq: Date.now() })
                } catch (e) {
                    if (!cancelado) {
                        setPinsBuscaTemp([])
                        setErro(e?.message || String(e))
                    }
                }
        })()

        return () => {
            cancelado = true
        }
    }, [buscaGeocodeSubmetida, marcadoresAlvoBusca.length])

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
        <div className="el-page credenciamento_main credenciamento_mapa_page">
            <div className="credenciamento_mapa_top">
            <PageHeader
                kicker="Credenciamento"
                title="Mapa de credenciados"
                actions={
                    podeImportarKmz ? (
                        <Link to="/credenciamento/import-kmz" className="credenciamento_main_action_btn secondary min-h-touch">
                            Importar coordenadas (KMZ)
                        </Link>
                    ) : null
                }
            />

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

            <div className="credenciamento_mapa_header flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
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
                <label className="credenciamento_mapa_filtro w-full md:ml-auto md:w-auto">
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

            <div className="credenciamento_mapa_mobile_tabs" role="tablist" aria-label="Alternar mapa e especialidades">
                <button
                    type="button"
                    role="tab"
                    id="cred_mapa_tab_mapa"
                    aria-selected={mobileAba === 'mapa'}
                    aria-controls="cred_mapa_panel_mapa"
                    className={mobileAba === 'mapa' ? 'is-ativo' : ''}
                    onClick={() => setMobileAba('mapa')}
                >
                    Mapa
                </button>
                <button
                    type="button"
                    role="tab"
                    id="cred_mapa_tab_lista"
                    aria-selected={mobileAba === 'lista'}
                    aria-controls="cred_mapa_panel_lista"
                    className={mobileAba === 'lista' ? 'is-ativo' : ''}
                    onClick={() => setMobileAba('lista')}
                >
                    Especialidades
                </button>
            </div>

            <div
                className={`credenciamento_mapa_layout${
                    layoutMobile ? ` credenciamento_mapa_layout--mobile-${mobileAba}` : ''
                }`}
            >
                <aside
                    className="credenciamento_mapa_legenda"
                    id="cred_mapa_panel_lista"
                    role="tabpanel"
                    aria-labelledby="cred_mapa_tab_lista"
                    hidden={layoutMobile && mobileAba !== 'lista' ? true : undefined}
                >
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
                        <CampoBuscaComLimpar
                            inputClassName="credenciamento_main_input credenciamento_mapa_busca_especialidade"
                            placeholder="Estabelecimento, cidade, bairro, CEP, UF…"
                            value={buscaLegenda}
                            autoComplete="off"
                            aria-label="Buscar no mapa"
                            onFocus={() => setBuscaFocada(true)}
                            onChange={onBuscaLegendaChange}
                            onKeyDown={onBuscaLegendaKeyDown}
                        />
                        {pinsBuscaTemp.length > 1 && !temCredenciadoNaBusca ? (
                            <p className="credenciamento_mapa_busca_hint pcad_muted" role="status">
                                {pinsBuscaTemp.length} locais na busca (pins laranja).
                            </p>
                        ) : null}
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
                                                                {
                                                                    temporario: true,
                                                                    ehPoi: loc.ehPoiOuComercio,
                                                                    nome: loc.nome,
                                                                    telefone: loc.telefone,
                                                                    endereco:
                                                                        loc.enderecoLinha ||
                                                                        loc.rotuloCompleto,
                                                                    horaAtendimento: loc.horaAtendimento,
                                                                },
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
                                    Credenciados a até {RAIO_LOCAIS_PROXIMOS_BUSCA_KM} km de{' '}
                                    {pontoReferenciaBusca?.rotulo || buscaLegenda}:
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
                        ) : pontoReferenciaBusca ? (
                            <p className="pcad_muted">
                                Nenhum credenciado a até {RAIO_LOCAIS_PROXIMOS_BUSCA_KM} km de{' '}
                                {pontoReferenciaBusca.rotulo || buscaLegenda}.
                            </p>
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
                                                onClick={() => irParaCredenciadoNoMapa(it, esp.id)}
                                                    >
                                                        <span
                                                            className="credenciamento_mapa_legenda_emoji credenciamento_mapa_legenda_emoji_mini"
                                                            style={{ borderColor: cor }}
                                                        >
                                                            {emojiEsp}
                                                        </span>
                                                        {it.nome}
                                                        {Number(it.especialidadeId) !== Number(esp.id) ? (
                                                            <span className="credenciamento_mapa_tag_esp_secundaria">
                                                                também
                                                            </span>
                                                        ) : null}
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

                <section
                    className="credenciamento_mapa_container min-h-[60vh] md:min-h-[70vh]"
                    id="cred_mapa_panel_mapa"
                    role="tabpanel"
                    aria-labelledby="cred_mapa_tab_mapa"
                    hidden={layoutMobile && mobileAba !== 'mapa' ? true : undefined}
                >
                    {loading ? (
                        <p>Carregando mapa...</p>
                    ) : (
                        <MapContainer
                            center={CENTRO_PADRAO_RS}
                            zoom={ZOOM_PADRAO_MAPA}
                            scrollWheelZoom
                            className="credenciamento_mapa_leaflet"
                        >
                            <MapaRedimensionar dep={layoutMobile ? mobileAba : 'desktop'} />
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
                            <MapaBoundsObserver onBounds={onMapBounds} />
                            <MapaAjustarBounds alvo={fitBoundsAlvo} />
                            {marcadoresVisiveis.map((m) => {
                                const destaque = marcadorDestaqueId === m.id
                                const exib = resolverEspecialidadeExibicaoMarcador(
                                    m,
                                    especialidadeAtiva,
                                    espPorId,
                                )
                                const cor = corPorEspecialidade.get(exib.id) || '#2f80ed'
                                const emoji =
                                    emojiPorEspecialidade.get(exib.id) ||
                                    resolverEmojiMapaEspecialidade(exib.nome)
                                const popupEsp =
                                    especialidadeAtiva &&
                                    Number(especialidadeAtiva) !== Number(m.especialidadeId)
                                        ? `${exib.nome} · principal: ${m.especialidadeNome}`
                                        : m.especialidadeNome
                                return (
                                    <MarcadorCredenciadoMapa
                                        key={m.id}
                                        m={m}
                                        destaque={destaque}
                                        cor={cor}
                                        emoji={emoji}
                                        especialidadePopup={popupEsp}
                                    />
                                )
                            })}
                            <PinsBuscaTemporariosMapa pins={pinsBuscaTemp} />
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
