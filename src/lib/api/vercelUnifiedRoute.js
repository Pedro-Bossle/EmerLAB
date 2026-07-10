/**
 * Após rewrite na Vercel, req.url costuma ser o destino (/api/map-osm), não a URL pública.
 * vercel.json adiciona ?_route=…; em dev local o pathname original ainda funciona.
 */

const ROUTE_PARAM = '_route'

export function searchRouteFlag(req) {
    const fromQuery = req?.query?.[ROUTE_PARAM]
    if (fromQuery != null && fromQuery !== '') {
        return Array.isArray(fromQuery) ? String(fromQuery[0]) : String(fromQuery)
    }
    try {
        const u = new URL(req?.url || '/', 'http://localhost')
        return u.searchParams.get(ROUTE_PARAM) || ''
    } catch {
        return ''
    }
}

export function pathnameOf(req) {
    try {
        return new URL(req?.url || '/', 'http://localhost').pathname
    } catch {
        return ''
    }
}

export function isOverpassOsmRequest(req) {
    const flag = searchRouteFlag(req)
    if (flag === 'overpass') return true
    if (flag === 'nominatim') return false
    return pathnameOf(req).includes('overpass-poi')
}

export function isGeminiStatusRequest(req) {
    const flag = searchRouteFlag(req)
    if (flag === 'gemini-status') return true
    return pathnameOf(req).includes('prospectos-gemini-status')
}

/** Remove _route dos params repassados ao Nominatim. */
export function queryParamsSemRota(req) {
    const params = {}
    const u = new URL(req?.url || '/', 'http://localhost')
    for (const [k, v] of u.searchParams.entries()) {
        if (k === ROUTE_PARAM) continue
        params[k] = v
    }
    return params
}
