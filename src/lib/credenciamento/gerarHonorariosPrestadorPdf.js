import { jsPDF } from 'jspdf'
import { OPCOES_JSPDF_A4 } from '../pdf/serializarPdf.js'
import autoTable from 'jspdf-autotable'
import { carregarLogoPdfEmerdog, sanitizarNomeArquivoPdf } from '../contratos/pdf/gerarContratoPdf.js'

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

function cidadeCabecalhoPdf(cidadeTabelaLabel) {
    let t = String(cidadeTabelaLabel || '').trim()
    if (!t) return ''
    t = t.replace(/^Supertabela\s*—\s*Cidades:\s*/i, '')
    t = t.replace(/\s*\(P\s*\/\s*M\s*\/\s*G\)\s*$/i, '').trim()
    const idx = t.indexOf(' · endereço:')
    if (idx >= 0) t = t.slice(0, idx).trim()
    return t
}

/**
 * @param {{ prestadorNome: string, prestadorId?: number|null, fonte: string, categorias: Array<{ nome: string, linhas: Array<{ checked: boolean, codigo: string, nome: string, P: string, M: string, G: string }> }> }} opts
 */
export async function gerarHonorariosPrestadorPdf(opts) {
    const doc = new jsPDF({ ...OPCOES_JSPDF_A4 })
    const logo = await carregarLogoPdfEmerdog()
    let y = MM_MARGIN

    const rightX = PAGE_W - MM_MARGIN
    const nome = String(opts.prestadorNome || 'Prestador').trim() || 'Prestador'
    const cidade = cidadeCabecalhoPdf(opts.cidadeTabelaLabel)

    doc.addImage(logo.dataUrl, 'PNG', MM_MARGIN, y, logo.w, logo.h)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    doc.text(`Gerado em: ${dataGeracaoPtBr()}`, rightX, y + logo.h * 0.45, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += logo.h + 6

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    const tituloHonorarios = `Honorários de Repasse - ${nome}`
    doc.text(tituloHonorarios, MM_MARGIN, y, { maxWidth: PAGE_W - MM_MARGIN * 2 })
    y += 7

    if (cidade) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        doc.text(cidade, MM_MARGIN, y)
        y += 8
    } else {
        y += 2
    }

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

export function nomeArquivoHonorariosRepasse(nomeBase) {
    const nome = sanitizarNomeArquivoPdf(String(nomeBase || '').trim() || 'Prestador')
    return `Honorários de Repasse - ${nome}.pdf`
}

export function downloadHonorariosPdf(blob, nomeBase) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomeArquivoHonorariosRepasse(nomeBase)
    a.click()
    URL.revokeObjectURL(url)
}
