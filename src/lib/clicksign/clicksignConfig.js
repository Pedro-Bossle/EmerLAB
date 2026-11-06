/**
 * Configuração server-side da Clicksign (API 3.0), compartilhada entre proxy, upload e download.
 */

export const CLICKSIGN_BASE_SANDBOX = 'https://sandbox.clicksign.com/api/v3'
export const CLICKSIGN_BASE_PRODUCAO = 'https://app.clicksign.com/api/v3'

const normBase = (b) => String(b || '').trim().replace(/\/$/, '')

/**
 * Resolve a base da API. Em produção (Vercel) a variável é obrigatória: cair em silêncio no
 * sandbox criaria envelopes sem validade jurídica (ou 401 confuso com token de produção).
 * Em desenvolvimento local o sandbox continua sendo o padrão.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ base: string, error?: string }}
 */
export function resolverBaseClicksign(env = globalThis.process?.env ?? {}) {
    const configurada = normBase(env.CLICKSIGN_API_BASE)
    if (!configurada) {
        if (env.VERCEL) {
            return {
                base: '',
                error:
                    'CLICKSIGN_API_BASE não configurada no servidor. Defina https://app.clicksign.com/api/v3 (produção) ou https://sandbox.clicksign.com/api/v3 (sandbox).',
            }
        }
        return { base: CLICKSIGN_BASE_SANDBOX }
    }
    if (configurada.includes('/api/v1') || configurada.includes('api.clicksign.com.br')) {
        return {
            base: '',
            error:
                'CLICKSIGN_API_BASE inválida para esta ferramenta (API 3.0). Use https://app.clicksign.com/api/v3 (produção) ou https://sandbox.clicksign.com/api/v3 (sandbox).',
        }
    }
    return { base: configurada }
}

/** Hosts da própria API/app Clicksign: aqui (e só aqui) é seguro enviar o Access Token. */
export function hostEhApiClicksign(hostname) {
    return /(^|\.)clicksign\.com$/i.test(String(hostname || ''))
}

/**
 * Hosts permitidos para baixar arquivos: API Clicksign e os buckets S3 de conteúdo
 * (links pré-assinados, que NÃO devem receber o Access Token).
 */
export function hostEhArquivoClicksign(hostname) {
    const h = String(hostname || '').toLowerCase()
    if (hostEhApiClicksign(h)) return true
    return /^clicksign-content-(production|sandbox)\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$/.test(h)
}

/** Remove o `secret` (HMAC) de respostas de /webhooks — não deve chegar ao navegador. */
export function removerSegredosWebhook(json) {
    if (Array.isArray(json)) return json.map(removerSegredosWebhook)
    if (!json || typeof json !== 'object') return json
    const out = {}
    for (const [k, v] of Object.entries(json)) {
        if (k === 'secret') continue
        out[k] = removerSegredosWebhook(v)
    }
    return out
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch com retry/backoff exponencial + jitter, conforme "Integração resiliente" da Clicksign.
 * - POST (não idempotente): só repete em 429 (a requisição foi recusada, não processada).
 * - Demais métodos: repete em 429, 502, 503, 504 e falhas de rede.
 * - Nunca repete 400/401/403/404/422.
 * - Respeita X-Rate-Limit-Reset (Unix time UTC), limitando a espera para caber na função serverless.
 *
 * @param {string} url
 * @param {RequestInit & { method?: string }} init
 * @param {{ maxTentativas?: number, esperaInicialMs?: number, esperaMaximaMs?: number }} [opts]
 */
export async function fetchComRetry(url, init = {}, opts = {}) {
    const maxTentativas = opts.maxTentativas ?? 3
    const esperaInicialMs = opts.esperaInicialMs ?? 600
    const esperaMaximaMs = opts.esperaMaximaMs ?? 4000
    const method = String(init.method || 'GET').toUpperCase()
    const soEm429 = method === 'POST'

    let ultimaResposta = null
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
        let res = null
        let erroRede = null
        try {
            res = await fetch(url, init)
        } catch (e) {
            erroRede = e
        }

        const status = res?.status ?? 0
        const repetivel = res
            ? status === 429 || (!soEm429 && [502, 503, 504].includes(status))
            : !soEm429
        if (!repetivel || tentativa === maxTentativas) {
            if (erroRede) throw erroRede
            return res
        }
        ultimaResposta = res

        let espera = Math.min(esperaInicialMs * 2 ** (tentativa - 1), esperaMaximaMs) * (0.5 + Math.random())
        const reset = Number(res?.headers?.get('x-rate-limit-reset'))
        if (status === 429 && Number.isFinite(reset) && reset > 0) {
            const ateReset = reset * 1000 - Date.now() + 100
            if (ateReset > espera) espera = ateReset
        }
        espera = Math.min(Math.max(espera, 0), esperaMaximaMs)
        void ultimaResposta?.body?.cancel?.().catch?.(() => {})
        await sleep(espera)
    }
    return ultimaResposta
}
