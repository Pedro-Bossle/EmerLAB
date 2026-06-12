import { carregarVinculosMunicipios, resolverCidadeTabelaId } from './cidadesSupertabelaVinculos.js'
import { supabase } from './supabase.js'

const RPC_OBTER_OU_CRIAR = 'credenciamento_obter_ou_criar_cidade_credenciamento'

function isConflitoUnicidade(error) {
    if (!error) return false
    const code = String(error.code || '')
    const status = Number(error.status || error.statusCode || 0)
    const msg = String(error.message || '').toLowerCase()
    return code === '23505' || status === 409 || msg.includes('duplicate') || msg.includes('unique')
}

function isErroRls(error) {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('row-level security') || msg.includes('rls')
}

function isRpcIndisponivel(error) {
    const msg = String(error?.message || '').toLowerCase()
    return (
        msg.includes(RPC_OBTER_OU_CRIAR) ||
        msg.includes('could not find the function') ||
        msg.includes('schema cache')
    )
}

const normalizarNomeCidade = (nome) =>
    String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

function rowFromRpc(data) {
    const row = Array.isArray(data) ? data[0] : data
    const id = Number(row?.id)
    if (!id) return null
    return { id, nome: String(row?.nome || '').trim() || '' }
}

async function obterOuCriarViaRpc(nomeCidade) {
    const nome = String(nomeCidade || '').trim()
    if (!nome) return null

    const { data, error } = await supabase.rpc(RPC_OBTER_OU_CRIAR, { p_nome: nome })
    if (!error) return rowFromRpc(data)
    if (isRpcIndisponivel(error)) return null
    throw new Error(error.message)
}

async function obterOuCriarViaRest(nomeCidade) {
    const nome = String(nomeCidade || '').trim()
    if (!nome) return null

    const chave = normalizarNomeCidade(nome)

    const { data: existentes, error: errBusca } = await supabase
        .from('cidades_credenciamento')
        .select('id, nome')
        .ilike('nome', nome)
        .limit(20)
    if (errBusca) throw new Error(errBusca.message)

    const hit =
        (existentes || []).find((c) => normalizarNomeCidade(c.nome) === chave) ||
        existentes?.[0]
    if (hit?.id) {
        return { id: Number(hit.id), nome: hit.nome || nome }
    }

    const { data: ins, error: errIns } = await supabase
        .from('cidades_credenciamento')
        .insert({ nome })
        .select('id, nome')
        .single()

    if (!errIns && ins?.id) {
        return { id: Number(ins.id), nome: ins.nome || nome }
    }

    if (isConflitoUnicidade(errIns)) {
        const { data: retry, error: errRetry } = await supabase
            .from('cidades_credenciamento')
            .select('id, nome')
            .ilike('nome', nome)
            .limit(1)
        if (errRetry) throw new Error(errRetry.message)
        if (retry?.[0]?.id) {
            return { id: Number(retry[0].id), nome: retry[0].nome || nome }
        }
    }

    if (errIns) {
        if (isErroRls(errIns)) {
            throw new Error(
                'Não foi possível vincular a cidade (permissão no banco). Peça à equipe técnica para executar o script SQL cidades_credenciamento_formulario_publico.sql no Supabase.',
            )
        }
        throw new Error(errIns.message)
    }
    return null
}

/**
 * Busca cidade por nome (ilike) ou cria. Preferência: RPC security definer (formulário público).
 * @returns {Promise<{ id: number, nome: string }|null>}
 */
export async function obterOuCriarCidadeCredenciamento(nomeCidade) {
    const viaRpc = await obterOuCriarViaRpc(nomeCidade)
    if (viaRpc) return viaRpc
    return obterOuCriarViaRest(nomeCidade)
}

/**
 * UF + município (IBGE): tenta alinhar ao nome da cidade-tabela antes de criar em credenciamento.
 */
export async function obterOuCriarCidadeCredenciamentoPorMunicipio(uf, nomeMunicipio) {
    const nome = String(nomeMunicipio || '').trim()
    const ufNorm = String(uf || '').trim().toUpperCase()
    if (!nome) return null

    const candidatos = [nome]
    try {
        const [vinculos, { data: cidades, error: errCid }] = await Promise.all([
            carregarVinculosMunicipios(supabase),
            supabase.from('cidades').select('id, nome, uf'),
        ])
        if (!errCid && cidades?.length) {
            const tabelaId = resolverCidadeTabelaId({
                uf: ufNorm,
                municipioNome: nome,
                vinculos,
                cidades,
            })
            if (tabelaId) {
                const row = cidades.find((c) => Number(c.id) === Number(tabelaId))
                if (row?.nome && !candidatos.includes(String(row.nome).trim())) {
                    candidatos.unshift(String(row.nome).trim())
                }
            }
        }
    } catch {
        /* segue só com nome IBGE */
    }

    for (const candidato of candidatos) {
        const row = await obterOuCriarCidadeCredenciamento(candidato)
        if (row?.id) return { ...row, nomeExibicao: nome, uf: ufNorm }
    }
    return null
}
