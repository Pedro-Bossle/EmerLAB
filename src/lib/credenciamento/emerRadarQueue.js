/**
 * Fila do cron + cooldown de cidades via Supabase (mesmas tabelas do worker/Actions).
 * Evita PUT/POST em /emeradar na Vercel (405 sem worker).
 */
import { supabase } from '../supabase.js'

export const COOLDOWN_DAYS = 70

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Mesma chave do worker Python (`city_key` em ports.py). */
function cityKey(cidade, uf) {
  return `${String(cidade || '').trim().toLowerCase()}|${String(uf || '').trim().toUpperCase()}`
}

function statusFromRegistry(rec, cidade, uf, today = todayYmd()) {
  if (!rec) {
    return {
      key: cityKey(cidade, uf),
      cidade: String(cidade || '').trim(),
      uf: String(uf || '').trim().toUpperCase(),
      vezes_requisitada: 0,
      ultima_pesquisa_em: null,
      liberada_em: null,
      em_cooldown: false,
      dias_restantes: 0,
      disponivel: true,
    }
  }
  const liberada = rec.liberada_em ? String(rec.liberada_em).slice(0, 10) : null
  const em_cooldown = Boolean(liberada && liberada > today)
  let dias_restantes = 0
  if (em_cooldown && liberada) {
    const a = new Date(`${today}T12:00:00`)
    const b = new Date(`${liberada}T12:00:00`)
    dias_restantes = Math.max(0, Math.round((b - a) / 86400000))
  }
  return {
    ...rec,
    cidade: rec.cidade || String(cidade || '').trim(),
    uf: (rec.uf || String(uf || '').trim()).toUpperCase(),
    em_cooldown,
    dias_restantes,
    disponivel: !em_cooldown,
  }
}

function normalizePares(cidades) {
  const out = []
  for (const item of cidades || []) {
    const cidade = String(item?.cidade || '').trim()
    const uf = String(item?.uf || '')
      .trim()
      .toUpperCase()
      .slice(0, 2)
    if (!cidade || uf.length !== 2) continue
    out.push({ cidade, uf })
  }
  return out
}

/** @returns {Promise<{ cities: object[], cooldown_days: number }>} */
export async function listCitiesFromDb() {
  const { data, error } = await supabase
    .from('city_registry')
    .select('key, cidade, uf, vezes_requisitada, ultima_pesquisa_em, liberada_em, updated_at')
    .order('uf', { ascending: true })
    .order('cidade', { ascending: true })
  if (error) throw new Error(error.message)
  const today = todayYmd()
  const cities = (data || []).map((rec) => statusFromRegistry(rec, rec.cidade, rec.uf, today))
  return { cities, cooldown_days: COOLDOWN_DAYS }
}

export async function deleteCityFromDb(cidade, uf) {
  const key = cityKey(cidade, uf)
  const { error } = await supabase.from('city_registry').delete().eq('key', key)
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** @returns {Promise<{ cities: object[], cooldown_days: number }>} */
export async function previewCitiesFromDb(cidades) {
  const pares = normalizePares(cidades)
  if (!pares.length) return { cities: [], cooldown_days: COOLDOWN_DAYS }

  const keys = pares.map((p) => cityKey(p.cidade, p.uf))
  const { data, error } = await supabase
    .from('city_registry')
    .select('key, cidade, uf, vezes_requisitada, ultima_pesquisa_em, liberada_em, updated_at')
    .in('key', keys)
  if (error) throw new Error(error.message)

  const byKey = new Map((data || []).map((r) => [r.key, r]))
  const today = todayYmd()
  const cities = pares.map((p) => {
    const k = cityKey(p.cidade, p.uf)
    return statusFromRegistry(byKey.get(k), p.cidade, p.uf, today)
  })
  return { cities, cooldown_days: COOLDOWN_DAYS }
}

function mapQueueRow(r) {
  return {
    id: r.id,
    cidade: r.cidade,
    uf: r.uf,
    status: r.status,
    error: r.error,
    run_id: r.run_id,
    created_at: r.created_at,
    started_at: r.started_at,
    finished_at: r.finished_at,
  }
}

/** @returns {Promise<{ queue: object[] }>} */
export async function listPipelineQueueFromDb(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
  let q = supabase
    .from('pipeline_queue')
    .select('id, cidade, uf, status, error, run_id, created_at, started_at, finished_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return { queue: (data || []).map(mapQueueRow) }
}

/** @returns {Promise<{ ok: boolean, enqueued: number, queue: object[] }>} */
export async function enqueuePipelineCitiesFromDb(cidades) {
  const pares = normalizePares(cidades)
  if (!pares.length) {
    const listed = await listPipelineQueueFromDb({ limit: 50 })
    return { ok: true, enqueued: 0, queue: listed.queue }
  }
  const rows = pares.map((p) => ({ cidade: p.cidade, uf: p.uf, status: 'pending' }))
  const { error } = await supabase.from('pipeline_queue').insert(rows)
  if (error) throw new Error(error.message)
  const listed = await listPipelineQueueFromDb({ limit: 50 })
  return { ok: true, enqueued: rows.length, queue: listed.queue }
}

/** @returns {Promise<{ ok: boolean, removed: number, queue: object[] }>} */
export async function removePipelineQueueItemFromDb(itemId) {
  const id = Number(itemId)
  if (!Number.isFinite(id)) throw new Error('ID inválido na fila.')
  const { data, error } = await supabase
    .from('pipeline_queue')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(error.message)
  const removed = (data || []).length
  if (!removed) {
    throw new Error('Essa cidade não está pendente na fila (já pode estar em execução).')
  }
  const listed = await listPipelineQueueFromDb({ limit: 50 })
  return { ok: true, removed, queue: listed.queue }
}
