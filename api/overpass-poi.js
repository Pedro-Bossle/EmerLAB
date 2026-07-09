/**
 * Proxy Overpass. GET /api/overpass-poi?south=&west=&north=&east=&categoria=veterinary
 */
import { overpassPoisNaArea } from '../src/lib/credenciamento/overpassUpstream.js'

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const url = new URL(req.url || '/', 'http://localhost')
    const r = await overpassPoisNaArea({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
        categoria: url.searchParams.get('categoria') || '',
    })

    if (!r.ok) {
        const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
        res.status(status).json({
            error: r.erro || 'Falha na consulta Overpass.',
            codigo: r.codigo || undefined,
        })
        return
    }

    res.setHeader('Cache-Control', 'private, max-age=300')
    res.status(200).json({ itens: r.itens || [] })
}
