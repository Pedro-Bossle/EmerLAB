/**
 * Inserção em planos_cidade sem upsert/ON CONFLICT (compatível com qualquer schema).
 */

export const isMissingColumnError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('does not exist') || (msg.includes('column') && msg.includes('schema cache'))
}

export const isDuplicateRowError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('23505') || msg.includes('duplicate') || msg.includes('unique')
}

const variantesProcedimentoCod = (cod) => {
    const t = String(cod ?? '').trim()
    if (!t) return []
    return [...new Set([t, t.toUpperCase(), t.toLowerCase()])]
}

const payloadsInsercao = (row, context) => {
    const planoId = Number(row.plano_id)
    const cod = String(row.procedimento_cod)
    const diferenca = row.diferenca != null ? row.diferenca : 0
    const lista = []

    const cid = row.cidade_id != null ? Number(row.cidade_id) : Number(context.cidadeId)
    if (Number.isFinite(cid)) {
        lista.push({ cidade_id: cid, plano_id: planoId, procedimento_cod: cod, diferenca })
    }

    const rid = row.regiao_id != null ? Number(row.regiao_id) : Number(context.regiaoId)
    if (Number.isFinite(rid)) {
        lista.push({ regiao_id: rid, plano_id: planoId, procedimento_cod: cod, diferenca })
    }

    return lista
}

const existePorCidade = async (supabase, planoId, codigos, cidadeId) => {
    if (!Number.isFinite(cidadeId)) return { exists: false, error: null }
    const { data, error } = await supabase
        .from('planos_cidade')
        .select('id')
        .eq('cidade_id', cidadeId)
        .eq('plano_id', planoId)
        .in('procedimento_cod', codigos)
        .limit(1)
    if (error) {
        if (isMissingColumnError(error)) return { exists: false, error: null }
        return { exists: false, error }
    }
    return { exists: (data || []).length > 0, error: null }
}

const existePorRegiao = async (supabase, planoId, codigos, regiaoId) => {
    if (!Number.isFinite(regiaoId)) return { exists: false, error: null }
    const { data, error } = await supabase
        .from('planos_cidade')
        .select('id')
        .eq('regiao_id', regiaoId)
        .eq('plano_id', planoId)
        .in('procedimento_cod', codigos)
        .limit(1)
    if (error) {
        if (isMissingColumnError(error)) return { exists: false, error: null }
        return { exists: false, error }
    }
    return { exists: (data || []).length > 0, error: null }
}

export const linhaPlanosCidadeJaExiste = async (supabase, row, context) => {
    const codigos = variantesProcedimentoCod(row.procedimento_cod)
    const planoId = Number(row.plano_id)

    const porCidade = await existePorCidade(
        supabase,
        planoId,
        codigos,
        row.cidade_id != null ? Number(row.cidade_id) : Number(context.cidadeId)
    )
    if (porCidade.error) return porCidade
    if (porCidade.exists) return { exists: true, error: null }

    return existePorRegiao(
        supabase,
        planoId,
        codigos,
        row.regiao_id != null ? Number(row.regiao_id) : Number(context.regiaoId)
    )
}

const inserirUmaLinha = async (supabase, row, context, select) => {
    const check = await linhaPlanosCidadeJaExiste(supabase, row, context)
    if (check.error) return { data: null, error: check.error, skipped: false }
    if (check.exists) return { data: null, error: null, skipped: true }

    const tentativas = payloadsInsercao(row, context)
    if (tentativas.length === 0) {
        return { data: null, error: new Error('Informe cidade ou região para vincular o procedimento.'), skipped: false }
    }

    let ultimoErro = null
    for (const payload of tentativas) {
        let q = supabase.from('planos_cidade').insert(payload)
        if (select) q = q.select(select).single()
        else q = q.select('id').single()
        const { data, error } = await q
        if (!error) return { data, error: null, skipped: false }
        if (isMissingColumnError(error)) {
            ultimoErro = error
            continue
        }
        if (isDuplicateRowError(error)) return { data: null, error: null, skipped: true }
        return { data: null, error, skipped: false }
    }

    return { data: null, error: ultimoErro, skipped: false }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} rows
 * @param {{ cidadeId?: number|string, regiaoId?: number|string }} context
 * @param {string} [select]
 */
export const upsertPlanosCidadeCompat = async (supabase, rows, context, select = null) => {
    const inseridos = []
    for (const row of rows || []) {
        const { data, error, skipped } = await inserirUmaLinha(supabase, row, context, select)
        if (error) return { data: null, error }
        if (!skipped && data) inseridos.push(data)
    }
    return { data: inseridos, error: null }
}
