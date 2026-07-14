import { buscarTodosPaginado, supabase } from '../supabase.js'
import { carregarDadosCredenciamentoQuemRealiza } from '../buscarQuemRealizaPrestadores.js'
import {
    buscarCategoriaLimitesGrupo,
    categoriaUsaLimiteGrupo,
    montarMapaLimiteGrupoPorCategoria,
    montarPlanosChaveDisponiveisPorCategoria,
    procedimentoIsentoLimiteGrupo,
    resolverLimiteGrupoExibicao,
    textoCelulaLimiteGrupo,
} from '../categoriaLimitesGrupo.js'
import {
    mapearPlanos,
    obterChavePlanoPorId,
    ORDEM_PLANOS,
    procedimentoPertenceAoPlanoSelecionado,
    procedimentoPlanoBaseApenasLoja,
} from '../planosHierarquia.js'
import { resolverUrlPdfPlano } from './mapearPlanoPdfAsset.js'
import { formatarDiferencaPlano, formatarTextoCampoPlano } from './formatarCamposPlano.js'
import { expandirLinhasNomeAlternativo } from './expandirLinhasNomeAlternativo.js'
import { filtrarPrestadorIdsPorLinhaExibicao } from './realizadoresPorLinhaExibicao.js'
import {
    MIN_REALIZADORES_PRE_MARCAR,
    montarMapasRealizadoresRegiao,
} from './mapaRealizadoresRegiao.js'

const normCodigo = (c) => String(c || '').trim().toUpperCase()

function resolverLimiteExibicao(linha, categorias, limitesGrupoPorCategoriaId, contextoLimiteGrupoPlano) {
    const catId = Number(linha.categoriaId)
    if (procedimentoIsentoLimiteGrupo(linha)) {
        return formatarTextoCampoPlano(linha.limite)
    }
    if (!categoriaUsaLimiteGrupo(categorias, catId)) {
        return formatarTextoCampoPlano(linha.limite)
    }
    const grupo = resolverLimiteGrupoExibicao(categorias, limitesGrupoPorCategoriaId, catId, contextoLimiteGrupoPlano)
    if (grupo) {
        const catNome = categorias.find((c) => Number(c.id) === catId)?.nome || 'categoria'
        return textoCelulaLimiteGrupo(grupo, catNome)
    }
    return formatarTextoCampoPlano(linha.limite)
}

/**
 * @param {{
 *   cidadeId: number|string,
 *   planoId: number|string,
 *   municipioNome?: string,
 *   incluirCidadesParalelas?: boolean,
 *   planosLista?: object[],
 * }} opcoes
 */
export async function carregarLinhasImpressaoPlanos(opcoes) {
    const cidadeId = Number(opcoes.cidadeId)
    const planoId = Number(opcoes.planoId)
    const incluirCidadesParalelas = opcoes.incluirCidadesParalelas !== false

    if (!cidadeId) throw new Error('Selecione uma cidade.')
    if (!planoId) throw new Error('Selecione um plano.')

    const { data: cidadeRow, error: errCidade } = await supabase
        .from('cidades')
        .select('id, nome, uf')
        .eq('id', cidadeId)
        .maybeSingle()
    if (errCidade) throw new Error(errCidade.message)
    if (!cidadeRow) throw new Error('Cidade não encontrada na tabela de valores.')

    let planosLista = opcoes.planosLista
    if (!planosLista?.length) {
        const { data: planosData, error: errPlanos } = await supabase.from('planos').select('id, nome').order('id')
        if (errPlanos) throw new Error(errPlanos.message)
        planosLista = planosData || []
    }

    const mapaPlanos = mapearPlanos(planosLista)
    const pdfUrl = resolverUrlPdfPlano(planoId, mapaPlanos)
    if (!pdfUrl) {
        throw new Error(
            'Não há PDF base mapeado para este plano. Verifique se o plano corresponde a Básico, Clássico, Avançado ou Ultra.',
        )
    }

    const chavePlano = obterChavePlanoPorId(planoId, mapaPlanos)
    const planoNome = planosLista.find((p) => Number(p.id) === planoId)?.nome || chavePlano || 'Plano'

    const [resPlanosCidade, resConfigs, { data: limitesGrupoData, error: errLg }] = await Promise.all([
            buscarTodosPaginado(() =>
                supabase
                    .from('planos_cidade')
                    .select('procedimento_cod, diferenca')
                    .eq('cidade_id', cidadeId)
                    .eq('plano_id', planoId),
            ),
            buscarTodosPaginado(() =>
                supabase.from('planos_config').select('procedimento, limite, carencia').eq('plano_id', planoId),
            ),
            buscarCategoriaLimitesGrupo(supabase, { planoId }),
        ])

    const planosCidade = resPlanosCidade.data
    const errPc = resPlanosCidade.error
    const configs = resConfigs.data
    const errCfg = resConfigs.error

    if (errPc) throw new Error(`Erro ao buscar diferenças da cidade: ${errPc.message}`)
    if (errCfg) throw new Error(`Erro ao buscar limites e carências: ${errCfg.message}`)
    if (errLg && !String(errLg.message || '').toLowerCase().includes('categoria_limites_grupo')) {
        throw new Error(`Erro ao buscar limites de grupo: ${errLg.message}`)
    }

    const mapaDiferenca = new Map()
    ;(planosCidade || []).forEach((row) => {
        const cod = normCodigo(row.procedimento_cod)
        if (cod) mapaDiferenca.set(cod, Number(row.diferenca || 0))
    })

    const mapaConfig = new Map()
    ;(configs || []).forEach((row) => {
        const cod = normCodigo(row.procedimento)
        if (!cod) return
        mapaConfig.set(cod, {
            limite: row.limite != null ? String(row.limite) : '',
            carencia: row.carencia != null ? String(row.carencia) : '',
        })
    })

    const codigosCidade = [...mapaDiferenca.keys()]
    if (!codigosCidade.length) {
        throw new Error('Não há procedimentos elegíveis para este plano e cidade.')
    }

    const { data: procedimentosData, error: errProc } = await supabase
        .from('procedimentos')
        .select('id, codigo, nome, categoria_id, plano_base_id')
        .in('codigo', codigosCidade)

    if (errProc) throw new Error(`Erro ao carregar procedimentos: ${errProc.message}`)

    const procedimentosElegiveis = (procedimentosData || []).filter((p) => {
        if (procedimentoPlanoBaseApenasLoja(p.plano_base_id, mapaPlanos)) return true
        return procedimentoPertenceAoPlanoSelecionado(p.plano_base_id, planoId, mapaPlanos)
    })

    if (!procedimentosElegiveis.length) {
        throw new Error('Não há procedimentos elegíveis para este plano e cidade.')
    }

    const catIds = [...new Set(procedimentosElegiveis.map((p) => Number(p.categoria_id)).filter(Boolean))]
    const { data: categoriasData, error: errCat } = await supabase
        .from('categorias')
        .select('id, nome, usa_limite_grupo')
        .in('id', catIds.length ? catIds : [-1])
        .order('id')

    if (errCat) throw new Error(`Erro ao carregar categorias: ${errCat.message}`)
    const categorias = categoriasData || []

    const limitesGrupoPorCategoriaId = montarMapaLimiteGrupoPorCategoria(limitesGrupoData || [], planoId)

    const planosChaveDisponiveisPorCategoria = montarPlanosChaveDisponiveisPorCategoria(
        procedimentosElegiveis.map((p) => ({
            categoriaId: p.categoria_id,
            planoBaseId: p.plano_base_id,
        })),
        mapaPlanos,
        ORDEM_PLANOS,
        (planoBaseId) => obterChavePlanoPorId(planoBaseId, mapaPlanos),
    )

    const contextoLimiteGrupoPlano = {
        planosChaveDisponiveisPorCategoria,
        chavePlano,
        mapaPlanosPorChave: mapaPlanos,
    }

    const dadosCred = await carregarDadosCredenciamentoQuemRealiza(supabase, { somenteVeterinarios: false })
    const prestadoresCredenciados =
        dadosCred.todosPrestadores?.length > 0 ? dadosCred.todosPrestadores : dadosCred.prestadores || []

    const municipioAlvo = String(opcoes.municipioNome || cidadeRow.nome || '').trim()
    const cidadesAlvo = [{ nome: municipioAlvo, uf: cidadeRow.uf }]

    const codigosNorm = procedimentosElegiveis.map((p) => normCodigo(p.codigo))
    const { contagemPorCodigo, prestadoresPorCodigo, mapaAltPorPrestadorId } = await montarMapasRealizadoresRegiao(
        supabase,
        {
            codigos: codigosNorm,
            cidadesAlvo,
            incluirCidadesParalelas,
            prestadores: prestadoresCredenciados,
            prestadorCidades: dadosCred.prestadorCidades,
            mapaCidadesCred: dadosCred.mapaCidadesCred,
            mapaCodigoPorProcedimentoId: dadosCred.mapaCodigoPorProcedimentoId,
        },
    )

    const mapaNomePrestador = new Map(
        (dadosCred.todosPrestadores || dadosCred.prestadores || []).map((p) => [
            Number(p.id),
            String(p.nome || '').trim(),
        ]),
    )

    const nomesRealizadoresDosIds = (ids) =>
        [...new Set(ids || [])]
            .map((id) => mapaNomePrestador.get(Number(id)) || '')
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))

    const linhasPorCategoria = new Map()

    for (const proc of procedimentosElegiveis) {
        const cod = normCodigo(proc.codigo)
        const catId = Number(proc.categoria_id) || 0
        const cfg = mapaConfig.get(cod) || { limite: '', carencia: '' }
        const metaBase = {
            codigo: cod,
            categoriaId: catId,
            limite: cfg.limite,
            carencia: cfg.carencia,
            procedimentoId: Number(proc.id),
            diferenca: formatarDiferencaPlano(mapaDiferenca.get(cod)),
            diferencaNum: mapaDiferenca.get(cod) ?? 0,
        }

        const expansoes = expandirLinhasNomeAlternativo(
            cod,
            proc.nome,
            [...(prestadoresPorCodigo.get(cod) || [])],
            mapaAltPorPrestadorId,
        )

        const contagemTotalCodigo = contagemPorCodigo.get(cod) || 0
        const apenasLoja = procedimentoPlanoBaseApenasLoja(proc.plano_base_id, mapaPlanos)
        const checkedDefault = apenasLoja ? false : contagemTotalCodigo >= MIN_REALIZADORES_PRE_MARCAR
        const pidsRegiao = [...(prestadoresPorCodigo.get(cod) || [])]

        expansoes.forEach((exp) => {
            const pidsLinha =
                expansoes.length === 1
                    ? pidsRegiao
                    : filtrarPrestadorIdsPorLinhaExibicao(
                          pidsRegiao,
                          cod,
                          exp.nome,
                          proc.nome,
                          mapaAltPorPrestadorId,
                      )
            const realizadoresNomes = nomesRealizadoresDosIds(pidsLinha)

            const linha = {
                ...metaBase,
                linhaKey: exp.linhaKey,
                nome: exp.nome,
                apenasLoja,
                selecionavel: !apenasLoja,
                realizadores: pidsLinha.length,
                realizadoresNomes,
                checked: checkedDefault,
                limiteIndividualExibicao: formatarTextoCampoPlano(cfg.limite),
                limiteExibicao: '',
                carenciaExibicao: formatarTextoCampoPlano(cfg.carencia),
            }
            linha.limiteExibicao = resolverLimiteExibicao(
                linha,
                categorias,
                limitesGrupoPorCategoriaId,
                contextoLimiteGrupoPlano,
            )

            if (!linhasPorCategoria.has(catId)) linhasPorCategoria.set(catId, [])
            linhasPorCategoria.get(catId).push(linha)
        })
    }

    const categoriasOut = categorias
        .filter((cat) => linhasPorCategoria.has(Number(cat.id)))
        .map((cat) => {
            const catId = Number(cat.id)
            const linhas = (linhasPorCategoria.get(catId) || []).sort((a, b) =>
                String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { sensitivity: 'base' }),
            )
            const limiteGrupoValor = resolverLimiteGrupoExibicao(
                categorias,
                limitesGrupoPorCategoriaId,
                catId,
                contextoLimiteGrupoPlano,
            )
            return {
                id: catId,
                nome: cat.nome,
                linhas,
                limiteGrupoValor,
                textoLimiteGrupo: limiteGrupoValor
                    ? textoCelulaLimiteGrupo(limiteGrupoValor, cat.nome)
                    : '',
            }
        })

    if (!categoriasOut.length) {
        throw new Error('Não há procedimentos elegíveis para este plano e cidade.')
    }

    return {
        pdfUrl,
        planoNome,
        cidadeNome: municipioAlvo || String(cidadeRow.nome || '').trim(),
        cidadeUf: cidadeRow.uf,
        chavePlano,
        categorias: categoriasOut,
    }
}
