/**
 * Orquestra coleta de prospectos (PoC Gemini ou OSM/Overpass).
 */
import { coletarProspectosOsmCidade } from './prospectosOsmColeta.js'
import { coletarProspectosGeminiCidade } from './prospectosGeminiColeta.js'
import { descansoGeminiParaResposta } from './geminiDescanso.js'

/** @typedef {'gemini' | 'osm' | 'auto'} FonteProspectosColeta */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ cidade: string, uf?: string, fonte?: FonteProspectosColeta, categorias?: string[] }} opts
 */
function fallbackOsmHabilitado() {
    const v = String(process.env.PROSPECTOS_GEMINI_FALLBACK_OSM ?? 'true').trim().toLowerCase()
    return v !== '0' && v !== 'false' && v !== 'no'
}

export { fallbackOsmHabilitado }

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

export async function coletarProspectosCidade(supabaseAdmin, opts) {
    const fonte = resolverFonteColeta(opts.fonte)
    const pularGemini = Boolean(opts.omitirGemini || opts.pularGemini)

    if (fonte === 'auto' && pularGemini) {
        const r = await coletarProspectosOsmCidade(supabaseAdmin, opts)
        return {
            ...r,
            fonte: 'osm',
            modoColeta: 'auto',
            coletaDiretaOsm: true,
            geminiIndisponivelPorCota: true,
        }
    }

    if (fonte === 'gemini' || fonte === 'auto') {
        const gem = await coletarProspectosGeminiCidade(supabaseAdmin, opts)
        if (gem.ok) {
            return { ...gem, fonte: 'gemini', modoColeta: fonte }
        }
        const podeFallback = fallbackOsmHabilitado() && fonte !== 'osm'
        if (podeFallback) {
            const osm = await coletarProspectosOsmCidade(supabaseAdmin, opts)
            if (!osm.ok) return anexarDescansoGemini(osm, gem)
            const avisoGemini = gem.erro || 'Gemini indisponível.'
            const avisoOsm = osm.aviso ? String(osm.aviso) : ''
            return anexarDescansoGemini(
                {
                    ...osm,
                    fonte: 'osm',
                    modoColeta: 'auto',
                    aviso: avisoOsm ? String(avisoOsm) : '',
                    fallbackDeGemini: true,
                    geminiIndisponivelPorCota: Boolean(gem.quotaExceeded),
                    geminiErroResumo: gem.erro || 'Gemini indisponível.',
                },
                gem,
            )
        }
        return anexarDescansoGemini({ ...gem, modoColeta: fonte }, gem)
    }
    const r = await coletarProspectosOsmCidade(supabaseAdmin, opts)
    return { ...r, fonte: 'osm', modoColeta: 'osm' }
}

/**
 * auto = Gemini primeiro, OSM se falhar (com PROSPECTOS_GEMINI_FALLBACK_OSM).
 * Sem PROSPECTOS_COLETA_FONTE: auto se GEMINI_API_KEY existir, senão osm.
 * @param {FonteProspectosColeta | string | undefined} pedida
 */
export function resolverFonteColeta(pedida) {
    const env = String(process.env.PROSPECTOS_COLETA_FONTE || '').trim().toLowerCase()
    if (env === 'gemini' || env === 'osm' || env === 'auto') return env
    const p = String(pedida || '').trim().toLowerCase()
    if (p === 'gemini' || p === 'osm' || p === 'auto') return p
    if (String(process.env.GEMINI_API_KEY || '').trim()) return 'auto'
    return 'osm'
}
