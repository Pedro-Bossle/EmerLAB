/**
 * Vercel: todas as rotas /api/clicksign/* (via rewrite em vercel.json).
 * Reconstrói req.url para o proxy (pathname /api/clicksign/...).
 */
import clicksignProxy from './clicksign-proxy.js'

function pathFromQuery(req) {
    const q = req.query?.path
    if (q == null || q === '') return ''
    return Array.isArray(q) ? q.join('/') : String(q)
}

export default async function handler(req, res) {
    const segment = pathFromQuery(req)
    const u = new URL(req.url || '/', 'http://localhost')
    const search = u.search || ''
    req.url = `/api/clicksign/${segment.replace(/^\/+/, '')}${search}`
    return clicksignProxy(req, res)
}
