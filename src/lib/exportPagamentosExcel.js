import { formatarDataAtualizadoEm } from './pagamentosRegistros.js'
import { rotuloMesAnoCurto, rotuloTipoRepasse } from './pagamentosPrestador.js'
import { formatarValorMonetarioBr } from './pagamentosValor.js'

const CABECALHOS = [
    'Competência',
    'Prestador',
    'Tipo de repasse',
    'Chave PIX',
    'Valor',
    'Resposta',
    'Pago',
    'Observações',
    'Atualizado em',
]

function sanitizarNomeArquivo(nome) {
    return String(nome || 'pagamentos')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80)
}

function simNao(v) {
    return v ? 'Sim' : 'Não'
}

/**
 * @param {object[]} registros — linhas já filtradas (competência + status pago)
 * @param {{ nomeArquivoBase?: string }} [opcoes]
 */
export async function exportarPagamentosParaExcel(registros, opcoes = {}) {
    const lista = Array.isArray(registros) ? registros : []
    if (!lista.length) return { ok: false, erro: 'Nenhum registro para exportar.' }

    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Pagamentos', {
        views: [{ state: 'frozen', ySplit: 1 }],
    })

    ws.addRow(CABECALHOS)
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', wrapText: true }

    for (const row of lista) {
        const valorFmt = formatarValorMonetarioBr(row.valor)
        ws.addRow([
            rotuloMesAnoCurto(row.mes, row.ano),
            String(row.prestadorNome || '').trim(),
            rotuloTipoRepasse(row.tipoRepasse),
            String(row.chavePix || '').trim(),
            valorFmt || '',
            simNao(row.resposta),
            simNao(row.pago),
            String(row.obs || '').trim(),
            formatarDataAtualizadoEm(row.atualizadoEm),
        ])
    }

    ;[14, 36, 18, 28, 14, 10, 10, 28, 14].forEach((w, i) => {
        ws.getColumn(i + 1).width = w
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizarNomeArquivo(opcoes.nomeArquivoBase || 'pagamentos')}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return { ok: true, totalLinhas: lista.length }
}
