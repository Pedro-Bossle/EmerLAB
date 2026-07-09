import { formatarContatoSeTelefone } from '../telefoneBrasil.js'

const CABECALHOS = [
    'NOME',
    'HORA DE ATENDIMENTO',
    'ENDEREÇO',
    'CONTATO',
    'CONTATADO (CHECKBOX)',
    'SEM INTERESSE (CHECKBOX)',
    'CREDENCIADO (CHECKBOX)',
]

function sanitizarNomeArquivo(nome) {
    return String(nome || 'pois-mapa')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80)
}

function nomeExibicaoPoi(p) {
    return String(p?.nome || p?.rotulo || '').trim()
}

/**
 * @param {Array<{ nome?: string, rotulo?: string, horaAtendimento?: string, endereco?: string, telefone?: string }>} pois
 */
export async function exportarMapaPoisParaExcel(pois, nomeArquivoBase = 'pois-mapa') {
    const lista = (pois || []).filter((p) => nomeExibicaoPoi(p) || p?.endereco)
    if (!lista.length) return { ok: false, erro: 'Nenhum POI para exportar.' }

    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('POIs', {
        views: [{ state: 'frozen', ySplit: 1 }],
    })

    ws.addRow(CABECALHOS)
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', wrapText: true }

    for (const p of lista) {
        const contato = formatarContatoSeTelefone(p.telefone) || String(p.telefone || '').trim()
        ws.addRow([
            nomeExibicaoPoi(p),
            String(p.horaAtendimento || '').trim(),
            String(p.endereco || '').trim(),
            contato,
            '',
            '',
            '',
        ])
    }

    const colWidths = [32, 22, 48, 18, 22, 24, 22]
    colWidths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w
    })

    const ultimaLinha = ws.rowCount
    for (let row = 2; row <= ultimaLinha; row += 1) {
        for (const col of [5, 6, 7]) {
            const cell = ws.getCell(row, col)
            cell.dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: ['"☐,☑"'],
                showErrorMessage: true,
                errorTitle: 'Valor inválido',
                error: 'Use ☐ ou ☑',
            }
            cell.value = '☐'
        }
    }

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
    return { ok: true }
}
