import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { coletarProspectosGeminiCidade } from './prospectosGeminiColeta.ts'
import {
  coletarCategoriaProspectosOsm,
  listaCategoriasColeta,
  resolverBoundsProspectosOsm,
  rotuloCategoriaColeta,
} from './prospectosOsmSteps.ts'

export const TABELA_COLETA_JOBS = 'cred_prospectos_coleta_jobs'

function fallbackOsmHabilitado() {
  const v = String(Deno.env.get('PROSPECTOS_GEMINI_FALLBACK_OSM') ?? 'false').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Pedido da UI tem prioridade; default gemini (nunca OSM por omissão). */
function resolverFonteColeta(pedida?: string) {
  const p = String(pedida || '').trim().toLowerCase()
  if (p === 'gemini' || p === 'osm' || p === 'auto') return p
  const env = String(Deno.env.get('PROSPECTOS_COLETA_FONTE') || '').trim().toLowerCase()
  if (env === 'gemini' || env === 'osm' || env === 'auto') return env
  if (String(Deno.env.get('GEMINI_API_KEY') || '').trim()) return 'gemini'
  return 'gemini'
}

function contarPassos(payload: Record<string, unknown>) {
  if (payload.fonte === 'gemini' || !fallbackOsmHabilitado()) return 1
  let n = 0
  if (payload.tentarGemini) n += 1
  n += 1
  n += ((payload.categorias as string[]) || []).length
  return Math.max(1, n)
}

function metaInicial(opts: Record<string, unknown>) {
  const cidade = String(opts.cidade || '').trim()
  const uf = String(opts.uf || '').trim()
  const omitirGemini = Boolean(opts.omitirGemini)
  const fonte = resolverFonteColeta(String(opts.fonte || ''))
  const categorias = listaCategoriasColeta(opts.categorias as string[] | undefined)
  const osmPermitido = fonte === 'osm' || (fonte === 'auto' && fallbackOsmHabilitado())
  const tentarGemini = fonte === 'gemini' || (fonte === 'auto' && !omitirGemini)
  const payload = {
    cidade,
    uf,
    fonte,
    omitirGemini,
    tentarGemini,
    categorias,
    fase: tentarGemini ? 'gemini' : osmPermitido ? 'bounds' : 'gemini',
    catIndex: 0,
    bounds: null as null | { south: number; west: number; north: number; east: number },
    erros: [] as string[],
    avisos: [] as string[],
    geminiSnapshot: null as Record<string, unknown> | null,
    fallbackDeGemini: false,
    coletaDiretaOsm: fonte === 'osm' || (fonte === 'auto' && omitirGemini && osmPermitido),
  }
  return { cidade, uf, payload, passos_totais: contarPassos(payload) }
}

async function atualizarJob(supabase: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from(TABELA_COLETA_JOBS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function iniciarJobColeta(supabaseAdmin: SupabaseClient, opts: Record<string, unknown>) {
  const ini = metaInicial(opts)
  if (!ini.cidade) return { ok: false as const, erro: 'Informe cidade.' }

  const { data, error } = await supabaseAdmin
    .from(TABELA_COLETA_JOBS)
    .insert({
      status: 'running',
      cidade: ini.cidade,
      uf: ini.uf,
      progresso_texto: 'Iniciando coleta…',
      passo_atual: 0,
      passos_totais: ini.passos_totais,
      payload: ini.payload,
    })
    .select('*')
    .single()

  if (error) {
    const msg =
      error.message?.includes('does not exist') || error.code === '42P01'
        ? 'Tabela cred_prospectos_coleta_jobs ausente. Execute scripts/sql/cred_prospectos_coleta_jobs.sql.'
        : error.message
    return { ok: false as const, erro: msg }
  }
  return {
    ok: true as const,
    jobId: data.id,
    status: data.status,
    progresso: data.progresso_texto,
    passoAtual: data.passo_atual,
    passosTotais: data.passos_totais,
  }
}

export async function executarPassoJobColeta(supabaseAdmin: SupabaseClient, jobId: string) {
  const { data: job, error: loadErr } = await supabaseAdmin
    .from(TABELA_COLETA_JOBS)
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (loadErr) return { ok: false as const, erro: loadErr.message }
  if (!job) return { ok: false as const, erro: 'Job não encontrado.' }
  if (job.status === 'done') {
    return {
      ok: true as const,
      jobId: job.id,
      status: job.status,
      progresso: job.progresso_texto,
      passoAtual: job.passo_atual,
      passosTotais: job.passos_totais,
      inseridos: job.inseridos_total,
      resultado: job.resultado,
    }
  }
  if (job.status === 'failed') {
    return {
      ok: false as const,
      jobId: job.id,
      status: job.status,
      erro: job.erro,
      resultado: job.resultado,
    }
  }

  const p = { ...(job.payload as Record<string, unknown>) }
  const cidade = job.cidade as string
  const uf = job.uf as string
  let inseridosDelta = 0
  let progresso = job.progresso_texto as string
  let passo = job.passo_atual as number

  try {
    if (p.fase === 'gemini') {
      progresso = 'Tentando coleta via Gemini…'
      const gem = await coletarProspectosGeminiCidade(supabaseAdmin, { cidade, uf })
      passo += 1
      if (gem.ok) {
        const resultado = {
          ok: true,
          inseridos: gem.inseridos ?? 0,
          fonte: 'gemini',
          modoColeta: p.fonte,
          aviso: gem.aviso || '',
        }
        const done = await atualizarJob(supabaseAdmin, job.id, {
          status: 'done',
          passo_atual: passo,
          inseridos_total: (job.inseridos_total || 0) + (gem.inseridos ?? 0),
          progresso_texto: 'Concluído (Gemini).',
          resultado,
        })
        return {
          ok: true as const,
          jobId: done.id,
          status: done.status,
          progresso: done.progresso_texto,
          passoAtual: done.passo_atual,
          passosTotais: done.passos_totais,
          inseridos: done.inseridos_total,
          resultado,
        }
      }
      p.geminiSnapshot = { quotaExceeded: gem.quotaExceeded, erro: gem.erro || '' }
      const podeFallback = fallbackOsmHabilitado() && p.fonte === 'auto'
      if (!podeFallback || p.fonte === 'gemini') {
        const failed = await atualizarJob(supabaseAdmin, job.id, {
          status: 'failed',
          passo_atual: passo,
          progresso_texto: 'Gemini indisponível.',
          erro: gem.erro || 'Gemini indisponível.',
          resultado: { ...gem, modoColeta: p.fonte, fonte: 'gemini' },
        })
        return { ok: false as const, jobId: failed.id, status: failed.status, erro: failed.erro, resultado: gem }
      }
      p.fallbackDeGemini = true
      p.fase = 'bounds'
      progresso = 'Gemini indisponível — OpenStreetMap…'
    }

    if (p.fase === 'bounds') {
      progresso = 'Obtendo área da cidade (Nominatim)…'
      const loc = await resolverBoundsProspectosOsm(cidade, uf)
      passo += 1
      if (!loc.ok) {
        const failed = await atualizarJob(supabaseAdmin, job.id, {
          status: 'failed',
          passo_atual: passo,
          progresso_texto: loc.erro,
          erro: loc.erro,
          payload: p,
        })
        return { ok: false as const, jobId: failed.id, status: failed.status, erro: loc.erro }
      }
      p.bounds = loc.bounds
      p.fase = 'categoria'
      p.catIndex = 0
    }

    if (p.fase === 'categoria') {
      const categorias = p.categorias as string[]
      const catId = categorias[p.catIndex as number]
      const label = rotuloCategoriaColeta(catId)
      progresso = `OpenStreetMap: ${label} (${(p.catIndex as number) + 1}/${categorias.length})…`
      const r = await coletarCategoriaProspectosOsm(supabaseAdmin, {
        bounds: p.bounds as { south: number; west: number; north: number; east: number },
        cidade,
        uf,
        catId,
      })
      passo += 1
      if (!r.ok) p.erros = [...(p.erros as string[]), `${catId}: ${r.erro}`]
      else inseridosDelta += r.inseridos || 0

      p.catIndex = (p.catIndex as number) + 1
      if ((p.catIndex as number) < categorias.length) {
        const running = await atualizarJob(supabaseAdmin, job.id, {
          status: 'running',
          passo_atual: passo,
          inseridos_total: (job.inseridos_total || 0) + inseridosDelta,
          progresso_texto: progresso,
          payload: p,
        })
        return {
          ok: true as const,
          jobId: running.id,
          status: running.status,
          progresso: running.progresso_texto,
          passoAtual: running.passo_atual,
          passosTotais: running.passos_totais,
          inseridos: running.inseridos_total,
        }
      }
      p.fase = 'done'
    }

    if (p.fase === 'done') {
      const total = (job.inseridos_total || 0) + inseridosDelta
      const avisoErros = (p.erros as string[]).length ? `Parcial: ${(p.erros as string[]).join('; ')}` : ''
      const avisoVazio =
        total === 0 ? avisoErros || 'Nenhum estabelecimento encontrado para esta cidade.' : avisoErros
      const resultado = {
        ok: true,
        inseridos: total,
        fonte: 'osm',
        modoColeta: p.fonte,
        aviso: avisoVazio,
        fallbackDeGemini: Boolean(p.fallbackDeGemini),
        geminiIndisponivelPorCota: Boolean((p.geminiSnapshot as { quotaExceeded?: boolean })?.quotaExceeded),
      }
      const done = await atualizarJob(supabaseAdmin, job.id, {
        status: 'done',
        passo_atual: passo,
        inseridos_total: total,
        progresso_texto: 'Concluído.',
        payload: p,
        resultado,
      })
      return {
        ok: true as const,
        jobId: done.id,
        status: done.status,
        progresso: done.progresso_texto,
        passoAtual: done.passo_atual,
        passosTotais: done.passos_totais,
        inseridos: done.inseridos_total,
        resultado,
      }
    }

    const running = await atualizarJob(supabaseAdmin, job.id, {
      status: 'running',
      passo_atual: passo,
      inseridos_total: (job.inseridos_total || 0) + inseridosDelta,
      progresso_texto: progresso,
      payload: p,
    })
    return {
      ok: true as const,
      jobId: running.id,
      status: running.status,
      progresso: running.progresso_texto,
      passoAtual: running.passo_atual,
      passosTotais: running.passos_totais,
      inseridos: running.inseridos_total,
    }
  } catch (e) {
    const failed = await atualizarJob(supabaseAdmin, job.id, {
      status: 'failed',
      erro: (e as Error)?.message || 'Erro na etapa da coleta.',
      progresso_texto: 'Falhou.',
      payload: p,
    })
    return { ok: false as const, jobId: failed.id, status: failed.status, erro: failed.erro }
  }
}
