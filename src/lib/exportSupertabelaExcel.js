const FONTE_PADRAO = { name: 'Calibri', size: 11 }
const FONTE_CABECALHO = { ...FONTE_PADRAO, bold: true }
const PREENCHIMENTO_CABECALHO = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' },
}
const BORDA_FINA = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
}
const FORMATO_MOEDA_PT = '#,##0.00'

function sanitizarNomeArquivo(nomeArquivoBase) {
    return (
        String(nomeArquivoBase || 'export')
            .replace(/[^\w\s-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ\[\]]/gi, '')
            .trim()
            .slice(0, 80) || 'export'
    )
}

async function baixarWorkbook(workbook, nomeArquivoBase) {
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizarNomeArquivo(nomeArquivoBase)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

function estiloCabecalho(cell) {
    cell.font = FONTE_CABECALHO
    cell.fill = PREENCHIMENTO_CABECALHO
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = BORDA_FINA
}

function estiloTexto(cell) {
    cell.font = FONTE_PADRAO
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = BORDA_FINA
}

function estiloNumero(cell, valor) {
    cell.font = FONTE_PADRAO
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = BORDA_FINA
    const n = Number(valor)
    if (Number.isFinite(n)) {
        cell.value = n
        cell.numFmt = FORMATO_MOEDA_PT
    } else {
        cell.value = valor != null && valor !== '' ? String(valor) : ''
    }
}

function valorCelulaPlano(linha, chave) {
    const cel = linha?.[chave]
    if (cel == null) return ''
    if (typeof cel === 'object' && 'valor' in cel) return cel.valor
    return cel
}

/**
 * @param {{ categoriaNome: string, linhas: object[] }[]} secoes
 */
export async function exportarTabelaPlanosDiferencasParaExcel(secoes, nomeArquivoBase = 'supertabela-planos') {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Emerdog SFSC Supertool'
    const ws = workbook.addWorksheet('Diferencas')
    const colunas = [
        { key: 'codigo', title: 'Código', width: 14 },
        { key: 'procedimento', title: 'Procedimento', width: 48 },
        { key: 'basico', title: 'Básico', width: 12 },
        { key: 'classico', title: 'Clássico', width: 12 },
        { key: 'avancado', title: 'Avançado', width: 12 },
        { key: 'ultra', title: 'Ultra', width: 12 },
    ]
    colunas.forEach((c, i) => {
        ws.getColumn(i + 1).width = c.width
    })

    let row = 1
    const lista = (secoes || []).filter((s) => (s.linhas || []).length > 0)
    if (!lista.length) {
        ws.getCell(1, 1).value = 'Sem dados para exportar.'
        await baixarWorkbook(workbook, nomeArquivoBase)
        return
    }

    lista.forEach((secao, idxSec) => {
        if (idxSec > 0) row += 1
        ws.mergeCells(row, 1, row, colunas.length)
        const titulo = ws.getCell(row, 1)
        titulo.value = String(secao.categoriaNome || 'Categoria').trim()
        estiloCabecalho(titulo)
        titulo.alignment = { vertical: 'middle', horizontal: 'left' }
        row += 1

        colunas.forEach((col, ci) => {
            const h = ws.getCell(row, ci + 1)
            h.value = col.title
            estiloCabecalho(h)
        })
        row += 1

        for (const linha of secao.linhas) {
            estiloTexto(ws.getCell(row, 1))
            ws.getCell(row, 1).value = linha.codigo || ''
            estiloTexto(ws.getCell(row, 2))
            ws.getCell(row, 2).value = linha.procedimento || ''
            estiloNumero(ws.getCell(row, 3), valorCelulaPlano(linha, 'basico'))
            estiloNumero(ws.getCell(row, 4), valorCelulaPlano(linha, 'classico'))
            estiloNumero(ws.getCell(row, 5), valorCelulaPlano(linha, 'avancado'))
            estiloNumero(ws.getCell(row, 6), valorCelulaPlano(linha, 'ultra'))
            row += 1
        }
    })

    await baixarWorkbook(workbook, nomeArquivoBase)
}

/**
 * @param {{ categoriaNome: string, linhas: object[] }[]} secoes
 */
export async function exportarTabelaPlanosLimitesParaExcel(secoes, nomeArquivoBase = 'supertabela-limites') {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Emerdog SFSC Supertool'
    const ws = workbook.addWorksheet('Limites')
    ws.getColumn(1).width = 14
    ws.getColumn(2).width = 48
    ws.getColumn(3).width = 16
    ws.getColumn(4).width = 14

    let row = 1
    const lista = (secoes || []).filter((s) => (s.linhas || []).length > 0)
    if (!lista.length) {
        ws.getCell(1, 1).value = 'Sem dados para exportar.'
        await baixarWorkbook(workbook, nomeArquivoBase)
        return
    }

    lista.forEach((secao, idxSec) => {
        if (idxSec > 0) row += 1
        ws.mergeCells(row, 1, row, 4)
        const titulo = ws.getCell(row, 1)
        titulo.value = String(secao.categoriaNome || 'Categoria').trim()
        estiloCabecalho(titulo)
        titulo.alignment = { vertical: 'middle', horizontal: 'left' }
        row += 1

        ;['Código', 'Procedimento', 'Limite', 'Carência'].forEach((t, ci) => {
            const h = ws.getCell(row, ci + 1)
            h.value = t
            estiloCabecalho(h)
        })
        row += 1

        for (const linha of secao.linhas) {
            estiloTexto(ws.getCell(row, 1))
            ws.getCell(row, 1).value = linha.codigo || ''
            estiloTexto(ws.getCell(row, 2))
            ws.getCell(row, 2).value = linha.procedimento || ''
            estiloTexto(ws.getCell(row, 3))
            ws.getCell(row, 3).value = linha.limite != null ? String(linha.limite) : ''
            estiloTexto(ws.getCell(row, 4))
            ws.getCell(row, 4).value = linha.carencia != null ? String(linha.carencia) : ''
            row += 1
        }
    })

    await baixarWorkbook(workbook, nomeArquivoBase)
}
