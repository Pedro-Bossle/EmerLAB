/**
 * Consulta de POI no mapa: "Nome do local, Cidade, UF" ou termo livre (limitado ao viewbox no Nominatim).
 */
export { filtrarItensNominatimPorTermo, filtrarItensPoiMapaPorTermo } from './mapaBuscaPoiFiltros.js'

export function parsearConsultaPoiMapa(bruto) {
    const t = String(bruto || '').trim()
    if (!t) {
        return { poi: '', cidade: '', uf: '', consultaNominatim: '' }
    }
    const partes = t.split(',').map((s) => s.trim()).filter(Boolean)
    if (partes.length >= 3) {
        const uf = partes[partes.length - 1]
        const cidade = partes[partes.length - 2]
        const poi = partes.slice(0, -2).join(', ')
        const consultaNominatim = [poi, cidade, uf, 'Brasil'].filter(Boolean).join(', ')
        return { poi, cidade, uf, consultaNominatim }
    }
    if (partes.length === 2) {
        return {
            poi: partes[0],
            cidade: partes[1],
            uf: '',
            consultaNominatim: `${partes[0]}, ${partes[1]}, Brasil`,
        }
    }
    return {
        poi: t,
        cidade: '',
        uf: '',
        consultaNominatim: `${t}, Brasil`,
    }
}

export function coordenadaDentroViewbox(lat, lng, bounds) {
    if (!bounds) return false
    const { west, south, east, north } = bounds
    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(west) ||
        !Number.isFinite(south) ||
        !Number.isFinite(east) ||
        !Number.isFinite(north)
    ) {
        return false
    }
    return lat >= south && lat <= north && lng >= west && lng <= east
}

export function montarPinBuscaMapaDeNominatim(item, idx, { ehPoi = true, prefixoId = 'poi' } = {}) {
    return {
        id: `${prefixoId}-${idx}-${item.lat}-${item.lng}`,
        lat: item.lat,
        lng: item.lng,
        rotulo: item.rotulo,
        ehPoi,
        nome: item.nome || '',
        endereco: item.enderecoLinha || item.rotuloCompleto || item.rotulo,
        telefone: item.telefone || '',
        horaAtendimento: item.horaAtendimento || '',
    }
}

