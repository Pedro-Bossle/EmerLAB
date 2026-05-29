import {
    prestadorEhEstabelecimento,
    resolverCidadePrincipalNome,
} from './prestadorCadastroHelpers.js'

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

export const normCodigoProcedimento = (c) => String(c || '').trim().toUpperCase()

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

/** Cache em memória para reutilizar em telas (ex.: orçamento). */
export async function carregarDadosCredenciamentoQuemRealiza(supabase, opcoes = {}) {
    const { somenteVeterinarios = true } = opcoes
    const [
        { data: prest },
        { data: pc },
        { data: cc },
        { data: esps },
        { data: procs },
    ] = await Promise.all([
        supabase
            .from('prestadores')
            .select(
                'id, nome, telefone, celular, especialidade_id, endereco_uf, endereco_cidade, cidade_id, ativo'
            )
            .eq('ativo', true),
        supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
        supabase.from('cidades_credenciamento').select('id, nome'),
        supabase.from('especialidades').select('id, nome'),
        supabase.from('procedimentos').select('codigo, nome'),
    ])
    const mapaNomePorCodigo = new Map()
    ;(procs || []).forEach((row) => {
        const cod = normCodigoProcedimento(row.codigo)
        if (cod) mapaNomePorCodigo.set(cod, String(row.nome || cod).trim())
    })
    const listaPrest = somenteVeterinarios
        ? (prest || []).filter((p) => !prestadorEhEstabelecimento(p.especialidade_id))
        : prest || []
    return {
        prestadores: listaPrest,
        prestadorCidades: pc || [],
        mapaCidadesCred: new Map((cc || []).map((c) => [Number(c.id), c.nome])),
        especialidades: esps || [],
        mapaNomePorCodigo,
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

    if (!prestadores) {
        const pack = await carregarDadosCredenciamentoQuemRealiza(supabase, { somenteVeterinarios })
        prestadores = pack.prestadores
        prestadorCidades = pack.prestadorCidades
        mapaCidadesCred = pack.mapaCidadesCred
        especialidades = pack.especialidades
        mapaNomePorCodigo = pack.mapaNomePorCodigo
    }

    const mapaEsp = new Map((especialidades || []).map((e) => [Number(e.id), e.nome]))
    const ctx = { mapaCidadesCred, prestadorCidades, incluirCidadesParalelas }

    const candidatos = prestadores.filter((p) => prestadorAtendeAlgumaCidadeAlvo(p, cidades, ctx))
    const ids = candidatos.map((p) => Number(p.id)).filter(Boolean)
    if (!ids.length) return []

    const vinculos = []
    const chunk = 40
    for (let i = 0; i < ids.length; i += chunk) {
        const lote = ids.slice(i, i + chunk)
        const { data, error } = await supabase
            .from('prestador_procedimentos')
            .select('prestador_id, procedimento_cod')
            .in('prestador_id', lote)
        if (error) throw new Error(error.message)
        vinculos.push(...(data || []))
    }

    const porPrestador = new Map()
    vinculos.forEach((v) => {
        const pid = Number(v.prestador_id)
        const cod = normCodigoProcedimento(v.procedimento_cod)
        if (!pid || !cod) return
        if (!porPrestador.has(pid)) porPrestador.set(pid, new Set())
        porPrestador.get(pid).add(cod)
    })

    const nomeServico = (codigo) => mapaNomePorCodigo.get(normCodigoProcedimento(codigo)) || codigo

    return candidatos
        .filter((p) => {
            const set = porPrestador.get(Number(p.id))
            if (!set) return false
            return codigos.some((c) => set.has(c))
        })
        .map((p) => {
            const set = porPrestador.get(Number(p.id)) || new Set()
            const realizaNomes = codigos
                .filter((c) => set.has(c))
                .map((c) => nomeServico(c))
                .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
            const tel = [p.celular, p.telefone].map((t) => String(t || '').trim()).find(Boolean) || '—'
            const rels = prestadorCidades.filter((r) => Number(r.prestador_id) === Number(p.id))
            const cidadePrincipal = resolverCidadePrincipalNome(p, {
                mapaCidadeNomePorId: mapaCidadesCred,
                relacoesCidades: rels,
            })
            const viaCidadeParalela = avaliarViaCidadeParalela(p, cidades, ctx)
            return {
                id: p.id,
                nome: p.nome,
                especialidade: mapaEsp.get(Number(p.especialidade_id)) || '—',
                telefone: tel,
                procedimentos: realizaNomes,
                viaCidadeParalela,
                cidadePrincipal,
            }
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
}
