function prefixoApi() {
    const base = String(import.meta.env.BASE_URL || '/')
    if (base === '/' || base === '') return ''
    return base.replace(/\/$/, '')
}

export async function buscarEnderecoPorCep(cep) {
    const digits = String(cep || '').replace(/\D/g, '')
    if (digits.length !== 8) throw new Error('CEP deve ter 8 dígitos.')
    const res = await fetch(`${prefixoApi()}/api/cep-lookup?cep=${encodeURIComponent(digits)}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'CEP não encontrado.')
    return data
}
