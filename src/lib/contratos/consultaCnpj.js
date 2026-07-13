import { apenasDigitos } from './validarDocumentos.js'
import { buildServerApiUrl, serverApiAuthHeaders } from '../api/serverBackend.js'

const TTL_MS_PADRAO = 3 * 24 * 60 * 60 * 1000
const cacheMemoria = new Map()
/** @type {Map<string, Promise<object|null>>} */
const emVoo = new Map()

export const ROTA_CONSULTA_CNPJ = '/api/consulta-cnpj'

/** Únicos fluxos autorizados a chamar a consulta CNPJ (proxy Brasil API). */
export const ORIGENS_CONSULTA_CNPJ = {
    CONTRATOS_EMERDOG: 'contratos_emergod',
    CONTRATO_PDF_CLINICA: 'contrato_pdf_clinica',
    CONTRATO_PDF_DESCONTO: 'contrato_pdf_desconto',
    CONTRATO_PDF_VOLANTE_PJ: 'contrato_pdf_volante_pj',
}

const ORIGENS_PERMITIDAS = new Set(Object.values(ORIGENS_CONSULTA_CNPJ))

function ttlMs() {
    const raw =
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CNPJ_CACHE_DAYS) ||
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RECEITAWS_CACHE_DAYS)
    if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 1 && n <= 30) return n * 24 * 60 * 60 * 1000
    }
    return TTL_MS_PADRAO
}

function lerCache(digits) {
    const hit = cacheMemoria.get(digits)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
        cacheMemoria.delete(digits)
        return null
    }
    return hit.data
}

function gravarCache(digits, data) {
    if (!data || typeof data !== 'object') return
    cacheMemoria.set(digits, { data, expiresAt: Date.now() + ttlMs() })
}

/**
 * Consulta CNPJ via /api/consulta-cnpj (Brasil API no servidor; cache no browser).
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.forcar]
 * @param {string} [opcoes.origem] — obrigatório; use `ORIGENS_CONSULTA_CNPJ`.
 */
export async function buscarDadosCNPJ(cnpj, opcoes = {}) {
    const { forcar = false, origem = null } = opcoes
    if (!origem || !ORIGENS_PERMITIDAS.has(origem)) {
        return null
    }
    const digits = apenasDigitos(cnpj)
    if (digits.length !== 14) return null

    if (!forcar) {
        const emCache = lerCache(digits)
        if (emCache) return emCache
        const pendente = emVoo.get(digits)
        if (pendente) return pendente
    }

    const promessa = (async () => {
        const url = buildServerApiUrl('consulta-cnpj', { cnpj: digits })
        const res = await fetch(url, { headers: { Accept: 'application/json', ...serverApiAuthHeaders() } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            throw new Error(data?.error || 'CNPJ não encontrado ou erro na API.')
        }
        gravarCache(digits, data)
        return data
    })()

    if (!forcar) {
        emVoo.set(digits, promessa)
        try {
            return await promessa
        } finally {
            if (emVoo.get(digits) === promessa) emVoo.delete(digits)
        }
    }

    return promessa
}

/** Evita nova consulta na mesma sessão se o CNPJ já foi buscado com sucesso. */
export function cnpjJaConsultadoComSucesso(cnpj) {
    const digits = apenasDigitos(cnpj)
    return digits.length === 14 && Boolean(lerCache(digits))
}
