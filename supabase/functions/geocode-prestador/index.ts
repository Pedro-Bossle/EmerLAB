import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'
import { geocodificarESalvarPrestador } from '../_shared/geocodePrestador.ts'
import {
  clientIp,
  podeCredenciamentoEdit,
  rateLimitOk,
  requireUserProfile,
} from '../_shared/requireUser.ts'

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método não permitido.' }, 405)
  }

  const ip = clientIp(req)
  if (!rateLimitOk(`geocode:${ip}`, 30, 60_000)) {
    return jsonResponse({ ok: false, error: 'Demasiados pedidos. Aguarde um momento.' }, 429)
  }

  const auth = await requireUserProfile(req)
  if ('error' in auth && auth.error) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status || 401)
  }
  const permissions = (auth.profile?.permissions || {}) as Record<string, unknown>
  if (!podeCredenciamentoEdit(permissions)) {
    return jsonResponse({ ok: false, error: 'Sem permissão para geocodificar.' }, 403)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const prestadorId = Number(body.prestadorId)
    if (!prestadorId) {
      return jsonResponse({ ok: false, error: 'Informe prestadorId.' }, 400)
    }

    const supabase = createServiceClient()
    const resultado = await geocodificarESalvarPrestador(supabase, prestadorId, {
      forcar: Boolean(body.forcar),
    })
    if (!resultado.ok && !resultado.skipped) {
      return jsonResponse({ ok: false, ...resultado }, 422)
    }
    return jsonResponse({ ok: true, ...resultado })
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error)?.message || 'Falha na geocodificação.' }, 500)
  }
})
