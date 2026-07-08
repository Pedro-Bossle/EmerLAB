/**
 * Geocodificação via Nominatim (OpenStreetMap). Uso server-side apenas.
 * Política: máx. 1 req/s — chame com delay entre lotes.
 */

const USER_AGENT = 'Emerdog-SFSC-Supertool/1.0 (credenciamento mapa)'

export async function geocodificarEnderecoNominatim(enderecoCompleto) {
    const q = String(enderecoCompleto || '').trim()
    if (!q) return { ok: false, erro: 'Endereço vazio.' }

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'br')

    const resp = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
    })
    if (!resp.ok) return { ok: false, erro: `Nominatim HTTP ${resp.status}` }
    const data = await resp.json()
    const hit = data?.[0]
    if (!hit) return { ok: false, erro: 'Endereço não encontrado.' }

    const lat = Number(hit.lat)
    const lon = Number(hit.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, erro: 'Coordenadas inválidas na resposta.' }
    }
    return { ok: true, latitude: lat, longitude: lon, displayName: hit.display_name || '' }
}

export function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
