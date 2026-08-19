export const TOLERANCIA_DIAS_DATA = 7

function epochDia(iso) {
    const raw = String(iso || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
    const t = Date.parse(`${raw}T00:00:00Z`)
    return Number.isFinite(t) ? t : null
}

export function diferencaDiasAbs(dataA, dataB) {
    const a = epochDia(dataA)
    const b = epochDia(dataB)
    if (a == null || b == null) return null
    return Math.round(Math.abs(a - b) / 86400000)
}

/**
 * ≤7 dias → DATA_COMPATIVEL; >7 → DATA_DIVERGENTE.
 */
export function compareDates(dataHonorarios, dataMellis) {
    const dias = diferencaDiasAbs(dataHonorarios, dataMellis)
    if (dias == null) {
        return {
            status: 'DATA_DIVERGENTE',
            diferenca_dias: null,
            data_honorarios: dataHonorarios || null,
            data_mellislab: dataMellis || null,
            compativel: false,
            exata: false,
        }
    }
    const exata = dias === 0
    const compativel = dias <= TOLERANCIA_DIAS_DATA
    return {
        status: compativel ? 'DATA_COMPATIVEL' : 'DATA_DIVERGENTE',
        diferenca_dias: dias,
        data_honorarios: dataHonorarios,
        data_mellislab: dataMellis,
        compativel,
        exata,
    }
}
