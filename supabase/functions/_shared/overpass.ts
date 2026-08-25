import { getProspectoOsmCategoriaPorId } from './osmCategories.ts'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const MIN_INTERVAL_MS = 2500
const MAX_BBOX_GRAUS = 0.45

const contact = String(Deno.env.get('NOMINATIM_CONTACT_EMAIL') || Deno.env.get('CONTACT_EMAIL') || '').trim()
const USER_AGENT = contact
  ? `EmerLAB/1.0 (${contact})`
  : 'EmerLAB/1.0 (prospectos OSM)'

let fila = Promise.resolve()
let ultimaReqEm = 0

function aguardarVaga() {
  fila = fila.then(async () => {
    const espera = Math.max(0, MIN_INTERVAL_MS - (Date.now() - ultimaReqEm))
    if (espera > 0) await new Promise((r) => setTimeout(r, espera))
    ultimaReqEm = Date.now()
  })
  return fila
}

export function limitarBoundsOverpass(bounds: {
  south: number
  west: number
  north: number
  east: number
}) {
  let { south, west, north, east } = bounds
  if (![south, west, north, east].every(Number.isFinite)) return null
  if (south >= north || west >= east) return null
  const latSpan = north - south
  const lngSpan = east - west
  if (latSpan > MAX_BBOX_GRAUS || lngSpan > MAX_BBOX_GRAUS) {
    const latMid = (south + north) / 2
    const lngMid = (west + east) / 2
    const h = MAX_BBOX_GRAUS / 2
    south = latMid - h
    north = latMid + h
    west = lngMid - h
    east = lngMid + h
  }
  return { south, west, north, east }
}

function montarQueryOverpass(categoriaId: string, south: number, west: number, north: number, east: number) {
  const cat = getProspectoOsmCategoriaPorId(categoriaId)
  if (!cat) return ''
  const excluirInativos =
    '["disused"!="yes"]["abandoned"!="yes"]["ruins"!="yes"]["vacant"!="yes"]'
  const bloco = cat.overpass
    .map(([k, v]) => {
      const esc = (s: string) => String(s).replace(/"/g, '\\"')
      const tag = `["${esc(k)}"="${esc(v)}"]${excluirInativos}`
      return `node${tag}(${south},${west},${north},${east});way${tag}(${south},${west},${north},${east});`
    })
    .join('')
  return `[out:json][timeout:45];(${bloco});out center tags;`
}

function tagsParaEndereco(tags: Record<string, string>, cidadeFallback = '', ufFallback = '') {
  const rua = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')
  const bairro = tags['addr:suburb'] || tags['addr:neighbourhood'] || ''
  const cidade = tags['addr:city'] || tags['addr:town'] || cidadeFallback || ''
  const uf = tags['addr:state'] || ufFallback || ''
  const partes = [rua, bairro, [cidade, uf].filter(Boolean).join(' / ')].filter(Boolean)
  return partes.join(' — ')
}

function normalizarTextoProspecto(s: string) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[/|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Alinhado a src/lib/credenciamento/prospectosOsmQualidade.js → estabelecimentoIndicaInativo */
function indicaInativo(tags: Record<string, string>, nome: string, horario: string) {
  const t = tags || {}
  if (
    t.disused === 'yes' ||
    t.abandoned === 'yes' ||
    t.ruins === 'yes' ||
    t.vacant === 'yes' ||
    t.shop === 'vacant' ||
    t.amenity === 'vacant' ||
    /^(yes|true|permanent|permanently)$/i.test(String(t.closed || '')) ||
    /^(yes|true|permanent|permanently)$/i.test(String(t.permanently_closed || ''))
  ) {
    return true
  }

  const oh = normalizarTextoProspecto(horario || t.opening_hours || '')
  if (
    oh === 'closed' ||
    oh === 'off' ||
    oh === 'permanently closed' ||
    oh === 'fechado' ||
    oh === 'fechada' ||
    /^closed\b/.test(oh) ||
    /^permanently closed/.test(oh)
  ) {
    return true
  }

  const n = normalizarTextoProspecto(nome || t.name || '')
  if (
    /\b(fechado|fechada|encerrado|encerrada|desativado|desativada|inexistente|abandonado|abandonada|demolido|demolida)\b/.test(
      n,
    ) ||
    /\bantig[oa]\b/.test(n) ||
    /\bem obras\b/.test(n) ||
    /\bfora de (operacao|atividade)\b/.test(n)
  ) {
    return true
  }

  const nota = normalizarTextoProspecto(t.nota || t.description || '')
  if (
    nota &&
    /\b(fechado|fechada|nao existe mais|nao funciona|desativado|permanently closed|out of business)\b/.test(
      nota,
    )
  ) {
    return true
  }

  return false
}

function elementoParaProspecto(
  el: { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> },
  categoriaId: string,
  categoriaLabel: string,
  cidade = '',
  uf = '',
) {
  const lat = Number(el.lat ?? el.center?.lat)
  const lng = Number(el.lon ?? el.center?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const tags = el.tags || {}
  const nome = String(tags.name || tags.brand || tags.operator || '').trim()
  if (!nome) return null
  const horario = String(tags.opening_hours || '').trim()
  if (indicaInativo(tags, nome, horario)) return null
  return {
    osm_type: String(el.type || 'node'),
    osm_id: Number(el.id),
    categoria_id: categoriaId,
    categoria_label: categoriaLabel,
    nome,
    endereco: tagsParaEndereco(tags, cidade, uf) || nome,
    cidade: tags['addr:city'] || tags['addr:town'] || cidade,
    uf: tags['addr:state'] || uf,
    lat,
    lng,
    telefone: String(tags.phone || tags['contact:phone'] || tags.mobile || '').trim(),
    horario_atendimento: horario,
    website: String(tags.website || tags['contact:website'] || '').trim(),
    tags,
  }
}

export async function overpassPoisNaArea(opts: {
  south: number
  west: number
  north: number
  east: number
  categoria: string
  cidade?: string
  uf?: string
}) {
  const categoria = String(opts.categoria || '').trim()
  const cat = getProspectoOsmCategoriaPorId(categoria)
  if (!cat) return { ok: false as const, status: 400, erro: 'Categoria inválida.' }

  const bounds = limitarBoundsOverpass({
    south: Number(opts.south),
    west: Number(opts.west),
    north: Number(opts.north),
    east: Number(opts.east),
  })
  if (!bounds) return { ok: false as const, status: 400, erro: 'Área (bbox) inválida.' }

  const query = montarQueryOverpass(categoria, bounds.south, bounds.west, bounds.north, bounds.east)
  if (!query) return { ok: false as const, erro: 'Consulta Overpass vazia.' }

  await aguardarVaga()

  let ultimoErro = 'Falha ao contactar Overpass.'
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (resp.status === 429 || resp.status === 504) {
        ultimoErro = 'Servidor de mapas ocupado. Aguarde e tente de novo.'
        continue
      }
      if (!resp.ok) {
        ultimoErro = `Overpass HTTP ${resp.status}`
        continue
      }
      const json = await resp.json()
      const cidade = String(opts.cidade || '').trim()
      const uf = String(opts.uf || '').trim()
      const itens = (json.elements || [])
        .map((el: unknown) => elementoParaProspecto(el as never, cat.id, cat.label, cidade, uf))
        .filter((x: { osm_id: number } | null) => x && Number.isFinite(x.osm_id))
        .slice(0, 120)
      return { ok: true as const, itens }
    } catch (e) {
      ultimoErro = (e as Error)?.message || ultimoErro
    }
  }
  return { ok: false as const, status: 502, erro: ultimoErro }
}
