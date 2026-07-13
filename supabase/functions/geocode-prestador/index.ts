import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'
import { geocodificarESalvarPrestador } from '../_shared/geocodePrestador.ts'

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método não permitido.' }, 405)
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

    if (!resultado.ok && !('skipped' in resultado && resultado.skipped)) {
      return jsonResponse({ ok: false, ...resultado }, 422)
    }
    return jsonResponse({ ok: true, ...resultado })
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error)?.message || 'Falha na geocodificação.' }, 500)
  }
})
