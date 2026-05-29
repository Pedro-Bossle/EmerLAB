/**
 * Exporta negociação para CSV compatível com Excel (PT-BR).
 * Colunas: Codigo, Nome, Nome Alternativo, P, M, G
 */
export function exportarNegociacaoParaExcel(linhas, nomeArquivoBase = 'negociacao') {
    const cabecalho = ['Codigo', 'Nome', 'Nome Alternativo', 'P', 'M', 'G']
    const escapar = (v) => {
        const s = String(v ?? '')
        if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
    }
    const corpo = (linhas || []).map((linha) =>
        [
            linha.codigo,
            linha.nome,
            linha.nomeAlternativo ?? '',
            formatarNumeroCelula(linha.porteP),
            formatarNumeroCelula(linha.porteM),
            formatarNumeroCelula(linha.porteG),
        ]
            .map(escapar)
            .join(';')
    )
    const csv = `\uFEFF${cabecalho.join(';')}\n${corpo.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const nome = String(nomeArquivoBase || 'negociacao')
        .replace(/[^\w\s-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/gi, '')
        .trim()
        .slice(0, 80) || 'negociacao'
    a.href = url
    a.download = `${nome}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

function formatarNumeroCelula(valor) {
    const n = Number(valor)
    if (!Number.isFinite(n)) return ''
    return n.toFixed(2).replace('.', ',')
}
