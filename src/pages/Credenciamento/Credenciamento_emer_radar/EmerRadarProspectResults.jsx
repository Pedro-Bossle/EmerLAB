import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { buttonClassName } from '../../../components/ui'
import {
  PERMISSION_KEYS,
  hasPermission,
  usuarioPodeEditarFerramenta,
  useStoredAccessProfile,
} from '../../../lib/accessControl'
import { enviarProspectoMapsParaKanban } from '../../../lib/credKanban.js'
import {
  fetchPlacePhotoEmerRadar,
  geocodeEmerRadar,
  scrapeExportExcelUrl,
  scrapeExportPdfUrl,
} from '../../../lib/credenciamento/emerRadarApi.js'
import {
  chaveEstavelProspectoMaps,
  lerProspectosMapsDismissed,
  marcarProspectoMapsDismissed,
} from '../../../lib/credenciamento/emerRadarProspectosDismiss.js'
import { descartarProspectoMaps, atualizarProspectoMaps } from '../../../lib/credenciamento/prospectosMapsRepo.js'
import { prospectoIndicaAtendimento24h } from '../../../lib/credenciamento/prospectosOsmHorario.js'
import { classify, copyText, displayCategory, unifyContato } from '../../../lib/credenciamento/emerRadarUi.js'

const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

/** Fila global: no máx. 1 fetch Playwright por vez no worker. */
const photoQueue = []
let photoActive = 0
const PHOTO_MAX_PARALLEL = 1

function enqueuePlacePhoto(task) {
  return new Promise((resolve, reject) => {
    photoQueue.push({ task, resolve, reject })
    pumpPhotoQueue()
  })
}

function pumpPhotoQueue() {
  while (photoActive < PHOTO_MAX_PARALLEL && photoQueue.length) {
    const job = photoQueue.shift()
    photoActive += 1
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        photoActive -= 1
        pumpPhotoQueue()
      })
  }
}

function pareceUrlFachadaMaps(url) {
  const u = String(url || '').trim().toLowerCase()
  if (!u.startsWith('http')) return false
  if (
    /maps\.gstatic|\/maps\/vt|staticmap|mt[0-3]\.google|khms|tile\.openstreetmap|streetviewpixels/i.test(
      u,
    )
  ) {
    return false
  }
  if (u.includes('googleusercontent.com/a/')) return false
  return u.includes('googleusercontent.com') || u.includes('ggpht.com')
}

/**
 * Usa imagem da sessão se houver; senão busca ao vivo no Maps (só quando o card entra na viewport).
 */
function useFachadaLive(est) {
  const inicial = est?.imagem && pareceUrlFachadaMaps(est.imagem) ? String(est.imagem) : null
  const [url, setUrl] = useState(() => inicial)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const mediaRef = useRef(null)

  useEffect(() => {
    const next =
      est?.imagem && pareceUrlFachadaMaps(est.imagem) ? String(est.imagem) : null
    setUrl(next)
    setFailed(false)
  }, [est?.imagem, est?.id, est?.maps_id, est?.link_maps])

  useEffect(() => {
    if (url || failed) return undefined
    if (!est?.link_maps && !est?.nome) return undefined

    const el = mediaRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined

    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        setLoading(true)
        enqueuePlacePhoto(() =>
          fetchPlacePhotoEmerRadar({
            link_maps: est.link_maps || '',
            nome: est.nome || '',
            cidade: est.cidade || '',
            uf: est.uf || '',
          }),
        )
          .then((r) => {
            if (cancelled) return
            const img = r?.imagem ? String(r.imagem) : ''
            if (img && pareceUrlFachadaMaps(img)) setUrl(img)
            else setFailed(true)
          })
          .catch(() => {
            if (!cancelled) setFailed(true)
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
      },
      { rootMargin: '120px', threshold: 0.15 },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [url, failed, est?.link_maps, est?.nome, est?.cidade, est?.uf])

  return { url, loading, failed, mediaRef }
}

function dash(v) {
  const s = String(v || '').trim()
  return s || '—'
}

function mapsUrl(r) {
  if (r?.link_maps) return r.link_maps
  const q = encodeURIComponent([r?.nome, r?.endereco, r?.cidade, r?.uf].filter(Boolean).join(', '))
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

function coordsFromMapsLink(url) {
  if (!url) return null
  const place = String(url).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  if (!place) return null
  const lat = Number(place[1])
  const lon = Number(place[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

function parseCoord(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function looksLikeStreetAddress(addr) {
  if (!addr || addr.length < 10) return false
  return /\b(Rua|R\.|Avenida|Av\.|Alameda|Travessa|Estrada|Rodovia|Praça)\b/i.test(addr)
}

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]))
    map.fitBounds(bounds.pad(0.2), { maxZoom: 14 })
  }, [map, points])
  return null
}

function ProspectMap({ results }) {
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [geocoded, setGeocoded] = useState(0)

  const withCoords = useMemo(() => {
    const out = []
    for (const r of results || []) {
      const fromLink = coordsFromMapsLink(r.link_maps)
      if (fromLink) {
        out.push({
          id: r.id || `${r.nome}-${r.endereco}`,
          nome: r.nome,
          lat: fromLink.lat,
          lon: fromLink.lon,
          endereco: r.endereco,
          telefone: r.telefone,
          source: 'place',
        })
        continue
      }
      const lat = parseCoord(r.latitude)
      const lon = parseCoord(r.longitude)
      if (lat != null && lon != null) {
        out.push({
          id: r.id || `${r.nome}-${r.endereco}`,
          nome: r.nome,
          lat,
          lon,
          endereco: r.endereco,
          telefone: r.telefone,
          source: 'coords',
        })
      }
    }
    return out
  }, [results])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      const knownIds = new Set(withCoords.map((p) => p.id))
      const need = (results || []).filter(
        (r) =>
          !knownIds.has(r.id || `${r.nome}-${r.endereco}`) &&
          looksLikeStreetAddress(r.endereco),
      )
      const extra = []
      for (const r of need.slice(0, 40)) {
        if (cancelled) break
        try {
          const hit = await geocodeEmerRadar(r.endereco || '', r.cidade, r.uf)
          if (hit.lat && hit.lon) {
            extra.push({
              id: r.id || `${r.nome}-${r.endereco}`,
              nome: r.nome,
              lat: Number(hit.lat),
              lon: Number(hit.lon),
              endereco: r.endereco,
              telefone: r.telefone,
              source: 'geocode',
            })
          }
        } catch {
          /* ignore */
        }
        await new Promise((res) => setTimeout(res, 1100))
      }
      if (!cancelled) {
        setPoints([...withCoords, ...extra])
        setGeocoded(extra.length)
        setLoading(false)
      }
    }
    setPoints(withCoords)
    setGeocoded(0)
    const needGeocode = (results || []).some(
      (r) =>
        !withCoords.some((p) => p.id === (r.id || `${r.nome}-${r.endereco}`)) &&
        looksLikeStreetAddress(r.endereco),
    )
    if (needGeocode) void run()
    else setLoading(false)
    return () => {
      cancelled = true
    }
  }, [results, withCoords])

  const center = points.length ? [points[0].lat, points[0].lon] : [-15.78, -47.93]

  return (
    <div className="emer-radar-map">
      <div className="emer-radar-map__meta">
        <span>
          {points.length} no mapa
          {geocoded > 0 ? ` · ${geocoded} via Nominatim` : ''}
          {loading ? ' · geocodificando…' : ''}
        </span>
        <span>OpenStreetMap</span>
      </div>
      <div className="emer-radar-map__canvas">
        <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; dados &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />
          <FitBounds points={points} />
          {points.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lon]} icon={markerIcon}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <strong>{p.nome}</strong>
                  {p.endereco && <div>{p.endereco}</div>}
                  {p.telefone && <div>{p.telefone}</div>}
                  <div className="text-xs text-slate-500">
                    {p.source === 'place'
                      ? 'Coords do place (Maps)'
                      : p.source === 'geocode'
                        ? 'Geocode (endereço)'
                        : 'Coords gravadas'}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

function parseLinhasHorario(detalhado) {
  if (!detalhado) return []
  return String(detalhado)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linha) => {
      if (linha.includes('=')) {
        const sep = linha.indexOf('=')
        return { dia: linha.slice(0, sep).trim(), faixa: linha.slice(sep + 1).trim() }
      }
      const m = linha.match(/^(.+?):\s*(.*)$/)
      if (m && !/^\d/.test(m[1])) {
        return { dia: m[1].trim(), faixa: m[2].trim() }
      }
      return { dia: linha, faixa: '' }
    })
}

/** Resumo + hover com semana (mesmo padrão do frontend Emer-Radar). */
function HoursDisplay({ horario, detalhado }) {
  const resumo = String(horario || '').trim()
  const detalhe = String(detalhado || '').trim()
  if (!resumo && !detalhe) {
    return <li className="emer-radar-card__hours is-vazio">Horário não disponível</li>
  }

  const linhas = parseLinhasHorario(detalhe)
  const temDetalhe =
    linhas.length > 1 ||
    (linhas.length === 1 && linhas[0].faixa !== '' && linhas[0].dia !== resumo)

  if (!temDetalhe) {
    return <li className="emer-radar-card__hours">{resumo || detalhe}</li>
  }

  return (
    <li className="emer-radar-card__hours">
      <div className="emer-radar-hours">
        <button type="button" className="emer-radar-hours__trigger" aria-label="Ver horários da semana">
          <span className="emer-radar-hours__resumo">{resumo || 'Ver horários'}</span>
          <span className="emer-radar-hours__hint">Ver horários da semana</span>
        </button>
        <div className="emer-radar-hours__tooltip" role="tooltip">
          <p className="emer-radar-hours__tooltip_tit">Horário de funcionamento</p>
          <ul>
            {linhas.map((item) => (
              <li key={`${item.dia}-${item.faixa}`}>
                <span className="emer-radar-hours__dia">{item.dia}</span>
                <span className="emer-radar-hours__faixa">{item.faixa || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

function ProspectCard({ est, podeEditar, onEnviadoKanban, onRemover, enviando, jaEnviado, removendo }) {
  const [imgError, setImgError] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const { url: fachadaUrl, loading: loadingFoto, mediaRef } = useFachadaLive(est)
  const showImg = Boolean(fachadaUrl) && !imgError
  const is24h = prospectoIndicaAtendimento24h(est)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(est))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <article className="emer-radar-card">
      <div className="emer-radar-card__media" ref={mediaRef}>
        {showImg ? (
          <img
            src={fachadaUrl}
            alt={`Fachada de ${est.nome}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="emer-radar-card__placeholder">
            {loadingFoto ? 'Buscando fachada no Maps…' : 'Sem imagem'}
          </div>
        )}
      </div>
      <div className="emer-radar-card__body">
        <h4 className="emer-radar-card__nome">
          <span>{dash(est.nome)}</span>
          {is24h ? (
            <span
              className="emer-radar-card__badge_24h"
              title={
                est.horario_detalhado || est.horario
                  ? `Horário: ${est.horario_detalhado || est.horario}`
                  : 'Atendimento 24 horas'
              }
            >
              24h
            </span>
          ) : null}
        </h4>
        <p className="emer-radar-card__cat">{displayCategory(est)}</p>
        <ul>
          <li>{dash(est.endereco)}</li>
          {(est.cidade || est.uf) && (
            <li className="emer-radar-card__muted">
              {[est.cidade, est.uf].filter(Boolean).join(' - ')}
            </li>
          )}
          <li>{dash(unifyContato(est.telefone, est.whatsapp) || est.telefone)}</li>
          <HoursDisplay horario={est.horario} detalhado={est.horario_detalhado} />
          {(est.nota || est.num_avaliacoes) && (
            <li className="emer-radar-card__rating">
              {est.nota ? `Nota ${est.nota}` : ''}
              {est.nota && est.num_avaliacoes ? ' · ' : ''}
              {est.num_avaliacoes ? `${est.num_avaliacoes} avaliações` : ''}
            </li>
          )}
          {(est.latitude || est.longitude) && (
            <li className="emer-radar-card__muted emer-radar-card__coords">
              Coords: {dash(est.latitude)}, {dash(est.longitude)}
            </li>
          )}
        </ul>
        {est.termo_busca && (
          <p className="emer-radar-card__term">Encontrado por: “{est.termo_busca}”</p>
        )}
        <div className="emer-radar-card__actions">
          <a href={mapsUrl(est)} target="_blank" rel="noreferrer">
            Abrir no Maps
          </a>
          <button
            type="button"
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
            })}
            onClick={() => void handleCopy()}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          {podeEditar ? (
            <>
              <button
                type="button"
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'emer-radar-card__btn-kanban',
                })}
                disabled={enviando || jaEnviado || removendo}
                title="Envia para Não contatado (atribuído a você) e marca Contactado no catálogo"
                onClick={() => onEnviadoKanban?.(est)}
              >
                {enviando ? 'Enviando…' : jaEnviado ? 'No Kanban' : '→ Kanban'}
              </button>
              <button
                type="button"
                className={buttonClassName({
                  variant: 'danger',
                  size: 'sm',
                  className: 'emer-radar-card__btn-remover',
                })}
                disabled={removendo || enviando}
                title="Soft delete: marca como descartado no catálogo e oculta na lista"
                onClick={() => onRemover?.(est)}
              >
                {removendo ? 'Removendo…' : 'Remover'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  )
}

const FILTERS_INITIAL = {
  query: '',
  categoria: '',
  cidade: '',
  termo: '',
  onlyPhone: false,
  onlyAddress: false,
  sort: 'original',
}

/**
 * Resultados do Prospect Maps: cards (fachada só na sessão da busca; catálogo sem foto).
 * @param {{
 *   results?: object[],
 *   titulo?: string,
 *   mostrarExport?: boolean,
 *   onRemovido?: (est: object) => void,
 *   onEnviadoKanbanOk?: (est: object) => void,
 * }} props
 */
export default function EmerRadarProspectResults({
  results,
  titulo,
  mostrarExport = true,
  onRemovido,
  onEnviadoKanbanOk,
}) {
  const [viewMode, setViewMode] = useState('lista')
  const [filters, setFilters] = useState(FILTERS_INITIAL)
  const [enviandoKey, setEnviandoKey] = useState(null)
  const [removendoKey, setRemovendoKey] = useState(null)
  const [enviados, setEnviados] = useState(() => new Set())
  const [dismissed, setDismissed] = useState(() => lerProspectosMapsDismissed())
  const [feedback, setFeedback] = useState('')
  const [erroKanban, setErroKanban] = useState('')
  const profile = useStoredAccessProfile()
  const podeEditar =
    (profile && usuarioPodeEditarFerramenta(profile.permissions, 'credenciamento.prospectos_osm')) ||
    (profile ? hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false)

  const visiveis = useMemo(
    () =>
      (results || []).filter((est) => {
        const key = chaveEstavelProspectoMaps(est)
        if (dismissed.has(key)) return false
        if (String(est?.status_prospeccao || '') === 'descartado') return false
        return true
      }),
    [results, dismissed],
  )

  const categorias = useMemo(
    () =>
      Array.from(new Set(visiveis.map((r) => displayCategory(r)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    [visiveis],
  )
  const cidades = useMemo(
    () =>
      Array.from(new Set(visiveis.map((r) => r.cidade).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    [visiveis],
  )
  const termosOpts = useMemo(
    () =>
      Array.from(new Set(visiveis.map((r) => r.termo_busca).filter(Boolean))).sort(),
    [visiveis],
  )

  const filtered = useMemo(() => {
    let list = [...visiveis]
    const q = filters.query.trim().toLowerCase()
    if (q) {
      list = list.filter((r) => {
        const hay = `${r.nome} ${r.endereco || ''} ${r.telefone || ''} ${r.categoria || ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    if (filters.categoria) list = list.filter((r) => displayCategory(r) === filters.categoria)
    if (filters.cidade) list = list.filter((r) => r.cidade === filters.cidade)
    if (filters.termo) list = list.filter((r) => r.termo_busca === filters.termo)
    if (filters.onlyPhone) list = list.filter((r) => Boolean(r.telefone))
    if (filters.onlyAddress) list = list.filter((r) => Boolean(r.endereco))
    if (filters.sort === 'az') list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    else if (filters.sort === 'za') list.sort((a, b) => b.nome.localeCompare(a.nome, 'pt-BR'))
    return list
  }, [visiveis, filters])

  const stats = useMemo(() => {
    const hospital = visiveis.filter((r) => classify(r) === 'hospital').length
    const clinica = visiveis.filter((r) => classify(r) === 'clinica').length
    const pet = visiveis.filter((r) => classify(r) === 'pet' || classify(r) === 'outros').length
    return { hospital, clinica, pet, total: visiveis.length }
  }, [visiveis])

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }))

  const enviarAoKanban = async (est) => {
    const key = chaveEstavelProspectoMaps(est)
    const jaContactado = String(est?.status_prospeccao || '') === 'contactado'
    if (!est || !key || enviandoKey === key || (enviados.has(key) && jaContactado)) return
    setEnviandoKey(key)
    setErroKanban('')
    setFeedback('')
    try {
      const card = await enviarProspectoMapsParaKanban(est)

      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      const dbId = est.maps_db_id || (uuidLike.test(String(est.id || '')) ? est.id : null)
      if (dbId) {
        const r = await atualizarProspectoMaps(dbId, { status_prospeccao: 'contactado' })
        if (!r.ok && r.erro && !/não encontrado|ausente|does not exist/i.test(String(r.erro))) {
          setErroKanban(r.erro)
        }
      }

      setEnviados((prev) => new Set(prev).add(key))
      const estAtualizado = { ...est, status_prospeccao: 'contactado' }
      onEnviadoKanbanOk?.(estAtualizado)

      const col =
        card?.coluna === 'contatado'
          ? 'Contatado'
          : 'Não contatado'
      setFeedback(
        `«${est.nome || 'Prospecto'}» enviado ao Kanban → ${col} (atribuído a você · Contactado no catálogo).`,
      )
    } catch (err) {
      setErroKanban(err?.message || String(err))
    } finally {
      setEnviandoKey(null)
    }
  }

  const removerProspecto = async (est) => {
    const key = chaveEstavelProspectoMaps(est)
    if (!est || !key || removendoKey === key) return
    setRemovendoKey(key)
    setErroKanban('')
    try {
      const next = marcarProspectoMapsDismissed(key)
      setDismissed(new Set(next))
      const dbRef = est.maps_db_id || est.maps_id || (est._salvo ? key : null)
      if (dbRef) {
        const r = await descartarProspectoMaps(dbRef)
        if (!r.ok && r.erro && !/não encontrado|ausente|does not exist/i.test(String(r.erro))) {
          setErroKanban(r.erro)
        }
      }
      setFeedback(`«${est.nome || 'Prospecto'}» removido (soft delete).`)
      onRemovido?.(est)
    } catch (err) {
      setErroKanban(err?.message || String(err))
    } finally {
      setRemovendoKey(null)
    }
  }

  if (!results?.length) return null

  const ocultos = Math.max(0, results.length - visiveis.length)
  const inputCls =
    'rounded-xl border border-line px-3 py-2 text-sm dark:border-white/15 dark:bg-[#152433]'

  return (
    <section className="el-stage">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="mt-0 mb-2 font-bold">{titulo || 'Resultados'}</h3>
          <div className="emer-radar-stats">
            <div className="emer-radar-stats__item">
              <strong>{stats.total}</strong>
              <span>Encontrados</span>
            </div>
            <div className="emer-radar-stats__item emer-radar-stats__item--hosp">
              <strong>{stats.hospital}</strong>
              <span>Hospital</span>
            </div>
            <div className="emer-radar-stats__item emer-radar-stats__item--clin">
              <strong>{stats.clinica}</strong>
              <span>Clínica</span>
            </div>
            <div className="emer-radar-stats__item">
              <strong>{stats.pet}</strong>
              <span>Pet / Outros</span>
            </div>
          </div>
          {ocultos > 0 ? (
            <p className="mt-2 mb-0 text-xs text-ink-muted">
              {ocultos} removido{ocultos === 1 ? '' : 's'} / descartado{ocultos === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="emer-radar-view-toggle" role="group" aria-label="Visualização">
            <button
              type="button"
              className={viewMode === 'lista' ? 'is-active' : ''}
              onClick={() => setViewMode('lista')}
            >
              Lista
            </button>
            <button
              type="button"
              className={viewMode === 'mapa' ? 'is-active' : ''}
              onClick={() => setViewMode('mapa')}
            >
              Mapa
            </button>
          </div>
          {mostrarExport ? (
            <>
              <a
                className={buttonClassName({ variant: 'secondary' })}
                href={scrapeExportExcelUrl()}
                target="_blank"
                rel="noreferrer"
              >
                Excel
              </a>
              <a
                className={buttonClassName({ variant: 'secondary' })}
                href={scrapeExportPdfUrl()}
                target="_blank"
                rel="noreferrer"
              >
                PDF
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="emer-radar-filters mt-4">
        <input
          className={`${inputCls} emer-radar-filters__query`}
          value={filters.query}
          onChange={(e) => setFilter('query', e.target.value)}
          placeholder="Buscar estabelecimento…"
        />
        <select
          className={inputCls}
          value={filters.categoria}
          onChange={(e) => setFilter('categoria', e.target.value)}
        >
          <option value="">Todas categorias</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={filters.cidade}
          onChange={(e) => setFilter('cidade', e.target.value)}
        >
          <option value="">Todas cidades</option>
          {cidades.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={filters.termo}
          onChange={(e) => setFilter('termo', e.target.value)}
        >
          <option value="">Todos os termos</option>
          {termosOpts.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={filters.sort}
          onChange={(e) => setFilter('sort', e.target.value)}
        >
          <option value="original">Ordem original</option>
          <option value="az">Nome A-Z</option>
          <option value="za">Nome Z-A</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={filters.onlyPhone}
            onChange={(e) => setFilter('onlyPhone', e.target.checked)}
          />
          Com telefone
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={filters.onlyAddress}
            onChange={(e) => setFilter('onlyAddress', e.target.checked)}
          />
          Com endereço
        </label>
      </div>

      <p className="mt-3 mb-0 text-sm text-ink-muted">
        Exibindo {filtered.length} de {visiveis.length} estabelecimentos
      </p>

      {feedback ? (
        <p className="mt-3 mb-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {feedback}
        </p>
      ) : null}
      {erroKanban ? (
        <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
          {erroKanban}
        </p>
      ) : null}

      {!filtered.length ? (
        <p className="mt-4 mb-0 text-sm text-ink-muted">
          Nenhum prospecto visível para estes filtros.
        </p>
      ) : viewMode === 'mapa' ? (
        <div className="mt-4">
          <ProspectMap results={filtered} />
        </div>
      ) : (
        <div className="emer-radar-card-grid mt-4">
          {filtered.map((est) => {
            const key = chaveEstavelProspectoMaps(est)
            return (
              <ProspectCard
                key={key}
                est={est}
                podeEditar={podeEditar}
                enviando={enviandoKey === key}
                removendo={removendoKey === key}
                jaEnviado={enviados.has(key) || String(est?.status_prospeccao || '') === 'contactado'}
                onEnviadoKanban={() => void enviarAoKanban(est)}
                onRemover={() => void removerProspecto(est)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
