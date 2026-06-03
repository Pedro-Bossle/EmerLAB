import {
    carregarVinculosMunicipios,
    resolverCidadeTabelaId,
} from '../cidadesSupertabelaVinculos.js'
import { supabase } from '../supabase.js'

/**
 * Resolve a tabela-mestre (`cidades`) / repasses pela **cidade do endereço** do prestador
 * (UF + município), incluindo município vinculado em `cidades_municipios_vinculo`.
 */
export async function resolverCidadeTabelaRepassesHonorarios({
    prestadorId,
    enderecoUf = '',
    enderecoMunicipio = '',
} = {}) {
    const [{ data: cidades, error: errCid }, vinculos] = await Promise.all([
        supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
        carregarVinculosMunicipios(supabase),
    ])
    if (errCid) throw new Error(errCid.message)

    const listaCidades = cidades || []
    const idsTabela = new Set(listaCidades.map((c) => Number(c.id)))
    const porId = new Map(listaCidades.map((c) => [Number(c.id), c]))

    let uf = String(enderecoUf || '').trim().toUpperCase()
    let municipio = String(enderecoMunicipio || '').trim()

    if ((!uf || !municipio) && prestadorId) {
        const { data: prest, error: errP } = await supabase
            .from('prestadores')
            .select('endereco_uf, endereco_cidade')
            .eq('id', prestadorId)
            .maybeSingle()
        if (errP) throw new Error(errP.message)
        if (prest) {
            if (!uf) uf = String(prest.endereco_uf || '').trim().toUpperCase()
            if (!municipio) municipio = String(prest.endereco_cidade || '').trim()
        }
    }

    if (!uf || !municipio) {
        return { cidadeTabelaId: null, cidadeTabelaNome: '', cidadeTabelaUf: '', origem: '', labelTabela: '' }
    }

    const id = resolverCidadeTabelaId({
        uf,
        municipioNome: municipio,
        vinculos,
        cidades: listaCidades,
    })

    if (id && idsTabela.has(Number(id))) {
        const row = porId.get(Number(id))
        return montarResultado(Number(id), row, 'endereco', municipio, uf)
    }

    return { cidadeTabelaId: null, cidadeTabelaNome: '', cidadeTabelaUf: '', origem: '', labelTabela: '' }
}

function montarResultado(cidadeTabelaId, row, origem, municipioEndereco, ufEndereco) {
    const nome = String(row?.nome || '').trim()
    const uf = String(row?.uf || '').trim().toUpperCase()
    const mun = String(municipioEndereco || '').trim()
    const labelBase = nome && uf ? `${nome} (${uf})` : nome || `Tabela #${cidadeTabelaId}`
    const labelTabela =
        mun && nome && normalizarChave(mun) !== normalizarChave(nome)
            ? `${labelBase} · endereço: ${mun}/${ufEndereco}`
            : labelBase
    return {
        cidadeTabelaId,
        cidadeTabelaNome: nome,
        cidadeTabelaUf: uf,
        origem,
        labelTabela,
    }
}

function normalizarChave(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}
