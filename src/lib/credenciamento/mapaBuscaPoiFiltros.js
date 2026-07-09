/**
 * Filtro e merge de itens POI (Nominatim + Overpass).
 */
import { normalizarTextoBusca, blobContemTermoBusca, tokensTermoBusca } from '../prestadorCadastroHelpers.js'
import { STOPWORDS_POI_BUSCA } from './prospectosOsmFiltrosStopwords.js'

function blobItemPoi(item) {
    return normalizarTextoBusca(
        [item.nome, item.rotulo, item.rotuloCompleto, item.enderecoLinha].filter(Boolean).join(' '),
    )
}

/** Filtra resultados OSM pelo termo (ignora acentos, pontuação e ordem das palavras). */
export function filtrarItensNominatimPorTermo(itens, termoBruto) {
    const termo = normalizarTextoBusca(termoBruto)
    if (!termo) return itens || []
    return (itens || []).filter((item) => blobContemTermoBusca(blobItemPoi(item), termo))
}

function tokensSignificativosPoi(termoBruto) {
    const termo = normalizarTextoBusca(termoBruto)
    return tokensTermoBusca(termo).filter((t) => t.length >= 3 && !STOPWORDS_POI_BUSCA.has(t))
}

/**
 * Filtro flexível para buscas por categoria (ex.: clínica veterinária → vets no OSM).
 */
export function filtrarItensPoiMapaPorTermo(itens, termoBruto, { categoriaDetectada = null } = {}) {
    const lista = itens || []
    if (!lista.length) return lista

    if (categoriaDetectada) {
        const tokens = tokensSignificativosPoi(termoBruto)
        if (!tokens.length) return lista
        return lista.filter((item) => {
            const blob = blobItemPoi(item)
            return tokens.some((t) => blob.includes(t))
        })
    }

    return filtrarItensNominatimPorTermo(lista, termoBruto)
}

export function chaveItemPoiMapa(item) {
    const lat = Number(item.lat)
    const lng = Number(item.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
    return `${lat.toFixed(4)}|${lng.toFixed(4)}`
}

export function mesclarItensPoiMapa(...listas) {
    const porChave = new Map()
    for (const lista of listas) {
        for (const item of lista || []) {
            const k = chaveItemPoiMapa(item)
            if (!k) continue
            if (!porChave.has(k)) porChave.set(k, item)
        }
    }
    return [...porChave.values()]
}
