/**
 * Cliente Overpass via Edge /api/overpass-poi (browser) ou módulo upstream (Node).
 */
import { buildServerApiUrl, serverApiAuthHeaders } from '../api/serverBackend.js'

export async function buscarPoisOverpassNaArea(bounds, categoriaId) {
    const categoria = String(categoriaId || '').trim()
    const { south, west, north, east } = bounds || {}
    if (!categoria || ![south, west, north, east].every(Number.isFinite)) {
        return { ok: false, erro: 'Parâmetros inválidos para Overpass.', itens: [] }
    }

    if (typeof window !== 'undefined') {
        const url = new URL(
            buildServerApiUrl('overpass-poi', {
                south: String(south),
                west: String(west),
                north: String(north),
                east: String(east),
                categoria,
            }),
        )
        let resp
        try {
            resp = await fetch(url.toString(), {
                headers: { Accept: 'application/json', ...serverApiAuthHeaders() },
            })
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
