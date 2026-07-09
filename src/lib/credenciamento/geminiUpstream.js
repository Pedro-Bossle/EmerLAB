/**
 * Cliente mínimo da API Gemini (Google AI) — apenas servidor/Node.
 */
import { fetchComTimeout } from './fetchComTimeout.js'
import { extrairGeminiRetrySegundos, metaDescansoGemini } from './geminiDescanso.js'

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_FETCH_TIMEOUT_MS = 120_000

/** @param {string} [msg] @param {number} [status] */
export function isGeminiQuotaOrRateLimit(msg, status) {
    const m = String(msg || '').toLowerCase()
    if (status === 429 || status === 503) return true
    return (
        m.includes('quota') ||
        m.includes('resource_exhausted') ||
        m.includes('rate limit') ||
        m.includes('rate-limit')
    )
}

/** Mensagem curta para UI quando a API devolve texto longo em inglês. */
export function mensagemErroGeminiAmigavel(msg, status) {
    if (isGeminiQuotaOrRateLimit(msg, status)) {
        const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
        return (
            `Cota do Gemini esgotada (modelo ${model}). ` +
            'Verifique plano/faturamento em Google AI Studio ou use coleta OSM ' +
            '(PROSPECTOS_COLETA_FONTE=osm no .env.local).'
        )
    }
    const raw = String(msg || '').trim()
    if (raw.length > 280) return `${raw.slice(0, 280)}…`
    return raw || 'Falha na consulta Gemini.'
}

function extrairTextoResposta(body) {
    const parts = body?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return ''
    return parts.map((p) => p?.text || '').join('').trim()
}

/**
 * @param {{ prompt: string, jsonSchema?: object, model?: string, temperature?: number }} opts
 */
export async function geminiGenerateJson(opts) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, erro: 'GEMINI_API_KEY não configurada no servidor.' }
    }

    const model = opts.model || DEFAULT_MODEL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const generationConfig = {
        temperature: opts.temperature ?? 0.25,
        responseMimeType: 'application/json',
    }
    if (Number.isFinite(opts.maxOutputTokens) && opts.maxOutputTokens > 0) {
        generationConfig.maxOutputTokens = Math.ceil(opts.maxOutputTokens)
    }
    if (opts.jsonSchema) {
        generationConfig.responseSchema = opts.jsonSchema
    }

    let res
    try {
        res = await fetchComTimeout(
            url,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
                    generationConfig,
                }),
            },
            GEMINI_FETCH_TIMEOUT_MS,
        )
    } catch (e) {
        return { ok: false, erro: e?.message || 'Falha de rede ao chamar Gemini.' }
    }

    const raw = await res.text()
    let body
    try {
        body = raw ? JSON.parse(raw) : {}
    } catch {
        return { ok: false, erro: 'Resposta Gemini inválida (não-JSON).', status: res.status }
    }

    if (!res.ok) {
        const msg = body?.error?.message || raw.slice(0, 400) || `HTTP ${res.status}`
        const quotaExceeded = isGeminiQuotaOrRateLimit(msg, res.status)
        const retryAfterSec = extrairGeminiRetrySegundos(msg)
        return {
            ok: false,
            erro: mensagemErroGeminiAmigavel(msg, res.status),
            status: res.status,
            quotaExceeded,
            erroOriginal: msg,
            retryAfterSec: retryAfterSec ?? undefined,
            ...metaDescansoGemini(msg, retryAfterSec),
        }
    }

    const texto = extrairTextoResposta(body)
    if (!texto) {
        return { ok: false, erro: 'Gemini não retornou conteúdo.' }
    }

    try {
        return { ok: true, data: JSON.parse(texto) }
    } catch {
        return { ok: false, erro: 'Não foi possível interpretar JSON do Gemini.' }
    }
}

/** Ping mínimo para saber se a API aceita requisições (cota / chave). */
export async function geminiVerificarDisponibilidade() {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, configurado: false, disponivel: false, erro: 'GEMINI_API_KEY não configurada.' }
    }

    const r = await geminiGenerateJson({
        prompt: 'Responda apenas com JSON: {"ok":true}',
        temperature: 0,
        maxOutputTokens: 16,
    })

    if (r.ok) {
        return {
            ok: true,
            configurado: true,
            disponivel: true,
            modelo: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        }
    }

    return {
        ok: true,
        configurado: true,
        disponivel: false,
        quotaExceeded: Boolean(r.quotaExceeded),
        erro: r.erro,
        erroOriginal: r.erroOriginal,
        retryAfterSec: r.retryAfterSec,
        geminiDescansoAte: r.geminiDescansoAte,
        modelo: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    }
}
