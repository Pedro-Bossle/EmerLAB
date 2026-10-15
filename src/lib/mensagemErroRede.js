/**
 * Traduz erros genéricos de fetch (rede/CORS/offline) para mensagem útil em PT.
 * @param {unknown} err
 * @param {{ contexto?: string }} [opts]
 */

/** @param {unknown} err */
export function isErroRedeFetch(err) {
    if (!err) return false
    if (err?.name === 'AbortError') return false
    const bruto = String(err?.message || err || '').trim().toLowerCase()
    return (
        bruto === 'failed to fetch' ||
        bruto.includes('networkerror') ||
        bruto.includes('network request failed') ||
        bruto.includes('load failed') ||
        bruto.includes('falha temporária de conexão') ||
        bruto.includes('não foi possível contactar o servidor')
    )
}

/**
 * Repete a operação em falhas transitórias de rede.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ tentativas?: number, delayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function comRetryRede(fn, opts = {}) {
    const tentativas = Math.max(1, Number(opts.tentativas) || 3)
    const delayMs = Math.max(0, Number(opts.delayMs) || 500)
    let ultimo
    for (let i = 0; i < tentativas; i += 1) {
        try {
            return await fn()
        } catch (err) {
            ultimo = err
            if (!isErroRedeFetch(err) || i === tentativas - 1) throw err
            await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
        }
    }
    throw ultimo
}

export function mensagemErroFetchAmigavel(err, opts = {}) {
    const bruto = String(err?.message || err || '').trim()
    if (!isErroRedeFetch(err) && !isErroRedeFetch({ message: bruto })) {
        return bruto || 'Erro inesperado.'
    }

    const ctx = opts.contexto ? ` (${opts.contexto})` : ''
    return (
        `Falha temporária de conexão${ctx}. Verifique a internet e tente enviar novamente.`
    )
}
