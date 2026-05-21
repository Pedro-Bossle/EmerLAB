import { normalizarTextoBusca } from './prestadorCadastroHelpers.js'
import { extrairCodigosProcedimentoEmMassa } from './parseCodigosEmMassa.js'

/**
 * Resolve tokens (código ou trecho do nome) para códigos de procedimentos da categoria.
 * @returns {{ codigos: string[], naoEncontrados: string[], ambiguos: { token: string, opcoes: {codigo:string,nome:string}[] }[] }}
 */
export function resolverProcedimentosMassaNaCategoria(texto, procedimentosCategoria) {
    const tokens = String(texto || '')
        .replace(/\r/g, '')
        .split(/[,\n\t]+/)
        .map((t) => t.trim())
        .filter(Boolean)

    const lista = procedimentosCategoria || []
    const porCodigo = new Map(lista.map((p) => [String(p.codigo || '').trim().toUpperCase(), p]))

    const codigos = new Set()
    const naoEncontrados = []
    const ambiguos = []

    for (const token of tokens) {
        const codUp = token.toUpperCase()
        if (porCodigo.has(codUp)) {
            codigos.add(String(porCodigo.get(codUp).codigo))
            continue
        }

        const seg = normalizarTextoBusca(token)
        const porNome = lista.filter((p) => normalizarTextoBusca(p.nome).includes(seg))
        if (porNome.length === 1) {
            codigos.add(String(porNome[0].codigo))
        } else if (porNome.length === 0) {
            const codigosMassa = extrairCodigosProcedimentoEmMassa(token)
            if (codigosMassa.length === 1 && porCodigo.has(codigosMassa[0])) {
                codigos.add(String(porCodigo.get(codigosMassa[0]).codigo))
            } else {
                naoEncontrados.push(token)
            }
        } else {
            ambiguos.push({
                token,
                opcoes: porNome.slice(0, 8).map((p) => ({ codigo: p.codigo, nome: p.nome })),
            })
        }
    }

    return { codigos: [...codigos], naoEncontrados, ambiguos }
}

/** Mesma regra de resolução, em qualquer conjunto de procedimentos (ex.: todas as categorias de serviço). */
export function resolverProcedimentosMassaGlobal(texto, procedimentos) {
    return resolverProcedimentosMassaNaCategoria(texto, procedimentos)
}
