/**
 * Cliente Gemini via Interactions API (@google/genai) — apenas servidor/Node.
 * @see https://ai.google.dev/gemini-api/docs/quickstart
 */
import { ApiError, GoogleGenAI } from '@google/genai'
import { extrairGeminiRetrySegundos, metaDescansoGemini } from './geminiDescanso.js'

const GEMINI_FETCH_TIMEOUT_MS = 120_000

/** Padrão alinhado ao AI Studio / Interactions API. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/** Modelo legado da PoC — use em GEMINI_MODEL se quiser forçar o ID antigo. */
export const GEMINI_MODEL_POC_LEGADO = 'gemini-2.0-flash-001'

/**
 * Aliases curtos (ex.: gemini-1.5-flash no Vercel) costumam retornar HTTP 404.
 */
const MODEL_ID_ALIASES = {
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash': 'gemini-2.5-flash',
    'gemini-2.0-flash-001': 'gemini-2.5-flash',
    'gemini-2.0-flash-lite': 'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite-001': 'gemini-2.5-flash-lite',
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

/** Chave do AI Studio (Interactions / generateContent) costuma começar com AIza */
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
    if (modeloPrincipal === 'gemini-3.6-flash') {
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

function extrairTextoInteraction(interaction) {
    const direto = String(interaction?.output_text || '').trim()
    if (direto) return direto
    const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
    let out = ''
    for (const step of steps) {
        if (step?.type !== 'model_output') continue
        for (const block of step.content || []) {
            if (block?.type === 'text' && block.text) out += block.text
        }
    }
    return out.trim()
}

function normalizarErroSdk(err) {
    if (err instanceof ApiError) {
        return { status: err.status, message: err.message || String(err) }
    }
    const status = Number(err?.status || err?.statusCode || 0) || undefined
    const message = String(err?.message || err?.error?.message || err || 'Falha na consulta Gemini.')
    return { status, message }
}

async function comTimeout(promessa, ms, rotulo) {
    let timer
    try {
        return await Promise.race([
            promessa,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(rotulo)), ms)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {{ prompt: string, jsonSchema?: object, temperature?: number, maxOutputTokens?: number }} opts
 */
async function geminiGenerateJsonUmaTentativa(apiKey, model, opts) {
    const ai = new GoogleGenAI({ apiKey })

    const generation_config = {
        temperature: opts.temperature ?? 0.25,
    }
    if (Number.isFinite(opts.maxOutputTokens) && opts.maxOutputTokens > 0) {
        generation_config.max_output_tokens = Math.ceil(opts.maxOutputTokens)
    }

    /** @type {Record<string, unknown>} */
    const request = {
        model,
        input: opts.prompt,
        store: false,
        response_format: {
            type: 'text',
            mime_type: 'application/json',
            ...(opts.jsonSchema ? { schema: opts.jsonSchema } : {}),
        },
        generation_config,
    }

    let interaction
    try {
        interaction = await comTimeout(
            ai.interactions.create(request),
            GEMINI_FETCH_TIMEOUT_MS,
            'Timeout ao chamar Gemini (Interactions API).',
        )
    } catch (e) {
        const { status, message } = normalizarErroSdk(e)
        return {
            ok: false,
            status,
            erro: message,
            erroOriginal: message,
            modeloUsado: model,
        }
    }

    const texto = extrairTextoInteraction(interaction)
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
 * @param {{ prompt: string, jsonSchema?: object, model?: string, temperature?: number, maxOutputTokens?: number, apenasModeloPrincipal?: boolean }} opts
 */
export async function geminiGenerateJson(opts) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, erro: 'GEMINI_API_KEY não configurada no servidor.' }
    }
    const avisoChave = avisoFormatoChaveGemini(apiKey)

    const modeloConfigurado =
        String(opts.model || process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL
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
        erro:
            mensagemErroGeminiAmigavel(msg, status, modeloConfigurado, modeloUsado) +
            (avisoChave ? ` ${avisoChave}` : ''),
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
        jsonSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
        },
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
