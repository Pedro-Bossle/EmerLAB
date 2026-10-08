import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { carregarLogoPdfEmerdog, downloadPdf, sanitizarNomeArquivoPdf } from '../contratos/pdf/gerarContratoPdf.js'
import { OPCOES_JSPDF_A4, blobDeJsPdf } from '../pdf/serializarPdf.js'
import {
    formatarValorOrcamento,
    montarAvisoForaDaCobertura,
    montarTabelaOrcamentoExport,
} from './orcamentoExport.js'

const MM_MARGIN = 14
const PAGE_W = 210
const TABLE_WIDTH_MM = PAGE_W - MM_MARGIN * 2

function dataGeracaoPtBr() {
    return new Date().toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    })
}

/**
 * @param {{
 *   linhas: object[],
 *   nomePlano?: string,
 *   uf?: string,
 *   cidade?: string,
 * }} opts
 */
export async function gerarOrcamentoPdfBlob(opts) {
    const doc = new jsPDF({ ...OPCOES_JSPDF_A4 })
    const logo = await carregarLogoPdfEmerdog()
    let y = MM_MARGIN
    const rightX = PAGE_W - MM_MARGIN

    doc.addImage(logo.dataUrl, 'PNG', MM_MARGIN, y, logo.w, logo.h)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    doc.text(`Gerado em: ${dataGeracaoPtBr()}`, rightX, y + logo.h * 0.45, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += logo.h + 6

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Orçamento de procedimentos', MM_MARGIN, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const metaLinhas = []
    const localParts = []
    if (opts.cidade) localParts.push(String(opts.cidade).trim())
    if (opts.uf) localParts.push(String(opts.uf).trim().toUpperCase())
    if (localParts.length) metaLinhas.push(`Local: ${localParts.join(' / ')}`)
    if (opts.nomePlano) metaLinhas.push(`Plano: ${String(opts.nomePlano).trim()}`)
    for (const linha of metaLinhas) {
        doc.text(linha, MM_MARGIN, y)
        y += 5
    }
    y += 2

    const tabela = montarTabelaOrcamentoExport(opts.linhas || [])
    const nCols = Math.max(1, tabela.head.length)
    const colStyles = {}
    for (let i = 0; i < nCols; i += 1) {
        const id = tabela.ativas[i]
        const isMoney = id === 'totalCompra' || id === 'totalCop'
        const isCenter = id === 'quantidade'
        colStyles[i] = {
            halign: isMoney ? 'right' : isCenter ? 'center' : 'left',
            ...(id === 'procedimento' ? { cellWidth: 'auto' } : {}),
        }
    }

    autoTable(doc, {
        startY: y,
        margin: { left: MM_MARGIN, right: MM_MARGIN },
        tableWidth: TABLE_WIDTH_MM,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 2,
            overflow: 'linebreak',
            valign: 'middle',
        },
        head: [tabela.head],
        body: tabela.body,
        foot: [tabela.foot],
        headStyles: {
            fillColor: [30, 77, 122],
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center',
        },
        footStyles: {
            fillColor: [232, 245, 255],
            textColor: [10, 93, 150],
            fontStyle: 'bold',
        },
        columnStyles: colStyles,
        didParseCell(data) {
            if (data.section === 'foot' && data.column.index === 0) {
                data.cell.styles.halign = 'left'
            }
        },
    })

    y = doc.lastAutoTable.finalY + 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(30, 49, 72)
    if (tabela.ativas.includes('totalCompra') || tabela.ativas.includes('totalCop')) {
        doc.text(`Total gasto: ${formatarValorOrcamento(tabela.totalGasto)}`, MM_MARGIN, y)
        y += 7
    }

    const aviso = montarAvisoForaDaCobertura(opts.linhas || [], opts.nomePlano)
    if (aviso) {
        if (y > 250) {
            doc.addPage()
            y = MM_MARGIN
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(140, 70, 10)
        const tituloLines = doc.splitTextToSize(aviso.titulo, TABLE_WIDTH_MM)
        doc.text(tituloLines, MM_MARGIN, y)
        y += tituloLines.length * 4.5 + 2
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        for (const item of aviso.itens) {
            if (y > 280) {
                doc.addPage()
                y = MM_MARGIN
            }
            const itemLines = doc.splitTextToSize(item.linha, TABLE_WIDTH_MM)
            doc.text(itemLines, MM_MARGIN, y)
            y += itemLines.length * 4 + 1
        }
        doc.setTextColor(0, 0, 0)
    }

    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i += 1) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(`Página ${i} de ${total}`, PAGE_W - MM_MARGIN, 290, { align: 'right' })
        doc.setTextColor(0, 0, 0)
    }

    return blobDeJsPdf(doc)
}

export function nomeArquivoOrcamentoPdf({ cidade, uf } = {}) {
    const stamp = new Date().toISOString().slice(0, 10)
    const local = sanitizarNomeArquivoPdf(
        [cidade, uf].filter(Boolean).join('-') || 'orcamento',
    )
    return `Orcamento Emerdog - ${local} - ${stamp}.pdf`
}

export async function baixarOrcamentoPdf(opts) {
    const blob = await gerarOrcamentoPdfBlob(opts)
    downloadPdf(blob, nomeArquivoOrcamentoPdf(opts))
    return blob
}
