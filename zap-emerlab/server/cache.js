// Cache de curta duração na memória da função (cada instância serverless tem o seu).
// Existe para o polling do painel: vários atendentes e abas consultando as mesmas linhas a cada poucos
// segundos geravam dezenas de milhares de leituras por dia no Supabase (egress do plano Free).
const itens = new Map() // chave → { valor, expira }
const emVoo = new Map() // chave → Promise (junta chamadas simultâneas)

/** Devolve o valor em cache (até `ttlMs`) ou executa `fn`. Erros e resultados vazios não ficam em cache. */
export async function memo(chave, ttlMs, fn) {
    const agora = Date.now()
    const guardado = itens.get(chave)
    if (guardado && guardado.expira > agora) return guardado.valor
    if (emVoo.has(chave)) return emVoo.get(chave)
    const promessa = (async () => {
        try {
            const valor = await fn()
            if (valor !== null && valor !== undefined) itens.set(chave, { valor, expira: Date.now() + ttlMs })
            return valor
        } finally {
            emVoo.delete(chave)
        }
    })()
    emVoo.set(chave, promessa)
    return promessa
}

/** Remove do cache as chaves que começam com `prefixo` (use depois de gravar). */
export function invalidar(prefixo) {
    for (const k of [...itens.keys()]) if (k.startsWith(prefixo)) itens.delete(k)
}
