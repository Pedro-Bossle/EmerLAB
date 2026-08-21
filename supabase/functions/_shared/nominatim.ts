const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const MIN_INTERVAL_MS = 1100
const CACHE_TTL_MS = 15 * 60 * 1000

const contact = String(Deno.env.get('NOMINATIM_CONTACT_EMAIL') || Deno.env.get('CONTACT_EMAIL') || '').trim()
const USER_AGENT = contact
  ? `EmerLAB/1.0 (${contact})`
  : 'EmerLAB/1.0 (credenciamento mapa)'

const PARAMS_PERMITIDOS = new Set([
  'q',
  'postalcode',
  'country',
  'format',
  'limit',
  'countrycodes',
  'addressdetails',
  'namedetails',
  'extratags',
  'viewbox',
  'bounded',
])

const cache = new Map<string, { expiresAt: number; data: unknown }>()
let fila = Promise.resolve()
let ultimaReqEm = 0

export function normalizarParamsNominatim(raw: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { format: 'json' }
  for (const [k, v] of Object.entries(raw)) {
    if (!PARAMS_PERMITIDOS.has(k)) continue
    if (v === undefined || v === null || v === '') continue
    out[k] = String(v)
  }
  return out
}

function aguardarVaga() {
  fila = fila.then(async () => {
    const espera = Math.max(0, MIN_INTERVAL_MS - (Date.now() - ultimaReqEm))
    if (espera > 0) await new Promise((r) => setTimeout(r, espera))
    ultimaReqEm = Date.now()
  })
  return fila
}

export async function nominatimSearchJson(
  params: Record<string, string>,
): Promise<{ ok: boolean; data?: unknown; status?: number; codigo?: string; erro?: string }> {
  const normalizado = normalizarParamsNominatim(params)
  if (!normalizado.q && !normalizado.postalcode) {
    return { ok: false, status: 400, erro: 'Informe q ou postalcode.' }
  }

  const chave = Object.keys(normalizado)
    .sort()
    .map((k) => `${k}=${normalizado[k]}`)
    .join('&')
  const hit = cache.get(chave)
  if (hit && hit.expiresAt > Date.now()) {
    return { ok: true, data: hit.data }
  }

  await aguardarVaga()

  const url = new URL(NOMINATIM_BASE)
  for (const [k, v] of Object.entries(normalizado)) {
    url.searchParams.set(k, v)
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
    const text = await resp.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : []
    } catch {
      return { ok: false, status: 502, erro: 'Resposta inválida do Nominatim.' }
    }
    if (resp.status === 429) {
      return { ok: false, status: 429, codigo: 'rate_limit', erro: 'Nominatim: limite de requisições.' }
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, erro: `Nominatim HTTP ${resp.status}` }
    }
    cache.set(chave, { data, expiresAt: Date.now() + CACHE_TTL_MS })
    return { ok: true, data }
  } catch (e) {
    return { ok: false, status: 502, erro: (e as Error)?.message || 'Falha ao contactar Nominatim.' }
  }
}

export async function buscarViewboxLocalidadeNominatim(cidade: string, uf: string) {
  const c = String(cidade || '').trim()
  if (!c) return { ok: false as const, erro: 'Cidade não informada.' }
  const q = [c, uf, 'Brasil'].filter(Boolean).join(', ')
  const r = await nominatimSearchJson({
    q,
    limit: '1',
    countrycodes: 'br',
    addressdetails: '1',
  })
  if (!r.ok) return { ok: false as const, erro: r.erro, codigo: r.codigo }
  const data = r.data as { boundingbox?: string[]; lat?: string; lon?: string }[] | undefined
  const hit = data?.[0]
  const bb = hit?.boundingbox
  if (!hit || !Array.isArray(bb) || bb.length < 4) {
    return { ok: false as const, erro: 'Limites da cidade não encontrados.' }
  }
  const south = Number(bb[0])
  const north = Number(bb[1])
  const west = Number(bb[2])
  const east = Number(bb[3])
  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return { ok: false as const, erro: 'Bounding box inválido para a cidade.' }
  }
  return {
    ok: true as const,
    bounds: { south, west, north, east },
    centro: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  }
}
