import { formatarContatoSeTelefone } from '../telefoneBrasil.js'
import { labelProspectoOsmCategoria } from './prospectosOsmCategorias.js'
import { prospectoIndicaAtendimento24h } from './prospectosOsmHorario.js'

const CABECALHOS = [
    'Nome',
    'Categoria',
    'Endereço',
    'Cidade',
    'UF',
    'Telefone',
    'Horário',
    'Site',
    'Status',
    'Latitude',
    'Longitude',
]

function sanitizarNomeArquivo(nome) {
    return String(nome || 'prospectos-osm')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80)
}

function rotuloStatus(id) {
    const map = {
        novo: 'Novo',
        contactado: 'Contactado',
        descartado: 'Descartado',
        credenciado: 'Credenciado',
    }
    return map[id] || id || ''
}

/**
 * @param {object[]} itens — linhas do catálogo (lista atual / filtrada)
 */
export async function exportarProspectosOsmParaExcel(itens, nomeArquivoBase = 'prospectos-osm') {
    const lista = (itens || []).filter((r) => r && (r.nome || r.endereco))
    if (!lista.length) return { ok: false, erro: 'Nenhum registro para exportar.' }

    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Prospectos', {
        views: [{ state: 'frozen', ySplit: 1 }],
    })

    ws.addRow(CABECALHOS)
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', wrapText: true }

    for (const row of lista) {
        const contato = formatarContatoSeTelefone(row.telefone) || String(row.telefone || '').trim()
        const horario = String(row.horario_atendimento || '').trim()
        const horarioCel = horario || (prospectoIndicaAtendimento24h(row) ? '24h' : '')
        ws.addRow([
            String(row.nome || '').trim(),
            row.categoria_label || labelProspectoOsmCategoria(row.categoria_id),
            String(row.endereco || '').trim(),
            String(row.cidade || '').trim(),
            String(row.uf || '').trim(),
            contato,
            horarioCel,
            String(row.website || '').trim(),
            rotuloStatus(row.status_prospeccao),
            Number.isFinite(row.lat) ? row.lat : '',
            Number.isFinite(row.lng) ? row.lng : '',
        ])
    }

    const colWidths = [34, 22, 44, 18, 6, 16, 18, 28, 14, 12, 12]
    colWidths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w
    })

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
