/**
 * planos_cidade — somente cidade_id (tabela de valores por cidade).
 */

export const isMissingColumnError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('does not exist') || (msg.includes('column') && msg.includes('schema cache'))
}

export const isDuplicateRowError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('23505') || msg.includes('duplicate') || msg.includes('unique')
}

const erroMigracaoCidadeId = () =>
    new Error(
        'A coluna planos_cidade.cidade_id não existe no banco. Execute scripts/sql/planos_cidade_adicionar_cidade_id.sql no Supabase.',
    )

const variantesProcedimentoCod = (cod) => {
    const t = String(cod ?? '').trim()
    if (!t) return []
    return [...new Set([t, t.toUpperCase(), t.toLowerCase()])]
}

const montarPayloadCidade = (row, context) => {
    const planoId = Number(row.plano_id)
    const cod = String(row.procedimento_cod)
    const diferenca = row.diferenca != null ? row.diferenca : 0
    const cid = row.cidade_id != null ? Number(row.cidade_id) : Number(context.cidadeId)
    if (!Number.isFinite(cid)) return null
    return { cidade_id: cid, plano_id: planoId, procedimento_cod: cod, diferenca }
}

const aplicarFiltroCidade = (query, context) => {
    if (context.cidadeId == null) return null
    return query.eq('cidade_id', context.cidadeId)
}

const executarQueryCidade = async (buildQuery, context) => {
    const q = aplicarFiltroCidade(buildQuery(), context)
    if (!q) return { data: null, error: new Error('Cidade (tabela) não selecionada.') }
    const resp = await q
    if (!resp.error) return resp
    if (isMissingColumnError(resp.error)) {
        return { data: null, error: erroMigracaoCidadeId() }
    }
    return resp
}

/** Contexto para consultas/inserções em planos_cidade. */
export const contextoPlanosCidadeFromCidades = (cidadeId) => {
    const cid = cidadeId != null && cidadeId !== '' ? Number(cidadeId) : null
    return {
        cidadeId: Number.isFinite(cid) ? cid : null,
    }
}

const linhaPlanosCidadeJaExiste = async (supabase, row, context) => {
    const codigos = variantesProcedimentoCod(row.procedimento_cod)
    const planoId = Number(row.plano_id)
    const cidadeId = row.cidade_id != null ? Number(row.cidade_id) : Number(context.cidadeId)

    if (!Number.isFinite(cidadeId)) {
        return { exists: false, error: new Error('Informe a cidade (tabela) para vincular o procedimento.') }
    }

    const { data, error } = await supabase
        .from('planos_cidade')
        .select('id')
        .eq('cidade_id', cidadeId)
        .eq('plano_id', planoId)
        .in('procedimento_cod', codigos)
        .limit(1)

    if (error) {
        if (isMissingColumnError(error)) return { exists: false, error: erroMigracaoCidadeId() }
        return { exists: false, error }
    }
    return { exists: (data || []).length > 0, error: null }
}

const inserirUmaLinha = async (supabase, row, context, select) => {
    const check = await linhaPlanosCidadeJaExiste(supabase, row, context)
    if (check.error) return { data: null, error: check.error, skipped: false }
    if (check.exists) return { data: null, error: null, skipped: true }

    const payload = montarPayloadCidade(row, context)
    if (!payload) {
        return {
            data: null,
            error: new Error('Informe a cidade (tabela) para vincular o procedimento.'),
            skipped: false,
        }
    }

    let q = supabase.from('planos_cidade').insert(payload)
    if (select) q = q.select(select).single()
    else q = q.select('id').single()
    const { data, error } = await q
    if (!error) return { data, error: null, skipped: false }
    if (isMissingColumnError(error)) return { data: null, error: erroMigracaoCidadeId(), skipped: false }
    if (isDuplicateRowError(error)) return { data: null, error: null, skipped: true }
    return { data: null, error, skipped: false }
}

export const upsertPlanosCidadeCompat = async (supabase, rows, context, select = null) => {
    const inseridos = []
    for (const row of rows || []) {
        const { data, error, skipped } = await inserirUmaLinha(supabase, row, context, select)
        if (error) return { data: null, error }
        if (!skipped && data) inseridos.push(data)
    }
    return { data: inseridos, error: null }
}

export const buscarTodosPlanosCidadeCompat = async (supabase, buscarTodosPaginado, context, select, applyExtra) => {
    if (context.cidadeId == null) {
        return { data: [], error: new Error('Cidade (tabela) não selecionada.') }
    }

    const montar = () => {
        let q = supabase.from('planos_cidade').select(select).eq('cidade_id', context.cidadeId)
        if (applyExtra) q = applyExtra(q)
        return q
    }

    const resp = await buscarTodosPaginado(montar)
    if (!resp.error) return resp
    if (isMissingColumnError(resp.error)) {
        return { data: [], error: erroMigracaoCidadeId() }
    }
    return resp
}

export const consultarPlanoCidadeUnicoCompat = async (supabase, context, { planoId, procedimentoCod }, select = 'id') =>
    executarQueryCidade(() => {
        let q = supabase.from('planos_cidade').select(select).eq('procedimento_cod', procedimentoCod)
        if (planoId != null && planoId !== '') q = q.eq('plano_id', Number(planoId))
        return q.maybeSingle()
    }, context)

export const consultarPlanosCidadeExistentesCompat = async (supabase, context, procedimentoCod) =>
    executarQueryCidade(
        () => supabase.from('planos_cidade').select('plano_id').eq('procedimento_cod', procedimentoCod),
        context,
    )

export const excluirPlanosCidadeCompat = async (supabase, context, aplicarFiltros) => {
    let q = aplicarFiltroCidade(supabase.from('planos_cidade').delete(), context)
    if (!q) return { error: new Error('Cidade não definida.') }
    q = aplicarFiltros(q)
    const resp = await q
    if (!resp.error) return resp
    if (isMissingColumnError(resp.error)) return { error: erroMigracaoCidadeId() }
    return resp
}
