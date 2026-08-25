/**
 * Proxy mapas OSM unificado (limite Hobby Vercel: menos Serverless Functions).
 * GET /api/nominatim-search?...  ou  GET /api/overpass-poi?...
 * (rewrites em vercel.json mantêm URLs antigas + ?_route=…)
 */
import { nominatimSearchJson, normalizarParamsNominatim } from '../src/lib/credenciamento/nominatimUpstream.js'
import { overpassPoisNaArea } from '../src/lib/credenciamento/overpassUpstream.js'
import { isOverpassOsmRequest, queryParamsSemRota } from '../src/lib/api/vercelUnifiedRoute.js'
import { getClientIp } from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'

async function handleNominatim(req, res) {
    const params = queryParamsSemRota(req)
    const normalizado = normalizarParamsNominatim(params)
    const r = await nominatimSearchJson(normalizado)
    if (!r.ok) {
        const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
        res.status(status).json({
            error: r.erro || 'Falha na consulta Nominatim.',
            codigo: r.codigo || undefined,
        })
        return
    }
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.status(200).json(r.data)
}

async function handleOverpass(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const r = await overpassPoisNaArea({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
        categoria: url.searchParams.get('categoria') || '',
    })
    if (!r.ok) {
        const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
        res.status(status).json({
            error: r.erro || 'Falha na consulta Overpass.',
            codigo: r.codigo || undefined,
        })
        return
    }
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.status(200).json({ itens: r.itens || [] })
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }
    const ip = getClientIp(req)
    if (!aplicarRateLimit(res, `map-osm:${ip}`, RATE_LIMITS.mapOsm)) return

    if (req.method === 'HEAD') {
        res.status(200).end()
        return
    }
    if (isOverpassOsmRequest(req)) {
        await handleOverpass(req, res)
        return
    }
    await handleNominatim(req, res)
}
