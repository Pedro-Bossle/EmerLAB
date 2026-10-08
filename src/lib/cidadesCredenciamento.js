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

export const normalizarNomeCidadeCredenciamento = (nome) =>
    String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

export function normalizarUfCredenciamento(uf) {
    return String(uf || '')
        .trim()
        .toUpperCase()
        .slice(0, 2)
}

/**
 * Mesma localidade = mesmo nome normalizado e mesma UF (quando ambas têm UF).
 * Sem UF em um dos lados, cai no cidadeId se disponível.
 */
export function cidadeCredenciamentoMesmaLocalidade(a, b) {
    const nomeA = normalizarNomeCidadeCredenciamento(a?.nome)
    const nomeB = normalizarNomeCidadeCredenciamento(b?.nome)
    if (!nomeA || !nomeB || nomeA !== nomeB) return false

    const ufA = normalizarUfCredenciamento(a?.uf)
    const ufB = normalizarUfCredenciamento(b?.uf)
    if (ufA && ufB) return ufA === ufB

    const idA = Number(a?.cidadeId ?? a?.id ?? 0)
    const idB = Number(b?.cidadeId ?? b?.id ?? 0)
    if (idA && idB) return idA === idB

    return !ufA && !ufB
}

function rowFromRpc(data) {
    const row = Array.isArray(data) ? data[0] : data
    const id = Number(row?.id)
    if (!id) return null
    return {
        id,
        nome: String(row?.nome || '').trim() || '',
        uf: normalizarUfCredenciamento(row?.uf) || null,
    }
}

async function obterOuCriarViaRpc(nomeCidade, uf) {
    const nome = String(nomeCidade || '').trim()
    if (!nome) return null
    const ufNorm = normalizarUfCredenciamento(uf) || null

    const params = ufNorm ? { p_nome: nome, p_uf: ufNorm } : { p_nome: nome }
    const { data, error } = await supabase.rpc(RPC_OBTER_OU_CRIAR, params)
    if (!error) return rowFromRpc(data)
    if (isRpcIndisponivel(error)) return null
    throw new Error(error.message)
}

async function buscarExistenteRest(nome, ufNorm) {
    const chave = normalizarNomeCidadeCredenciamento(nome)
    const { data: existentes, error: errBusca } = await supabase
        .from('cidades_credenciamento')
        .select('id, nome, uf')
        .ilike('nome', nome)
        .limit(40)
    if (errBusca) throw new Error(errBusca.message)

    const rows = existentes || []
    if (ufNorm) {
        const exact =
            rows.find(
                (c) =>
                    normalizarNomeCidadeCredenciamento(c.nome) === chave &&
                    normalizarUfCredenciamento(c.uf) === ufNorm,
            ) || null
        if (exact?.id) {
            return { id: Number(exact.id), nome: exact.nome || nome, uf: ufNorm }
        }
        const legado =
            rows.find(
                (c) =>
                    normalizarNomeCidadeCredenciamento(c.nome) === chave &&
                    !normalizarUfCredenciamento(c.uf),
            ) || null
        if (legado?.id) {
            const { error: errUp } = await supabase
                .from('cidades_credenciamento')
                .update({ uf: ufNorm })
                .eq('id', legado.id)
            if (errUp && !isConflitoUnicidade(errUp)) throw new Error(errUp.message)
            return { id: Number(legado.id), nome: legado.nome || nome, uf: ufNorm }
        }
        return null
    }

    const hit =
        rows.find(
            (c) =>
                normalizarNomeCidadeCredenciamento(c.nome) === chave &&
                !normalizarUfCredenciamento(c.uf),
        ) ||
        rows.find((c) => normalizarNomeCidadeCredenciamento(c.nome) === chave) ||
        null
    if (hit?.id) {
        return {
            id: Number(hit.id),
            nome: hit.nome || nome,
            uf: normalizarUfCredenciamento(hit.uf) || null,
        }
    }
    return null
}

async function obterOuCriarViaRest(nomeCidade, uf) {
    const nome = String(nomeCidade || '').trim()
    if (!nome) return null
    const ufNorm = normalizarUfCredenciamento(uf) || null

    const existente = await buscarExistenteRest(nome, ufNorm)
    if (existente) return existente

    const payload = ufNorm ? { nome, uf: ufNorm } : { nome }
    const { data: ins, error: errIns } = await supabase
        .from('cidades_credenciamento')
        .insert(payload)
        .select('id, nome, uf')
        .single()

    if (!errIns && ins?.id) {
        return {
            id: Number(ins.id),
            nome: ins.nome || nome,
            uf: normalizarUfCredenciamento(ins.uf) || ufNorm,
        }
    }

    if (isConflitoUnicidade(errIns)) {
        const retry = await buscarExistenteRest(nome, ufNorm)
        if (retry) return retry
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
 * Busca ou cria cidade. Com UF, distingue homônimos (ex.: Santa Maria/RS ≠ Santa Maria/RN).
 * @param {string} nomeCidade
 * @param {string} [uf]
 * @returns {Promise<{ id: number, nome: string, uf?: string|null }|null>}
 */
export async function obterOuCriarCidadeCredenciamento(nomeCidade, uf) {
    const viaRpc = await obterOuCriarViaRpc(nomeCidade, uf)
    if (viaRpc) return viaRpc
    return obterOuCriarViaRest(nomeCidade, uf)
}

/**
 * UF + município (IBGE): tenta alinhar ao nome da cidade-tabela antes de criar em credenciamento.
 */
export async function obterOuCriarCidadeCredenciamentoPorMunicipio(uf, nomeMunicipio) {
    const nome = String(nomeMunicipio || '').trim()
    const ufNorm = normalizarUfCredenciamento(uf)
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
        const row = await obterOuCriarCidadeCredenciamento(candidato, ufNorm)
        if (row?.id) return { ...row, nomeExibicao: nome, uf: ufNorm || row.uf }
    }
    return null
}
