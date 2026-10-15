import { buildServerApiUrl, serverApiAuthHeaders } from './api/serverBackend.js'
import { comRetryRede, mensagemErroFetchAmigavel } from './mensagemErroRede.js'

export async function buscarEnderecoPorCep(cep) {
    const digits = String(cep || '').replace(/\D/g, '')
    if (digits.length !== 8) throw new Error('CEP deve ter 8 dígitos.')
    const url = buildServerApiUrl('cep-lookup', { cep: digits })
    const auth = await serverApiAuthHeaders('cep-lookup')
    let res
    try {
        res = await comRetryRede(
            () => fetch(url, { headers: { Accept: 'application/json', ...auth } }),
            { tentativas: 3, delayMs: 500 },
        )
    } catch (err) {
        throw new Error(mensagemErroFetchAmigavel(err, { contexto: 'consulta de CEP' }))
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'CEP não encontrado.')
    return data
}
