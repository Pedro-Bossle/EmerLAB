/**
 * Coleta prospectos em etapas (cada passo < timeout Vercel).
 */
import { coletarProspectosGeminiCidade } from './prospectosGeminiColeta.js'
import { descansoGeminiParaResposta } from './geminiDescanso.js'
import { resolverFonteColeta, fallbackOsmHabilitado } from './prospectosColeta.js'
import {
    coletarCategoriaProspectosOsm,
    listaCategoriasColeta,
    resolverBoundsProspectosOsm,
    rotuloCategoriaColeta,
} from './prospectosOsmColetaSteps.js'

export const TABELA_COLETA_JOBS = 'cred_prospectos_coleta_jobs'

function anexarDescansoGemini(resultado, gem) {
    const descanso = descansoGeminiParaResposta(gem)
    if (!descanso.geminiDescansoAte) return resultado
    return {
        ...resultado,
        geminiDescansoAte: descanso.geminiDescansoAte,
        geminiRetryAfterSec: descanso.geminiRetryAfterSec,
        geminiQuotaPausa: Boolean(descanso.geminiQuotaPausa),
    }
}

function contarPassos(payload) {
    let n = 0
    if (payload.tentarGemini) n += 1
    n += 1 // bounds
    n += (payload.categorias || []).length
    return Math.max(1, n)
}

function metaInicial(opts) {
    const cidade = String(opts.cidade || '').trim()
    const uf = String(opts.uf || '').trim()
    const omitirGemini = Boolean(opts.omitirGemini)
    const fonte = resolverFonteColeta(opts.fonte)
    const categorias = listaCategoriasColeta(opts.categorias)
    const tentarGemini = !omitirGemini && (fonte === 'gemini' || fonte === 'auto')
    const payload = {
        cidade,
        uf,
        fonte,
        omitirGemini,
        tentarGemini,
        categorias,
        fase: tentarGemini ? 'gemini' : 'bounds',
        catIndex: 0,
        bounds: null,
        erros: [],
        avisos: [],
        geminiSnapshot: null,
        fallbackDeGemini: false,
        coletaDiretaOsm: fonte === 'auto' && omitirGemini,
    }
    return {
        cidade,
        uf,
        payload,
        passos_totais: contarPassos(payload),
    }
}

async function atualizarJob(supabase, id, patch) {
    const { data, error } = await supabase
        .from(TABELA_COLETA_JOBS)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
    if (error) throw new Error(error.message || String(error))
    return data
}

function respostaJob(job, extra = {}) {
    return {
        jobId: job.id,
        status: job.status,
        progresso: job.progresso_texto,
        passoAtual: job.passo_atual,
        passosTotais: job.passos_totais,
        inseridos: job.inseridos_total,
        resultado: job.resultado || null,
        erro: job.erro || null,
        ...extra,
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
export async function iniciarJobColeta(supabaseAdmin, opts) {
    const ini = metaInicial(opts)
    if (!ini.cidade) {
        return { ok: false, erro: 'Informe cidade.' }
    }
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
        return {
            ok: false,
            erro:
                error.message?.includes('does not exist') || error.code === '42P01'
                    ? 'Tabela cred_prospectos_coleta_jobs ausente. Execute scripts/sql/cred_prospectos_coleta_jobs.sql no Supabase.'
                    : error.message || String(error),
        }
    }
    return { ok: true, ...respostaJob(data, { async: true }) }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
export async function executarPassoJobColeta(supabaseAdmin, jobId) {
    const { data: job, error: loadErr } = await supabaseAdmin
        .from(TABELA_COLETA_JOBS)
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
    if (loadErr) return { ok: false, erro: loadErr.message }
    if (!job) return { ok: false, erro: 'Job não encontrado.' }
    if (job.status === 'done') {
        return { ok: true, ...respostaJob(job) }
    }
    if (job.status === 'failed') {
        return { ok: false, ...respostaJob(job) }
    }

    const p = { ...job.payload }
    const cidade = job.cidade
    const uf = job.uf
    let inseridosDelta = 0
    let progresso = job.progresso_texto
    let passo = job.passo_atual

    try {
        if (p.fase === 'gemini') {
            progresso = 'Tentando coleta via Gemini…'
            const gem = await coletarProspectosGeminiCidade(supabaseAdmin, { cidade, uf })
            passo += 1
            if (gem.ok) {
                const resultado = anexarDescansoGemini(
                    {
                        ok: true,
                        inseridos: gem.inseridos ?? 0,
                        fonte: 'gemini',
                        modoColeta: p.fonte,
                        aviso: gem.aviso || '',
                    },
                    gem,
                )
                const done = await atualizarJob(supabaseAdmin, job.id, {
                    status: 'done',
                    passo_atual: passo,
                    inseridos_total: (job.inseridos_total || 0) + (gem.inseridos ?? 0),
                    progresso_texto: 'Concluído (Gemini).',
                    resultado,
                })
                return { ok: true, ...respostaJob(done, resultado) }
            }
            p.geminiSnapshot = {
                quotaExceeded: Boolean(gem.quotaExceeded),
                erro: gem.erro || '',
                erroOriginal: gem.erroOriginal,
                retryAfterSec: gem.retryAfterSec,
            }
            const podeFallback = fallbackOsmHabilitado() && p.fonte !== 'osm'
            if (!podeFallback) {
                const resultado = anexarDescansoGemini({ ...gem, modoColeta: p.fonte }, gem)
                const failed = await atualizarJob(supabaseAdmin, job.id, {
                    status: 'failed',
                    passo_atual: passo,
                    progresso_texto: 'Gemini indisponível.',
                    erro: gem.erro || 'Gemini indisponível.',
                    resultado,
                })
                return { ok: false, ...respostaJob(failed, resultado) }
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
                return { ok: false, ...respostaJob(failed) }
            }
            p.bounds = loc.bounds
            p.fase = 'categoria'
            p.catIndex = 0
        }

        if (p.fase === 'categoria') {
            const catId = p.categorias[p.catIndex]
            const label = rotuloCategoriaColeta(catId)
            progresso = `OpenStreetMap: ${label} (${p.catIndex + 1}/${p.categorias.length})…`
            const r = await coletarCategoriaProspectosOsm(supabaseAdmin, {
                bounds: p.bounds,
                cidade,
                uf,
                catId,
            })
            passo += 1
            if (!r.ok) {
                p.erros.push(`${catId}: ${r.erro}`)
            } else {
                inseridosDelta += r.inseridos || 0
            }
            p.catIndex += 1
            if (p.catIndex < p.categorias.length) {
                const running = await atualizarJob(supabaseAdmin, job.id, {
                    status: 'running',
                    passo_atual: passo,
                    inseridos_total: (job.inseridos_total || 0) + inseridosDelta,
                    progresso_texto: progresso,
                    payload: p,
                })
                return { ok: true, ...respostaJob(running) }
            }
            p.fase = 'done'
        }

        if (p.fase === 'done') {
            const total = (job.inseridos_total || 0) + inseridosDelta
            const avisoErros = p.erros.length ? `Parcial: ${p.erros.join('; ')}` : ''
            const avisoVazio =
                total === 0
                    ? avisoErros || 'Nenhum local OSM encontrado para esta cidade.'
                    : avisoErros
            const resultado = anexarDescansoGemini(
                {
                    ok: true,
                    inseridos: total,
                    fonte: 'osm',
                    modoColeta: p.fonte,
                    aviso: avisoVazio,
                    fallbackDeGemini: Boolean(p.fallbackDeGemini),
                    coletaDiretaOsm: Boolean(p.coletaDiretaOsm),
                    geminiIndisponivelPorCota: Boolean(p.geminiSnapshot?.quotaExceeded),
                },
                p.geminiSnapshot || {},
            )
            const done = await atualizarJob(supabaseAdmin, job.id, {
                status: 'done',
                passo_atual: passo,
                inseridos_total: total,
                progresso_texto: 'Concluído.',
                payload: p,
                resultado,
            })
            return { ok: true, ...respostaJob(done, resultado) }
        }

        const running = await atualizarJob(supabaseAdmin, job.id, {
            status: 'running',
            passo_atual: passo,
            inseridos_total: (job.inseridos_total || 0) + inseridosDelta,
            progresso_texto: progresso,
            payload: p,
        })
        return { ok: true, ...respostaJob(running) }
    } catch (e) {
        const failed = await atualizarJob(supabaseAdmin, job.id, {
            status: 'failed',
            erro: e?.message || 'Erro na etapa da coleta.',
            progresso_texto: 'Falhou.',
            payload: p,
        })
        return { ok: false, ...respostaJob(failed) }
    }
}
