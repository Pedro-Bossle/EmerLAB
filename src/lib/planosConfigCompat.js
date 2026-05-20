/**
 * Inserção em planos_config sem upsert/ON CONFLICT.
 */

const variantesProcedimento = (cod) => {
    const t = String(cod ?? '').trim()
    if (!t) return []
    return [...new Set([t, t.toUpperCase(), t.toLowerCase()])]
}

const jaExistePlanoConfig = async (supabase, planoNum, variantes) => {
    const { data, error } = await supabase
        .from('planos_config')
        .select('id, procedimento')
        .eq('plano_id', planoNum)
        .in('procedimento', variantes)
        .limit(1)

    if (error) return { exists: false, error }
    return { exists: (data || []).length > 0, error: null }
}

export const inserirPlanoConfigSeNaoExiste = async (
    supabase,
    { planoId, procedimento, limite = '', carencia = '' }
) => {
    const planoNum = Number(planoId)
    const variantes = variantesProcedimento(procedimento)
    const procGravar = String(procedimento).trim().toUpperCase()

    if (!variantes.length) {
        return { status: 'erro', error: new Error('Código do procedimento inválido.') }
    }

    const check = await jaExistePlanoConfig(supabase, planoNum, variantes)
    if (check.error) return { status: 'erro', error: check.error }
    if (check.exists) return { status: 'ja_existia', error: null }

    const { error: errInsert } = await supabase.from('planos_config').insert({
        plano_id: planoNum,
        procedimento: procGravar,
        limite,
        carencia,
    })

    if (errInsert) {
        if (isDuplicateConfigError(errInsert)) return { status: 'ja_existia', error: null }
        return { status: 'erro', error: errInsert }
    }

    return { status: 'ok', error: null }
}

const isDuplicateConfigError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return msg.includes('23505') || msg.includes('duplicate') || msg.includes('unique')
}
