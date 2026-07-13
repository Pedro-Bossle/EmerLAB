import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  PROSPECTOS_OSM_CATEGORIAS,
  labelProspectoOsmCategoria,
} from './osmCategories.ts'
import { buscarViewboxLocalidadeNominatim } from './nominatim.ts'
import { limitarBoundsOverpass, overpassPoisNaArea } from './overpass.ts'

function itemParaRow(item: Record<string, unknown>, cidade: string, uf: string) {
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

export async function resolverBoundsProspectosOsm(cidade: string, uf: string) {
  const loc = await buscarViewboxLocalidadeNominatim(cidade, uf)
  if (!loc.ok || !loc.bounds) {
    return { ok: false as const, erro: loc.erro || 'Não foi possível obter a área da cidade.' }
  }
  const bounds = limitarBoundsOverpass(loc.bounds)
  if (!bounds) return { ok: false as const, erro: 'Área da cidade inválida.' }
  return { ok: true as const, bounds }
}

export async function coletarCategoriaProspectosOsm(
  supabaseAdmin: SupabaseClient,
  opts: { bounds: { south: number; west: number; north: number; east: number }; cidade: string; uf: string; catId: string },
) {
  const r = await overpassPoisNaArea({
    ...opts.bounds,
    categoria: opts.catId,
    cidade: opts.cidade,
    uf: opts.uf,
  })
  if (!r.ok) {
    return { ok: false as const, erro: r.erro || `Falha Overpass (${opts.catId}).`, inseridos: 0 }
  }
  const rows = (r.itens || []).map((item) => itemParaRow(item as Record<string, unknown>, opts.cidade, opts.uf))
  if (!rows.length) return { ok: true as const, inseridos: 0, aviso: '' }

  const { error } = await supabaseAdmin.from('cred_prospectos_osm').upsert(rows, {
    onConflict: 'osm_type,osm_id',
  })
  if (error) return { ok: false as const, erro: error.message, inseridos: 0 }
  return { ok: true as const, inseridos: rows.length, aviso: '' }
}

export function listaCategoriasColeta(categoriasPedidas?: string[]) {
  if (categoriasPedidas?.length) return categoriasPedidas
  return PROSPECTOS_OSM_CATEGORIAS.map((c) => c.id)
}

export function rotuloCategoriaColeta(catId: string) {
  return labelProspectoOsmCategoria(catId)
}
