/**
 * Modelo de planilha para o vínculo manual do relatório de repasse (mesmo formato que o sistema principal exporta).
 * exceljs carrega sob demanda: só entra no navegador quando alguém pede o modelo.
 */
import { COLUNAS_RELATORIO } from './lerRelatorioExcel.js'

export async function gerarModeloRelatorioXlsx(nomePrestador = 'NOME DO PRESTADOR') {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Relatório')
    ws.columns = [{ width: 14 }, { width: 28 }, { width: 18 }, { width: 13 }, { width: 38 }, { width: 13 }, { width: 13 }]
    const negrito = { bold: true }
    const preenche = (cel, argb) => {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    }

    // A1: nome do prestador (mesclado A..G, como no arquivo do sistema)
    ws.addRow([String(nomePrestador || 'NOME DO PRESTADOR').toUpperCase()])
    ws.mergeCells('A1:G1')
    ws.getCell('A1').font = { bold: true, size: 13 }

    // (opcional) nome do veterinário antes do cabeçalho: uma tabela por veterinário
    ws.addRow(['DR(A). NOME DO VETERINÁRIO'])
    ws.mergeCells('A2:G2')
    ws.getCell('A2').font = negrito
    preenche(ws.getCell('A2'), 'FFE7F4FC')

    const cab = ws.addRow(COLUNAS_RELATORIO)
    cab.font = negrito
    cab.eachCell((c) => preenche(c, 'FFD9E8F2'))

    // atendimento com 1 procedimento
    ws.addRow([12345, 'NOME DO TUTOR', 'NOME DO PET', '01/10/2026', 'CONSULTA', 50, 30])
    // atendimento com 2 procedimentos: Atendimento, Tutor, Pet e Data só na primeira linha (as outras ficam vazias)
    ws.addRow([12346, 'OUTRO TUTOR', 'OUTRO PET', '02/10/2026', 'CONSULTA', 50, 30])
    ws.addRow(['', '', '', '', 'VACINA', 15, 20])

    const t = ws.addRow(['Totais', 'Atendimentos: 2'])
    t.font = negrito
    ws.mergeCells(`B${t.number}:G${t.number}`)
    ws.addRow([])
    // soma das linhas acima (substitua pelos totais reais)
    const final = ws.addRow(['Totais Prestador', '', '', '', '', 115, 80])
    final.font = negrito
    preenche(final.getCell(6), 'FFB2E9F4')
    ws.eachRow((row) => {
        for (const c of [6, 7]) if (typeof row.getCell(c).value === 'number') row.getCell(c).numFmt = '#,##0.00'
    })
    const buf = await wb.xlsx.writeBuffer()
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
