import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { carregarLogoPdfEmerdog } from '../contratos/pdf/gerarContratoPdf.js'

const MM_MARGIN = 14
const PAGE_W = 210
/** Largura útil da tabela (A4 retrato, mm). */
const TABLE_WIDTH_MM = PAGE_W - MM_MARGIN * 2

function dataGeracaoPtBr() {
    return new Date().toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    })
}

function rotuloFonte(fonte, cidadeTabelaLabel) {
    if (fonte === 'negociacao') return 'Valores da negociação específica'
    if (fonte === 'repasses') {
        const tab = String(cidadeTabelaLabel || '').trim()
        return tab
            ? `Supertabela — Cidades: ${tab} (P / M / G)`
            : 'Supertabela — Cidades (P / M / G)'
    }
    return '—'
}

/**
 * @param {{ prestadorNome: string, prestadorId?: number|null, fonte: string, categorias: Array<{ nome: string, linhas: Array<{ checked: boolean, codigo: string, nome: string, P: string, M: string, G: string }> }> }} opts
 */
export async function gerarHonorariosPrestadorPdf(opts) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const logo = await carregarLogoPdfEmerdog()
    let y = MM_MARGIN

    doc.addImage(logo.dataUrl, 'PNG', (PAGE_W - logo.w) / 2, y, logo.w, logo.h)
    y += logo.h + 8

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Honorários — procedimentos', PAGE_W / 2, y, { align: 'center' })
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const nome = String(opts.prestadorNome || 'Prestador').trim() || 'Prestador'
    doc.text(nome, PAGE_W / 2, y, { align: 'center' })
    y += 5
    if (opts.prestadorId) {
        doc.setFontSize(9)
        doc.setTextColor(80, 80, 80)
        doc.text(`ID ${opts.prestadorId}`, PAGE_W / 2, y, { align: 'center' })
        doc.setTextColor(0, 0, 0)
        y += 5
    }
    doc.setFontSize(9)
    doc.text(`Gerado em: ${dataGeracaoPtBr()}`, PAGE_W / 2, y, { align: 'center' })
    y += 5
    doc.text(rotuloFonte(opts.fonte, opts.cidadeTabelaLabel), PAGE_W / 2, y, { align: 'center' })
    y += 8

    for (const cat of opts.categorias || []) {
        const linhas = (cat.linhas || []).filter((l) => l.checked !== false)
        if (!linhas.length) continue

        if (y > 250) {
            doc.addPage()
            y = MM_MARGIN
        }

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text(String(cat.nome || 'Categoria'), MM_MARGIN, y)
        y += 6

        const wCheck = 10
        const wCodigo = 26
        const wPorte = 17
        const wNome = TABLE_WIDTH_MM - wCheck - wCodigo - wPorte * 3

        autoTable(doc, {
            startY: y,
            margin: { left: MM_MARGIN, right: MM_MARGIN },
            tableWidth: TABLE_WIDTH_MM,
            theme: 'grid',
            styles: {
                font: 'helvetica',
                fontSize: 7,
                cellPadding: 1.5,
                overflow: 'linebreak',
            },
            head: [['✓', 'Código', 'Nome', 'P', 'M', 'G']],
            body: linhas.map((l) => [
                l.checked ? '✓' : '',
                String(l.codigo || ''),
                String(l.nome || ''),
                String(l.P ?? '—'),
                String(l.M ?? '—'),
                String(l.G ?? '—'),
            ]),
            headStyles: { fillColor: [30, 77, 122], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: wCheck, halign: 'center' },
                1: { cellWidth: wCodigo },
                2: { cellWidth: Math.max(40, wNome) },
                3: { cellWidth: wPorte, halign: 'right' },
                4: { cellWidth: wPorte, halign: 'right' },
                5: { cellWidth: wPorte, halign: 'right' },
            },
        })
        y = doc.lastAutoTable.finalY + 8
    }

    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i += 1) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(`Página ${i} de ${total}`, PAGE_W - MM_MARGIN, 290, { align: 'right' })
        doc.setTextColor(0, 0, 0)
    }

    return doc.output('blob')
}

export function downloadHonorariosPdf(blob, nomeBase) {
    const slug = String(nomeBase || 'honorarios')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 60)
    const data = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Honorarios_${slug || 'prestador'}_${data}.pdf`
    a.click()
    URL.revokeObjectURL(url)
}
