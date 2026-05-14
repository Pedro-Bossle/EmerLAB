import { apenasDigitos } from './validarDocumentos.js'

/**
 * Consulta CNPJ via /api/cnpj-lookup (ReceitaWS; token opcional em RECEITAWS_API_TOKEN no servidor).
 * @returns {Promise<{razaoSocial:string,enderecoCompleto:string,...}|null>}
 */
export async function buscarDadosCNPJ(cnpj) {
    const digits = apenasDigitos(cnpj)
    if (digits.length !== 14) return null
    const res = await fetch(`/api/cnpj-lookup?cnpj=${encodeURIComponent(digits)}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(data?.error || 'CNPJ não encontrado ou erro na API.')
    }
    return data
}
