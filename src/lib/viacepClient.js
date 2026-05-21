export async function buscarEnderecoPorCep(cep) {
    const digits = String(cep || '').replace(/\D/g, '')
    if (digits.length !== 8) throw new Error('CEP deve ter 8 dígitos.')
    const res = await fetch(`/api/cep-lookup?cep=${encodeURIComponent(digits)}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'CEP não encontrado.')
    return data
}
