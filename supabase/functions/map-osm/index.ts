import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { nominatimSearchJson, normalizarParamsNominatim } from '../_shared/nominatim.ts'
import { overpassPoisNaArea } from '../_shared/overpass.ts'
import { clientIp, rateLimitOk } from '../_shared/requireUser.ts'

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  if (!rateLimitOk(`map-osm:${clientIp(req)}`, 45, 60_000)) {
    return jsonResponse({ error: 'Demasiados pedidos. Aguarde um momento.' }, 429)
  }

  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const url = new URL(req.url)
  const route = url.searchParams.get('route') || ''
  const isOverpass =
    route === 'overpass' ||
    (url.searchParams.has('categoria') &&
      url.searchParams.has('south') &&
      url.searchParams.has('north'))

  if (isOverpass) {
    const r = await overpassPoisNaArea({
      south: Number(url.searchParams.get('south')),
      west: Number(url.searchParams.get('west')),
      north: Number(url.searchParams.get('north')),
      east: Number(url.searchParams.get('east')),
      categoria: url.searchParams.get('categoria') || '',
      cidade: url.searchParams.get('cidade') || '',
      uf: url.searchParams.get('uf') || '',
    })
    if (!r.ok) {
      const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
      return jsonResponse({ error: r.erro || 'Falha na consulta Overpass.', codigo: undefined }, status)
    }
    return jsonResponse(
      { itens: r.itens || [] },
      200,
      { 'Cache-Control': 'private, max-age=300' },
    )
  }

  const params: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    if (k === 'route') return
    params[k] = v
  })
  const normalizado = normalizarParamsNominatim(params)
  const r = await nominatimSearchJson(normalizado)
  if (!r.ok) {
    const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
    return jsonResponse({ error: r.erro || 'Falha na consulta Nominatim.', codigo: r.codigo }, status)
  }
  return jsonResponse(r.data, 200, { 'Cache-Control': 'private, max-age=300' })
})
