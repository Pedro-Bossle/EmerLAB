import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { createServiceClient } from '../_shared/supabaseAdmin.ts'
import { geminiVerificarDisponibilidade, lerRate } from '../_shared/gemini.ts'
import { executarPassoJobColeta, iniciarJobColeta } from '../_shared/prospectosJob.ts'

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  const url = new URL(req.url)
  const route = url.searchParams.get('route') || ''

  if (req.method === 'GET' && (route === 'gemini-rate' || url.pathname.endsWith('gemini-rate'))) {
    return jsonResponse(lerRate())
  }

  if (req.method === 'GET' && (route === 'gemini-status' || url.pathname.endsWith('gemini-status'))) {
    const r = await geminiVerificarDisponibilidade()
    return jsonResponse({
      configurado: r.configurado,
      disponivel: r.disponivel,
      quotaExceeded: Boolean(r.quotaExceeded),
      modeloInvalido: Boolean(r.modeloInvalido),
      httpStatus: r.httpStatus,
      modelo: r.modelo,
      erro: r.erro,
      verificadoEm: new Date().toISOString(),
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  try {
    const supabase = createServiceClient()
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'start').trim().toLowerCase()

    if (action === 'step') {
      const jobId = String(body.jobId || '').trim()
      if (!jobId) return jsonResponse({ error: 'Informe jobId.' }, 400)
      const r = await executarPassoJobColeta(supabase, jobId)
      const base = {
        jobId: r.jobId,
        status: r.status,
        async: true,
        progresso: 'progresso' in r ? r.progresso : undefined,
        passoAtual: 'passoAtual' in r ? r.passoAtual : undefined,
        passosTotais: 'passosTotais' in r ? r.passosTotais : undefined,
        inseridos: 'inseridos' in r ? r.inseridos : undefined,
        ...(r.resultado && typeof r.resultado === 'object' ? r.resultado : {}),
      }
      if (r.status === 'failed' || !r.ok) {
        return jsonResponse({ ...base, error: r.erro || 'Falha na coleta.' }, 502)
      }
      if (r.status === 'done') {
        return jsonResponse({ ok: true, ...base })
      }
      return jsonResponse({ ok: true, ...base })
    }

    if (action === 'start') {
      const cidade = String(body.cidade || '').trim()
      if (!cidade) return jsonResponse({ error: 'Informe cidade.' }, 400)
      const start = await iniciarJobColeta(supabase, {
        cidade,
        uf: String(body.uf || '').trim(),
        fonte: body.fonte,
        omitirGemini: Boolean(body.omitirGemini),
        categorias: body.categorias,
      })
      if (!start.ok) return jsonResponse({ error: start.erro || 'Não foi possível iniciar a coleta.' }, 502)
      return jsonResponse(
        {
          ok: true,
          async: true,
          jobId: start.jobId,
          status: start.status,
          progresso: start.progresso,
          passoAtual: start.passoAtual,
          passosTotais: start.passosTotais,
        },
        202,
      )
    }

    return jsonResponse({ error: 'Ação inválida. Use action: start ou step.' }, 400)
  } catch (e) {
    return jsonResponse({ error: (e as Error)?.message || 'Erro interno.' }, 500)
  }
})
