/**
 * Cliente HTTP do worker Emer-Radar (FastAPI + Playwright).
 *
 * - Dev: proxy Vite `/emeradar` → http://127.0.0.1:8000
 * - Prod: pipeline/cron via GitHub Actions (POST /api/emer-radar-cron);
 *   scraping interativo exige worker local.
 *
 * Override raro: VITE_EMERADAR_API_BASE + VITE_EMERADAR_DIRECT=true
 */

const DEFAULT_TERMS = [
  'clínica veterinária',
  'veterinário',
  'pet shop veterinário',
  'hospital veterinário',
]

export function getEmerRadarApiBase() {
  const direct = String(import.meta.env.VITE_EMERADAR_DIRECT || '').trim() === 'true'
  const raw = (import.meta.env.VITE_EMERADAR_API_BASE || '').trim().replace(/\/$/, '')
  if (direct && raw) return raw
  return '/emeradar'
}

/** Dispara o workflow Emer-Radar cron no GitHub Actions. */
export async function triggerEmerRadarCron(opts = {}) {
  const { data: sess } = await (await import('../supabase.js')).supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) throw new Error('Faça login para disparar o cron.')

  const res = await fetch('/api/emer-radar-cron', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ref: opts.ref || undefined }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `Falha ao disparar o cron (HTTP ${res.status}).`)
  }
  return json
}

export function getDefaultSearchTerms() {
  return [...DEFAULT_TERMS]
}

/** True quando a app corre fora de localhost (Vercel / domínio). */
export function isEmerRadarAmbienteRemoto() {
  if (typeof window === 'undefined') return Boolean(import.meta.env.PROD)
  const host = String(window.location.hostname || '').toLowerCase()
  return host !== 'localhost' && host !== '127.0.0.1'
}

async function request(path, init = {}) {
  const base = getEmerRadarApiBase()
  const method = (init.method || 'GET').toUpperCase()
  const headers = { ...(init.headers || {}) }
  // Evita preflight CORS desnecessário em GET (Content-Type em GET quebra OPTIONS no browser)
  if (method !== 'GET' && method !== 'HEAD' && headers['Content-Type'] == null) {
    headers['Content-Type'] = 'application/json'
  }
  let res
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers,
    })
  } catch (e) {
    const msg = e?.message || String(e)
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        'Worker Emer-Radar inacessível (rede). Em local: python backend/main.py na pasta teste-emeradar (porta 8000).',
      )
    }
    throw e
  }

  const ct = String(res.headers.get('content-type') || '')
  const text = await res.text()
  const pareceHtml = /^\s*</.test(text) || /text\/html/i.test(ct)

  if (pareceHtml) {
    // Em produção /emeradar não existe → Vercel devolve index.html da SPA.
    if (isEmerRadarAmbienteRemoto()) {
      throw new Error('WORKER_AUSENTE_PROD')
    }
    throw new Error(
      'Proxy /emeradar devolveu HTML (worker parado?). Na pasta teste-emeradar rode: python backend/main.py',
    )
  }

  let body = null
  if (text && res.status !== 204) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(
        `Resposta inválida do Emer-Radar (HTTP ${res.status}). Confirme o worker na porta 8000.`,
      )
    }
  }

  if (!res.ok) {
    const detail = body?.detail || body?.error || 'Falha na requisição Emer-Radar'
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return null
  return body
}

export async function emerRadarHealth() {
  // Em produção não há worker hospedado — o cron corre no GitHub Actions.
  if (isEmerRadarAmbienteRemoto()) {
    return { ok: false, mode: 'actions-only', message: 'WORKER_AUSENTE_PROD' }
  }
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

export function pipelineListQueue() {
  return request('/api/pipeline/queue?limit=50')
}

export function pipelineRemoveFromQueue(itemId) {
  return request(`/api/pipeline/queue/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
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
