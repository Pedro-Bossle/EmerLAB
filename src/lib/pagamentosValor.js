/** Converte texto pt-BR/en-US em número (valor monetário). */
export function normalizarValorMonetarioEntrada(valorTexto) {
    const texto = String(valorTexto || '').trim().replace(/\s/g, '').replace(/^R\$/i, '')
    if (!texto) return null

    const temPonto = texto.includes('.')
    const temVirgula = texto.includes(',')
    if (temPonto && temVirgula) {
        const n = Number(texto.replace(/\./g, '').replace(',', '.'))
        return Number.isFinite(n) ? n : null
    }
    if (temVirgula) {
        const n = Number(texto.replace(',', '.'))
        return Number.isFinite(n) ? n : null
    }
    const n = Number(texto)
    return Number.isFinite(n) ? n : null
}

export function formatarValorMonetarioBr(valor) {
    if (valor == null || valor === '') return ''
    const n = typeof valor === 'number' ? valor : Number(valor)
    if (!Number.isFinite(n)) return ''
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Desconto retido nos repasses do tipo RPA. */
export const DESCONTO_RPA = 0.11

export const ehTipoRpa = (tipoRepasse) => String(tipoRepasse || '').toLowerCase() === 'rpa'

/** Valor com o desconto do RPA (11%), arredondado em centavos. `null` se o valor não for numérico. */
export function valorLiquidoRpa(valor) {
    const v = Number(valor)
    if (valor == null || valor === '' || !Number.isFinite(v)) return null
    return Math.round(v * (1 - DESCONTO_RPA) * 100) / 100
}
