/**
 * Coordenadas de sede municipal (dataset kelvins/municipios-brasileiros) + Haversine.
 * Usado para filtrar sugestões de malha por distância da cidade principal.
 */

import { normalizarMunicipioChave } from './cidadesSupertabelaVinculos.js'

export const MAX_KM_SUGESTAO_MALHA = 50

const CODIGO_UF_PARA_SIGLA = {
    11: 'RO',
    12: 'AC',
    13: 'AM',
    14: 'RR',
    15: 'PA',
    16: 'AP',
    17: 'TO',
    21: 'MA',
    22: 'PI',
    23: 'CE',
    24: 'RN',
    25: 'PB',
    26: 'PE',
    27: 'AL',
    28: 'SE',
    29: 'BA',
    31: 'MG',
    32: 'ES',
    33: 'RJ',
    35: 'SP',
    41: 'PR',
    42: 'SC',
    43: 'RS',
    50: 'MS',
    51: 'MT',
    52: 'GO',
    53: 'DF',
}

const DATASET_URL =
    'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json/municipios.json'

/** @type {Map<string, { lat: number, lng: number }> | null} */
let mapaCoordsPorUfNome = null
/** @type {Promise<Map<string, { lat: number, lng: number }>> | null} */
let promessaMapa = null

function chaveUfNome(uf, nome) {
    const ufNorm = String(uf || '').trim().toUpperCase()
    const nomeNorm = normalizarMunicipioChave(nome)
    if (!ufNorm || !nomeNorm) return ''
    return `${ufNorm}|${nomeNorm}`
}

export function distanciaKm(lat1, lng1, lat2, lng2) {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

async function carregarMapaCoordsMunicipios() {
    if (mapaCoordsPorUfNome) return mapaCoordsPorUfNome
    if (promessaMapa) return promessaMapa

    promessaMapa = (async () => {
        const res = await fetch(DATASET_URL, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error('Não foi possível carregar coordenadas dos municípios.')
        const data = await res.json()
        const mapa = new Map()
        for (const row of data || []) {
            const uf = CODIGO_UF_PARA_SIGLA[Number(row.codigo_uf)]
            const lat = Number(row.latitude)
            const lng = Number(row.longitude)
            const chave = chaveUfNome(uf, row.nome)
            if (!chave || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
            if (!mapa.has(chave)) mapa.set(chave, { lat, lng })
        }
        mapaCoordsPorUfNome = mapa
        return mapa
    })()

    try {
        return await promessaMapa
    } catch (err) {
        promessaMapa = null
        throw err
    }
}

export async function coordenadaMunicipio(uf, nome) {
    const chave = chaveUfNome(uf, nome)
    if (!chave) return null
    const mapa = await carregarMapaCoordsMunicipios()
    return mapa.get(chave) || null
}

/**
 * Mantém apenas nomes a até `maxKm` da sede do município principal (mesma UF).
 * Sem coordenadas da principal → lista vazia. Sem coords do candidato → exclui.
 */
export async function filtrarMunicipiosPorDistanciaDoPrincipal({
    uf,
    municipioPrincipal,
    nomes = [],
    maxKm = MAX_KM_SUGESTAO_MALHA,
} = {}) {
    const origem = await coordenadaMunicipio(uf, municipioPrincipal)
    if (!origem) {
        return { nomes: [], semCoordsPrincipal: true }
    }

    const out = []
    for (const nome of nomes || []) {
        const c = await coordenadaMunicipio(uf, nome)
        if (!c) continue
        if (distanciaKm(origem.lat, origem.lng, c.lat, c.lng) <= maxKm) out.push(nome)
    }
    return { nomes: out, semCoordsPrincipal: false }
}
