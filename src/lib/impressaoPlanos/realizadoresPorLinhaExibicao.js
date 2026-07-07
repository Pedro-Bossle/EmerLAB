import { normCodigoProcedimento } from '../buscarQuemRealizaPrestadores.js'

export const nomeAlternativoValido = (altRaw, nomeBase) => {
    const alt = String(altRaw ?? '').trim()
    const base = String(nomeBase ?? '').trim()
    if (!alt) return ''
    if (!base) return alt
    if (alt.localeCompare(base, 'pt-BR', { sensitivity: 'base' }) === 0) return ''
    return alt
}

/** Nome efetivo que o prestador «usa» para o código (alternativo ou base do catálogo). */
export function nomeExibidoPrestadorParaCodigo(prestadorId, codigo, nomeBaseCatalogo, mapaAltPorPrestadorId) {
    const cod = normCodigoProcedimento(codigo)
    const base = String(nomeBaseCatalogo || cod).trim() || cod
    const alt = nomeAlternativoValido(mapaAltPorPrestadorId?.get(Number(prestadorId))?.get(cod), base)
    return alt || base
}

/**
 * Prestadores na região que realizam o código e cuja linha de exibição coincide com `nomeLinha`.
 * @param {number[]} prestadorIdsNaRegiao
 */
export function filtrarPrestadorIdsPorLinhaExibicao(
    prestadorIdsNaRegiao,
    codigo,
    nomeLinha,
    nomeBaseCatalogo,
    mapaAltPorPrestadorId,
) {
    const alvo = String(nomeLinha || '').trim()
    const unicos = [...new Set((prestadorIdsNaRegiao || []).map(Number).filter(Boolean))]
    return unicos.filter((pid) => {
        const eff = nomeExibidoPrestadorParaCodigo(pid, codigo, nomeBaseCatalogo, mapaAltPorPrestadorId)
        return eff.localeCompare(alvo, 'pt-BR', { sensitivity: 'base' }) === 0
    })
}
