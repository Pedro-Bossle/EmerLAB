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
