/**

 * Geocodificação via Nominatim (OpenStreetMap).

 * No browser: proxy /api/nominatim-search. No Node: nominatimUpstream (1 req/s).

 */



function cidadeDeEnderecoNominatim(addr = {}) {

    return addr.city || addr.town || addr.municipality || addr.village || addr.county || ''

}



/** Horário de atendimento (tag opening_hours do OSM), texto livre. */

export function extrairHorarioAtendimentoNominatim(hit) {

    const ext = hit?.extratags || {}

    return String(ext.opening_hours || ext['opening_hours:covid19'] || '').trim()

}



/** Telefone em tags OSM (extratags) quando disponível no Nominatim. */

export function extrairTelefoneNominatim(hit) {

    const ext = hit?.extratags || {}

    const raw =

        ext.phone ||

        ext['contact:phone'] ||

        ext['contact:mobile'] ||

        ext.mobile ||

        ext['phone:BR'] ||

        ''

    return String(raw || '').trim()

}



export function enderecoLinhaNominatim(hit) {

    const addr = hit?.address || {}

    const rua = [addr.road, addr.house_number].filter(Boolean).join(', ')

    const bairro = addr.suburb || addr.neighbourhood || addr.quarter || ''

    const cidade = cidadeDeEnderecoNominatim(addr)

    const uf = addr.state || ''

    const partes = [

        rua,

        bairro,

        [cidade, uf].filter(Boolean).join(' / '),

    ].filter(Boolean)

    if (partes.length) return partes.join(' — ')

    return String(hit?.display_name || '').trim()

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

        nome,

        telefone: extrairTelefoneNominatim(hit),

        horaAtendimento: extrairHorarioAtendimentoNominatim(hit),

        enderecoLinha: enderecoLinhaNominatim(hit),

    }

}



const MSG_RATE_LIMIT =

    'Limite de consultas ao mapa (OpenStreetMap). Aguarde alguns segundos e tente de novo.'



/**

 * @param {Record<string, string | number | boolean | undefined>} params

 * @returns {Promise<{ ok: boolean, data?: unknown[], erro?: string, codigo?: string }>}

 */

async function executarBuscaNominatim(params) {

    const query = { format: 'json' }

    for (const [k, v] of Object.entries(params)) {

        if (v === undefined || v === null || v === '') continue

        query[k] = String(v)

    }



    if (typeof window !== 'undefined') {

        const url = new URL('/api/nominatim-search', window.location.origin)

        for (const [k, v] of Object.entries(query)) {

            url.searchParams.set(k, v)

        }

        let resp

        try {

            resp = await fetch(url.toString(), {

                headers: { Accept: 'application/json' },

            })

        } catch (e) {

            return { ok: false, erro: e?.message || 'Falha na rede ao consultar o mapa.' }

        }

        let body = null

        try {

            body = await resp.json()

        } catch {

            body = null

        }

        if (resp.status === 429 || body?.codigo === 'rate_limit') {

            return { ok: false, codigo: 'rate_limit', erro: body?.error || MSG_RATE_LIMIT }

        }

        if (!resp.ok) {

            return { ok: false, erro: body?.error || `Servidor de mapas HTTP ${resp.status}` }

        }

        if (!Array.isArray(body)) {

            return { ok: false, erro: 'Resposta inválida do servidor de mapas.' }

        }

        return { ok: true, data: body }

    }



    const { nominatimSearchJson } = await import('./nominatimUpstream.js')

    const r = await nominatimSearchJson(query)

    if (!r.ok) {

        return { ok: false, erro: r.erro, codigo: r.codigo }

    }

    const data = Array.isArray(r.data) ? r.data : []

    return { ok: true, data }

}



export async function geocodificarEnderecoNominatim(enderecoCompleto) {

    const q = String(enderecoCompleto || '').trim()

    if (!q) return { ok: false, erro: 'Endereço vazio.' }



    const r = await executarBuscaNominatim({

        q,

        limit: '1',

        countrycodes: 'br',

        addressdetails: '1',

        namedetails: '1',

        extratags: '1',

    })

    if (!r.ok) return { ok: false, erro: r.erro || MSG_RATE_LIMIT, codigo: r.codigo }



    const hit = r.data?.[0]

    if (!hit) return { ok: false, erro: 'Endereço não encontrado.' }



    const lat = Number(hit.lat)

    const lon = Number(hit.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {

        return { ok: false, erro: 'Coordenadas inválidas na resposta.' }

    }

    const { rotulo, rotuloCompleto, nome, telefone, horaAtendimento, enderecoLinha } = formatarHitNominatim(hit, q)

    return {

        ok: true,

        latitude: lat,

        longitude: lon,

        displayName: rotuloCompleto,

        rotuloCurto: rotulo,

        nome,

        telefone,

        horaAtendimento,

        enderecoLinha,

    }

}



/** Várias sugestões de lugar (autocomplete no mapa). */

export async function buscarSugestoesNominatim(consulta, { limite = 5 } = {}) {

    const q = String(consulta || '').trim()

    if (!q || q.length < 2) return { ok: true, itens: [] }



    const r = await executarBuscaNominatim({

        q: `${q}, Brasil`,

        limit: String(Math.min(Math.max(limite, 1), 8)),

        countrycodes: 'br',

        addressdetails: '1',

        namedetails: '1',

        extratags: '1',

    })

    if (!r.ok) return { ok: false, erro: r.erro || MSG_RATE_LIMIT, codigo: r.codigo, itens: [] }

    return { ok: true, itens: mapearHitsNominatim(r.data, q) }

}



function mapearHitsNominatim(data, consultaFallback) {

    return (data || [])

        .map((hit) => {

            const lat = Number(hit.lat)

            const lon = Number(hit.lon)

            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

            const { rotulo, rotuloCompleto, ehPoiOuComercio, nome, telefone, horaAtendimento, enderecoLinha } =

                formatarHitNominatim(hit, consultaFallback)

            return {

                rotulo,

                rotuloCompleto,

                ehPoiOuComercio,

                nome,

                telefone,

                horaAtendimento,

                enderecoLinha,

                lat,

                lng: lon,

            }

        })

        .filter(Boolean)

}



/** Geocodifica CEP brasileiro (Nominatim postalcode). */

export async function geocodificarCepNominatim(cepBruto) {

    const cep = String(cepBruto || '').replace(/\D/g, '')

    if (cep.length !== 8) return { ok: false, erro: 'CEP deve ter 8 dígitos.' }



    const r = await executarBuscaNominatim({

        postalcode: cep,

        country: 'Brazil',

        limit: '1',

        addressdetails: '1',

        extratags: '1',

    })

    if (!r.ok) return { ok: false, erro: r.erro || MSG_RATE_LIMIT, codigo: r.codigo }



    const hit = r.data?.[0]

    if (!hit) return { ok: false, erro: 'CEP não encontrado no mapa.' }



    const lat = Number(hit.lat)

    const lon = Number(hit.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {

        return { ok: false, erro: 'Coordenadas inválidas para o CEP.' }

    }

    const { rotulo, rotuloCompleto, telefone, enderecoLinha } = formatarHitNominatim(hit, cep)

    return {

        ok: true,

        latitude: lat,

        longitude: lon,

        displayName: rotuloCompleto,

        rotuloCurto: rotulo || `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`,

        telefone,

        enderecoLinha,

    }

}



/**

 * POIs / lugares na área visível do mapa (viewbox Nominatim).

 * @param {string} consulta

 * @param {{ west: number, south: number, east: number, north: number, limite?: number, bounded?: boolean }} opts

 */

export async function buscarPoisNominatimNaViewbox(consulta, opts = {}) {

    const q = String(consulta || '').trim()

    if (!q || q.length < 2) return { ok: true, itens: [] }



    const { west, south, east, north } = opts

    const limite = Math.min(Math.max(Number(opts.limite) || 20, 1), 50)

    const bounded = opts.bounded !== false

    const obrigarViewbox = opts.obrigarViewbox === true



    const temViewbox =

        Number.isFinite(west) &&

        Number.isFinite(south) &&

        Number.isFinite(east) &&

        Number.isFinite(north)



    if (!temViewbox) {

        if (obrigarViewbox) {

            return {

                ok: false,

                erro: 'Área visível do mapa indisponível. Ajuste o zoom ou mova o mapa.',

                itens: [],

            }

        }

        return { ok: true, itens: [] }

    }



    const params = {

        q,

        limit: String(limite),

        countrycodes: 'br',

        addressdetails: '1',

        namedetails: '1',

        extratags: '1',

        viewbox: `${west},${north},${east},${south}`,

    }

    if (bounded) params.bounded = '1'



    const r = await executarBuscaNominatim(params)

    if (!r.ok) {

        return {

            ok: false,

            erro: r.erro || MSG_RATE_LIMIT,

            codigo: r.codigo,

            itens: [],

        }

    }



    let itens = mapearHitsNominatim(r.data, q)

    itens = itens.filter((item) => {

        const lat = item.lat

        const lng = item.lng

        return lat >= south && lat <= north && lng >= west && lng <= east

    })

    return { ok: true, itens }

}



/** Bounding box de município/localidade (Nominatim) para busca POI na cidade. */
export async function buscarViewboxLocalidadeNominatim(cidade, uf) {
    const c = String(cidade || '').trim()
    if (!c) return { ok: false, erro: 'Cidade não informada.' }
    const q = [c, uf, 'Brasil'].filter(Boolean).join(', ')
    const r = await executarBuscaNominatim({
        q,
        limit: '1',
        countrycodes: 'br',
        addressdetails: '1',
    })
    if (!r.ok) return { ok: false, erro: r.erro, codigo: r.codigo }
    const hit = r.data?.[0]
    const bb = hit?.boundingbox
    if (!hit || !Array.isArray(bb) || bb.length < 4) {
        return { ok: false, erro: 'Limites da cidade não encontrados.' }
    }
    const south = Number(bb[0])
    const north = Number(bb[1])
    const west = Number(bb[2])
    const east = Number(bb[3])
    const lat = Number(hit.lat)
    const lng = Number(hit.lon)
    if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
        return { ok: false, erro: 'Bounding box inválido para a cidade.' }
    }
    return {
        ok: true,
        bounds: { south, west, north, east },
        centro: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    }
}

export function delayMs(ms) {

    return new Promise((resolve) => setTimeout(resolve, ms))

}


