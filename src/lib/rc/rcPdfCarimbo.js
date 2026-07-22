import { rgb } from 'pdf-lib'
import { embedMontserratNoPdf } from '../impressaoPlanos/montserratPdfFonts.js'
import { formatarCarimboDataHora } from '../pdf/formatarCarimboEmissao.js'

export { formatarCarimboDataHora }

/** Mesmas constantes de posição/estilo do PDF de planos (`gerarImpressaoPlanosPdf.js`). */
const MARGIN_X = 42
const FONT_SIZE_STAMP = 7
const COR_STAMP = rgb(0.72, 0.72, 0.72)
const GAP_CARIMBO = 12
const MAX_LINHAS_CIDADES = 2
const LINE_GAP = FONT_SIZE_STAMP + 2

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

/**
 * Quebra a lista de cidades em até `maxLinhas`, preferindo cortes após vírgula.
 * Se ainda não couber na última linha, aplica reticências.
 */
function quebrarCidadesEmLinhas(texto, font, size, larguraMax, maxLinhas = MAX_LINHAS_CIDADES) {
    const bruto = String(texto || '').trim()
    if (!bruto || larguraMax <= 0) return []
    if (font.widthOfTextAtSize(bruto, size) <= larguraMax) return [bruto]

    const partes = bruto.split(/,\s*/).filter(Boolean)
    if (!partes.length) return []

    const linhas = []
    let i = 0

    while (i < partes.length && linhas.length < maxLinhas) {
        const ehUltimaLinha = linhas.length === maxLinhas - 1
        let atual = ''

        while (i < partes.length) {
            const candidato = atual ? `${atual}, ${partes[i]}` : partes[i]
            if (font.widthOfTextAtSize(candidato, size) <= larguraMax) {
                atual = candidato
                i += 1
                continue
            }
            break
        }

        if (!atual) {
            atual = encaixarTextoLargura(partes[i], font, size, larguraMax)
            i += 1
        }

        if (ehUltimaLinha && i < partes.length) {
            const resto = [atual, ...partes.slice(i)].join(', ')
            atual = encaixarTextoLargura(resto, font, size, larguraMax)
            i = partes.length
        }

        if (atual) linhas.push(atual)
    }

    return linhas
}

function desenharCarimboPagina(page, fonts, width, textoCidades) {
    const stamp = formatarCarimboDataHora()
    const font = fonts.regular
    const stampW = font.widthOfTextAtSize(stamp, FONT_SIZE_STAMP)
    const stampX = width - MARGIN_X - stampW
    const yBase = 24

    page.drawText(stamp, {
        x: stampX,
        y: yBase,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })

    const cidades = String(textoCidades || '').trim()
    if (!cidades) return

    const larguraDisponivel = Math.max(0, stampX - MARGIN_X - GAP_CARIMBO)
    const linhas = quebrarCidadesEmLinhas(cidades, font, FONT_SIZE_STAMP, larguraDisponivel)
    if (!linhas.length) return

    linhas.forEach((linha, idx) => {
        const yLinha = yBase + (linhas.length - 1 - idx) * LINE_GAP
        page.drawText(linha, {
            x: MARGIN_X,
            y: yLinha,
            size: FONT_SIZE_STAMP,
            font,
            color: COR_STAMP,
        })
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
