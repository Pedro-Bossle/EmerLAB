import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getLinhas } from './linhasIndex.js'

const MM_MARGIN = 20
const PAGE_W = 210
const FOOTER_Y = 289

function slugArquivo(s) {
    return String(s || 'Contratada')
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80)
}

/** @param {'clinicas'|'volantes'|'parceria'} tipo */
export function nomeArquivoContrato(tipo, d) {
    const data = new Date().toISOString().slice(0, 10)
    if (tipo === 'clinicas') return `Contrato_Clinica_${slugArquivo(d.razaoSocial)}_${data}.pdf`
    if (tipo === 'volantes') {
        const base = d.docTipo === 'cnpj' ? d.razaoSocial : d.nomeCompleto
        return `Contrato_Volante_${slugArquivo(base)}_${data}.pdf`
    }
    return `Contrato_Parceria_${slugArquivo(d.razaoSocial)}_${data}.pdf`
}

function aplicarRodapePaginas(doc) {
    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i += 1) {
        doc.setPage(i)
        doc.setFont('times', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60, 60, 60)
        doc.text(`Página ${i} de ${total}`, PAGE_W / 2, FOOTER_Y, { align: 'center' })
        doc.setTextColor(0, 0, 0)
    }
}

function tabelaAssinaturas(doc, tipo, d, startY) {
    const margin = { left: MM_MARGIN, right: MM_MARGIN }
    if (tipo === 'parceria') {
        autoTable(doc, {
            startY: startY,
            margin,
            theme: 'plain',
            styles: { font: 'times', fontSize: 9, cellPadding: 3, valign: 'top' },
            head: [
                [
                    'EMERDOG PLANO DE SAÚDE ANIMAL LTDA\nRepresentante Legal – Assinatura',
                    `${d.razaoSocial}\nRepresentante Legal – Assinatura`,
                ],
            ],
            body: [
                ['\n\n\n\n', '\n\n\n\n'],
            ],
            headStyles: { fillColor: [248, 251, 253], textColor: [30, 49, 72], fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 80 } },
        })
        return
    }
    const colContratada = tipo === 'volantes' && d.docTipo !== 'cnpj' ? d.nomeCompleto : d.razaoSocial
    autoTable(doc, {
        startY: startY,
        margin,
        theme: 'plain',
        styles: { font: 'times', fontSize: 9, cellPadding: 3 },
        head: [['EMERDOG – Representante Legal', `${colContratada} – Representante Legal`]],
        body: [['\n\n\n\n', '\n\n\n\n']],
        headStyles: { fillColor: [248, 251, 253], textColor: [30, 49, 72], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 80 } },
    })
}

/**
 * @param {'clinicas'|'volantes'|'parceria'} tipo
 * @param {Record<string,string>} dados
 * @returns {Blob}
 */
export function gerarPdfBlob(tipo, dados) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const linhas = getLinhas(tipo, dados)

    let y = MM_MARGIN
    const maxY = 275

    for (const line of linhas) {
        const fontStyle = line.style === 'bold' ? 'bold' : line.style === 'italic' ? 'italic' : 'normal'
        doc.setFont('times', fontStyle)
        doc.setFontSize(line.size || 11)
        const x = MM_MARGIN + (line.indent || 0)
        const w = PAGE_W - MM_MARGIN - x
        const wrapped = doc.splitTextToSize(line.text, Math.max(40, w))
        const lineStep = ((line.size || 11) * 0.45) * 1.2

        for (let i = 0; i < wrapped.length; i += 1) {
            if (y > maxY) {
                doc.addPage()
                y = MM_MARGIN
            }
            doc.text(wrapped[i], x, y)
            y += lineStep
        }
        y += line.gap ?? 2
    }

    if (y > 240) {
        doc.addPage()
        y = MM_MARGIN
    }
    tabelaAssinaturas(doc, tipo, dados, y + 4)

    aplicarRodapePaginas(doc)
    return doc.output('blob')
}

export function downloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}
