function limparSegmentoNome(s) {
    return String(s || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** @param {string[]} cidades Nomes das cidades selecionadas */
export function montarNomeArquivoRc(cidades) {
    const lista = (cidades || []).map(limparSegmentoNome).filter(Boolean)
    if (!lista.length) return 'RC.pdf'
    return `RC - ${lista.join(', ')}.pdf`
}
