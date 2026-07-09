/**
 * @deprecated Use prospectosOsmCategorias.js — mantido para imports legados do mapa.
 */
export {
    PROSPECTOS_OSM_CATEGORIAS as CATEGORIAS_POI_OSM,
    getProspectoOsmCategoriaPorId as getCategoriaPoiOsmPorId,
} from './prospectosOsmCategorias.js'

import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { PROSPECTOS_OSM_CATEGORIAS } from './prospectosOsmCategorias.js'

export function detectarCategoriaPoiOsm(textoBruto) {
    const t = normalizarTextoBusca(textoBruto)
    if (!t) return null
    for (const cat of PROSPECTOS_OSM_CATEGORIAS) {
        const id = cat.id
        const padroes =
            id === 'veterinary'
                ? ['veterinaria', 'veterinario', 'veterin', 'vet']
                : id === 'pet_shop'
                  ? ['petshop', 'pet shop', 'loja pet']
                  : []
        if (padroes.some((p) => t.includes(normalizarTextoBusca(p)))) return cat
    }
    return null
}
