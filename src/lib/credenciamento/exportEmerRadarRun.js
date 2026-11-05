import { displayCategory, planoLabel } from './emerRadarUi.js'

const CABECALHOS = [
    'Nome',
    'Categoria',
    'Endereço',
    'Cidade',
    'UF',
    'Telefone',
    'Nota',
    'Avaliações',
    'Planos',
    'Site',
    'Link Maps',
]

const texto = (v) => String(v ?? '').trim()

const nomeSeguro = (nome) =>
    texto(nome || 'emer-radar')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80)

/**
 * Excel de uma execução do pipeline, gerado no navegador (em produção não há worker para exportar).
 * @param {object[]} resultados registros devolvidos por `emerRadarCarregarExecucao`
 * @param {string} runId
 */
export async function exportarExecucaoEmerRadarParaExcel(resultados, runId) {
    const lista = (resultados || []).filter((r) => r && (r.nome || r.endereco))
    if (!lista.length) return { ok: false, erro: 'Esta execução não tem registros para exportar.' }

    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Emer-Radar', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.addRow(CABECALHOS)
    const cab = ws.getRow(1)
    cab.font = { bold: true }
    cab.alignment = { vertical: 'middle', wrapText: true }

    for (const r of lista) {
        const planos = Array.isArray(r.planos) ? r.planos.map((p) => planoLabel(p)).join(', ') : ''
        ws.addRow([
            texto(r.nome),
            displayCategory(r),
            texto(r.endereco),
            texto(r.cidade),
            texto(r.uf),
            texto(r.telefone),
            texto(r.nota),
            texto(r.num_avaliacoes),
            planos,
            texto(r.site),
            texto(r.link_maps),
        ])
    }
    const larguras = [34, 24, 46, 20, 6, 18, 8, 12, 28, 30, 40]
    larguras.forEach((w, i) => {
        ws.getColumn(i + 1).width = w
    })

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emer-radar-${nomeSeguro(runId)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return { ok: true, total: lista.length }
}
