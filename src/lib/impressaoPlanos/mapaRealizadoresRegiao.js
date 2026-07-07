import {
    buscarVinculosPrestadorProcedimentosEmLote,
    normCodigoProcedimento,
    prestadorAtendeAlgumaCidadeAlvo,
} from '../buscarQuemRealizaPrestadores.js'
import { mapaCodigosPorPrestadorDeVinculos } from '../prestadorProcedimentos.js'
import { carregarMapaNomesAlternativosPrestador } from '../prestadorNomeAlternativo.js'

const MIN_REALIZADORES_PRE_MARCAR = 3

export { MIN_REALIZADORES_PRE_MARCAR }

/**
 * @returns {Promise<{ contagemPorCodigo: Map<string, number>, prestadoresPorCodigo: Map<string, number[]>, mapaAltPorPrestadorId: Map<number, Map<string, string>> }>}
 */
export async function montarMapasRealizadoresRegiao(supabase, opcoes) {
    const {
        codigos = [],
        cidadesAlvo = [],
        incluirCidadesParalelas = true,
        prestadores = [],
        prestadorCidades = [],
        mapaCidadesCred = new Map(),
        mapaCodigoPorProcedimentoId = new Map(),
    } = opcoes

    const codigosNorm = [...new Set(codigos.map(normCodigoProcedimento).filter(Boolean))]
    const contagemPorCodigo = new Map(codigosNorm.map((c) => [c, 0]))
    const prestadoresPorCodigo = new Map(codigosNorm.map((c) => [c, new Set()]))

    if (!codigosNorm.length || !cidadesAlvo?.length) {
        return { contagemPorCodigo, prestadoresPorCodigo, mapaAltPorPrestadorId: new Map() }
    }

    const ctxFiltro = { mapaCidadesCred, prestadorCidades, incluirCidadesParalelas }
    const candidatos = (prestadores || []).filter((p) =>
        prestadorAtendeAlgumaCidadeAlvo(p, cidadesAlvo, ctxFiltro),
    )
    const ids = candidatos.map((p) => Number(p.id)).filter(Boolean)
    if (!ids.length) {
        return { contagemPorCodigo, prestadoresPorCodigo, mapaAltPorPrestadorId: new Map() }
    }

    const vinculos = await buscarVinculosPrestadorProcedimentosEmLote(supabase, ids)
    const porPrestador = mapaCodigosPorPrestadorDeVinculos(vinculos, mapaCodigoPorProcedimentoId)

    candidatos.forEach((p) => {
        const pid = Number(p.id)
        const set = porPrestador.get(pid)
        if (!set) return
        codigosNorm.forEach((cod) => {
            if (!set.has(cod)) return
            const bucket = prestadoresPorCodigo.get(cod)
            if (!bucket.has(pid)) {
                bucket.add(pid)
                contagemPorCodigo.set(cod, (contagemPorCodigo.get(cod) || 0) + 1)
            }
        })
    })

    const mapaAltPorPrestadorId = new Map()
    await Promise.all(
        ids.map(async (id) => {
            try {
                mapaAltPorPrestadorId.set(id, await carregarMapaNomesAlternativosPrestador(id))
            } catch {
                mapaAltPorPrestadorId.set(id, new Map())
            }
        }),
    )

    return { contagemPorCodigo, prestadoresPorCodigo, mapaAltPorPrestadorId }
}
