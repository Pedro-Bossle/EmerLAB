import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export function getBearerToken(req: Request): string {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  return String(h).replace(/^Bearer\s+/i, '').trim()
}

export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function requireUserProfile(req: Request) {
  const token = getBearerToken(req)
  if (!token) return { error: 'Sessão ausente.', status: 401 as const }

  const admin = createServiceClient()
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData?.user?.id) return { error: 'Sessão inválida.', status: 401 as const }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, name, email, permissions')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) return { error: 'Perfil não encontrado.', status: 403 as const }
  return { user: userData.user, profile, admin }
}

function hasLegacy(permissions: Record<string, unknown> | null | undefined, key: string) {
  const p = permissions || {}
  return p[key] === true || p[key] === 'true' || p[key] === 1
}

function hasAclRead(permissions: Record<string, unknown> | null | undefined, toolId: string) {
  const p = permissions || {}
  const block = p[toolId]
  if (block && typeof block === 'object' && (block as { read?: boolean }).read === true) return true
  return false
}

export function podeCredenciamentoView(permissions: Record<string, unknown> | null | undefined) {
  return (
    hasLegacy(permissions, 'credenciamento.view') ||
    hasAclRead(permissions, 'credenciamento.processos') ||
    hasAclRead(permissions, 'credenciamento.prospectos_osm')
  )
}

export function podeFerramentaProspectos(permissions: Record<string, unknown> | null | undefined) {
  return podeCredenciamentoView(permissions) && hasAclRead(permissions, 'credenciamento.prospectos_osm')
}

/** Rate limit simples por IP (memória da isolate). */
const buckets = new Map<string, number[]>()

export function rateLimitOk(key: string, limit: number, windowMs: number): boolean {
  const agora = Date.now()
  const lista = (buckets.get(key) || []).filter((t) => agora - t < windowMs)
  if (lista.length >= limit) {
    buckets.set(key, lista)
    return false
  }
  lista.push(agora)
  buckets.set(key, lista)
  return true
}

export function clientIp(req: Request): string {
  const xf = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return xf || req.headers.get('x-real-ip') || 'unknown'
}
