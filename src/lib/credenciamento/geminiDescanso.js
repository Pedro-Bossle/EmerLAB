/** Chave localStorage — fim do intervalo de descanso (ISO) após rate limit do Gemini. */
export const GEMINI_DESCANSO_LS_KEY = 'sfsc-gemini-descanso-ate'
/** Cota/plano Gemini esgotado — distinto do descanso curto (retry). */
export const GEMINI_COTA_ESGOTADA_LS_KEY = 'sfsc-gemini-cota-esgotada'

/**
 * Extrai segundos de mensagens como "Please retry in 6.761188213s".
 * @param {string} [mensagem]
 * @returns {number | null}
 */
export function extrairGeminiRetrySegundos(mensagem) {
    const hit = String(mensagem || '').match(/retry in ([\d.]+)\s*s/i)
    if (!hit) return null
    const sec = Math.ceil(Number(hit[1]))
    if (!Number.isFinite(sec) || sec <= 0) return null
    return Math.min(sec, 24 * 60 * 60)
}

/**
 * @param {number} retrySec
 * @returns {string} ISO timestamp
 */
export function descansoAteFromRetrySec(retrySec) {
    const sec = Math.max(1, Math.ceil(Number(retrySec) || 0))
    return new Date(Date.now() + sec * 1000).toISOString()
}

/**
 * @param {string} [ateIso]
 * @returns {number}
 */
export function segundosRestantesDescanso(ateIso) {
    if (!ateIso) return 0
    const fim = new Date(ateIso).getTime()
    if (!Number.isFinite(fim)) return 0
    return Math.max(0, Math.ceil((fim - Date.now()) / 1000))
}

/**
 * @param {number} segundos
 * @returns {string}
 */
export function formatarTimerDescansoGemini(segundos) {
    const s = Math.max(0, Math.floor(segundos))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = s % 60
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    }
    return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * Contagem ao vivo (atualização ~10×/s) — segundos com décimo abaixo de 1 min.
 * @param {number} msRestantes
 * @returns {string}
 */
export function formatarTimerDescansoGeminiLive(msRestantes) {
    const ms = Math.max(0, msRestantes)
    if (ms <= 0) return '0,0s'
    const totalSec = ms / 1000
    if (totalSec >= 60) {
        return formatarTimerDescansoGemini(Math.ceil(totalSec))
    }
    return `${totalSec.toFixed(1).replace('.', ',')}s`
}

/**
 * @param {string} [ateIso]
 * @returns {number} ms restantes
 */
export function msRestantesDescanso(ateIso) {
    if (!ateIso) return 0
    const fim = new Date(ateIso).getTime()
    if (!Number.isFinite(fim)) return 0
    return Math.max(0, fim - Date.now())
}

/**
 * @param {string} [erroOriginal]
 * @param {number} [retryAfterSec]
 * @returns {{ retryAfterSec?: number, geminiDescansoAte?: string }}
 */
export function metaDescansoGemini(erroOriginal, retryAfterSec) {
    const sec =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.ceil(retryAfterSec)
            : extrairGeminiRetrySegundos(erroOriginal)
    if (!sec) return {}
    return {
        retryAfterSec: sec,
        geminiDescansoAte: descansoAteFromRetrySec(sec),
    }
}

const PAUSA_COTA_PADRAO_SEG = 60

function pausaCotaSegundos() {
    const n = Number(process.env.PROSPECTOS_GEMINI_PAUSA_SEG || PAUSA_COTA_PADRAO_SEG)
    return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : PAUSA_COTA_PADRAO_SEG
}

/**
 * Calcula descanso no momento da resposta HTTP (após coleta OSM longa o retry curto já teria expirado).
 * @param {{ quotaExceeded?: boolean, erroOriginal?: string, retryAfterSec?: number, geminiDescansoAte?: string }} gem
 */
export function descansoGeminiParaResposta(gem) {
    if (!gem) return {}

    const ateExistente = gem.geminiDescansoAte
    if (ateExistente && msRestantesDescanso(ateExistente) > 0) {
        return {
            geminiDescansoAte: ateExistente,
            geminiRetryAfterSec: Math.ceil(msRestantesDescanso(ateExistente) / 1000),
        }
    }

    const parsed = metaDescansoGemini(gem.erroOriginal, gem.retryAfterSec)
    if (parsed.geminiDescansoAte && msRestantesDescanso(parsed.geminiDescansoAte) > 0) {
        return {
            geminiDescansoAte: parsed.geminiDescansoAte,
            geminiRetryAfterSec: parsed.retryAfterSec,
        }
    }

    if (gem.quotaExceeded) {
        const sec = pausaCotaSegundos()
        return {
            geminiDescansoAte: descansoAteFromRetrySec(sec),
            geminiRetryAfterSec: sec,
            geminiQuotaPausa: true,
        }
    }

    if (parsed.geminiDescansoAte) {
        return {
            geminiDescansoAte: parsed.geminiDescansoAte,
            geminiRetryAfterSec: parsed.retryAfterSec,
        }
    }

    return {}
}
