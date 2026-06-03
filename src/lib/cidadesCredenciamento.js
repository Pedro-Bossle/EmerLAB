import { supabase } from './supabase.js'

function isConflitoUnicidade(error) {
    if (!error) return false
    const code = String(error.code || '')
    const status = Number(error.status || error.statusCode || 0)
    const msg = String(error.message || '').toLowerCase()
    return code === '23505' || status === 409 || msg.includes('duplicate') || msg.includes('unique')
}

/**
 * Busca cidade por nome (ilike) ou cria. Em 409, relê o registro existente.
 * @returns {Promise<{ id: number, nome: string }|null>}
 */
export async function obterOuCriarCidadeCredenciamento(nomeCidade) {
    const nome = String(nomeCidade || '').trim()
    if (!nome) return null

    const { data: existentes, error: errBusca } = await supabase
        .from('cidades_credenciamento')
        .select('id, nome')
        .ilike('nome', nome)
        .limit(1)
    if (errBusca) throw new Error(errBusca.message)
    if (existentes?.[0]?.id) {
        return { id: Number(existentes[0].id), nome: existentes[0].nome || nome }
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

    if (errIns) throw new Error(errIns.message)
    return null
}
