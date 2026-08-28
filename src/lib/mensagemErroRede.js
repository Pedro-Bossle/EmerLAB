/**
 * Traduz erros genéricos de fetch (rede/CORS/offline) para mensagem útil em PT.
 * @param {unknown} err
 * @param {{ contexto?: string }} [opts]
 */
export function mensagemErroFetchAmigavel(err, opts = {}) {
    const bruto = String(err?.message || err || '').trim()
    const lower = bruto.toLowerCase()
    const rede =
        lower === 'failed to fetch' ||
        lower.includes('networkerror') ||
        lower.includes('network request failed') ||
        lower.includes('load failed')

    if (!rede) return bruto || 'Erro inesperado.'

    const ctx = opts.contexto ? ` (${opts.contexto})` : ''
    return (
        `Não foi possível contactar o servidor${ctx}. Verifique a ligação à internet, ` +
        'desative bloqueadores de anúncios para este site e tente de novo. ' +
        'Se o problema continuar, confirme no ambiente de produção as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.'
    )
}
