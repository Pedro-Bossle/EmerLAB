/**
 * Compatibilidade planos_cidade: bases com UNIQUE (cidade_id, plano_id, procedimento_cod)
 * e/ou UNIQUE (regiao_id, plano_id, procedimento_cod).
 */

export const PLANOS_CIDADE_ON_CONFLICTS = [
    'cidade_id,plano_id,procedimento_cod',
    'regiao_id,plano_id,procedimento_cod',
]

export const isMissingColumnError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('does not exist') || msg.includes('column') && msg.includes('schema cache')
}

export const isOnConflictConstraintError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('no unique or exclusion constraint') || msg.includes('on conflict')
}

export const enrichPlanosCidadeRow = (row, { cidadeId, regiaoId }) => {
    const out = { ...row }
    if (cidadeId != null && out.cidade_id == null) out.cidade_id = Number(cidadeId)
    if (regiaoId != null && out.regiao_id == null) out.regiao_id = Number(regiaoId)
    return out
}

const existePorCidade = async (supabase, row, cidadeId) => {
    const cid = row.cidade_id != null ? Number(row.cidade_id) : Number(cidadeId)
    if (!Number.isFinite(cid)) return { exists: false, error: null }
    const { data, error } = await supabase
        .from('planos_cidade')
        .select('id')
        .eq('cidade_id', cid)
        .eq('plano_id', row.plano_id)
        .eq('procedimento_cod', row.procedimento_cod)
        .maybeSingle()
    if (error) {
        if (isMissingColumnError(error)) return { exists: false, error: null }
        return { exists: false, error }
    }
    return { exists: Boolean(data), error: null }
}

const existePorRegiao = async (supabase, row, regiaoId) => {
    const rid = row.regiao_id != null ? Number(row.regiao_id) : Number(regiaoId)
    if (!Number.isFinite(rid)) return { exists: false, error: null }
    const { data, error } = await supabase
        .from('planos_cidade')
        .select('id')
        .eq('regiao_id', rid)
        .eq('plano_id', row.plano_id)
        .eq('procedimento_cod', row.procedimento_cod)
        .maybeSingle()
    if (error) {
        if (isMissingColumnError(error)) return { exists: false, error: null }
        return { exists: false, error }
    }
    return { exists: Boolean(data), error: null }
}

export const linhaPlanosCidadeJaExiste = async (supabase, row, context) => {
    const porCidade = await existePorCidade(supabase, row, context.cidadeId)
    if (porCidade.error) return porCidade
    if (porCidade.exists) return { exists: true, error: null }

    return existePorRegiao(supabase, row, context.regiaoId)
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} rows
 * @param {{ cidadeId?: number|string, regiaoId?: number|string }} context
 * @param {string} [select] colunas do .select() após upsert
 */
export const upsertPlanosCidadeCompat = async (supabase, rows, context, select = null) => {
    const payloads = (rows || []).map((r) => enrichPlanosCidadeRow(r, context))
    if (payloads.length === 0) return { data: [], error: null }

    for (const onConflict of PLANOS_CIDADE_ON_CONFLICTS) {
        let q = supabase.from('planos_cidade').upsert(payloads, { onConflict, ignoreDuplicates: true })
        if (select) q = q.select(select)
        const { data, error } = await q
        if (!error) return { data: data || [], error: null }
        if (!isOnConflictConstraintError(error)) return { data: null, error }
    }

    const inseridos = []
    for (const row of payloads) {
        const check = await linhaPlanosCidadeJaExiste(supabase, row, context)
        if (check.error) return { data: null, error: check.error }
        if (check.exists) continue

        let q = supabase.from('planos_cidade').insert(row)
        if (select) q = q.select(select).single()
        else q = q.select('id').single()
        const { data, error } = await q
        if (error) {
            const msg = String(error.message || '')
            if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) continue
            return { data: null, error }
        }
        if (data) inseridos.push(data)
    }

    return { data: inseridos, error: null }
}
