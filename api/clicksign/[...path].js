/**
 * Vercel (rota dinâmica): /api/clicksign/* → clicksign-proxy.js
 * Reconstrói req.url a partir de req.query.path (catch-all da Vercel).
 */
import clicksignProxy from '../clicksign-proxy.js'

function pathFromQuery(req) {
    const q = req.query?.path
    if (q == null || q === '') return ''
    return Array.isArray(q) ? q.join('/') : String(q)
}

export default async function handler(req, res) {
    const segment = pathFromQuery(req)
    const u = new URL(req.url || '/', 'http://localhost')
    const pathname = (u.pathname || '').replace(/^\/api\/clicksign\/?/, '')
    const effective = segment || pathname
    const search = u.search || ''
    req.url = `/api/clicksign/${String(effective).replace(/^\/+/, '')}${search}`
    return clicksignProxy(req, res)
}
