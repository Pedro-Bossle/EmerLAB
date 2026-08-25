/**
 * Auth helpers para Edge Functions.
 * IMPORTANTE: a lógica de permissões deve permanecer alinhada com
 * src/lib/accessControl.js + src/lib/permissionCatalog.js (Node/Vercel).
 * Qualquer alteração de contrato ACL/legado deve ser espelhada nos dois backends.
 */
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
    .select('id, name, email, permissions, force_password_change, password_changed_at')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) return { error: 'Perfil não encontrado.', status: 403 as const }
  return { user: userData.user, profile, admin }
}

/** Espelha permissionCatalog.aclKey */
function aclKey(toolId: string, action: string) {
  return `${toolId}.${action}`
}

/** Truthy como no Node (Boolean / string / 1). */
function isTruthyPerm(val: unknown): boolean {
  return val === true || val === 'true' || val === 1 || val === '1'
}

function hasLegacy(permissions: Record<string, unknown> | null | undefined, key: string) {
  const p = permissions || {}
  return isTruthyPerm(p[key])
}

function hasAcl(
  permissions: Record<string, unknown> | null | undefined,
  toolId: string,
  action: string,
) {
  const p = permissions || {}
  if (isTruthyPerm(p[aclKey(toolId, action)])) return true
  // Formato aninhado legado (objeto { read: true })
  const block = p[toolId]
  if (block && typeof block === 'object' && isTruthyPerm((block as Record<string, unknown>)[action])) {
    return true
  }
  return false
}

function hasAclRead(permissions: Record<string, unknown> | null | undefined, toolId: string) {
  return hasAcl(permissions, toolId, 'read')
}

function hasAclWrite(permissions: Record<string, unknown> | null | undefined, toolId: string) {
  return (
    hasAcl(permissions, toolId, 'update') ||
    hasAcl(permissions, toolId, 'create') ||
    hasAcl(permissions, toolId, 'delete')
  )
}

export function podeCredenciamentoView(permissions: Record<string, unknown> | null | undefined) {
  return (
    hasLegacy(permissions, 'credenciamento.view') ||
    hasAclRead(permissions, 'credenciamento.processos') ||
    hasAclRead(permissions, 'credenciamento.prospectos_osm') ||
    hasAclRead(permissions, 'credenciamento.cadastro')
  )
}

export function podeCredenciamentoEdit(permissions: Record<string, unknown> | null | undefined) {
  return (
    hasLegacy(permissions, 'credenciamento.edit') ||
    hasAclWrite(permissions, 'credenciamento.processos') ||
    hasAclWrite(permissions, 'credenciamento.prospectos_osm') ||
    hasAclWrite(permissions, 'credenciamento.cadastro')
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
  if (lista.length === 0) {
    buckets.delete(key)
  }
  if (lista.length >= limit) {
    buckets.set(key, lista)
    return false
  }
  lista.push(agora)
  buckets.set(key, lista)
  return true
}

/**
 * IP do cliente: último hop de x-forwarded-for (proxy), nunca o primeiro (spoofável).
 */
export function clientIp(req: Request): string {
  const xfRaw = req.headers.get('x-forwarded-for') || ''
  const hops = xfRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (hops.length) return hops[hops.length - 1]
  return req.headers.get('x-real-ip') || 'unknown'
}
