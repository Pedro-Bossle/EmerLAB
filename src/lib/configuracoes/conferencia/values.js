export const TOLERANCIA_VALOR = 0.009

export function arredondarValor(valor) {
    if (valor == null || !Number.isFinite(Number(valor))) return null
    return Math.round(Number(valor) * 100) / 100
}

/**
 * Honorários é o valor oficial. diferença = mellis - honorarios.
 */
export function compareValues(valorHonorarios, valorMellis) {
    const h = arredondarValor(valorHonorarios)
    const m = arredondarValor(valorMellis)
    const diferenca_valor =
        h != null && m != null ? Math.round((m - h) * 100) / 100 : null
    const iguais =
        h != null && m != null && Math.abs(m - h) <= TOLERANCIA_VALOR
    return {
        status: iguais ? 'VALOR_OK' : 'VALOR_DIVERGENTE',
        valor_honorarios: h,
        valor_mellislab: m,
        diferenca_valor,
        ok: iguais,
    }
}
