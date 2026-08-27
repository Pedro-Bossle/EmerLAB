/**
 * Basemaps Leaflet para mapas de credenciamento.
 *
 * - detalhado: OpenStreetMap completo (ruas coloridas, vegetação, etc.)
 * - simplificado: fundo claro Esri + rótulos (ruas, bairros, cidades, estados)
 *
 * Opcional: VITE_CARTO_API_KEY → estilo claro CARTO no modo simplificado.
 */

export const MAPA_ESTILO_DETALHADO = 'detalhado'
export const MAPA_ESTILO_SIMPLIFICADO = 'simplificado'
export const MAPA_ESTILOS = [MAPA_ESTILO_DETALHADO, MAPA_ESTILO_SIMPLIFICADO]

const LS_KEY = 'emerlab-mapa-basemap-estilo'

const OSM_DETALHADO = {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
}

const ESRI_CINZA_BASE = {
    attribution:
        'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
}

const ESRI_CINZA_ROTULOS = {
    attribution:
        'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    opacity: 1,
}

function cartoApiKey() {
    return String(
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CARTO_API_KEY) || '',
    ).trim()
}

/**
 * @param {string} [estilo]
 * @returns {'detalhado'|'simplificado'}
 */
export function normalizarEstiloBasemap(estilo) {
    const s = String(estilo || '').trim().toLowerCase()
    if (s === MAPA_ESTILO_SIMPLIFICADO || s === 'simple' || s === 'light') {
        return MAPA_ESTILO_SIMPLIFICADO
    }
    return MAPA_ESTILO_DETALHADO
}

export function lerEstiloBasemapSalvo() {
    try {
        if (typeof localStorage === 'undefined') return MAPA_ESTILO_DETALHADO
        return normalizarEstiloBasemap(localStorage.getItem(LS_KEY))
    } catch {
        return MAPA_ESTILO_DETALHADO
    }
}

export function salvarEstiloBasemap(estilo) {
    try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(LS_KEY, normalizarEstiloBasemap(estilo))
    } catch {
        /* ignore */
    }
}

/**
 * Camadas TileLayer para o estilo (pode ser >1 no simplificado: base + rótulos).
 * @param {'detalhado'|'simplificado'} [estilo]
 * @returns {Array<{ attribution: string, url: string, maxZoom?: number, opacity?: number, zIndex?: number }>}
 */
export function leafletBasemapLayers(estilo = MAPA_ESTILO_DETALHADO) {
    const mode = normalizarEstiloBasemap(estilo)

    if (mode === MAPA_ESTILO_SIMPLIFICADO) {
        const key = cartoApiKey()
        if (key) {
            return [
                {
                    attribution:
                        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                    url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?apikey=${encodeURIComponent(key)}`,
                    maxZoom: 20,
                    zIndex: 1,
                },
            ]
        }
        return [
            { ...ESRI_CINZA_BASE, zIndex: 1 },
            { ...ESRI_CINZA_ROTULOS, zIndex: 2 },
        ]
    }

    return [{ ...OSM_DETALHADO, zIndex: 1 }]
}

/** Compat: uma única camada (modo detalhado ou 1ª do simplificado). */
export function leafletBasemapProps(estilo = MAPA_ESTILO_DETALHADO) {
    return leafletBasemapLayers(estilo)[0]
}
