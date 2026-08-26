/**
 * Proxy ViaCEP — Vercel Edge (não conta no limite Hobby de 12 Serverless).
 * GET /api/cep-lookup?cep=8digitos
 */
import {
    clientIpFromHeaders,
    executarEdgeProxy,
} from '../src/lib/api/edgeProxiesLogic.js'

export const config = {
    runtime: 'edge',
}

export default async function handler(request) {
    const u = new URL(request.url)
    u.searchParams.set('_route', 'cep')
    const result = await executarEdgeProxy(u, {
        method: request.method,
        headers: request.headers,
        ip: clientIpFromHeaders(request.headers),
    })
    return new Response(result.body ?? '', {
        status: result.status,
        headers: result.headers || {},
    })
}

/** Compat Vite/dev-api (req/res Node). */
export async function nodeHandler(req, res) {
    const { edgeProxyComoNodeHandler } = await import('../src/lib/api/edgeProxiesLogic.js')
    const u = new URL(req.url || '/', 'http://localhost')
    u.searchParams.set('_route', 'cep')
    req.url = u.pathname + u.search
    return edgeProxyComoNodeHandler(req, res)
}
