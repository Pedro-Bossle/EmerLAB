/**
 * Compat: reexporta o cliente Gemini global.
 * Novos imports devem usar `src/lib/gemini/gemini.ts`.
 */
export {
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL_POC_LEGADO,
    avisoFormatoChaveGemini,
    classificarErroGemini,
    configSnapshot,
    generateJson,
    generateText,
    geminiConfigSnapshot,
    geminiGenerateJson,
    geminiGenerateText,
    geminiRpdLimite,
    geminiRpmLimite,
    geminiVerificarDisponibilidade,
    isGeminiModelNotFound,
    isGeminiOverloaded,
    isGeminiQuotaOrRateLimit,
    isGeminiTimeout,
    lerRate,
    marcarRateEsgotado,
    mensagemErroGeminiAmigavel,
    modeloGeminiPadrao,
    prospectosGeminiMax,
    registarChamada,
    resolverModeloGemini,
} from '../gemini/gemini.ts'
