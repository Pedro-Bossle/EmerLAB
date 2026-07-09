/**
 * Proxy Nominatim (OpenStreetMap). GET /api/nominatim-search?q=...&limit=...
 * Evita CORS e centraliza rate limit (1 req/s) no servidor.
 */
import { nominatimSearchJson, normalizarParamsNominatim } from '../src/lib/credenciamento/nominatimUpstream.js'

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const url = new URL(req.url || '/', 'http://localhost')
    const params = {}
    for (const [k, v] of url.searchParams.entries()) {
        params[k] = v
    }

    const normalizado = normalizarParamsNominatim(params)
    const r = await nominatimSearchJson(normalizado)

    if (!r.ok) {
        const status = r.status === 429 ? 429 : r.status && r.status >= 400 ? r.status : 502
        res.status(status).json({
            error: r.erro || 'Falha na consulta Nominatim.',
            codigo: r.codigo || undefined,
        })
        return
    }

    res.setHeader('Cache-Control', 'private, max-age=300')
    res.status(200).json(r.data)
}
