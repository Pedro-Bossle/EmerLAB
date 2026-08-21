/**
 * Cliente Gemini via generateContent (@google/genai) - apenas servidor/Node.
 * @see https://ai.google.dev/gemini-api/docs/quickstart
 */
import { ApiError, GoogleGenAI } from '@google/genai'
import { extrairGeminiRetrySegundos, metaDescansoGemini } from './geminiDescanso.js'

const GEMINI_FETCH_TIMEOUT_MS = 120_000

/** Padrão: Gemini 3.5 Flash-Lite (generateContent). @see https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

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
    'gemini-3.5-flashlite': 'gemini-3.5-flash-lite',
    'gemini-3.5-flash-lite-latest': 'gemini-3.5-flash-lite',
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

/** Chaves do AI Studio: AIza… (clássica) ou AQ.… (formato recente). */
export function avisoFormatoChaveGemini(apiKey) {
    const k = String(apiKey || '').trim()
    if (!k || k.startsWith('AIza') || k.startsWith('AQ.')) return null
    return (
        'GEMINI_API_KEY com formato inesperado. Crie em aistudio.google.com/apikey ' +
        '(prefixos habituais: AIza… ou AQ.…).'
    )
}

/** Um fallback opcional — evita 3× 404 por requisição no painel Google. */
function fallbacksApos404(modeloPrincipal) {
    const manual = String(process.env.GEMINI_MODEL_FALLBACK || '').trim()
    if (manual && manual !== modeloPrincipal) {
        return [resolverModeloGemini(manual)]
    }
    if (modeloPrincipal === 'gemini-2.5-flash-lite') {
        return ['gemini-2.5-flash', 'gemini-flash-latest']
    }
    if (modeloPrincipal === 'gemini-2.5-flash') {
        return ['gemini-flash-latest']
    }
    if (modeloPrincipal === 'gemini-3.5-flash-lite') {
        return ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
    }
    if (
        modeloPrincipal === 'gemini-3.7-flash' ||
        modeloPrincipal === 'gemini-3.6-flash' ||
        modeloPrincipal === 'gemini-3.5-flash'
    ) {
        return ['gemini-3.5-flash-lite', 'gemini-2.5-flash']
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

/** Só env local — não chama a API Google. */
export function geminiConfigSnapshot() {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    const modelo = modeloGeminiPadrao()
    const aviso = avisoFormatoChaveGemini(apiKey)
    return {
        ok: true,
        configurado: Boolean(apiKey),
        ping: false,
        disponivel: null,
        modelo,
        modeloEfetivo: null,
        erro: !apiKey ? 'GEMINI_API_KEY não configurada no servidor.' : aviso || null,
    }
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

/** 503 UNAVAILABLE — modelo sobrecarregado, não é cota. */
export function isGeminiOverloaded(msg, status) {
    if (status === 503) return true
    const m = String(msg || '').toLowerCase()
    return (
        m.includes('overloaded') ||
        m.includes('high demand') ||
        m.includes('unavailable') ||
        m.includes('temporarily unavailable')
    )
}

function deveTentarProximoModelo(msg, status) {
    const m = String(msg || '').toLowerCase()
    if (status === 400 && (m.includes('thinking') || m.includes('budget'))) return true
    if (m.includes('não retornou conteúdo') || m.includes('empty_content')) return true
    return (
        status === 404 ||
        isGeminiModelNotFound(msg, status) ||
        isGeminiOverloaded(msg, status) ||
        isGeminiTimeout(msg)
    )
}

export function isGeminiTimeout(msg) {
    const m = String(msg || '').toLowerCase()
    return m.includes('timeout') || m.includes('aborted') || m.includes('aborterror')
}

/** @param {string} [msg] @param {number} [status] */
export function isGeminiQuotaOrRateLimit(msg, status) {
    if (isGeminiModelNotFound(msg, status)) return false
    if (isGeminiOverloaded(msg, status)) return false
    const m = String(msg || '').toLowerCase()
    if (status === 429) return true
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
    if (isGeminiOverloaded(msg, status)) return 'sobrecarregado'
    if (isGeminiTimeout(msg)) return 'timeout'
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
            `Modelo ${usado}. Verifique o uso no AI Studio.`
        )
    }
    if (isGeminiOverloaded(msg, status)) {
        return (
            `Gemini temporariamente indisponível (HTTP ${status || 503}). ` +
            `Modelo ${usado} está sobrecarregado — tente de novo ou use GEMINI_MODEL=gemini-2.5-flash.`
        )
    }
    if (isGeminiTimeout(msg)) {
        return `Timeout ao chamar o Gemini (modelo ${usado}). Tente de novo ou use GEMINI_MODEL=gemini-2.5-flash.`
    }
    const raw = String(msg || '').trim()
    if (raw.length > 280) return `${raw.slice(0, 280)}…`
    return raw || 'Falha na consulta Gemini.'
}

function limparTextoJson(texto) {
    let t = String(texto || '').trim()
    if (t.startsWith('```')) {
        t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    }
    return t.trim()
}

function extrairTextoGenerateContent(response) {
    const direto = String(response?.text || '').trim()
    if (direto) return direto
    const parts = response?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return ''
    let out = ''
    for (const part of parts) {
        if (part?.thought) continue
        if (typeof part?.text === 'string') out += part.text
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

async function comTimeout(factoryOuPromessa, ms, rotulo) {
    const ctrl = new AbortController()
    let timer
    const promessa =
        typeof factoryOuPromessa === 'function' ? factoryOuPromessa(ctrl.signal) : factoryOuPromessa
    try {
        return await Promise.race([
            promessa,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    ctrl.abort()
                    reject(new Error(rotulo))
                }, ms)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

function timeoutMsDe(opts) {
    const n = Number(opts?.timeoutMs)
    if (Number.isFinite(n) && n > 0) return Math.ceil(n)
    return GEMINI_FETCH_TIMEOUT_MS
}

function aplicarConfigGeracao(config, opts) {
    if (Number.isFinite(opts.temperature)) {
        config.temperature = opts.temperature
    }
    if (Number.isFinite(opts.maxOutputTokens) && opts.maxOutputTokens > 0) {
        config.maxOutputTokens = Math.ceil(opts.maxOutputTokens)
    }
    // Gemini 3.x: thinkingLevel (MINIMAL/LOW/MEDIUM/HIGH). thinkingBudget: 0 é da geração 2.5.
    if (opts.desligarThinking) {
        config.thinkingConfig = { thinkingLevel: 'MINIMAL' }
    }
}

function logGemini(nivel, mensagem, extra) {
    const fn = nivel === 'warn' ? console.warn : console.info
    fn(`[gemini] ${mensagem}`, extra || '')
}

function resumoRespostaGemini(response, texto) {
    const cand = response?.candidates?.[0]
    const usage = response?.usageMetadata || {}
    const parts = cand?.content?.parts
    return {
        finishReason: cand?.finishReason || null,
        parts: Array.isArray(parts) ? parts.length : 0,
        textoChars: String(texto || '').length,
        promptTokens: usage.promptTokenCount ?? null,
        candidatesTokens: usage.candidatesTokenCount ?? null,
        thoughtsTokens: usage.thoughtsTokenCount ?? null,
    }
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {{ prompt: string, jsonSchema?: object, temperature?: number, maxOutputTokens?: number }} opts
 */
async function geminiGenerateJsonUmaTentativa(apiKey, model, opts) {
    const ai = new GoogleGenAI({ apiKey })

    /** @type {Record<string, unknown>} */
    const config = {
        temperature: opts.temperature ?? 0.25,
        responseMimeType: 'application/json',
    }
    aplicarConfigGeracao(config, opts)
    if (opts.jsonSchema) {
        config.responseJsonSchema = opts.jsonSchema
    }

    let response
    try {
        response = await comTimeout(
            (signal) => {
                config.abortSignal = signal
                return ai.models.generateContent({
                    model,
                    contents: opts.prompt,
                    config,
                })
            },
            timeoutMsDe(opts),
            'Timeout ao chamar Gemini (generateContent).',
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

    const texto = limparTextoJson(extrairTextoGenerateContent(response))
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
 * @param {{ prompt: string, model?: string, apenasModeloPrincipal?: boolean }} opts
 * @param {(apiKey: string, model: string, opts: object) => Promise<object>} umaTentativa
 */
async function executarGenerateComCandidatos(opts, umaTentativa) {
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
    logGemini('info', 'candidatos', { modeloConfigurado, candidatos })
    let ultimo = null
    let algumFallback = false

    for (const model of candidatos) {
        const tentativa = await umaTentativa(apiKey, model, opts)
        if (tentativa.ok) {
            gravarCacheModelo(tentativa.modeloUsado)
            return {
                ...tentativa,
                modeloConfigurado,
                modeloEfetivo: tentativa.modeloUsado,
            }
        }
        ultimo = tentativa
        if (deveTentarProximoModelo(tentativa.erroOriginal, tentativa.status)) {
            algumFallback = true
            continue
        }
        break
    }

    if (algumFallback) limparCacheModelo()

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

/**
 * @param {{ prompt: string, jsonSchema?: object, model?: string, temperature?: number, maxOutputTokens?: number, apenasModeloPrincipal?: boolean }} opts
 */
export async function geminiGenerateJson(opts) {
    return executarGenerateComCandidatos(opts, geminiGenerateJsonUmaTentativa)
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {{ prompt: string, temperature?: number, maxOutputTokens?: number }} opts
 */
async function geminiGenerateTextUmaTentativa(apiKey, model, opts) {
    const ai = new GoogleGenAI({ apiKey })
    const timeoutMs = timeoutMsDe(opts)
    const t0 = Date.now()
    logGemini('info', 'pedido', {
        model,
        timeoutMs,
        promptChars: String(opts.prompt || '').length,
        maxOutputTokens: opts.maxOutputTokens ?? null,
        thinking: opts.desligarThinking ? 'MINIMAL' : 'default',
    })

    /** @type {Record<string, unknown>} */
    const config = {}
    aplicarConfigGeracao(config, opts)

    let response
    try {
        response = await comTimeout(
            (signal) => {
                config.abortSignal = signal
                return ai.models.generateContent({
                    model,
                    contents: opts.prompt,
                    config,
                })
            },
            timeoutMs,
            'Timeout ao chamar Gemini (generateContent).',
        )
    } catch (e) {
        const { status, message } = normalizarErroSdk(e)
        logGemini('warn', 'falha', { model, ms: Date.now() - t0, status: status || null, erro: message })
        return {
            ok: false,
            status,
            erro: message,
            erroOriginal: message,
            modeloUsado: model,
        }
    }

    const texto = extrairTextoGenerateContent(response)
    const resumo = resumoRespostaGemini(response, texto)
    logGemini('info', 'resposta', { model, ms: Date.now() - t0, ...resumo })
    if (!texto) {
        return {
            ok: false,
            erro: resumo.finishReason
                ? `Gemini não retornou texto (finishReason=${resumo.finishReason}).`
                : 'Gemini não retornou conteúdo.',
            modeloUsado: model,
        }
    }
    return { ok: true, texto, modeloUsado: model, finishReason: resumo.finishReason }
}

/**
 * generateContent em texto livre (sem JSON schema) — playground / testes.
 * @param {{ prompt: string, model?: string, temperature?: number, maxOutputTokens?: number, apenasModeloPrincipal?: boolean }} opts
 */
export async function geminiGenerateText(opts) {
    return executarGenerateComCandidatos(opts, geminiGenerateTextUmaTentativa)
}

/**
 * Ping leve.
 * @param {{ permitirFallback?: boolean, textoLivre?: boolean }} [opts]
 */
export async function geminiVerificarDisponibilidade(opts = {}) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) {
        return { ok: false, configurado: false, disponivel: false, erro: 'GEMINI_API_KEY não configurada.' }
    }

    const modeloConfigurado = String(process.env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL
    const apenasPrincipal = opts.permitirFallback ? false : true

    const r = opts.textoLivre
        ? await geminiGenerateText({
              prompt: 'Responda apenas: ok',
              temperature: 0,
              maxOutputTokens: 32,
              apenasModeloPrincipal: apenasPrincipal,
          })
        : await geminiGenerateJson({
              prompt: 'Responda apenas com JSON: {"ok":true}',
              temperature: 0,
              // Modelos com "thinking" consomem tokens internos; 16 deixa a saída vazia.
              maxOutputTokens: 256,
              apenasModeloPrincipal: apenasPrincipal,
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
        sobrecarregado: r.codigoErro === 'sobrecarregado',
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
