/**
 * Overpass API (OSM) — somente servidor.
 */
import { getProspectoOsmCategoriaPorId } from './prospectosOsmCategorias.js'
import { estabelecimentoIndicaInativo } from './prospectosOsmQualidade.js'
import { fetchComTimeout } from './fetchComTimeout.js'

const OVERPASS_FETCH_TIMEOUT_MS = 90_000

const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

const MIN_INTERVAL_MS = 2500
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 120
const MAX_BBOX_GRAUS = 0.45

const contact = String(process.env.NOMINATIM_CONTACT_EMAIL || process.env.CONTACT_EMAIL || '').trim()
const USER_AGENT = contact
    ? `EmerLAB/1.0 (${contact})`
    : 'EmerLAB/1.0 (prospectos OSM)'

/** @type {Map<string, { expiresAt: number, data: unknown }>} */
const cache = new Map()
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

function chaveCache(categoria, south, west, north, east) {
    return `${categoria}|${south.toFixed(4)}|${west.toFixed(4)}|${north.toFixed(4)}|${east.toFixed(4)}`
}

export function limitarBoundsOverpass(bounds) {
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

function montarQueryOverpass(categoriaId, south, west, north, east) {
    const cat = getProspectoOsmCategoriaPorId(categoriaId)
    if (!cat) return ''
    // Exclui tags comuns de local desativado no OSM
    const excluirInativos =
        '["disused"!="yes"]["abandoned"!="yes"]["ruins"!="yes"]["vacant"!="yes"]'
    const bloco = cat.overpass
        .map(([k, v]) => {
            const esc = (s) => String(s).replace(/"/g, '\\"')
            const tag = `["${esc(k)}"="${esc(v)}"]${excluirInativos}`
            return `node${tag}(${south},${west},${north},${east});way${tag}(${south},${west},${north},${east});`
        })
        .join('')
    return `[out:json][timeout:45];(${bloco});out center tags;`
}

function tagsParaEndereco(tags = {}, cidadeFallback = '', ufFallback = '') {
    const rua = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')
    const bairro = tags['addr:suburb'] || tags['addr:neighbourhood'] || ''
    const cidade = tags['addr:city'] || tags['addr:town'] || cidadeFallback || ''
    const uf = tags['addr:state'] || ufFallback || ''
    const partes = [rua, bairro, [cidade, uf].filter(Boolean).join(' / ')].filter(Boolean)
    return partes.join(' — ')
}

export function elementoOverpassParaProspecto(el, categoriaId, categoriaLabel, cidade = '', uf = '') {
    const lat = Number(el.lat ?? el.center?.lat)
    const lng = Number(el.lon ?? el.center?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const tags = el.tags || {}
    const nome = String(tags.name || tags.brand || tags.operator || '').trim()
    if (!nome) return null
    const horario = String(tags.opening_hours || '').trim()
    if (estabelecimentoIndicaInativo(tags, nome, horario)) return null
    const endereco = tagsParaEndereco(tags, cidade, uf) || nome
    const telefone = String(tags.phone || tags['contact:phone'] || tags.mobile || '').trim()
    const website = String(tags.website || tags['contact:website'] || '').trim()
    return {
        osm_type: String(el.type || 'node'),
        osm_id: Number(el.id),
        categoria_id: categoriaId,
        categoria_label: categoriaLabel,
        nome,
        endereco,
        cidade: tags['addr:city'] || tags['addr:town'] || cidade,
        uf: tags['addr:state'] || uf,
        lat,
        lng,
        telefone,
        horario_atendimento: horario,
        website,
        tags,
    }
}

async function executarOverpass(query) {
    let ultimoErro = 'Falha ao contactar Overpass.'
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const resp = await fetchComTimeout(
                endpoint,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        Accept: 'application/json',
                        'User-Agent': USER_AGENT,
                    },
                    body: `data=${encodeURIComponent(query)}`,
                },
                OVERPASS_FETCH_TIMEOUT_MS,
            )
            if (resp.status === 429 || resp.status === 504) {
                ultimoErro = 'Servidor de mapas ocupado. Aguarde e tente de novo.'
                continue
            }
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                ultimoErro = txt?.slice(0, 200) || `Overpass HTTP ${resp.status}`
                continue
            }
            const json = await resp.json()
            return { ok: true, json }
        } catch (e) {
            ultimoErro = e?.message || ultimoErro
        }
    }
    return { ok: false, erro: ultimoErro }
}

/**
 * @param {{ south: number, west: number, north: number, east: number, categoria: string, cidade?: string, uf?: string }} opts
 */
export async function overpassPoisNaArea(opts) {
    const categoria = String(opts.categoria || '').trim()
    const cat = getProspectoOsmCategoriaPorId(categoria)
    if (!cat) {
        return { ok: false, status: 400, erro: 'Categoria inválida.' }
    }

    const bounds = limitarBoundsOverpass({
        south: Number(opts.south),
        west: Number(opts.west),
        north: Number(opts.north),
        east: Number(opts.east),
    })
    if (!bounds) {
        return { ok: false, status: 400, erro: 'Área (bbox) inválida.' }
    }
    const { south, west, north, east } = bounds
    const cidade = String(opts.cidade || '').trim()
    const uf = String(opts.uf || '').trim()

    const chave = chaveCache(categoria, south, west, north, east)
    const hit = cache.get(chave)
    if (hit && hit.expiresAt > Date.now()) {
        return { ok: true, itens: hit.data, fromCache: true }
    }

    const query = montarQueryOverpass(categoria, south, west, north, east)
    if (!query) return { ok: false, erro: 'Consulta Overpass vazia.' }

    await aguardarVaga()

    const exec = await executarOverpass(query)
    if (!exec.ok) {
        return { ok: false, status: 502, erro: exec.erro }
    }

    const itens = (exec.json.elements || [])
        .map((el) => elementoOverpassParaProspecto(el, cat.id, cat.label, cidade, uf))
        .filter((x) => x && Number.isFinite(x.osm_id))
        .slice(0, 120)

    cache.set(chave, { data: itens, expiresAt: Date.now() + CACHE_TTL_MS })
    while (cache.size > CACHE_MAX) {
        const k = cache.keys().next().value
        if (k === undefined) break
        cache.delete(k)
    }

    return { ok: true, itens }
}
