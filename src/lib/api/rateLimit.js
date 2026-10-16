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
    /** Recuperação de senha na tela de login (por IP). */
    forgotPassword: { limit: 5, windowMs: 15 * 60_000 },
    /** Mesmo e-mail a partir de qualquer IP. */
    forgotPasswordPorEmail: { limit: 5, windowMs: 60 * 60_000 },
    auditLogs: { limit: 40, windowMs: 60_000 },
    geminiRate: { limit: 30, windowMs: 60_000 },
}

/**
 * Rate limit compartilhado entre instâncias (Postgres, migração 20261017000100).
 * Se a função não existir ou o banco falhar, cai para o limite em memória.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin — cliente service role
 */
export async function consumirRateLimitDistribuido(supabaseAdmin, key, { limit, windowMs }) {
    const local = consumirRateLimit(key, { limit, windowMs })
    if (!supabaseAdmin?.rpc) return local
    try {
        const { data, error } = await supabaseAdmin.rpc('emer_rate_limit_consumir', {
            p_chave: String(key || 'anon'),
            p_limite: limit,
            p_janela_seg: Math.max(1, Math.round(windowMs / 1000)),
        })
        const row = Array.isArray(data) ? data[0] : data
        if (error || !row) return local
        // O mais restritivo vence: a instância também pode ter visto rajadas locais.
        if (!row.ok || !local.ok) {
            return {
                ok: false,
                remaining: 0,
                retryAfterSec: Math.max(Number(row.retry_after_seg) || 1, local.retryAfterSec || 0),
                limit,
            }
        }
        return { ok: true, remaining: Math.min(Number(row.restante) || 0, local.remaining), retryAfterSec: 0, limit }
    } catch {
        return local
    }
}

function escreverRateLimit(res, r) {
    res.setHeader?.('X-RateLimit-Limit', String(r.limit))
    res.setHeader?.('X-RateLimit-Remaining', String(r.remaining))
    if (!r.ok) {
        res.setHeader?.('Retry-After', String(r.retryAfterSec))
        res.status(429).json({
            ok: false,
            error: 'Muitas solicitações. Aguarde um momento e tente de novo.',
            retryAfterSec: r.retryAfterSec,
        })
        return false
    }
    return true
}

/**
 * Aplica rate limit em memória e escreve 429 se excedido.
 * @returns {boolean} true se pode continuar
 */
export function aplicarRateLimit(res, key, spec) {
    return escreverRateLimit(res, consumirRateLimit(key, spec))
}

/**
 * Igual a aplicarRateLimit, mas com contador compartilhado no Postgres.
 * Use em rotas sem login ou caras (recuperação de senha, Gemini).
 * @returns {Promise<boolean>} true se pode continuar
 */
export async function aplicarRateLimitDistribuido(res, supabaseAdmin, key, spec) {
    return escreverRateLimit(res, await consumirRateLimitDistribuido(supabaseAdmin, key, spec))
}
