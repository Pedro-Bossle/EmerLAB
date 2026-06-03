import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoAzulUrl from '../../../assets/logo_azul_escuro.png'
import { getLinhas } from './linhasIndex.js'
import { textoLinha } from './linhasUtil.js'

const MM_MARGIN = 20
const PAGE_W = 210
const FOOTER_Y = 289
const LOGO_W_MM = 52

let logoCache = null

export async function carregarLogoPdfEmerdog() {
    if (logoCache) return logoCache
    const res = await fetch(logoAzulUrl)
    if (!res.ok) {
        throw new Error(`Não foi possível carregar a logo do PDF (${res.status}).`)
    }
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
    const dims = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 400, h: 120 })
        img.src = dataUrl
    })
    const logoH = (LOGO_W_MM * dims.h) / dims.w
    logoCache = { dataUrl, w: LOGO_W_MM, h: logoH }
    return logoCache
}

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
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60, 60, 60)
        doc.text(`Página ${i} de ${total}`, PAGE_W / 2, FOOTER_Y, { align: 'center' })
        doc.setTextColor(0, 0, 0)
    }
}

function tabelaAssinaturas(doc, tipo, d, startY) {
    const margin = { left: MM_MARGIN, right: MM_MARGIN }
    const tableWidth = PAGE_W - MM_MARGIN * 2
    const half = tableWidth / 2
    const headAssinatura = { fillColor: [248, 251, 253], textColor: [30, 49, 72], fontStyle: 'bold' }
    const colStylesDuas = {
        0: { cellWidth: half, overflow: 'linebreak' },
        1: { cellWidth: half, overflow: 'linebreak' },
    }
    if (tipo === 'parceria') {
        autoTable(doc, {
            startY: startY,
            margin,
            tableWidth,
            theme: 'plain',
            styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, valign: 'top', overflow: 'linebreak' },
            head: [
                [
                    'EMERDOG PLANO DE SAÚDE ANIMAL LTDA\nRepresentante Legal – Assinatura',
                    `${d.razaoSocial}\nRepresentante Legal – Assinatura`,
                ],
            ],
            body: [['\n\n\n\n', '\n\n\n\n']],
            headStyles: headAssinatura,
            columnStyles: colStylesDuas,
        })
        return
    }
    const colContratada = tipo === 'volantes' && d.docTipo !== 'cnpj' ? d.nomeCompleto : d.razaoSocial
    autoTable(doc, {
        startY: startY,
        margin,
        tableWidth,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
        head: [['EMERDOG – Representante Legal', `${colContratada} – Representante Legal`]],
        body: [['\n\n\n\n', '\n\n\n\n']],
        headStyles: headAssinatura,
        columnStyles: colStylesDuas,
    })
}

function larguraTexto(doc, line) {
    const x = MM_MARGIN + (line.indent || 0)
    return PAGE_W - MM_MARGIN - x
}

function tokenizarSegmentos(segments) {
    const tokens = []
    for (const seg of segments) {
        const parts = String(seg.t).split(/(\s+)/)
        for (const p of parts) {
            if (p === '') continue
            tokens.push({ w: p, bold: !!seg.bold })
        }
    }
    return tokens
}

function quebrarTokensEmLinhas(doc, tokens, maxWidth, size) {
    const linhas = []
    let atual = []
    let largura = 0
    for (const tok of tokens) {
        doc.setFont('helvetica', tok.bold ? 'bold' : 'normal')
        doc.setFontSize(size)
        const tw = doc.getTextWidth(tok.w)
        if (atual.length > 0 && largura + tw > maxWidth) {
            linhas.push(atual)
            atual = []
            largura = 0
        }
        atual.push(tok)
        largura += tw
    }
    if (atual.length) linhas.push(atual)
    return linhas
}

function desenharLinhaTokens(doc, tokens, x, y, size) {
    let curX = x
    for (const tok of tokens) {
        doc.setFont('helvetica', tok.bold ? 'bold' : 'normal')
        doc.setFontSize(size)
        doc.text(tok.w, curX, y)
        curX += doc.getTextWidth(tok.w)
    }
}

/** Altura em mm ocupada pelas linhas de segmentos (com quebra). */
function desenharSegmentosQuebrados(doc, line, yInicio, maxY) {
    const size = line.size || 11
    const lineStep = (size * 0.45) * 1.2
    const x0 = MM_MARGIN + (line.indent || 0)
    const w = larguraTexto(doc, line)
    const tokens = tokenizarSegmentos(line.segments)
    const linhas = quebrarTokensEmLinhas(doc, tokens, w, size)
    let y = yInicio
    for (const row of linhas) {
        if (y > maxY) {
            doc.addPage()
            y = MM_MARGIN
        }
        desenharLinhaTokens(doc, row, x0, y, size)
        y += lineStep
    }
    return { yFinal: y, altura: y - yInicio }
}

/**

 * @param {'clinicas'|'volantes'|'parceria'} tipo
 * @param {Record<string,string>} dados
 * @returns {Promise<Blob>}
 */
export async function gerarPdfBlob(tipo, dados) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const linhas = getLinhas(tipo, dados)
    const logo = await carregarLogoPdfEmerdog()

    let y = MM_MARGIN
    const maxY = 275

    doc.addImage(logo.dataUrl, 'PNG', (PAGE_W - logo.w) / 2, y, logo.w, logo.h)
    y += logo.h + 10

    for (const line of linhas) {
        const size = line.size || 11
        const lineStep = (size * 0.45) * 1.2
        const x = MM_MARGIN + (line.indent || 0)
        const w = larguraTexto(doc, line)

        if (line.segments?.length) {
            const { yFinal } = desenharSegmentosQuebrados(doc, line, y, maxY)
            y = yFinal
            y += line.gap ?? 2
            continue
        }

        const fontStyle = line.style === 'bold' ? 'bold' : line.style === 'italic' ? 'italic' : 'normal'
        doc.setFont('helvetica', fontStyle)
        doc.setFontSize(size)
        const align = line.align === 'justify' ? 'justify' : line.align === 'center' ? 'center' : 'left'
        let wrapped = doc.splitTextToSize(line.text, Math.max(40, w))

        if (align === 'center') {
            if (y > maxY) {
                doc.addPage()
                y = MM_MARGIN
            }
            doc.text(wrapped, PAGE_W / 2, y, { align: 'center' })
            y += wrapped.length * lineStep
            y += line.gap ?? 2
            continue
        }

        for (let i = 0; i < wrapped.length; i += 1) {
            if (y > maxY) {
                doc.addPage()
                y = MM_MARGIN
            }
            if (align === 'justify' && wrapped.length === 1) {
                doc.text(wrapped[i], x, y, { align: 'justify', maxWidth: w })
            } else {
                doc.text(wrapped[i], x, y)
            }
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
