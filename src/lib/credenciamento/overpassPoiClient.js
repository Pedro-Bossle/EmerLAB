/**
 * Cliente Overpass via /api/overpass-poi (browser) ou módulo upstream (Node).
 */

export async function buscarPoisOverpassNaArea(bounds, categoriaId) {
    const categoria = String(categoriaId || '').trim()
    const { south, west, north, east } = bounds || {}
    if (!categoria || ![south, west, north, east].every(Number.isFinite)) {
        return { ok: false, erro: 'Parâmetros inválidos para Overpass.', itens: [] }
    }

    if (typeof window !== 'undefined') {
        const url = new URL('/api/overpass-poi', window.location.origin)
        url.searchParams.set('south', String(south))
        url.searchParams.set('west', String(west))
        url.searchParams.set('north', String(north))
        url.searchParams.set('east', String(east))
        url.searchParams.set('categoria', categoria)
        let resp
        try {
            resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
        } catch (e) {
            return { ok: false, erro: e?.message || 'Falha na rede.', itens: [] }
        }
        let body = null
        try {
            body = await resp.json()
        } catch {
            body = null
        }
        if (!resp.ok) {
            return {
                ok: false,
                erro: body?.error || `Overpass HTTP ${resp.status}`,
                codigo: body?.codigo,
                itens: [],
            }
        }
        return { ok: true, itens: body?.itens || [] }
    }

    const { overpassPoisNaArea } = await import('./overpassUpstream.js')
    const r = await overpassPoisNaArea({ south, west, north, east, categoria })
    if (!r.ok) return { ok: false, erro: r.erro, codigo: r.codigo, itens: [] }
    return { ok: true, itens: r.itens || [] }
}
