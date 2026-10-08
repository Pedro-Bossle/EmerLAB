export function formatarValorOrcamento(valor) {
    if (valor == null || Number.isNaN(Number(valor))) return '—'
    return Number(valor).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    })
}

/** Por padrão, compra entra na mensagem/PDF. */
export function linhaIncluiCompra(row) {
    return row?.incluirCompra !== false
}

/**
 * Itens cujo plano base não está coberto pelo plano do tutor.
 * @param {object[]} linhas
 * @param {string} [nomePlanoTutor]
 */
export function montarAvisoForaDaCobertura(linhas = [], nomePlanoTutor = '') {
    const fora = (Array.isArray(linhas) ? linhas : []).filter((row) => row?.foraDaCobertura)
    if (!fora.length) return null

    const planoTutor = String(nomePlanoTutor || '').trim() || 'atual'
    const itens = fora.map((row) => {
        const nome = String(row.nome || row.codigo || 'Procedimento').trim()
        const planoInclui = String(row.planoBaseNome || '').trim() || '—'
        return {
            codigo: row.codigo || '',
            nome,
            planoInclui,
            linha: `• ${nome} — incluso no plano ${planoInclui}`,
        }
    })

    const titulo = `Atenção: alguns procedimentos não estão na cobertura do plano ${planoTutor} e deverão ser comprados.`

    return {
        titulo,
        itens,
        texto: [titulo, ...itens.map((i) => i.linha)].join('\n'),
    }
}

function rotuloItem(row) {
    const nome = String(row.nome || row.codigo || 'Procedimento').trim()
    const q = Math.max(1, Number(row.quantidade || 1))
    return q > 1 ? `${nome} (x${q})` : nome
}

/**
 * Mensagem pronta (WhatsApp / e-mail).
 * Compra só entra nos itens com `incluirCompra` (default true).
 * @param {{
 *   linhas: object[],
 *   nomePlano?: string,
 *   meta?: { uf?: string, cidade?: string }
 * }} opts
 */
export function montarTextoCopiaRapidaOrcamento({ linhas, nomePlano, meta } = {}) {
    const itens = Array.isArray(linhas) ? linhas : []
    const planoLabel = String(nomePlano || '').trim() || '—'
    const comCompra = itens.filter((row) => linhaIncluiCompra(row))

    const lines = ['Segue o seu orçamento de compra de procedimentos:']

    const localParts = []
    if (meta?.cidade) localParts.push(String(meta.cidade).trim())
    if (meta?.uf) localParts.push(String(meta.uf).trim().toUpperCase())
    if (localParts.length) lines.push(`Local: ${localParts.join(' / ')}`)
    if (nomePlano) lines.push(`Plano: ${planoLabel}`)
    lines.push('')

    if (comCompra.length) {
        lines.push('Valor de Compra:')
        for (const row of comCompra) {
            lines.push(`${rotuloItem(row)} - ${formatarValorOrcamento(row.totalCompra)}`)
        }
        lines.push('')
    }

    lines.push(`Valor de Diferença Plano [${planoLabel}]:`)
    for (const row of itens) {
        lines.push(`${rotuloItem(row)} - ${formatarValorOrcamento(row.totalCoparticipacao)}`)
    }
    lines.push('')

    let totalCompra = 0
    let totalCop = 0
    for (const row of itens) {
        if (linhaIncluiCompra(row) && row.totalCompra != null) {
            totalCompra += Number(row.totalCompra) || 0
        }
        if (row.totalCoparticipacao != null) totalCop += Number(row.totalCoparticipacao) || 0
    }

    if (comCompra.length) {
        lines.push(`Total Compra: ${formatarValorOrcamento(totalCompra)}`)
    }
    lines.push(`Total Cop.: ${formatarValorOrcamento(totalCop)}`)
    lines.push(`Total gasto: ${formatarValorOrcamento(totalCompra + totalCop)}`)

    const aviso = montarAvisoForaDaCobertura(itens, nomePlano)
    if (aviso) {
        lines.push('')
        lines.push(aviso.texto)
    }

    return lines.join('\n')
}

/**
 * Tabela PDF: inclui coluna Compra só se algum item tiver compra marcada.
 * Linhas sem compra mostram "—" na coluna Compra (quando a coluna existe).
 */
export function montarTabelaOrcamentoExport(linhas) {
    const itens = Array.isArray(linhas) ? linhas : []
    const temAlgumaCompra = itens.some((row) => linhaIncluiCompra(row))

    const ativas = temAlgumaCompra
        ? ['procedimento', 'quantidade', 'totalCompra', 'totalCop']
        : ['procedimento', 'quantidade', 'totalCop']

    const labels = {
        procedimento: 'Procedimento',
        quantidade: 'Qtd',
        totalCompra: 'Total Compra',
        totalCop: 'Total Cop.',
    }

    const head = ativas.map((id) => labels[id])
    const body = itens.map((row) =>
        ativas.map((id) => {
            if (id === 'procedimento') return String(row.nome || row.codigo || 'Procedimento').trim()
            if (id === 'quantidade') return String(Math.max(1, Number(row.quantidade || 1)))
            if (id === 'totalCompra') {
                return linhaIncluiCompra(row) ? formatarValorOrcamento(row.totalCompra) : '—'
            }
            if (id === 'totalCop') return formatarValorOrcamento(row.totalCoparticipacao)
            return '—'
        }),
    )

    let totalCompra = 0
    let totalCop = 0
    for (const row of itens) {
        if (linhaIncluiCompra(row) && row.totalCompra != null) {
            totalCompra += Number(row.totalCompra) || 0
        }
        if (row.totalCoparticipacao != null) totalCop += Number(row.totalCoparticipacao) || 0
    }

    const foot = ativas.map((id) => {
        if (id === 'procedimento') return 'Totais'
        if (id === 'totalCompra') return formatarValorOrcamento(totalCompra)
        if (id === 'totalCop') return formatarValorOrcamento(totalCop)
        return ''
    })

    return {
        ativas,
        head,
        body,
        foot,
        totalCompra,
        totalCop,
        totalGasto: totalCompra + totalCop,
        temAlgumaCompra,
    }
}
