/**
 * Basemap Leaflet — CARTO (com chave) ou OSM (sem chave).
 *
 * CARTO deixou de servir `basemaps.cartocdn.com` sem API key
 * (watermarks "API KEY REQUIRED"). Sem `VITE_CARTO_API_KEY` usa OSM.
 *
 * Chave: https://carto.com/basemaps/apikey → VITE_CARTO_API_KEY no .env
 */

const OSM = {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
}

/**
 * @returns {{ attribution: string, url: string, maxZoom?: number }}
 */
export function leafletBasemapProps() {
    const key = String(
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CARTO_API_KEY) || '',
    ).trim()
    if (!key) return { ...OSM }

    return {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?apikey=${encodeURIComponent(key)}`,
        maxZoom: 20,
    }
}
