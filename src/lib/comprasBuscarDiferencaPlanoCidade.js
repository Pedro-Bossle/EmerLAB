/**
 * Busca `diferenca` em `planos_cidade` por procedimento + plano + cidade_id (UF opcional).
 */

const selectDiferenca = 'id, procedimento_cod, diferenca, plano_id'

const parseDiferenca = (raw) => {
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
}

const variantesProcedimentoCod = (raw) => {
    const t = String(raw ?? '').trim()
    if (!t) return []
    const u = t.toUpperCase()
    const l = t.toLowerCase()
    return [...new Set([t, u, l])]
}

const normUf = (u) => String(u || '').trim().toUpperCase()

const queryPorCidade = (supabase, procedimentoCod, cidadeId, planoId, uf) => {
    let q = supabase
        .from('planos_cidade')
        .select(selectDiferenca)
        .eq('procedimento_cod', procedimentoCod)
        .eq('cidade_id', Number(cidadeId))
        .eq('plano_id', planoId)
        .order('id', { ascending: false })
        .limit(1)
    const ufNorm = normUf(uf)
    if (ufNorm) q = q.eq('uf', ufNorm)
    return q
}

const queryPorCidadeSemUf = (supabase, procedimentoCod, cidadeId, planoId) =>
    supabase
        .from('planos_cidade')
        .select(selectDiferenca)
        .eq('procedimento_cod', procedimentoCod)
        .eq('cidade_id', Number(cidadeId))
        .eq('plano_id', planoId)
        .order('id', { ascending: false })
        .limit(1)

const montarResultadoLinha = (row, planoIdFallback, origem) => ({
    encontrado: true,
    planoCidadeId: row.id,
    diferenca: parseDiferenca(row.diferenca),
    planoUtilizadoId: Number(row.plano_id || planoIdFallback),
    origem,
})

const tentarCidade = async (supabase, { procedimentoCod, cidadeId, uf, planoId }) => {
    const cid = Number(cidadeId)
    const pid = Number(planoId)
    if (!Number.isFinite(cid) || !pid) return { row: null, erro: null, origem: null }

    const ufNorm = normUf(uf)
    if (ufNorm) {
        const r1 = await queryPorCidade(supabase, procedimentoCod, cid, pid, ufNorm)
        if (r1.error) return { row: null, erro: r1.error, origem: null }
        if (r1.data?.length) return { row: r1.data[0], erro: null, origem: 'cidade_uf' }
    }

    const r2 = await queryPorCidadeSemUf(supabase, procedimentoCod, cid, pid)
    if (r2.error) return { row: null, erro: r2.error, origem: null }
    if (r2.data?.length) return { row: r2.data[0], erro: null, origem: 'cidade' }
    return { row: null, erro: null, origem: null }
}

const tentarUmaVariante = async (supabase, params) => {
    const { row: rowCidade, erro: errCidade, origem } = await tentarCidade(supabase, params)
    if (errCidade) return { row: null, erro: errCidade, origem: null }
    if (rowCidade) return { row: rowCidade, erro: null, origem: origem || 'cidade' }
    return { row: null, erro: null, origem: null }
}

export const buscarDiferencaPlanoCidadeUmaTentativa = async (
    supabase,
    { procedimentoCod, cidadeId, uf, planoId },
) => {
    const variantes = variantesProcedimentoCod(procedimentoCod)
    if (!variantes.length) return { row: null, erro: null }

    let ultimoErro = null
    for (const cod of variantes) {
        const { row, erro } = await tentarUmaVariante(supabase, {
            procedimentoCod: cod,
            cidadeId,
            uf,
            planoId,
        })
        if (erro) ultimoErro = erro
        if (row && row.id != null) return { row, erro: null }
    }

    return { row: null, erro: ultimoErro }
}

export const buscarDiferencaComCascataPlanos = async (
    supabase,
    { procedimentoCod, cidadeId, uf, planoIdsOrdenados },
) => {
    const lista = Array.isArray(planoIdsOrdenados) ? planoIdsOrdenados : []
    let ultimoErro = null

    for (let i = 0; i < lista.length; i += 1) {
        const planoId = lista[i]
        const variantes = variantesProcedimentoCod(procedimentoCod)
        let encontrou = null
        for (const cod of variantes) {
            const tCidade = await tentarCidade(supabase, {
                procedimentoCod: cod,
                cidadeId,
                uf,
                planoId,
            })
            if (tCidade.erro) ultimoErro = tCidade.erro
            if (tCidade.row) {
                encontrou = { row: tCidade.row, origem: tCidade.origem || 'cidade' }
                break
            }
        }
        if (encontrou?.row) {
            const tagPlano = i === 0 ? 'match_direto' : 'plano_superior'
            const origem = `${encontrou.origem}_${tagPlano}`
            return {
                ...montarResultadoLinha(encontrou.row, planoId, origem),
                erro: null,
            }
        }
    }

    return {
        encontrado: false,
        planoCidadeId: null,
        diferenca: null,
        planoUtilizadoId: null,
        origem: 'nao_encontrado',
        erro: ultimoErro,
    }
}
