/**
 * Janela de linhas para tabelas virtualizadas (altura fixa por linha).
 * Evita oscilação do scroll no fim (espaçador inferior alternando 0 ↔ 1 linha).
 * Não força scrollTop no DOM: linhas reais podem ser um pouco mais altas que alturaLinha.
 */
export function calcularJanelaVirtualTabela({
    scrollTop,
    totalLinhas,
    alturaLinha,
    alturaVisivel,
    overscan = 6,
}) {
    const total = Math.max(0, Number(totalLinhas) || 0)
    const h = Math.max(1, Number(alturaLinha) || 42)
    const viewport = Math.max(h, Number(alturaVisivel) || h)
    const totalAltura = total * h
    const maxScrollTop = Math.max(0, totalAltura - viewport)
    const scrollRaw = Math.max(0, Number(scrollTop) || 0)

    const linhasNoViewport = Math.ceil(viewport / h)
    const qtdRender = linhasNoViewport + overscan * 2

    let indiceInicial = Math.max(0, Math.floor(scrollRaw / h) - overscan)
    let indiceFinal = Math.min(total, indiceInicial + qtdRender)

    const pertoDoFim =
        total > 0 &&
        (scrollRaw >= maxScrollTop - 1 ||
            indiceFinal >= total - 1 ||
            indiceInicial + linhasNoViewport >= total)

    if (pertoDoFim) {
        indiceFinal = total
        indiceInicial = Math.max(0, indiceFinal - qtdRender)
    }

    return {
        scrollTop: scrollRaw,
        maxScrollTop,
        indiceInicial,
        indiceFinal,
        alturaEspacadorTopo: indiceInicial * h,
        alturaEspacadorBase: Math.max(0, (total - indiceFinal) * h),
    }
}

export function criarHandlerScrollVirtualTabela({ categoriaId, setScrollTopoPorCategoria }) {
    return (event) => {
        const st = event.currentTarget.scrollTop
        setScrollTopoPorCategoria((anterior) => {
            const prev = Number(anterior[categoriaId] ?? 0)
            if (Math.abs(prev - st) < 0.5) return anterior
            return { ...anterior, [categoriaId]: st }
        })
    }
}
