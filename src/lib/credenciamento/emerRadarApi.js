/**
 * Cliente HTTP do worker Emer-Radar (FastAPI + Playwright).
 *
 * Dev: proxy Vite `/emeradar` → http://127.0.0.1:8000
 * Prod: VITE_EMERADAR_API_BASE=https://seu-worker.up.railway.app
 */

const DEFAULT_TERMS = [
  'clínica veterinária',
  'veterinário',
  'pet shop veterinário',
  'hospital veterinário',
]

export function getEmerRadarApiBase() {
  const raw = (import.meta.env.VITE_EMERADAR_API_BASE || '').trim().replace(/\/$/, '')
  return raw || '/emeradar'
}

export function getDefaultSearchTerms() {
  return [...DEFAULT_TERMS]
}

async function request(path, init = {}) {
  const base = getEmerRadarApiBase()
  const method = (init.method || 'GET').toUpperCase()
  const headers = { ...(init.headers || {}) }
  // Evita preflight CORS desnecessário em GET (Content-Type em GET quebra OPTIONS no browser)
  if (method !== 'GET' && method !== 'HEAD' && headers['Content-Type'] == null) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    let detail = 'Falha na requisição Emer-Radar'
    try {
      const body = await res.json()
      detail = body.detail || body.error || detail
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return null
  return res.json()
}

export async function emerRadarHealth() {
  return request('/api/health')
}

/* --- Prospect (Maps scrape) --- */

export function scrapeStart(body) {
  return request('/api/scrape/start', { method: 'POST', body: JSON.stringify(body) })
}

export function scrapeStop() {
  return request('/api/scrape/stop', { method: 'POST' })
}

export function scrapeStatus() {
  return request('/api/scrape/status')
}

export function scrapeResults() {
  return request('/api/results')
}

export function openScrapeStream(lastId = 0) {
  const base = getEmerRadarApiBase()
  return new EventSource(`${base}/api/scrape/stream?last_id=${lastId}`)
}

export function scrapeExportExcelUrl() {
  return `${getEmerRadarApiBase()}/api/results/export/excel`
}

export function scrapeExportPdfUrl() {
  return `${getEmerRadarApiBase()}/api/results/export/pdf`
}

export function geocodeEmerRadar(q, cidade, uf) {
  const params = new URLSearchParams({ q: q || '' })
  if (cidade) params.set('cidade', cidade)
  if (uf) params.set('uf', uf)
  return request(`/api/geocode?${params.toString()}`)
}

/**
 * Foto de fachada ao vivo (worker abre o Maps e devolve URL do CDN Google).
 * Não grava imagem no Supabase — só usa link_maps/nome.
 * @param {{ link_maps?: string, nome?: string, cidade?: string, uf?: string }} opts
 */
export function fetchPlacePhotoEmerRadar(opts = {}) {
  const params = new URLSearchParams()
  if (opts.link_maps) params.set('link_maps', opts.link_maps)
  if (opts.nome) params.set('nome', opts.nome)
  if (opts.cidade) params.set('cidade', opts.cidade)
  if (opts.uf) params.set('uf', opts.uf)
  const qs = params.toString()
  return request(`/api/place-photo${qs ? `?${qs}` : ''}`)
}

/* --- Pipeline --- */

export function listCities() {
  return request('/api/cities')
}

export function deleteCity(cidade, uf) {
  const params = new URLSearchParams({
    cidade: cidade || '',
    uf: uf || '',
  })
  return request(`/api/cities?${params.toString()}`, { method: 'DELETE' })
}

export function pipelinePreviewCities(cidades) {
  return request('/api/cities/preview', {
    method: 'POST',
    body: JSON.stringify({ cidades }),
  })
}

export function pipelineStart(body) {
  return request('/api/pipeline/start', { method: 'POST', body: JSON.stringify(body) })
}

export function pipelineStop() {
  return request('/api/pipeline/stop', { method: 'POST' })
}

export function pipelineStatus() {
  return request('/api/pipeline/status')
}

export function pipelineResults() {
  return request('/api/pipeline/results')
}

export function pipelineListRuns() {
  return request('/api/pipeline/runs')
}

export function pipelineGetRun(runId) {
  return request(`/api/pipeline/runs/${encodeURIComponent(runId)}`)
}

export function pipelineEnqueue(cidades) {
  return request('/api/pipeline/queue', {
    method: 'POST',
    body: JSON.stringify({ cidades }),
  })
}

export function openPipelineStream(lastId = 0) {
  const base = getEmerRadarApiBase()
  return new EventSource(`${base}/api/pipeline/stream?last_id=${lastId}`)
}

export function pipelineExportUrl(kind, runId) {
  const base = getEmerRadarApiBase()
  if (runId) {
    return `${base}/api/pipeline/runs/${encodeURIComponent(runId)}/export/${kind}`
  }
  return `${base}/api/pipeline/export/${kind}`
}

export function emerRadarGetSettings() {
  return request('/api/settings')
}

export function emerRadarSaveSettings(body) {
  return request('/api/settings', { method: 'PUT', body: JSON.stringify(body) })
}
