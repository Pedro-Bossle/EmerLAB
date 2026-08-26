/**
 * Proxy server-side para municípios IBGE (evita bloqueio CORS/rede no browser).
 * GET /api/ibge-municipios?uf=RS
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end()
        return
    }
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const u = new URL(req.url || '/', 'http://localhost')
    const uf = String(u.searchParams.get('uf') || '')
        .trim()
        .toUpperCase()
    if (!/^[A-Z]{2}$/.test(uf)) {
        res.status(400).json({ error: 'Informe uf=XX (sigla).' })
        return
    }

    try {
        const upstream = await fetch(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
            { headers: { Accept: 'application/json' } },
        )
        const text = await upstream.text()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.status(upstream.status).end(text)
    } catch (e) {
        res.status(502).json({ error: e?.message || 'Falha ao contactar o IBGE.' })
    }
}
