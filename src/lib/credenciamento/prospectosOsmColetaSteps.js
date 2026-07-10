/**
 * Etapas da coleta OSM (uma categoria / bounds por invocação).
 */
import { PROSPECTOS_OSM_CATEGORIAS, labelProspectoOsmCategoria } from './prospectosOsmCategorias.js'
import { buscarViewboxLocalidadeNominatim } from './geocodeNominatim.js'
import { overpassPoisNaArea, limitarBoundsOverpass } from './overpassUpstream.js'

function itemParaRow(item, cidade, uf) {
    return {
        osm_type: item.osm_type,
        osm_id: item.osm_id,
        categoria_id: item.categoria_id,
        categoria_label: item.categoria_label,
        nome: item.nome || '',
        endereco: item.endereco || '',
        cidade: item.cidade || cidade,
        uf: item.uf || uf,
        lat: item.lat,
        lng: item.lng,
        telefone: item.telefone || '',
        horario_atendimento: item.horario_atendimento || '',
        website: item.website || '',
        tags: item.tags || {},
        coletado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
    }
}

export async function resolverBoundsProspectosOsm(cidade, uf) {
    const loc = await buscarViewboxLocalidadeNominatim(cidade, uf)
    if (!loc.ok || !loc.bounds) {
        return { ok: false, erro: loc.erro || 'Não foi possível obter a área da cidade.' }
    }
    const bounds = limitarBoundsOverpass(loc.bounds)
    if (!bounds) {
        return { ok: false, erro: 'Área da cidade inválida.' }
    }
    return { ok: true, bounds }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
export async function coletarCategoriaProspectosOsm(supabaseAdmin, { bounds, cidade, uf, catId }) {
    const r = await overpassPoisNaArea({
        ...bounds,
        categoria: catId,
        cidade,
        uf,
    })
    if (!r.ok) {
        return { ok: false, erro: r.erro || `Falha Overpass (${catId}).`, inseridos: 0 }
    }
    const rows = (r.itens || []).map((item) => itemParaRow(item, cidade, uf))
    if (!rows.length) {
        return { ok: true, inseridos: 0, aviso: '' }
    }
    const { error } = await supabaseAdmin.from('cred_prospectos_osm').upsert(rows, {
        onConflict: 'osm_type,osm_id',
        ignoreDuplicates: false,
    })
    if (error) {
        return { ok: false, erro: error.message || String(error), inseridos: 0 }
    }
    return { ok: true, inseridos: rows.length, aviso: '' }
}

export function listaCategoriasColeta(categoriasPedidas) {
    if (categoriasPedidas?.length) return categoriasPedidas
    return PROSPECTOS_OSM_CATEGORIAS.map((c) => c.id)
}

export function rotuloCategoriaColeta(catId) {
    return labelProspectoOsmCategoria(catId)
}
