/**
 * Rate limit em memória do processo (Vercel: por instância quente).
 * Adequado para frear abuso; não é quota global multi-região.
 */

/** @type {Map<string, number[]>} */
const buckets = new Map()

const MAX_KEYS = 8000

function agoraMs() {
    return Date.now()
}

function limparBucket(chave, windowMs) {
    const agora = agoraMs()
    const lista = (buckets.get(chave) || []).filter((t) => agora - t < windowMs)
    if (lista.length) buckets.set(chave, lista)
    else buckets.delete(chave)
    return lista
}

/**
 * @param {string} key
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number, limit: number }}
 */
export function consumirRateLimit(key, { limit, windowMs }) {
    const k = String(key || 'anon')
    if (buckets.size > MAX_KEYS) {
        const excesso = buckets.size - Math.floor(MAX_KEYS * 0.8)
        let i = 0
        for (const ck of buckets.keys()) {
            if (i++ >= excesso) break
            buckets.delete(ck)
        }
    }

    const lista = limparBucket(k, windowMs)
    if (lista.length >= limit) {
        const maisAntigo = lista[0] || agoraMs()
        const retryAfterSec = Math.max(1, Math.ceil((windowMs - (agoraMs() - maisAntigo)) / 1000))
        return { ok: false, remaining: 0, retryAfterSec, limit }
    }
    lista.push(agoraMs())
    buckets.set(k, lista)
    return {
        ok: true,
        remaining: Math.max(0, limit - lista.length),
        retryAfterSec: 0,
        limit,
    }
}

/** Limites padrão por tipo de rota. */
export const RATE_LIMITS = {
    cep: { limit: 40, windowMs: 60_000 },
    cnpj: { limit: 30, windowMs: 60_000 },
    mapOsm: { limit: 45, windowMs: 60_000 },
    rcPdf: { limit: 8, windowMs: 60_000 },
    geocode: { limit: 30, windowMs: 60_000 },
    prospectos: { limit: 12, windowMs: 60_000 },
    clicksign: { limit: 60, windowMs: 60_000 },
    webhook: { limit: 120, windowMs: 60_000 },
    adminUsers: { limit: 30, windowMs: 60_000 },
    auditLogs: { limit: 40, windowMs: 60_000 },
    geminiRate: { limit: 30, windowMs: 60_000 },
}

/**
 * Aplica rate limit e escreve 429 se excedido.
 * @returns {boolean} true se pode continuar
 */
export function aplicarRateLimit(res, key, spec) {
    const r = consumirRateLimit(key, spec)
    res.setHeader?.('X-RateLimit-Limit', String(r.limit))
    res.setHeader?.('X-RateLimit-Remaining', String(r.remaining))
    if (!r.ok) {
        res.setHeader?.('Retry-After', String(r.retryAfterSec))
        res.status(429).json({
            ok: false,
            error: 'Demasiados pedidos. Aguarde um momento e tente de novo.',
            retryAfterSec: r.retryAfterSec,
        })
        return false
    }
    return true
}
