/**
 * Orquestra coleta de prospectos (PoC Gemini ou OSM/Overpass).
 */
import { coletarProspectosOsmCidade } from './prospectosOsmColeta.js'
import { coletarProspectosGeminiCidade } from './prospectosGeminiColeta.js'
import { descansoGeminiParaResposta } from './geminiDescanso.js'

/** @typedef {'gemini' | 'osm' | 'auto'} FonteProspectosColeta */

function fallbackOsmHabilitado() {
    const v = String(process.env.PROSPECTOS_GEMINI_FALLBACK_OSM ?? 'false').trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
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

    // Pedido explícito Gemini: nunca Overpass/OSM
    if (fonte === 'gemini') {
        const gem = await coletarProspectosGeminiCidade(supabaseAdmin, opts)
        return anexarDescansoGemini({ ...gem, fonte: 'gemini', modoColeta: 'gemini' }, gem)
    }

    if (fonte === 'auto' && pularGemini && fallbackOsmHabilitado()) {
        const r = await coletarProspectosOsmCidade(supabaseAdmin, opts)
        return {
            ...r,
            fonte: 'osm',
            modoColeta: 'auto',
            coletaDiretaOsm: true,
            geminiIndisponivelPorCota: true,
        }
    }

    if (fonte === 'auto') {
        const gem = await coletarProspectosGeminiCidade(supabaseAdmin, opts)
        if (gem.ok) {
            return { ...gem, fonte: 'gemini', modoColeta: 'auto' }
        }
        if (fallbackOsmHabilitado()) {
            const osm = await coletarProspectosOsmCidade(supabaseAdmin, opts)
            if (!osm.ok) return anexarDescansoGemini(osm, gem)
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
        return anexarDescansoGemini({ ...gem, modoColeta: 'auto' }, gem)
    }

    const r = await coletarProspectosOsmCidade(supabaseAdmin, opts)
    return { ...r, fonte: 'osm', modoColeta: 'osm' }
}

/**
 * Pedido explícito da UI (`fonte`) tem prioridade sobre ENV.
 * Default: gemini (não OSM).
 * auto = Gemini primeiro; OSM só se PROSPECTOS_GEMINI_FALLBACK_OSM=true.
 * @param {FonteProspectosColeta | string | undefined} pedida
 */
export function resolverFonteColeta(pedida) {
    const p = String(pedida || '').trim().toLowerCase()
    if (p === 'gemini' || p === 'osm' || p === 'auto') return p
    const env = String(process.env.PROSPECTOS_COLETA_FONTE || '').trim().toLowerCase()
    if (env === 'gemini' || env === 'osm' || env === 'auto') return env
    if (String(process.env.GEMINI_API_KEY || '').trim()) return 'gemini'
    return 'gemini'
}
