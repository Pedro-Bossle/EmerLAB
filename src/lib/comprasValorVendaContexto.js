const normCod = (c) => String(c || '').trim().toUpperCase()
const normUf = (u) => String(u || '').trim().toUpperCase()

const linhaLegada = (r) => {
    const uf = r?.uf
    const cid = r?.cidade_id
    return (uf == null || uf === '') && (cid == null || cid === '')
}

const pontuacaoLinha = (r, ctx) => {
    if (!r) return -1
    const codOk = normCod(r.cod_procedimento) === normCod(ctx.codigo)
    if (!codOk) return -1

    const ufCtx = normUf(ctx.uf)
    const cidCtx = ctx.cidadeId != null && ctx.cidadeId !== '' ? Number(ctx.cidadeId) : null
    const ufLin = normUf(r.uf)
    const cidLin = r.cidade_id != null && r.cidade_id !== '' ? Number(r.cidade_id) : null

    if (linhaLegada(r)) return 1

    let score = 0
    if (cidCtx != null && cidLin === cidCtx) score += 10
    if (ufCtx && ufLin === ufCtx) score += 5
    if (cidCtx != null && cidLin != null && cidLin !== cidCtx) return -1
    if (ufCtx && ufLin && ufLin !== ufCtx) return -1
    if (score > 0) return score + 2
    return -1
}

/**
 * Escolhe valor de venda: mais específico (cidade+UF) → cidade → UF → legado (sem UF/cidade).
 */
export const escolherValorVendaParaContexto = (codigo, linhas, contexto = {}) => {
    const cod = normCod(codigo)
    const candidatos = (linhas || []).filter((r) => normCod(r.cod_procedimento) === cod)
    if (!candidatos.length) return { valor: null, linha: null, origem: 'nao_encontrado' }

    const ctx = {
        codigo: cod,
        uf: contexto.uf,
        cidadeId: contexto.cidadeId,
    }

    const ranqueados = candidatos
        .map((r) => ({ r, score: pontuacaoLinha(r, ctx) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return Number(b.r.id || 0) - Number(a.r.id || 0)
        })

    const top = ranqueados[0]?.r
    if (!top) return { valor: null, linha: null, origem: 'nao_encontrado' }

    let origem = 'legado'
    if (pontuacaoLinha(top, ctx) >= 12) origem = 'cidade_uf'
    else if (pontuacaoLinha(top, ctx) >= 10) origem = 'cidade'
    else if (pontuacaoLinha(top, ctx) >= 5) origem = 'uf'
    else origem = 'legado'

    return {
        valor: top.valor_venda != null ? Number(top.valor_venda) : null,
        linha: top,
        origem,
    }
}
