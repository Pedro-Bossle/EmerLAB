/**
 * Destinatários / settings do Emer-Radar no Supabase (app_settings).
 * Funciona na Vercel sem worker local — o cron GitHub Actions lê a mesma tabela.
 */
import { supabase } from '../supabase.js'

export const EMER_RADAR_SETTINGS_KEY = 'emer_radar'

function cleanDestinatarios(dest) {
  if (!Array.isArray(dest)) return []
  const out = []
  for (const item of dest) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || '').trim()
    if (!id) continue
    out.push({
      id,
      nome: String(item.nome || id).trim() || id,
      enabled: item.enabled !== false,
    })
  }
  return out
}

/**
 * @returns {Promise<{ tarefa_destinatarios: { id: string, nome: string, enabled: boolean }[] }>}
 */
export async function loadEmerRadarSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', EMER_RADAR_SETTINGS_KEY)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const value = data?.value && typeof data.value === 'object' ? data.value : {}
  return {
    tarefa_destinatarios: cleanDestinatarios(value.tarefa_destinatarios),
  }
}

/**
 * @param {{ tarefa_destinatarios: { id: string, nome: string, enabled?: boolean }[] }} patch
 */
export async function saveEmerRadarSettings(patch) {
  const tarefa_destinatarios = cleanDestinatarios(patch?.tarefa_destinatarios)
  const value = { tarefa_destinatarios }
  const { data, error } = await supabase
    .from('app_settings')
    .upsert(
      {
        key: EMER_RADAR_SETTINGS_KEY,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    .select('value')
    .single()
  if (error) throw new Error(error.message)
  const saved = data?.value && typeof data.value === 'object' ? data.value : value
  return {
    tarefa_destinatarios: cleanDestinatarios(saved.tarefa_destinatarios),
  }
}
