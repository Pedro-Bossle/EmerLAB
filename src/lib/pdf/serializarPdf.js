/**
 * Serialização de PDFs com opções que reduzem tamanho no cliente (pdf-lib / jsPDF).
 * Não substitui compressão agressiva (ex.: Ghostscript); o maior peso costuma ser
 * o PDF-molde copiado página a página e fontes embutidas.
 */

/** @param {import('pdf-lib').PDFDocument} pdfDoc */
export async function bytesDePdfLib(pdfDoc) {
    return pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
    })
}

/** @param {import('pdf-lib').PDFDocument} pdfDoc */
export async function blobDePdfLib(pdfDoc) {
    const bytes = await bytesDePdfLib(pdfDoc)
    return new Blob([bytes], { type: 'application/pdf' })
}

/** A4 retrato com compressão de streams (jsPDF). */
export const OPCOES_JSPDF_A4 = Object.freeze({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
    compress: true,
})

/** @param {import('jspdf').jsPDF} doc */
export function blobDeJsPdf(doc) {
    return doc.output('blob')
}
