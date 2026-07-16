import { buscarEmLotesPaginado, supabase as supabaseDefault } from '../supabase.js'
import {
    buscarVinculosPrestadorProcedimentosEmLote,
    carregarDadosCredenciamentoQuemRealiza,
    normCodigoProcedimento,
    prestadorAtendeAlgumaCidadeAlvo,
} from '../buscarQuemRealizaPrestadores.js'
import { anexarLocalidadeVinculoAoCtx } from '../prestadorLocalidadeVinculo.js'
import { mapaCodigosPorPrestadorDeVinculos } from '../prestadorProcedimentos.js'

/**
 * Alvos de contagem de prestadores (Planos Impressão, Supertabela Planos, Supertabela Cidades).
 *
 * Inclui o município principal da tabela + municípios vinculados («Gerenciar tabelas»).
 * Ex.: Porto Alegre → Alvorada, Gravataí, Viamão, …
 *
 * Um prestador conta se tiver qualquer um desses nomes como:
 *   (a) endereço principal, OU
 *   (b) cidade na lista «Cidades que atende» com «Múltiplas cidades» ativo no perfil.
 * Match via `prestadorAtendeAlgumaCidadeAlvo`.
 *
 * @param {{ nome?: string, uf?: string }|null} cidadeTabela
 * @param {{ municipio_nome?: string, uf?: string }[]} [vinculosDaCidade]
 * @returns {{ nome: string, uf: string }[]}
 */
export function montarCidadesAlvoContagemPrestadores(cidadeTabela, vinculosDaCidade = []) {
    return montarCidadesAlvoTabelaPlanos(cidadeTabela, vinculosDaCidade)
}

/**
 * Município principal da tabela + vínculos IBGE (mesma lista da contagem de realizadores).
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

    const adicionar = (nomeRaw, ufRaw) => {
        const nome = String(nomeRaw || '').trim()
        const uf = String(ufRaw || ufCidade)
            .trim()
            .toUpperCase()
        if (!nome || !uf) return
        const chave = `${uf}|${nome.toLocaleLowerCase('pt-BR')}`
        if (vistos.has(chave)) return
        vistos.add(chave)
        lista.push({ nome, uf })
    }

    // Município principal da tabela (ex.: Porto Alegre)
    adicionar(cidade?.nome, ufCidade)

    // Municípios que usam os mesmos valores (ex.: Alvorada, Gravataí, …)
    for (const v of vinculosDaCidade || []) {
        adicionar(v.municipio_nome, v.uf || ufCidade)
    }

    return lista
}

/**
 * Amplia o município escolhido (Quem Realiza / IBGE) para todos os municípios da mesma
 * tabela-mestre Super-Tabela (via `cidades_municipios_vinculo`).
 */
export function montarCidadesAlvoMunicipioComRegiao(
    municipioNome,
    uf,
    cidadesTabela = [],
    vinculos = [],
) {
    const nome = String(municipioNome || '').trim()
    const ufNorm = String(uf || '')
        .trim()
        .toUpperCase()
    if (!nome) return []

    const base = [{ nome, uf: ufNorm }]
    if (!ufNorm || !cidadesTabela?.length) return base

    // Importação local evita ciclo com cidadesSupertabelaVinculos ↔ contagem.
    // Resolução inline por nome/UF.
    const normChave = (t) =>
        String(t || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
    const chaveAlvo = normChave(nome)

    let cidadeId = null
    for (const v of vinculos || []) {
        if (String(v.uf || '').trim().toUpperCase() !== ufNorm) continue
        if (normChave(v.municipio_nome) === chaveAlvo) {
            cidadeId = Number(v.cidade_id)
            break
        }
    }
    if (!cidadeId) {
        const legado = (cidadesTabela || []).find(
            (c) =>
                String(c.uf || '').trim().toUpperCase() === ufNorm &&
                normChave(c.nome) === chaveAlvo,
        )
        if (legado) cidadeId = Number(legado.id)
    }
    if (!cidadeId) return base

    const cidade = (cidadesTabela || []).find((c) => Number(c.id) === cidadeId)
    if (!cidade) return base

    const vins = (vinculos || []).filter((v) => Number(v.cidade_id) === cidadeId)
    const ampliados = montarCidadesAlvoTabelaPlanos(cidade, vins)
    return ampliados.length ? ampliados : base
}

async function carregarMetaProcedimentos(supabase, codigos) {
    const unicos = [...new Set((codigos || []).map(normCodigoProcedimento).filter(Boolean))]
    const mapa = new Map()
    if (!unicos.length) return mapa

    const { data, error } = await buscarEmLotesPaginado(
        unicos,
        (fatia) =>
            supabase
                .from('procedimentos')
                .select('codigo, nome, categoria_id, plano_base_id')
                .in('codigo', fatia)
                .order('id', { ascending: true }),
        { tamanhoLote: 100 },
    )
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
    return mapa
}

/**
 * Contagem de prestadores credenciados que realizam cada procedimento na cidade.
 * Mesma regra que Planos Impressão (`montarMapasRealizadoresRegiao`) e Supertabela:
 * endereço principal OU lista «Cidades que atende» (se «Múltiplas cidades» no perfil).
 * Use `montarCidadesAlvoContagemPrestadores` para montar `cidadesAlvo`.
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

    const ctxFiltro = anexarLocalidadeVinculoAoCtx(
        {
            mapaCidadesCred: dadosCred.mapaCidadesCred,
            prestadorCidades: dadosCred.prestadorCidades,
            incluirCidadesParalelas,
        },
        prestadoresCredenciados,
        dadosCred.prestadorEstabelecimentos,
    )
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
