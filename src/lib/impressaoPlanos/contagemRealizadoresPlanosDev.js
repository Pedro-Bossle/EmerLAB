import { supabase as supabaseDefault } from '../supabase.js'
import {
    buscarVinculosPrestadorProcedimentosEmLote,
    carregarDadosCredenciamentoQuemRealiza,
    normCodigoProcedimento,
    prestadorAtendeAlgumaCidadeAlvo,
} from '../buscarQuemRealizaPrestadores.js'
import { mapaCodigosPorPrestadorDeVinculos } from '../prestadorProcedimentos.js'

/**
 * Municípios-alvo da tabela de valores (vínculos IBGE + fallback nome/UF da cidade).
 * Espelha a ideia da impressão de planos (cidade + UF), cobrindo municípios englobados.
 *
 * @param {{ nome?: string, uf?: string }|null} cidade
 * @param {{ municipio_nome?: string, uf?: string }[]} vinculosDaCidade
 * @returns {{ nome: string, uf: string }[]}
 */
export function montarCidadesAlvoTabelaPlanos(cidade, vinculosDaCidade = []) {
    const ufCidade = String(cidade?.uf || '')
        .trim()
        .toUpperCase()
    const lista = []
    const vistos = new Set()

    for (const v of vinculosDaCidade || []) {
        const nome = String(v.municipio_nome || '').trim()
        const uf = String(v.uf || ufCidade)
            .trim()
            .toUpperCase()
        if (!nome || !uf) continue
        const chave = `${uf}|${nome.toLocaleLowerCase('pt-BR')}`
        if (vistos.has(chave)) continue
        vistos.add(chave)
        lista.push({ nome, uf })
    }

    if (lista.length) return lista

    const nome = String(cidade?.nome || '').trim()
    if (nome && ufCidade) return [{ nome, uf: ufCidade }]
    return []
}

async function carregarMetaProcedimentos(supabase, codigos) {
    const unicos = [...new Set((codigos || []).map(normCodigoProcedimento).filter(Boolean))]
    const mapa = new Map()
    const TAM = 120
    for (let i = 0; i < unicos.length; i += TAM) {
        const fatia = unicos.slice(i, i + TAM)
        const { data, error } = await supabase
            .from('procedimentos')
            .select('codigo, nome, categoria_id, plano_base_id')
            .in('codigo', fatia)
        if (error) throw new Error(error.message)
        for (const p of data || []) {
            const cod = normCodigoProcedimento(p.codigo)
            if (!cod) continue
            mapa.set(cod, {
                codigo: cod,
                nome: String(p.nome || '').trim() || cod,
                categoriaId: p.categoria_id != null ? Number(p.categoria_id) : null,
                planoBaseId: p.plano_base_id != null ? Number(p.plano_base_id) : null,
            })
        }
    }
    return mapa
}

/**
 * Contagem de prestadores/lab. que realizam cada procedimento na região (cidade + paralelas),
 * mesmo padrão da impressão de planos (`montarMapasRealizadoresRegiao`).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabaseClient]
 * @param {{
 *   cidadesAlvo: { nome: string, uf?: string }[],
 *   incluirCidadesParalelas?: boolean,
 *   codigosNaTabela?: string[],
 * }} opcoes
 * @returns {Promise<{
 *   contagemPorCodigo: Map<string, number>,
 *   nomesPorCodigo: Map<string, string[]>,
 *   sugestoes: {
 *     codigo: string,
 *     nome: string,
 *     categoriaId: number|null,
 *     planoBaseId: number|null,
 *     prestadores: number,
 *     nomesPrestadores: string[],
 *   }[],
 * }>}
 */
export async function carregarContagemESugestoesRealizadoresPlanos(supabaseClient, opcoes) {
    const supabase = supabaseClient || supabaseDefault
    const incluirCidadesParalelas = opcoes?.incluirCidadesParalelas !== false
    const cidadesAlvo = opcoes?.cidadesAlvo || []
    const setNaTabela = new Set(
        (opcoes?.codigosNaTabela || []).map(normCodigoProcedimento).filter(Boolean),
    )

    const contagemPorCodigo = new Map()
    /** @type {Map<string, Set<string>>} */
    const nomesSetPorCodigo = new Map()

    const vazio = { contagemPorCodigo, nomesPorCodigo: new Map(), sugestoes: [] }

    if (!cidadesAlvo.length) {
        return vazio
    }

    const dadosCred = await carregarDadosCredenciamentoQuemRealiza(supabase, {
        somenteVeterinarios: false,
    })
    const prestadoresCredenciados =
        dadosCred.todosPrestadores?.length > 0
            ? dadosCred.todosPrestadores
            : dadosCred.prestadores || []

    const ctxFiltro = {
        mapaCidadesCred: dadosCred.mapaCidadesCred,
        prestadorCidades: dadosCred.prestadorCidades,
        incluirCidadesParalelas,
    }
    const candidatos = (prestadoresCredenciados || []).filter((p) =>
        prestadorAtendeAlgumaCidadeAlvo(p, cidadesAlvo, ctxFiltro),
    )
    const ids = candidatos.map((p) => Number(p.id)).filter(Boolean)
    if (!ids.length) {
        return vazio
    }

    const vinculos = await buscarVinculosPrestadorProcedimentosEmLote(supabase, ids)
    const porPrestador = mapaCodigosPorPrestadorDeVinculos(
        vinculos,
        dadosCred.mapaCodigoPorProcedimentoId,
    )

    candidatos.forEach((p) => {
        const pid = Number(p.id)
        const set = porPrestador.get(pid)
        if (!set) return
        const nomePrestador = String(p.nome || '').trim() || `#${pid}`
        set.forEach((cod) => {
            const c = normCodigoProcedimento(cod)
            if (!c) return
            contagemPorCodigo.set(c, (contagemPorCodigo.get(c) || 0) + 1)
            if (!nomesSetPorCodigo.has(c)) nomesSetPorCodigo.set(c, new Set())
            nomesSetPorCodigo.get(c).add(nomePrestador)
        })
    })

    const nomesPorCodigo = new Map()
    for (const [cod, setNomes] of nomesSetPorCodigo.entries()) {
        nomesPorCodigo.set(
            cod,
            [...setNomes].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
        )
    }

    const sugestoesCodigos = [...contagemPorCodigo.entries()]
        .filter(([cod, n]) => n > 0 && !setNaTabela.has(cod))
        .map(([cod]) => cod)

    const metaProcs = await carregarMetaProcedimentos(supabase, sugestoesCodigos)

    const sugestoes = sugestoesCodigos
        .map((cod) => {
            const meta = metaProcs.get(cod) || {
                codigo: cod,
                nome: cod,
                categoriaId: null,
                planoBaseId: null,
            }
            const nomesPrestadores = nomesPorCodigo.get(cod) || []
            return {
                ...meta,
                prestadores: contagemPorCodigo.get(cod) || 0,
                nomesPrestadores,
            }
        })
        .sort((a, b) => {
            if (b.prestadores !== a.prestadores) return b.prestadores - a.prestadores
            return String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' })
        })

    return { contagemPorCodigo, nomesPorCodigo, sugestoes }
}
