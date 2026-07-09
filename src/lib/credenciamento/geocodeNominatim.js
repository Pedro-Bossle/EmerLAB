/**
 * Geocodificação via Nominatim (OpenStreetMap). Uso server-side apenas.
 * Política: máx. 1 req/s — chame com delay entre lotes.
 */

const USER_AGENT = 'Emerdog-SFSC-Supertool/1.0 (credenciamento mapa)'

function cidadeDeEnderecoNominatim(addr = {}) {
    return addr.city || addr.town || addr.municipality || addr.village || addr.county || ''
}

/** Rótulo curto: prioriza nome de comércio/POI quando existir no OSM. */
export function formatarHitNominatim(hit, consultaFallback = '') {
    const addr = hit?.address || {}
    const cidade = cidadeDeEnderecoNominatim(addr)
    const uf = addr.state || ''
    const bairro = addr.suburb || addr.neighbourhood || addr.quarter || ''
    const nome = String(hit?.name || '').trim()
    const sufixoLocal =
        bairro && cidade
            ? `${bairro}, ${cidade}${uf ? ` — ${uf}` : ''}`
            : cidade && uf
              ? `${cidade} — ${uf}`
              : cidade
              ? String(cidade)
              : ''

    let rotulo = hit?.display_name || consultaFallback
    if (nome) {
        rotulo = sufixoLocal ? `${nome} · ${sufixoLocal}` : nome
    } else if (bairro && cidade) rotulo = `${bairro}, ${cidade}${uf ? ` — ${uf}` : ''}`
    else if (cidade && uf) rotulo = `${cidade} — ${uf}`
    else if (cidade) rotulo = String(cidade)

    const classe = hit?.class
    const tipo = hit?.type
    const ehPoi =
        classe &&
        !['place', 'boundary', 'highway'].includes(classe) &&
        tipo &&
        tipo !== 'administrative'

    return {
        rotulo,
        rotuloCompleto: hit?.display_name || rotulo,
        ehPoiOuComercio: Boolean(nome) || ehPoi,
    }
}

export async function geocodificarEnderecoNominatim(enderecoCompleto) {
    const q = String(enderecoCompleto || '').trim()
    if (!q) return { ok: false, erro: 'Endereço vazio.' }

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'br')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('namedetails', '1')

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
    const { rotulo, rotuloCompleto } = formatarHitNominatim(hit, q)
    return {
        ok: true,
        latitude: lat,
        longitude: lon,
        displayName: rotuloCompleto,
        rotuloCurto: rotulo,
    }
}

/** Várias sugestões de lugar (autocomplete no mapa). */
export async function buscarSugestoesNominatim(consulta, { limite = 5 } = {}) {
    const q = String(consulta || '').trim()
    if (!q || q.length < 2) return { ok: true, itens: [] }

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', `${q}, Brasil`)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', String(Math.min(Math.max(limite, 1), 8)))
    url.searchParams.set('countrycodes', 'br')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('namedetails', '1')

    const resp = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
    })
    if (!resp.ok) return { ok: false, erro: `Nominatim HTTP ${resp.status}`, itens: [] }
    const data = await resp.json()
    const itens = (data || [])
        .map((hit) => {
            const lat = Number(hit.lat)
            const lon = Number(hit.lon)
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
            const { rotulo, rotuloCompleto, ehPoiOuComercio } = formatarHitNominatim(hit, q)
            return {
                rotulo,
                rotuloCompleto,
                ehPoiOuComercio,
                lat,
                lng: lon,
            }
        })
        .filter(Boolean)
    return { ok: true, itens }
}

export function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
