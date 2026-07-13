import { buildServerApiUrl, serverApiAuthHeaders } from './api/serverBackend.js'

export async function buscarEnderecoPorCep(cep) {
    const digits = String(cep || '').replace(/\D/g, '')
    if (digits.length !== 8) throw new Error('CEP deve ter 8 dígitos.')
    const url = buildServerApiUrl('cep-lookup', { cep: digits })
    const res = await fetch(url, { headers: { Accept: 'application/json', ...serverApiAuthHeaders() } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'CEP não encontrado.')
    return data
}
