/**
 * Chamadas ao Nominatim apenas no servidor (API / scripts Node).
 * Política OSM: máx. ~1 req/s; User-Agent identificável.
 */

import { fetchComTimeout } from './fetchComTimeout.js'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_FETCH_TIMEOUT_MS = 45_000
const MIN_INTERVAL_MS = 1100
const CACHE_TTL_MS = 15 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

const contact = String(process.env.NOMINATIM_CONTACT_EMAIL || process.env.CONTACT_EMAIL || '').trim()
const USER_AGENT = contact
    ? `Emerdog-SFSC-Supertool/1.0 (${contact})`
    : 'Emerdog-SFSC-Supertool/1.0 (credenciamento mapa)'

/** @type {Map<string, { expiresAt: number, data: unknown }>} */
const cache = new Map()

let fila = Promise.resolve()
let ultimaReqEm = 0

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

export function normalizarParamsNominatim(raw = {}) {
    const out = { format: 'json' }
    for (const [k, v] of Object.entries(raw)) {
        if (!PARAMS_PERMITIDOS.has(k)) continue
        if (v === undefined || v === null || v === '') continue
        out[k] = String(v)
    }
    if (!out.format) out.format = 'json'
    return out
}

function chaveCache(params) {
    const keys = Object.keys(params).sort()
    return keys.map((k) => `${k}=${params[k]}`).join('&')
}

function limparCacheAntigo() {
    const agora = Date.now()
    for (const [k, v] of cache) {
        if (v.expiresAt <= agora) cache.delete(k)
    }
    while (cache.size > CACHE_MAX_ENTRIES) {
        const first = cache.keys().next().value
        if (first === undefined) break
        cache.delete(first)
    }
}

function lerCache(chave) {
    const hit = cache.get(chave)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
        cache.delete(chave)
        return null
    }
    return hit.data
}

function gravarCache(chave, data) {
    limparCacheAntigo()
    cache.set(chave, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

function aguardarVagaNaFila() {
    fila = fila.then(async () => {
        const agora = Date.now()
        const espera = Math.max(0, MIN_INTERVAL_MS - (agora - ultimaReqEm))
        if (espera > 0) await new Promise((r) => setTimeout(r, espera))
        ultimaReqEm = Date.now()
    })
    return fila
}

/**
 * @param {Record<string, string>} params
 * @returns {Promise<{ ok: boolean, data?: unknown, status?: number, codigo?: string, erro?: string }>}
 */
export async function nominatimSearchJson(params) {
    const normalizado = normalizarParamsNominatim(params)
    const temBusca = Boolean(normalizado.q || normalizado.postalcode)
    if (!temBusca) {
        return { ok: false, status: 400, erro: 'Informe q ou postalcode.' }
    }

    const chave = chaveCache(normalizado)
    const emCache = lerCache(chave)
    if (emCache !== null) {
        return { ok: true, data: emCache, fromCache: true }
    }

    await aguardarVagaNaFila()

    const url = new URL(NOMINATIM_BASE)
    for (const [k, v] of Object.entries(normalizado)) {
        url.searchParams.set(k, v)
    }

    let resp
    try {
        resp = await fetchComTimeout(
            url.toString(),
            {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': USER_AGENT,
                },
            },
            NOMINATIM_FETCH_TIMEOUT_MS,
        )
    } catch (e) {
        return { ok: false, status: 502, erro: e?.message || 'Falha ao contactar Nominatim.' }
    }

    if (resp.status === 429) {
        return {
            ok: false,
            status: 429,
            codigo: 'rate_limit',
            erro: 'Limite de consultas ao mapa (OpenStreetMap). Aguarde alguns segundos e tente de novo.',
        }
    }

    if (!resp.ok) {
        return { ok: false, status: resp.status, erro: `Nominatim HTTP ${resp.status}` }
    }

    let data
    try {
        data = await resp.json()
    } catch {
        return { ok: false, status: 502, erro: 'Resposta inválida do Nominatim.' }
    }

    gravarCache(chave, data)
    return { ok: true, data }
}
