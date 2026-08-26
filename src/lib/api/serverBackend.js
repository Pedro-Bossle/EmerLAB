/**
 * Roteamento de APIs de servidor: Supabase Edge Functions ou legado /api (Vite/Vercel).
 *
 * Ative Edge: VITE_SUPABASE_EDGE_API=true no .env.local (após deploy das functions).
 */

const EDGE_ROUTE_MAP = {
  'cep-lookup': 'cep-lookup',
  'consulta-cnpj': 'consulta-cnpj',
  'nominatim-search': 'map-osm',
  'overpass-poi': 'map-osm',
  'geocode-prestador': 'geocode-prestador',
  'prospectos-osm-coletar': 'prospectos-coletar',
  'prospectos-gemini-status': 'prospectos-coletar',
  'gemini-rate': 'prospectos-coletar',
}

/** Rotas que exigem JWT do utilizador (não só anon key). */
const ROTAS_COM_JWT_UTILIZADOR = new Set([
  'consulta-cnpj',
  'geocode-prestador',
  'prospectos-osm-coletar',
  'prospectos-gemini-status',
  'gemini-rate',
])

/** @param {'cep-lookup'|'consulta-cnpj'|'nominatim-search'|'overpass-poi'|'geocode-prestador'|'prospectos-osm-coletar'|'prospectos-gemini-status'|'gemini-rate'} routeId */
export function useSupabaseEdgeApi(routeId) {
  const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
  const flag = String(env.VITE_SUPABASE_EDGE_API || '').trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'vercel') return false
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'edge') return Boolean(EDGE_ROUTE_MAP[routeId])
  return false
}

function supabaseProjectUrl() {
  const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
  return (
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '')
}

function anonKey() {
  const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
  return (
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  )
}

function viteApiPrefix() {
  const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
  const base = String(env.BASE_URL || '/')
  if (base === '/' || base === '') return ''
  return base.replace(/\/$/, '')
}

/**
 * @param {'cep-lookup'|'consulta-cnpj'|'nominatim-search'|'overpass-poi'|'geocode-prestador'|'prospectos-osm-coletar'|'prospectos-gemini-status'|'gemini-rate'} routeId
 * @param {Record<string, string>} [queryParams]
 */
export function buildServerApiUrl(routeId, queryParams = {}) {
  if (useSupabaseEdgeApi(routeId)) {
    const fn = EDGE_ROUTE_MAP[routeId]
    const url = new URL(`${supabaseProjectUrl()}/functions/v1/${fn}`)
    if (routeId === 'nominatim-search') {
      url.searchParams.set('route', 'nominatim')
    }
    if (routeId === 'overpass-poi') {
      url.searchParams.set('route', 'overpass')
    }
    if (routeId === 'prospectos-gemini-status') {
      url.searchParams.set('route', 'gemini-status')
    }
    if (routeId === 'gemini-rate') {
      url.searchParams.set('route', 'gemini-rate')
    }
    for (const [k, v] of Object.entries(queryParams)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  const legacyPath = {
    'cep-lookup': '/api/cep-lookup',
    'consulta-cnpj': '/api/consulta-cnpj',
    'nominatim-search': '/api/nominatim-search',
    'overpass-poi': '/api/overpass-poi',
    'geocode-prestador': '/api/geocode-prestador',
    'prospectos-osm-coletar': '/api/prospectos-osm-coletar',
    'prospectos-gemini-status': '/api/prospectos-gemini-status',
    'gemini-rate': '/api/gemini-rate',
  }[routeId]

  const url = new URL(`${viteApiPrefix()}${legacyPath}`, window.location.origin)
  for (const [k, v] of Object.entries(queryParams)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  return url.toString()
}

/** Headers com JWT do utilizador logado (quando existir). */
export async function userAccessTokenHeaders() {
  try {
    const { supabase } = await import('../supabase.js')
    if (!supabase) return {}
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

/**
 * Headers de auth para APIs de servidor.
 * Edge: anon key + (se rota protegida) JWT do user.
 * Legacy /api: JWT do user nas rotas protegidas.
 */
export async function serverApiAuthHeaders(routeId = 'geocode-prestador') {
  const headers = {}
  if (useSupabaseEdgeApi(routeId)) {
    const key = anonKey()
    if (key) {
      headers.Authorization = `Bearer ${key}`
      headers.apikey = key
    }
  }
  if (ROTAS_COM_JWT_UTILIZADOR.has(routeId) || !useSupabaseEdgeApi(routeId)) {
    const user = await userAccessTokenHeaders()
    if (user.Authorization) {
      headers.Authorization = user.Authorization
      if (useSupabaseEdgeApi(routeId) && anonKey()) {
        headers.apikey = anonKey()
      }
    }
  }
  return headers
}

/**
 * POST JSON para rota de servidor (Edge ou /api).
 * @param {'geocode-prestador'|'prospectos-osm-coletar'} routeId
 */
export async function postServerApiJson(routeId, body, init = {}) {
  const url = buildServerApiUrl(routeId)
  const authHeaders = await serverApiAuthHeaders(routeId)
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...authHeaders,
    ...(init.headers || {}),
  }
  return fetch(url, { ...init, method: 'POST', headers, body: JSON.stringify(body ?? {}) })
}

/**
 * Invoca function com JWT do usuário logado (quando verify_jwt=true).
 */
export async function invokeEdgeFunction(functionName, { body, method = 'POST' } = {}) {
  const { supabase } = await import('../supabase.js')
  if (!supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body ?? {},
    method,
  })
  if (error) throw error
  return data
}

export const ROTA_CONSULTA_CNPJ_EDGE = 'consulta-cnpj'
