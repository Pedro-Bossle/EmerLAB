import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, Marker } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../../../lib/supabase'
import {
    atualizarCoordenadasPrestadorManual,
    coordenadasValidasBrasil,
    filtrarPrestadoresParaMapaEndereco,
    parseCoordenadaEntrada,
} from '../../../lib/credenciamento/prestadorEnderecoGeocode'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission } from '../../../lib/accessControl'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoMapa.css'
import 'leaflet/dist/leaflet.css'

const CORES = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a3a3', '#7f8c8d', '#6d4c41']
const CENTRO_PADRAO_RS = [-29.7, -53.2]

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

const CredenciamentoMapa = () => {
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [dados, setDados] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidadeAtiva, setEspecialidadeAtiva] = useState('')
    const [editandoId, setEditandoId] = useState(null)
    const [latInput, setLatInput] = useState('')
    const [lngInput, setLngInput] = useState('')
    const [salvandoCoord, setSalvandoCoord] = useState(false)
    const [modoCliqueMapa, setModoCliqueMapa] = useState(false)
    const [buscaEspecialidade, setBuscaEspecialidade] = useState('')
    const [especialidadesExpandidas, setEspecialidadesExpandidas] = useState({})
    const [centroPadraoAtivo, setCentroPadraoAtivo] = useState(true)

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : true
    }, [])

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [{ data: prestadoresData, error: errP }, { data: especialidadesData, error: errE }, { data: situacoesData, error: errS }] =
                await Promise.all([
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, especialidade_id, situacao_id, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, latitude, longitude',
                        )
                        .eq('ativo', true),
                    supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                    supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
                ])
            const erros = [errP, errE, errS].map((e) => e?.message).filter(Boolean)
            if (erros.length) {
                setErro(erros.join(' | '))
                return
            }
            setDados(prestadoresData || [])
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
                .map((p) => ({
                    id: Number(p.id),
                    nome: p.nome || `#${p.id}`,
                    especialidade: espPorId.get(Number(p.especialidade_id)) || '—',
                    cidade: p.endereco_cidade || '',
                    uf: p.endereco_uf || '',
                    endereco: p.endereco_logradouro || p.endereco || '',
                }))
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
        [credenciadosLocal, espPorId],
    )

    const marcadores = useMemo(() => {
        return credenciadosLocal
            .map((p) => {
                const lat = normalizarNum(p.latitude)
                const lng = normalizarNum(p.longitude)
                return {
                    id: Number(p.id),
                    nome: p.nome || `#${p.id}`,
                    lat,
                    lng,
                    especialidadeId: Number(p.especialidade_id),
                    especialidadeNome: espPorId.get(Number(p.especialidade_id)) || 'Sem especialidade',
                    cidade: p.endereco_cidade || '',
                    uf: p.endereco_uf || '',
                    logradouro: p.endereco_logradouro || p.endereco || '',
                    numero: p.endereco_numero || '',
                    bairro: p.endereco_bairro || '',
                    raw: p,
                }
            })
            .filter((p) => coordenadaValida(p.lat, p.lng))
    }, [credenciadosLocal, espPorId])

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

    const especialidadesFiltradas = useMemo(() => {
        const q = String(buscaEspecialidade || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
        if (!q) return especialidadesMapa
        return especialidadesMapa
            .map((esp) => {
                const nomeEsp = String(esp.nome || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                const itens = esp.itens.filter((it) => {
                    const nome = String(it.nome || '')
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase()
                    return nome.includes(q)
                })
                if (nomeEsp.includes(q)) return esp
                if (itens.length) return { ...esp, itens }
                return null
            })
            .filter(Boolean)
    }, [especialidadesMapa, buscaEspecialidade])

    const marcadoresVisiveis = useMemo(() => {
        if (!especialidadeAtiva) return marcadores
        return marcadores.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
    }, [marcadores, especialidadeAtiva])

    const centro = useMemo(() => {
        if (centroPadraoAtivo && !editandoId) return CENTRO_PADRAO_RS
        if (editandoId) {
            const la = parseCoordenadaEntrada(latInput)
            const lo = parseCoordenadaEntrada(lngInput)
            if (la != null && lo != null) return [la, lo]
        }
        if (!marcadoresVisiveis.length) return CENTRO_PADRAO_RS
        const latMedia = marcadoresVisiveis.reduce((acc, m) => acc + m.lat, 0) / marcadoresVisiveis.length
        const lngMedia = marcadoresVisiveis.reduce((acc, m) => acc + m.lng, 0) / marcadoresVisiveis.length
        return [latMedia, lngMedia]
    }, [marcadoresVisiveis, editandoId, latInput, lngInput, centroPadraoAtivo])

    const corPorEspecialidade = useMemo(() => {
        const m = new Map()
        especialidadesMapa.forEach((esp, idx) => m.set(esp.id, CORES[idx % CORES.length]))
        return m
    }, [especialidadesMapa])

    const prestadorEmEdicao = useMemo(
        () => credenciadosLocal.find((p) => Number(p.id) === Number(editandoId)) || null,
        [credenciadosLocal, editandoId],
    )

    const selecionarParaEdicao = (id) => {
        const p = credenciadosLocal.find((x) => Number(x.id) === Number(id))
        setEditandoId(Number(id))
        setCentroPadraoAtivo(false)
        setLatInput(p?.latitude != null ? String(p.latitude) : '')
        setLngInput(p?.longitude != null ? String(p.longitude) : '')
        setModoCliqueMapa(true)
        setFeedback('')
    }

    const salvarCoordenadas = async () => {
        if (somenteLeitura || !editandoId || !prestadorEmEdicao) return
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
            <h1>Mapa de credenciados</h1>
            <hr />

            {semCoordenadas.length > 0 && (
                <div className="credenciamento_main_alert credenciamento_mapa_alert_sem_coord" role="status">
                    <span>
                        <strong>{semCoordenadas.length}</strong> credenciado(s) LOCAL com endereço, mas{' '}
                        <strong>sem latitude/longitude válidas</strong> no mapa. Selecione abaixo para preencher.
                    </span>
                </div>
            )}

            {erro ? (
                <div className="credenciamento_main_alert" role="alert">
                    <span>{erro}</span>
                    <button type="button" onClick={() => setErro('')}>
                        x
                    </button>
                </div>
            ) : null}
            {feedback ? (
                <div className="credenciamento_main_alert" role="status">
                    <span>{feedback}</span>
                    <button type="button" onClick={() => setFeedback('')}>
                        x
                    </button>
                </div>
            ) : null}

            <div className="credenciamento_mapa_header">
                <div className="credenciamento_mapa_kpi">
                    <strong>{marcadores.length}</strong> com coordenadas
                </div>
                <div className="credenciamento_mapa_kpi credenciamento_mapa_kpi_warn">
                    <strong>{semCoordenadas.length}</strong> sem coordenadas
                </div>
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
                            setCentroPadraoAtivo(false)
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

            <div className="credenciamento_mapa_layout">
                <aside className="credenciamento_mapa_legenda">
                    <h3>Especialidades</h3>
                    <input
                        className="credenciamento_main_input credenciamento_mapa_busca_especialidade"
                        placeholder="Buscar especialidade ou cadastrado..."
                        value={buscaEspecialidade}
                        onChange={(e) => setBuscaEspecialidade(e.target.value)}
                    />
                    {especialidadesFiltradas.length === 0 ? (
                        <p className="pcad_muted">Sem coordenadas para exibir no mapa.</p>
                    ) : (
                        especialidadesFiltradas.map((esp) => {
                            const expandido = !!especialidadesExpandidas[esp.id]
                            return (
                                <div key={esp.id} className="credenciamento_mapa_legenda_bloco">
                                    <button
                                        type="button"
                                        className={`credenciamento_mapa_legenda_item ${
                                            String(especialidadeAtiva) === String(esp.id) ? 'is-active' : ''
                                        }`}
                                        onClick={() => {
                                            setCentroPadraoAtivo(false)
                                            setEspecialidadeAtiva((atual) =>
                                                String(atual) === String(esp.id) ? '' : String(esp.id),
                                            )
                                        }}
                                    >
                                        <span
                                            className="credenciamento_mapa_legenda_cor"
                                            style={{ backgroundColor: corPorEspecialidade.get(esp.id) || '#999' }}
                                        />
                                        <span className="credenciamento_mapa_legenda_nome">{esp.nome}</span>
                                        <span className="credenciamento_mapa_legenda_qtd">{esp.itens.length}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="credenciamento_mapa_legenda_expandir"
                                        onClick={() =>
                                            setEspecialidadesExpandidas((prev) => ({ ...prev, [esp.id]: !prev[esp.id] }))
                                        }
                                    >
                                        {expandido ? 'Ocultar cadastrados' : 'Mostrar cadastrados'}
                                    </button>
                                    {expandido && (
                                        <ul className="credenciamento_mapa_legenda_nomes">
                                            {esp.itens.map((it) => (
                                                <li key={`${esp.id}-${it.id}`}>{it.nome}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )
                        })
                    )}

                    <h3 className="credenciamento_mapa_subtitulo_pend">Sem coordenadas</h3>
                    {semCoordenadas.length === 0 ? (
                        <p className="pcad_muted">Todos os credenciados LOCAL têm pin no mapa.</p>
                    ) : (
                        <ul className="credenciamento_mapa_lista_pend">
                            {semCoordenadas.map((p) => (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        className={`credenciamento_mapa_pend_btn ${
                                            editandoId === p.id ? 'is-active' : ''
                                        }`}
                                        onClick={() => selecionarParaEdicao(p.id)}
                                        disabled={somenteLeitura}
                                    >
                                        <strong>{p.nome}</strong>
                                        <span>
                                            {p.especialidade} · {[p.cidade, p.uf].filter(Boolean).join('/')}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {editandoId && prestadorEmEdicao && (
                        <div className="credenciamento_mapa_editor">
                            <p className="credenciamento_mapa_editor_titulo">Preencher: {prestadorEmEdicao.nome}</p>
                            <label className="credenciamento_mapa_editor_label">
                                Latitude
                                <input
                                    className="credenciamento_main_input"
                                    value={latInput}
                                    onChange={(e) => setLatInput(e.target.value)}
                                    disabled={somenteLeitura || salvandoCoord}
                                />
                            </label>
                            <label className="credenciamento_mapa_editor_label">
                                Longitude
                                <input
                                    className="credenciamento_main_input"
                                    value={lngInput}
                                    onChange={(e) => setLngInput(e.target.value)}
                                    disabled={somenteLeitura || salvandoCoord}
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
                                    disabled={somenteLeitura || salvandoCoord}
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
                            key={`${centro[0]}-${centro[1]}-${marcadoresVisiveis.length}-${editandoId || 0}`}
                            center={centro}
                            zoom={marcadoresVisiveis.length || editandoId ? 12 : 7}
                            scrollWheelZoom
                            className="credenciamento_mapa_leaflet"
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            />
                            <MapClickParaCoordenadas
                                ativo={modoCliqueMapa && !somenteLeitura}
                                onPick={(lat, lng) => {
                                    setCentroPadraoAtivo(false)
                                    setLatInput(String(lat))
                                    setLngInput(String(lng))
                                }}
                            />
                            {marcadoresVisiveis.map((m) => (
                                <CircleMarker
                                    key={m.id}
                                    center={[m.lat, m.lng]}
                                    radius={8}
                                    pathOptions={{
                                        color: corPorEspecialidade.get(m.especialidadeId) || '#2f80ed',
                                        fillColor: corPorEspecialidade.get(m.especialidadeId) || '#2f80ed',
                                        fillOpacity: 0.8,
                                        weight: 1,
                                    }}
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
                                </CircleMarker>
                            ))}
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
