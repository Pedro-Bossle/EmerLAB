/**
 * Lógica partilhada dos proxies leves (CEP / IBGE) — Edge Vercel + Vite/dev.
 * Sem Node APIs (sem path/fs/Buffer).
 */

import { consumirRateLimit, RATE_LIMITS } from './rateLimit.js'

const apenasDigitos = (v) => String(v || '').replace(/\D/g, '')

const formatarCep = (cepDigits) => {
    const c = apenasDigitos(cepDigits)
    if (c.length !== 8) return String(cepDigits || '').trim()
    return `${c.slice(0, 5)}-${c.slice(5)}`
}

/**
 * @param {Headers|Record<string, string|string[]|undefined>|undefined} headers
 */
export function clientIpFromHeaders(headers) {
    const get = (name) => {
        if (!headers) return ''
        if (typeof headers.get === 'function') return String(headers.get(name) || '')
        const h = headers
        const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
        const v = key ? h[key] : ''
        return Array.isArray(v) ? String(v[0] || '') : String(v || '')
    }
    const xfRaw = get('x-forwarded-for')
    const hops = xfRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
    return get('x-real-ip') || get('x-vercel-forwarded-for') || 'unknown'
}

/**
 * @returns {'ibge'|'cep'|''}
 */
export function rotaEdgeProxyDeUrl(urlLike) {
    try {
        const u = typeof urlLike === 'string' ? new URL(urlLike, 'http://localhost') : urlLike
        const flag = String(u.searchParams.get('_route') || '').trim().toLowerCase()
        if (flag === 'ibge' || flag === 'cep') return flag
        const path = u.pathname || ''
        if (path.includes('ibge-municipios')) return 'ibge'
        if (path.includes('cep-lookup')) return 'cep'
    } catch {
        /* ignore */
    }
    return ''
}

function jsonResult(status, body, extraHeaders = {}) {
    return {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...extraHeaders,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }
}

async function handleIbge(url) {
    const uf = String(url.searchParams.get('uf') || '')
        .trim()
        .toUpperCase()
    if (!/^[A-Z]{2}$/.test(uf)) {
        return jsonResult(400, { error: 'Informe uf=XX (sigla).' })
    }
    try {
        const upstream = await fetch(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
            { headers: { Accept: 'application/json' } },
        )
        const text = await upstream.text()
        return {
            status: upstream.status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=86400',
            },
            body: text,
        }
    } catch (e) {
        return jsonResult(502, { error: e?.message || 'Falha ao contactar o IBGE.' })
    }
}

async function handleCep(url, ip) {
    const rate = consumirRateLimit(`cep:${ip || 'unknown'}`, RATE_LIMITS.cep)
    const rateHeaders = {
        'X-RateLimit-Limit': String(rate.limit),
        'X-RateLimit-Remaining': String(rate.remaining),
    }
    if (!rate.ok) {
        return jsonResult(
            429,
            {
                ok: false,
                error: 'Demasiados pedidos. Aguarde um momento e tente de novo.',
                retryAfterSec: rate.retryAfterSec,
            },
            { ...rateHeaders, 'Retry-After': String(rate.retryAfterSec) },
        )
    }

    const cep = apenasDigitos(url.searchParams.get('cep') || '')
    if (cep.length !== 8) {
        return jsonResult(400, { error: 'Informe um CEP com 8 dígitos.' }, rateHeaders)
    }

    try {
        const upstream = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            headers: { Accept: 'application/json' },
        })
        const data = await upstream.json()
        if (!upstream.ok) {
            return jsonResult(upstream.status, { error: 'Falha ao consultar ViaCEP.' }, rateHeaders)
        }
        if (data?.erro) {
            return jsonResult(404, { error: 'CEP não encontrado.' }, rateHeaders)
        }
        return jsonResult(
            200,
            {
                cep: formatarCep(data.cep || cep),
                logradouro: String(data.logradouro || '').trim(),
                complemento: String(data.complemento || '').trim(),
                bairro: String(data.bairro || '').trim(),
                cidade: String(data.localidade || '').trim(),
                uf: String(data.uf || '').trim(),
                pais: 'Brasil',
                ibge: data.ibge || null,
            },
            rateHeaders,
        )
    } catch (e) {
        return jsonResult(502, { error: e?.message || 'Falha na consulta de CEP.' }, rateHeaders)
    }
}

/**
 * @param {string|URL} urlLike
 * @param {{ method?: string, headers?: Headers|Record<string, unknown>, ip?: string }} [opts]
 */
export async function executarEdgeProxy(urlLike, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase()
    if (method === 'OPTIONS') {
        return { status: 204, headers: {}, body: '' }
    }
    if (method !== 'GET' && method !== 'HEAD') {
        return jsonResult(405, { error: 'Método não permitido.' })
    }

    const url = typeof urlLike === 'string' ? new URL(urlLike, 'http://localhost') : urlLike
    const rota = rotaEdgeProxyDeUrl(url)
    const ip = opts.ip || clientIpFromHeaders(opts.headers)

    if (rota === 'ibge') return handleIbge(url)
    if (rota === 'cep') return handleCep(url, ip)
    return jsonResult(404, { error: 'Rota de proxy desconhecida.' })
}

/** Adapter Node/Vite (req/res estilo Vercel). */
export async function edgeProxyComoNodeHandler(req, res) {
    const result = await executarEdgeProxy(req.url || '/', {
        method: req.method,
        headers: req.headers,
        ip: clientIpFromHeaders(req.headers),
    })
    for (const [k, v] of Object.entries(result.headers || {})) {
        res.setHeader?.(k, v)
    }
    if (typeof res.status === 'function') {
        res.status(result.status)
        if (typeof res.end === 'function') {
            res.end(result.body ?? '')
            return
        }
        if (typeof res.send === 'function') {
            res.send(result.body ?? '')
            return
        }
    }
    res.statusCode = result.status
    res.end?.(result.body ?? '')
}
