/**
 * Cliente mínimo da API Gemini (Google AI) — apenas servidor/Node.
 */
import { fetchComTimeout } from './fetchComTimeout.js'
import { extrairGeminiRetrySegundos, metaDescansoGemini } from './geminiDescanso.js'

const GEMINI_FETCH_TIMEOUT_MS = 120_000

/** Padrão alinhado à POC (antes: gemini-2.0-flash) e ao AI Studio atual. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/** Modelo da primeira POC no código legado — use em GEMINI_MODEL se quiser reproduzir exatamente. */
export const GEMINI_MODEL_POC_LEGADO = 'gemini-2.0-flash-001'

/**
 * Aliases curtos (ex.: gemini-1.5-flash no Vercel) costumam retornar HTTP 404.
 */
const MODEL_ID_ALIASES = {
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001',
}

/** @type {{ modelo: string, configHash: string } | null} */
let modeloEfetivoCache = null

function configHashGemini() {
    const m = String(process.env.GEMINI_MODEL || '').trim()
    const k = String(process.env.GEMINI_API_KEY || '').trim()
    return `${m}|${k.length}`
}

export function resolverModeloGemini(pedido) {
    const raw = String(pedido || process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL
    const key = raw.toLowerCase()
    return MODEL_ID_ALIASES[key] || raw
}

/** Chave do AI Studio (generateContent com ?key=) costuma começar com AIza */
export function avisoFormatoChaveGemini(apiKey) {
    const k = String(apiKey || '').trim()
    if (!k || k.startsWith('AIza')) return null
    return (
        'GEMINI_API_KEY não parece ser do Google AI Studio (esperado prefixo AIza…). ' +
        'Crie em aistudio.google.com/apikey. Outros formatos geram 404/503 no endpoint usado pela PoC.'
    )
}

/** Um fallback opcional — evita 3× 404 por requisição no painel Google. */
function fallbacksApos404(modeloPrincipal) {
    const manual = String(process.env.GEMINI_MODEL_FALLBACK || '').trim()
    if (manual && manual !== modeloPrincipal) {
        return [resolverModeloGemini(manual)]
    }
    if (modeloPrincipal === 'gemini-2.5-flash-lite') {
        return ['gemini-2.5-flash']
    }
    if (modeloPrincipal === 'gemini-2.0-flash-001' || modeloPrincipal === 'gemini-2.0-flash') {
        return ['gemini-2.5-flash']
    }
    return []
}

/**
 * @param {string} modeloInicial
 * @param {{ apenasPrincipal?: boolean }} [opcoes]
 */
function modelosParaTentar(modeloInicial, opcoes = {}) {
    const primeiro = resolverModeloGemini(modeloInicial)
    const hash = configHashGemini()

    if (modeloEfetivoCache && modeloEfetivoCache.configHash === hash) {
        return [modeloEfetivoCache.modelo]
    }

    if (opcoes.apenasPrincipal) {
        return [primeiro]
    }

    const lista = [primeiro]
    for (const m of fallbacksApos404(primeiro)) {
        if (!lista.includes(m)) lista.push(m)
    }
    return lista
}

function gravarCacheModelo(modelo) {
    modeloEfetivoCache = { modelo, configHash: configHashGemini() }
}

function limparCacheModelo() {
    modeloEfetivoCache = null
}

export function modeloGeminiPadrao() {
    return resolverModeloGemini(process.env.GEMINI_MODEL)
}

/** @param {string} [msg] @param {number} [status] */
export function isGeminiModelNotFound(msg, status) {
    if (status === 404) return true
    const m = String(msg || '').toLowerCase()
    return (
        m.includes('not found') ||
        m.includes('not_found') ||
        m.includes('is not found') ||
        m.includes('does not exist') ||
        (m.includes('model') && m.includes('invalid'))
    )
}

/** @param {string} [msg] @param {number} [status] */
export function isGeminiQuotaOrRateLimit(msg, status) {
    if (isGeminiModelNotFound(msg, status)) return false
    const m = String(msg || '').toLowerCase()
    if (status === 429 || status === 503) return true
    return (
        m.includes('quota') ||
        m.includes('resource_exhausted') ||
        m.includes('rate limit') ||
        m.includes('rate-limit')
    )
}

/** @param {string} [msg] @param {number} [status] */
export function classificarErroGemini(msg, status) {
    if (isGeminiModelNotFound(msg, status)) return 'modelo_nao_encontrado'
    if (isGeminiQuotaOrRateLimit(msg, status)) return 'cota_ou_rate_limit'
    return 'outro'
}

/** Mensagem curta para UI quando a API devolve texto longo em inglês. */
export function mensagemErroGeminiAmigavel(msg, status, modeloConfigurado, modeloUsado) {
    const cfg = modeloConfigurado || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    const usado = modeloUsado || cfg
    if (isGeminiModelNotFound(msg, status)) {
        const dica =
            cfg.toLowerCase() === 'gemini-1.5-flash'
                ? ` Use GEMINI_MODEL=${DEFAULT_GEMINI_MODEL} no Vercel (ou outro ID listado no AI Studio).`
                : ' Confira o nome exato em Google AI Studio → Models.'
        return (
            `Modelo Gemini não encontrado (HTTP 404). Configurado: "${cfg}"` +
            (usado !== cfg ? `, tentado: "${usado}".` : '.') +
            dica
        )
    }
    if (isGeminiQuotaOrRateLimit(msg, status)) {
        return (
            `Cota ou limite do Gemini (HTTP ${status || 429}). ` +
            `Modelo ${usado}. Verifique uso no AI Studio ou use coleta OSM.`
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

async function geminiGenerateJsonUmaTentativa(apiKey, model, opts) {
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
        return { ok: false, erro: e?.message || 'Falha de rede ao chamar Gemini.', modeloUsado: model }
    }

    const raw = await res.text()
    let body
    try {
        body = raw ? JSON.parse(raw) : {}
    } catch {
        return {
            ok: false,
            erro: 'Resposta Gemini inválida (não-JSON).',
            status: res.status,
            modeloUsado: model,
        }
    }

    if (!res.ok) {
        const msg = body?.error?.message || raw.slice(0, 400) || `HTTP ${res.status}`
        return {
            ok: false,
            status: res.status,
            erroOriginal: msg,
            modeloUsado: model,
        }
    }

    const texto = extrairTextoResposta(body)
    if (!texto) {
        return { ok: false, erro: 'Gemini não retornou conteúdo.', modeloUsado: model }
    }

    try {
        return { ok: true, data: JSON.parse(texto), modeloUsado: model }
    } catch {
        return { ok: false, erro: 'Não foi possível interpretar JSON do Gemini.', modeloUsado: model }
    }
}

/**
 * @param {{ prompt: string, jsonSchema?: object, model?: string, temperature?: number, apenasModeloPrincipal?: boolean }} opts
 */
export async function geminiGenerateJson(opts) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, erro: 'GEMINI_API_KEY não configurada no servidor.' }
    }
    const avisoChave = avisoFormatoChaveGemini(apiKey)

    const modeloConfigurado = String(opts.model || process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL
    const candidatos = modelosParaTentar(modeloConfigurado, {
        apenasPrincipal: Boolean(opts.apenasModeloPrincipal),
    })
    let ultimo = null
    let algum404 = false

    for (const model of candidatos) {
        const tentativa = await geminiGenerateJsonUmaTentativa(apiKey, model, opts)
        if (tentativa.ok) {
            gravarCacheModelo(tentativa.modeloUsado)
            return {
                ...tentativa,
                modeloConfigurado,
                modeloEfetivo: tentativa.modeloUsado,
            }
        }
        ultimo = tentativa
        if (tentativa.status === 404 || isGeminiModelNotFound(tentativa.erroOriginal, tentativa.status)) {
            algum404 = true
            continue
        }
        break
    }

    if (algum404) limparCacheModelo()

    const msg = ultimo?.erroOriginal || ultimo?.erro || 'Falha na consulta Gemini.'
    const status = ultimo?.status
    const modeloUsado = ultimo?.modeloUsado || candidatos[0]
    const codigo = classificarErroGemini(msg, status)
    const quotaExceeded = codigo === 'cota_ou_rate_limit'
    const modeloInvalido = codigo === 'modelo_nao_encontrado'
    const retryAfterSec = extrairGeminiRetrySegundos(msg)

    return {
        ok: false,
        erro: mensagemErroGeminiAmigavel(msg, status, modeloConfigurado, modeloUsado) + (avisoChave ? ` ${avisoChave}` : ''),
        status,
        codigoErro: codigo,
        quotaExceeded,
        modeloInvalido,
        erroOriginal: msg,
        modeloConfigurado,
        modeloEfetivo: modeloUsado,
        retryAfterSec: retryAfterSec ?? undefined,
        ...(quotaExceeded ? metaDescansoGemini(msg, retryAfterSec) : {}),
    }
}

/** Ping leve — só o modelo configurado (evita rajada de 404 no gráfico do Google). */
export async function geminiVerificarDisponibilidade() {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, configurado: false, disponivel: false, erro: 'GEMINI_API_KEY não configurada.' }
    }

    const modeloConfigurado = String(process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL

    const r = await geminiGenerateJson({
        prompt: 'Responda apenas com JSON: {"ok":true}',
        temperature: 0,
        maxOutputTokens: 16,
        apenasModeloPrincipal: true,
    })

    if (r.ok) {
        return {
            ok: true,
            configurado: true,
            disponivel: true,
            modelo: modeloConfigurado,
            modeloEfetivo: r.modeloEfetivo || r.modeloUsado,
        }
    }

    return {
        ok: true,
        configurado: true,
        disponivel: false,
        quotaExceeded: Boolean(r.quotaExceeded),
        modeloInvalido: Boolean(r.modeloInvalido),
        chaveFormatoInvalido: r.codigoErro === 'chave_invalida',
        codigoErro: r.codigoErro || 'outro',
        httpStatus: r.status,
        erro: r.erro,
        erroOriginal: r.erroOriginal,
        retryAfterSec: r.retryAfterSec,
        geminiDescansoAte: r.geminiDescansoAte,
        modelo: modeloConfigurado,
        modeloEfetivo: r.modeloEfetivo,
    }
}
