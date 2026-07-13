import { supabase } from '../supabase.js'

function clampPct(valor) {
    const n = Number(String(valor ?? '').replace(',', '.'))
    if (!Number.isFinite(n)) return 0
    return Math.min(100, Math.max(0, n))
}

/** Normaliza min/max; se só um valor, ambos iguais; se max < min, troca. */
export function normalizarFaixaPercentual(minRaw, maxRaw) {
    let min = clampPct(minRaw)
    let max = maxRaw === '' || maxRaw == null ? min : clampPct(maxRaw)
    if (max < min) {
        const t = min
        min = max
        max = t
    }
    return { percentual: min, percentualMax: max }
}

export function formatarFaixaPercentual(minRaw, maxRaw) {
    const { percentual: min, percentualMax: max } = normalizarFaixaPercentual(minRaw, maxRaw)
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }))
    if (min === max) return `${fmt(min)}%`
    return `${fmt(min)}% a ${fmt(max)}%`
}

/** Remove sufixo tipo « (PS) », « (BT) » do nome do grupo para exibição. */
export function nomeGrupoBeneficioVisivel(nome) {
    return String(nome || '')
        .replace(/\s*\([A-Za-z0-9_-]{1,8}\)\s*$/u, '')
        .trim()
}

export async function carregarCatalogoBeneficios() {
    const { data, error } = await supabase
        .from('beneficios_catalogo')
        .select('id, codigo, nome, grupo_codigo, grupo_nome, ordem, ativo')
        .eq('ativo', true)
        .order('grupo_codigo', { ascending: true })
        .order('ordem', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

export async function carregarBeneficiosPrestador(prestadorId) {
    const pid = Number(prestadorId)
    if (!pid) return { itens: [], observacoes: '' }

    const [{ data: itens, error: eItens }, { data: obsRow, error: eObs }] = await Promise.all([
        supabase
            .from('prestador_beneficios')
            .select(
                'id, beneficio_id, percentual, percentual_max, incluir, ordem, beneficios_catalogo ( id, codigo, nome, grupo_codigo, grupo_nome, ordem )',
            )
            .eq('prestador_id', pid)
            .order('ordem', { ascending: true }),
        supabase.from('prestador_beneficios_obs').select('observacoes').eq('prestador_id', pid).maybeSingle(),
    ])
    if (eItens) throw new Error(eItens.message)
    if (eObs) throw new Error(eObs.message)

    return {
        itens: (itens || []).map((row, idx) => {
            const min = Number(row.percentual ?? 0)
            const max = row.percentual_max == null ? min : Number(row.percentual_max)
            return {
                id: row.id,
                beneficioId: row.beneficio_id,
                percentual: min,
                percentualMax: Number.isFinite(max) ? max : min,
                incluir: row.incluir !== false,
                ordem: row.ordem ?? idx,
                codigo: row.beneficios_catalogo?.codigo || '',
                nome: row.beneficios_catalogo?.nome || '',
                grupoCodigo: row.beneficios_catalogo?.grupo_codigo || '',
                grupoNome: row.beneficios_catalogo?.grupo_nome || '',
            }
        }),
        observacoes: String(obsRow?.observacoes || ''),
    }
}

/**
 * Substitui o pacote de benefícios do prestador.
 * @param {number} prestadorId
 * @param {{ itens: Array<{ beneficioId: number, percentual: number, percentualMax?: number, incluir?: boolean }>, observacoes?: string }} pacote
 */
export async function sincronizarBeneficiosPrestador(prestadorId, pacote) {
    const pid = Number(prestadorId)
    if (!pid) throw new Error('Prestador inválido para benefícios.')

    const itens = Array.isArray(pacote?.itens) ? pacote.itens : []
    const observacoes = String(pacote?.observacoes || '').trim()

    const { error: eDel } = await supabase.from('prestador_beneficios').delete().eq('prestador_id', pid)
    if (eDel) throw new Error(eDel.message)

    if (itens.length) {
        const rows = itens
            .filter((i) => Number(i.beneficioId))
            .map((i, idx) => {
                const faixa = normalizarFaixaPercentual(i.percentual, i.percentualMax ?? i.percentual)
                return {
                    prestador_id: pid,
                    beneficio_id: Number(i.beneficioId),
                    percentual: faixa.percentual,
                    percentual_max: faixa.percentualMax,
                    incluir: i.incluir !== false,
                    ordem: idx,
                    atualizado_em: new Date().toISOString(),
                }
            })
        const visto = new Set()
        const unicos = []
        for (const row of rows) {
            if (visto.has(row.beneficio_id)) continue
            visto.add(row.beneficio_id)
            unicos.push(row)
        }
        if (unicos.length) {
            const { error: eIns } = await supabase.from('prestador_beneficios').insert(unicos)
            if (eIns) throw new Error(eIns.message)
        }
    }

    const { error: eObs } = await supabase.from('prestador_beneficios_obs').upsert(
        {
            prestador_id: pid,
            observacoes,
            atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'prestador_id' },
    )
    if (eObs) throw new Error(eObs.message)
}

export function gruposDoCatalogo(catalogo = []) {
    const mapa = new Map()
    for (const item of catalogo) {
        const chave = item.grupo_codigo
        if (!mapa.has(chave)) {
            mapa.set(chave, {
                codigo: chave,
                nome: nomeGrupoBeneficioVisivel(item.grupo_nome) || item.grupo_nome,
                itens: [],
            })
        }
        mapa.get(chave).itens.push(item)
    }
    return [...mapa.values()]
}
