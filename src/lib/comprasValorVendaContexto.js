const normCod = (c) => String(c || '').trim().toUpperCase()

/** Valor da lojinha: um preço por procedimento, válido para todas as regiões. */
const linhaLegada = (r) => {
    const uf = r?.uf
    const cid = r?.cidade_id
    return (uf == null || uf === '') && (cid == null || cid === '')
}

/**
 * Escolhe valor de venda da lojinha (somente registros sem UF/cidade).
 * O contexto do comprador (UF/cidade) não altera o preço exibido no orçamento.
 */
export const escolherValorVendaParaContexto = (codigo, linhas, _contexto = {}) => {
    const cod = normCod(codigo)
    const candidatos = (linhas || [])
        .filter((r) => normCod(r.cod_procedimento) === cod && linhaLegada(r))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))

    const top = candidatos[0]
    if (!top) return { valor: null, linha: null, origem: 'nao_encontrado' }

    return {
        valor: top.valor_venda != null ? Number(top.valor_venda) : null,
        linha: top,
        origem: 'lojinha',
    }
}
