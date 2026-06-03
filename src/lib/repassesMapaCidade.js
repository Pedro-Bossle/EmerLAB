import { buscarTodosPaginado, supabase } from './supabase.js'
import { carregarPortesDb, mapaLetraPorPorteId } from './prestadorProcedimentos.js'

export function normalizarCodigoRepasses(cod) {
    return String(cod || '')
        .trim()
        .toUpperCase()
}

/**
 * Mapa codigo (upper) → { P, M, G } numérico ou null, a partir de `repasses` da tabela-mestre.
 */
export async function buscarMapaRepassesPorCidadeId(cidadeId) {
    const cid = Number(cidadeId)
    if (!cid) return new Map()

    const { data, error } = await buscarTodosPaginado(() =>
        supabase.from('repasses').select('procedimento_id, porte_id, valor').eq('cidade_id', cid),
    )
    if (error) throw new Error(error.message)

    const portesLista = await carregarPortesDb()
    const letraPorId = mapaLetraPorPorteId(portesLista)
    const mapa = new Map()

    for (const item of data || []) {
        const cod = normalizarCodigoRepasses(item.procedimento_id)
        if (!cod) continue
        if (!mapa.has(cod)) mapa.set(cod, { P: null, M: null, G: null })
        const letra = letraPorId.get(Number(item.porte_id))
        if (letra === 'P' || letra === 'M' || letra === 'G') {
            const v = item.valor
            mapa.get(cod)[letra] = v != null && v !== '' ? Number(v) : null
        }
    }
    return mapa
}

/** Negociação prevalece; portes vazios na negociação vêm dos repasses da cidade do endereço. */
export function mesclarMapasValoresPorte(negociacao, repasses) {
    const out = new Map()
    const cods = new Set([...(negociacao?.keys() || []), ...(repasses?.keys() || [])])
    for (const cod of cods) {
        const n = negociacao?.get(cod) || { P: null, M: null, G: null }
        const r = repasses?.get(cod) || { P: null, M: null, G: null }
        out.set(cod, {
            P: n.P != null ? n.P : r.P,
            M: n.M != null ? n.M : r.M,
            G: n.G != null ? n.G : r.G,
        })
    }
    return out
}
