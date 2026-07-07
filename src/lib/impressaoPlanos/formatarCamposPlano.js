export const formatarDiferencaPlano = (valor) =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(Number(valor || 0))

export const formatarTextoCampoPlano = (valor) => {
    const t = String(valor ?? '').trim()
    return t || '—'
}
