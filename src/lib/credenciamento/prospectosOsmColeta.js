/**
 * Coleta Overpass por cidade e upsert no Supabase.
 */
import { PROSPECTOS_OSM_CATEGORIAS } from './prospectosOsmCategorias.js'
import { buscarViewboxLocalidadeNominatim } from './geocodeNominatim.js'
import { overpassPoisNaArea, limitarBoundsOverpass } from './overpassUpstream.js'

function chaveUnica(p) {
    return `${p.osm_type}|${p.osm_id}`
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ cidade: string, uf?: string, categorias?: string[] }} opts
 */
export async function coletarProspectosOsmCidade(supabaseAdmin, opts) {
    const cidade = String(opts.cidade || '').trim()
    const uf = String(opts.uf || '').trim()
    if (!cidade) {
        return { ok: false, erro: 'Informe a cidade.' }
    }

    const loc = await buscarViewboxLocalidadeNominatim(cidade, uf)
    if (!loc.ok || !loc.bounds) {
        return { ok: false, erro: loc.erro || 'Não foi possível obter a área da cidade.' }
    }

    const bounds = limitarBoundsOverpass(loc.bounds)
    if (!bounds) {
        return { ok: false, erro: 'Área da cidade inválida.' }
    }

    const idsCategoria = opts.categorias?.length
        ? opts.categorias
        : PROSPECTOS_OSM_CATEGORIAS.map((c) => c.id)

    const porChave = new Map()
    const erros = []

    for (const catId of idsCategoria) {
        const r = await overpassPoisNaArea({
            ...bounds,
            categoria: catId,
            cidade,
            uf,
        })
        if (!r.ok) {
            erros.push(`${catId}: ${r.erro}`)
            continue
        }
        for (const item of r.itens || []) {
            const row = {
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
            porChave.set(chaveUnica(row), row)
        }
    }

    const rows = [...porChave.values()]
    if (!rows.length) {
        return {
            ok: true,
            inseridos: 0,
            aviso: erros.length
                ? `Nenhum local OSM encontrado. ${erros.join('; ')}`
                : 'Nenhum local OSM encontrado para esta cidade.',
        }
    }

    const { error } = await supabaseAdmin.from('cred_prospectos_osm').upsert(rows, {
        onConflict: 'osm_type,osm_id',
        ignoreDuplicates: false,
    })

    if (error) {
        return { ok: false, erro: error.message || String(error) }
    }

    return {
        ok: true,
        inseridos: rows.length,
        aviso: erros.length ? `Parcial: ${erros.join('; ')}` : '',
    }
}
