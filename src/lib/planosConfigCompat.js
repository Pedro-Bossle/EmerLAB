/**
 * Inserção em planos_config sem depender de UNIQUE para ON CONFLICT
 * (evita erro Postgres 42P10 no Supabase).
 */

export const inserirPlanoConfigSeNaoExiste = async (
    supabase,
    { planoId, procedimento, limite = '', carencia = '' }
) => {
    const planoNum = Number(planoId)
    const proc = String(procedimento)

    const { data: existe, error: errConsulta } = await supabase
        .from('planos_config')
        .select('id')
        .eq('plano_id', planoNum)
        .eq('procedimento', proc)
        .maybeSingle()

    if (errConsulta) return { status: 'erro', error: errConsulta }

    if (existe?.id) return { status: 'ja_existia', error: null }

    const { error: errInsert } = await supabase.from('planos_config').insert({
        plano_id: planoNum,
        procedimento: proc,
        limite,
        carencia,
    })

    if (errInsert) {
        const msg = String(errInsert.message || '')
        if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) {
            return { status: 'ja_existia', error: null }
        }
        return { status: 'erro', error: errInsert }
    }

    return { status: 'ok', error: null }
}
