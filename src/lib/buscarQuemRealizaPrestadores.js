import {
    prestadorEhEstabelecimento,
    prestadorEhCredenciado,
    prestadorEhLaboratorio,
    resolverCidadePrincipalNome,
} from './prestadorCadastroHelpers.js'
import { carregarMapaNomesAlternativosPrestador } from './prestadorNomeAlternativo.js'
import { mapaCodigosPorPrestadorDeVinculos } from './prestadorProcedimentos.js'

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

export const normCodigoProcedimento = (c) => String(c || '').trim().toUpperCase()

function formatarNomeProcedimentoQuemRealiza(proc) {
    if (proc == null) return ''
    if (typeof proc === 'string') return String(proc).trim()
    const base = String(proc.nomeBase || '').trim()
    const alt = String(proc.nomeAlt || '').trim()
    if (base && alt) return `${base} — ${alt}`
    return base || alt
}

/** Texto para copiar resultados do Quem Realiza (bloco por prestador). */
export function formatarResultadosQuemRealizaParaClipboard(resultados) {
    const blocos = (resultados || []).map((r) => {
        const nome = String(r.nome || '').trim() || '—'
        const esp = String(r.especialidade || '').trim() || '—'
        const tel = String(r.telefone || '').trim() || '—'
        const linhaPrestador = `${nome} - ${esp} - ${tel}`
        const procs = (r.procedimentos || []).map(formatarNomeProcedimentoQuemRealiza).filter(Boolean)
        const linhaProcs = procs.length ? procs.join(', ') : '—'
        return `${linhaPrestador}\n${linhaProcs}`
    })
    return blocos.join('\n\n')
}

/** @typedef {{ nome: string, uf?: string }} CidadeAlvo */

/**
 * @param {object} p — prestador
 * @param {CidadeAlvo} alvo
 * @param {{ mapaCidadesCred: Map, prestadorCidades: object[], incluirCidadesParalelas: boolean }} ctx
 */
/** Cidade do bloco de endereço do cadastro (endereco_cidade / endereco_uf). */
export function prestadorEnderecoNaCidadeAlvo(p, alvo) {
    const cidadeNome = String(alvo?.nome || '').trim()
    if (!cidadeNome) return false
    const alvoCidade = norm(cidadeNome)
    const alvoUf = String(alvo?.uf || '').trim().toUpperCase()
    const exigeUf = Boolean(alvoUf)

    const endCidade = norm(p.endereco_cidade)
    if (endCidade !== alvoCidade) return false

    const endUf = String(p.endereco_uf || '').trim().toUpperCase()
    if (!exigeUf) return true
    if (endUf === alvoUf) return true
    if (!endUf) return true
    return false
}

/** Cidades que o prestador atende (tabela prestador_cidades / credenciamento). */
export function prestadorAtendeCidadeCredenciamento(p, alvo, ctx) {
    const cidadeNome = String(alvo?.nome || '').trim()
    if (!cidadeNome) return false
    const alvoCidade = norm(cidadeNome)
    const { mapaCidadesCred, prestadorCidades } = ctx
    const extras = (prestadorCidades || []).filter((r) => Number(r.prestador_id) === Number(p.id))
    return extras.some((rel) => {
        const nomeCred = mapaCidadesCred.get(Number(rel.cidade_id))
        return norm(nomeCred) === alvoCidade
    })
}

/** Cidade principal / vínculos de credenciamento (cidade_id + «Cidades que atendem»). */
export function prestadorLocalizacaoCredenciamentoNaCidade(p, alvo, ctx) {
    const cidadeNome = String(alvo?.nome || '').trim()
    if (!cidadeNome) return false
    const alvoCidade = norm(cidadeNome)
    const { mapaCidadesCred } = ctx
    const cidPrincipal = mapaCidadesCred.get(Number(p.cidade_id))
    if (norm(cidPrincipal) === alvoCidade) return true
    return prestadorAtendeCidadeCredenciamento(p, alvo, ctx)
}

/**
 * Filtro de localidade:
 * - Veterinário: endereço; com paralelas, também cidades que atende.
 * - Clínica/estabelecimento: endereço ou cidade de credenciamento (sede + cidades que atende).
 */
export function prestadorAtendeCidadeAlvo(p, alvo, ctx) {
    if (prestadorEnderecoNaCidadeAlvo(p, alvo)) return true
    if (prestadorEhEstabelecimento(p.especialidade_id)) {
        return prestadorLocalizacaoCredenciamentoNaCidade(p, alvo, ctx)
    }
    if (!ctx.incluirCidadesParalelas) return false
    return prestadorAtendeCidadeCredenciamento(p, alvo, ctx)
}

export function prestadorAtendeAlgumaCidadeAlvo(p, cidadesAlvo, ctx) {
    const lista = cidadesAlvo || []
    if (!lista.length) return false
    return lista.some((alvo) => prestadorAtendeCidadeAlvo(p, alvo, ctx))
}

export function avaliarViaCidadeParalela(p, cidadesAlvo, ctx) {
    const { incluirCidadesParalelas } = ctx
    if (!incluirCidadesParalelas) return false
    if (prestadorEhEstabelecimento(p.especialidade_id)) return false
    return cidadesAlvo.some((alvo) => {
        const sede = prestadorAtendeCidadeAlvo(p, alvo, { ...ctx, incluirCidadesParalelas: false })
        if (sede) return false
        return prestadorAtendeCidadeAlvo(p, alvo, { ...ctx, incluirCidadesParalelas: true })
    })
}

export function mapaCodigoProcedimentoIdDeCatalogo(procedimentos) {
    const mapa = new Map()
    ;(procedimentos || []).forEach((p) => {
        const id = Number(p.id)
        const cod = normCodigoProcedimento(p.codigo)
        if (id && cod) mapa.set(id, cod)
    })
    return mapa
}

export async function buscarVinculosPrestadorProcedimentosEmLote(supabase, prestadorIds) {
    const ids = [...new Set((prestadorIds || []).map(Number).filter(Boolean))]
    const vinculos = []
    const chunk = 40
    for (let i = 0; i < ids.length; i += chunk) {
        const lote = ids.slice(i, i + chunk)
        const { data, error } = await supabase
            .from('prestador_procedimentos')
            .select('prestador_id, procedimento_cod, procedimento_id')
            .in('prestador_id', lote)
        if (error) throw new Error(error.message)
        vinculos.push(...(data || []))
    }
    return vinculos
}

function montarLinhaResultadoQuemRealiza(p, codigos, porPrestador, ctx) {
    const {
        mapaEsp,
        mapaNomePorCodigo,
        mapaCidadesCred,
        prestadorCidades,
        cidadesAlvo,
        incluirCidadesParalelas,
        mapaAltPorPrestadorId,
    } = ctx
    const set = porPrestador.get(Number(p.id)) || new Set()
    const mapaAlt = mapaAltPorPrestadorId?.get(Number(p.id)) || new Map()
    const realizaNomes = codigos
        .filter((c) => set.has(c))
        .map((c) => {
            const cod = normCodigoProcedimento(c)
            const nomeBase = String(mapaNomePorCodigo.get(cod) || c).trim() || cod
            const altRaw = String(mapaAlt.get(cod) ?? '').trim()
            const nomeAlt =
                altRaw && altRaw.localeCompare(nomeBase, 'pt-BR', { sensitivity: 'base' }) !== 0 ? altRaw : ''
            return { nomeBase, nomeAlt }
        })
        .sort((a, b) => a.nomeBase.localeCompare(b.nomeBase, 'pt-BR', { sensitivity: 'base' }))
    const tel = [p.celular, p.telefone].map((t) => String(t || '').trim()).find(Boolean) || '—'
    const rels = prestadorCidades.filter((r) => Number(r.prestador_id) === Number(p.id))
    const cidadePrincipal = resolverCidadePrincipalNome(p, {
        mapaCidadeNomePorId: mapaCidadesCred,
        relacoesCidades: rels,
    })
    const filtroCtx = { mapaCidadesCred, prestadorCidades, incluirCidadesParalelas }
    const viaCidadeParalela = avaliarViaCidadeParalela(p, cidadesAlvo, filtroCtx)
    return {
        id: p.id,
        nome: p.nome,
        especialidade: mapaEsp.get(Number(p.especialidade_id)) || '—',
        telefone: tel,
        procedimentos: realizaNomes,
        viaCidadeParalela,
        cidadePrincipal,
    }
}

/** Mapa prestador_id → Map(código → nome alternativo) para exibição no Quem realiza. */
async function carregarMapasNomesAlternativosPorPrestador(prestadorIds) {
    const ids = [...new Set((prestadorIds || []).map(Number).filter(Boolean))]
    const mapaPorId = new Map()
    await Promise.all(
        ids.map(async (id) => {
            try {
                const m = await carregarMapaNomesAlternativosPrestador(id)
                mapaPorId.set(id, m)
            } catch {
                mapaPorId.set(id, new Map())
            }
        }),
    )
    return mapaPorId
}

/**
 * Prestadores (e laboratórios) na cidade com o procedimento no **perfil** (`prestador_procedimentos`).
 * Laboratório não herda exames de vets vinculados em `prestador_laboratorios_solicitacao`.
 */
export async function pesquisarQuemRealizaNaRede(supabase, opcoes) {
    const {
        codigosProcedimento = [],
        cidadesAlvo = [],
        incluirCidadesParalelas = true,
        prestadores = [],
        prestadorCidades = [],
        mapaCidadesCred = new Map(),
        especialidades = [],
        mapaNomePorCodigo = new Map(),
        mapaCodigoPorProcedimentoId = new Map(),
        filtrarSomenteVeterinarios = false,
    } = opcoes

    const codigos = [...new Set(codigosProcedimento.map(normCodigoProcedimento).filter(Boolean))]
    const cidades = (cidadesAlvo || []).filter((c) => String(c?.nome || '').trim())
    if (!codigos.length || !cidades.length) return []

    const mapaEsp = new Map((especialidades || []).map((e) => [Number(e.id), e.nome]))
    const ctxFiltro = { mapaCidadesCred, prestadorCidades, incluirCidadesParalelas }

    const todosIds = (prestadores || []).map((p) => Number(p.id)).filter(Boolean)
    if (!todosIds.length) return []

    const vinculos = await buscarVinculosPrestadorProcedimentosEmLote(supabase, todosIds)
    const porPrestador = mapaCodigosPorPrestadorDeVinculos(vinculos, mapaCodigoPorProcedimentoId)

    const prestadorRealizaAlgumCodigo = (p) => {
        const set = porPrestador.get(Number(p.id))
        return set && codigos.some((c) => set.has(c))
    }

    const candidatos = (prestadores || []).filter((p) => {
        if (filtrarSomenteVeterinarios && prestadorEhLaboratorio(p.especialidade_id, especialidades)) {
            return false
        }
        return prestadorAtendeAlgumaCidadeAlvo(p, cidades, ctxFiltro) && prestadorRealizaAlgumCodigo(p)
    })

    const mapaAltPorPrestadorId = await carregarMapasNomesAlternativosPorPrestador(
        candidatos.map((p) => p.id),
    )

    const ctxLinha = {
        mapaEsp,
        mapaNomePorCodigo,
        mapaCidadesCred,
        prestadorCidades,
        cidadesAlvo: cidades,
        incluirCidadesParalelas,
        mapaAltPorPrestadorId,
    }

    const resultadoPorId = new Map()

    candidatos.forEach((p) => {
        resultadoPorId.set(Number(p.id), montarLinhaResultadoQuemRealiza(p, codigos, porPrestador, ctxLinha))
    })

    return [...resultadoPorId.values()].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    )
}

/** Cache em memória para reutilizar em telas (ex.: orçamento). */
export async function carregarDadosCredenciamentoQuemRealiza(supabase, opcoes = {}) {
    const { somenteVeterinarios = true } = opcoes
    const [
        { data: prest },
        { data: pc },
        { data: cc },
        { data: esps },
        { data: procs },
        { data: situacoes },
    ] = await Promise.all([
        supabase
            .from('prestadores')
            .select(
                'id, nome, telefone, celular, especialidade_id, endereco_uf, endereco_cidade, cidade_id, ativo, situacao_id'
            )
            .eq('ativo', true),
        supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
        supabase.from('cidades_credenciamento').select('id, nome'),
        supabase.from('especialidades').select('id, nome'),
        supabase.from('procedimentos').select('id, codigo, nome'),
        supabase.from('situacoes').select('id, descricao'),
    ])
    const mapaNomePorCodigo = new Map()
    const mapaCodigoPorProcedimentoId = new Map()
    ;(procs || []).forEach((row) => {
        const cod = normCodigoProcedimento(row.codigo)
        const id = Number(row.id)
        if (cod) mapaNomePorCodigo.set(cod, String(row.nome || cod).trim())
        if (id && cod) mapaCodigoPorProcedimentoId.set(id, cod)
    })
    const listaSituacoes = situacoes || []
    const prestCredenciados = (prest || []).filter((p) => prestadorEhCredenciado(p, listaSituacoes))
    const listaPrest = somenteVeterinarios
        ? prestCredenciados.filter((p) => !prestadorEhEstabelecimento(p.especialidade_id))
        : prestCredenciados
    return {
        prestadores: listaPrest,
        todosPrestadores: prestCredenciados,
        prestadorCidades: pc || [],
        mapaCidadesCred: new Map((cc || []).map((c) => [Number(c.id), c.nome])),
        especialidades: esps || [],
        mapaNomePorCodigo,
        mapaCodigoPorProcedimentoId,
    }
}

/**
 * Prestadores (vets) que realizam algum dos procedimentos e atendem em alguma das cidades alvo.
 */
export async function buscarPrestadoresQuemRealiza(supabase, opcoes = {}) {
    const {
        codigosProcedimento = [],
        cidadesAlvo = [],
        incluirCidadesParalelas = true,
        dadosCredenciamento = null,
        somenteVeterinarios = true,
    } = opcoes

    const codigos = [...new Set(codigosProcedimento.map(normCodigoProcedimento).filter(Boolean))]
    const cidades = (cidadesAlvo || []).filter((c) => String(c?.nome || '').trim())
    if (!codigos.length || !cidades.length) return []

    let prestadores = dadosCredenciamento?.prestadores
    let prestadorCidades = dadosCredenciamento?.prestadorCidades
    let mapaCidadesCred = dadosCredenciamento?.mapaCidadesCred
    let especialidades = dadosCredenciamento?.especialidades
    let mapaNomePorCodigo = dadosCredenciamento?.mapaNomePorCodigo
    let mapaCodigoPorProcedimentoId = dadosCredenciamento?.mapaCodigoPorProcedimentoId
    let todosPrestadores = dadosCredenciamento?.todosPrestadores

    if (!prestadores) {
        const pack = await carregarDadosCredenciamentoQuemRealiza(supabase, { somenteVeterinarios: false })
        prestadores = pack.prestadores
        todosPrestadores = pack.todosPrestadores
        prestadorCidades = pack.prestadorCidades
        mapaCidadesCred = pack.mapaCidadesCred
        especialidades = pack.especialidades
        mapaNomePorCodigo = pack.mapaNomePorCodigo
        mapaCodigoPorProcedimentoId = pack.mapaCodigoPorProcedimentoId
    }

    const basePrestadores = somenteVeterinarios ? prestadores : todosPrestadores || prestadores

    return pesquisarQuemRealizaNaRede(supabase, {
        codigosProcedimento: codigos,
        cidadesAlvo: cidades,
        incluirCidadesParalelas,
        prestadores: basePrestadores,
        prestadorCidades,
        mapaCidadesCred,
        especialidades,
        mapaNomePorCodigo,
        mapaCodigoPorProcedimentoId,
        filtrarSomenteVeterinarios: somenteVeterinarios,
    })
}
