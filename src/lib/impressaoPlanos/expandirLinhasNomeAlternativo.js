import { normCodigoProcedimento } from '../buscarQuemRealizaPrestadores.js'
import { nomeAlternativoValido } from './realizadoresPorLinhaExibicao.js'

export { nomeAlternativoValido }

/**
 * Regras 3.4.1–3.4.3: uma linha selecionável por nome distinto (alternativo ou base).
 * @param {string} codigo
 * @param {string} nomeBase
 * @param {number[]} prestadorIds — prestadores na região que realizam o código
 * @param {Map<number, Map<string, string>>} mapaAltPorPrestadorId
 */
export function expandirLinhasNomeAlternativo(codigo, nomeBase, prestadorIds, mapaAltPorPrestadorId) {
    const cod = normCodigoProcedimento(codigo)
    const base = String(nomeBase || cod).trim() || cod
    const ids = [...new Set((prestadorIds || []).map(Number).filter(Boolean))]

    if (!ids.length) {
        return [
            {
                linhaKey: `${cod}|base`,
                codigo: cod,
                nome: base,
            },
        ]
    }

    const chaves = new Map()
    ids.forEach((pid) => {
        const alt = nomeAlternativoValido(mapaAltPorPrestadorId?.get(pid)?.get(cod), base)
        if (alt) chaves.set(`alt:${alt}`, alt)
        else chaves.set('base', base)
    })

    return [...chaves.entries()].map(([key, nome]) => ({
        linhaKey: `${cod}|${key}`,
        codigo: cod,
        nome,
    }))
}
