import { rgb } from 'pdf-lib'
import { embedMontserratNoPdf } from '../impressaoPlanos/montserratPdfFonts.js'

/** Mesmas constantes de posição/estilo do PDF de planos (`gerarImpressaoPlanosPdf.js`). */
const MARGIN_X = 42
const FONT_SIZE_STAMP = 7
const COR_STAMP = rgb(0.72, 0.72, 0.72)
const GAP_CARIMBO = 12

export function formatarCarimboDataHora() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Lista de cidades selecionadas no gerador, separadas por vírgula. */
export function formatarCidadesContempladasRc(cidades = []) {
    const unicas = []
    const visto = new Set()
    for (const raw of cidades) {
        const nome = String(raw || '').trim()
        if (!nome) continue
        const chave = nome.toLocaleLowerCase('pt-BR')
        if (visto.has(chave)) continue
        visto.add(chave)
        unicas.push(nome)
    }
    unicas.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    return unicas.join(', ')
}

function encaixarTextoLargura(texto, font, size, larguraMax) {
    const bruto = String(texto || '').trim()
    if (!bruto || larguraMax <= 0) return ''
    if (font.widthOfTextAtSize(bruto, size) <= larguraMax) return bruto
    const sufixo = '…'
    let cortado = bruto
    while (cortado.length > 1 && font.widthOfTextAtSize(cortado + sufixo, size) > larguraMax) {
        cortado = cortado.slice(0, -1)
    }
    return cortado.length < bruto.length ? `${cortado}${sufixo}` : cortado
}

function desenharCarimboPagina(page, fonts, width, textoCidades) {
    const stamp = formatarCarimboDataHora()
    const font = fonts.regular
    const stampW = font.widthOfTextAtSize(stamp, FONT_SIZE_STAMP)
    const stampX = width - MARGIN_X - stampW
    const y = 24

    page.drawText(stamp, {
        x: stampX,
        y,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })

    const cidades = String(textoCidades || '').trim()
    if (!cidades) return

    const larguraDisponivel = Math.max(0, stampX - MARGIN_X - GAP_CARIMBO)
    const exibir = encaixarTextoLargura(cidades, font, FONT_SIZE_STAMP, larguraDisponivel)
    if (!exibir) return

    page.drawText(exibir, {
        x: MARGIN_X,
        y,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })
}

/**
 * Carimbo de emissão em todas as páginas do documento RC.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {{ cidades?: string[] }} [opcoes]
 */
export async function aplicarCarimboRcDocumento(pdfDoc, opcoes = {}) {
    const textoCidades = formatarCidadesContempladasRc(opcoes.cidades)
    const fonts = await embedMontserratNoPdf(pdfDoc)
    for (const page of pdfDoc.getPages()) {
        const { width } = page.getSize()
        desenharCarimboPagina(page, fonts, width, textoCidades)
    }
}
