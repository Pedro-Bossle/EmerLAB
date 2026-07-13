import { PDFDocument, rgb } from 'pdf-lib'
import { embedMontserratNoPdf } from '../impressaoPlanos/montserratPdfFonts.js'
import { formatarCarimboDataHora } from '../pdf/formatarCarimboEmissao.js'
import urlEstetoscopioSvg from '../../assets/planos/estetoscopio.svg?url'
import urlHonorariosPdf from '../../assets/honorarios/honorarios.pdf?url'

const ICON_CAB_SIZE_PT = 10
const ICON_CAB_GAP_PT = 4
const ICON_RASTER_PX = 64

const TEMPLATE_PAGE_INDEX = 1
const COVER_INDEX = 0
const OBS_INDEX = 2

const MARGIN_X = 42
const MARGIN_TOP = 86
const MARGIN_BOTTOM = 58
const SECTION_GAP = 16
const CARD_RADIUS = 8
const TITLE_BAR_HEIGHT = 32
const TABLE_HEADER_HEIGHT = 26
const ROW_BASE_HEIGHT = 26
const LINE_LEADING = 11
const FONT_SIZE_BODY = 9
const FONT_SIZE_HEADER = 9
const FONT_SIZE_TITLE_PREFIX = 10
const FONT_SIZE_TITLE_CAT = 10
const FONT_SIZE_STAMP = 7
const GAP_CARIMBO = 12

const COR_NAVY = rgb(22 / 255, 33 / 255, 62 / 255)
const COR_TEXTO = rgb(58 / 255, 63 / 255, 75 / 255)
const COR_BRANCO = rgb(1, 1, 1)
const COR_ZEBRA = rgb(247 / 255, 248 / 255, 250 / 255)
const COR_BORDA = rgb(229 / 255, 230 / 255, 234 / 255)
const COR_STAMP = rgb(0.72, 0.72, 0.72)

/** Nome | Porte P | Porte M | Porte G */
const COL_FRAC = [0.46, 0.18, 0.18, 0.18]

function fontCorpo(fonts) {
    return fonts.light || fonts.regular
}

function sanitizarTextoPdf(texto) {
    return String(texto ?? '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .trim()
}

function formatarValorPorte(valor) {
    if (valor === '' || valor == null) return '—'
    const n = Number(valor)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function quebrarTexto(texto, font, size, larguraMax) {
    const bruto = sanitizarTextoPdf(texto) || '—'
    const palavras = bruto.split(/\s+/).filter(Boolean)
    if (!palavras.length) return ['—']
    const linhas = []
    let atual = ''
    for (const palavra of palavras) {
        const teste = atual ? `${atual} ${palavra}` : palavra
        if (font.widthOfTextAtSize(teste, size) <= larguraMax) {
            atual = teste
        } else {
            if (atual) linhas.push(atual)
            atual = palavra
        }
    }
    if (atual) linhas.push(atual)
    return linhas
}

function textoCentralizado(xCol, colW, texto, font, size) {
    const t = sanitizarTextoPdf(texto) || '—'
    const w = font.widthOfTextAtSize(t, size)
    return xCol + Math.max(2, (colW - w) / 2)
}

function colunasLayout(width) {
    const innerW = width - MARGIN_X * 2
    const widths = COL_FRAC.map((f) => innerW * f)
    const xs = [MARGIN_X]
    for (let i = 0; i < widths.length - 1; i += 1) {
        xs.push(xs[i] + widths[i])
    }
    return { innerW, widths, xs }
}

function medirAlturaLinha(linha, fonts, colNomeW) {
    const corpo = fontCorpo(fonts)
    const linhasNome = quebrarTexto(linha.nome, corpo, FONT_SIZE_BODY, colNomeW - 12)
    let h = ROW_BASE_HEIGHT
    if (linhasNome.length > 1) h += (linhasNome.length - 1) * LINE_LEADING
    return Math.max(ROW_BASE_HEIGHT, h)
}

/**
 * @param {Array<{ categoriaNome?: string, nome?: string, linhas: object[] }>} secoes
 */
function montarSecoesImpressao(secoes) {
    const saida = []
    for (const secao of secoes || []) {
        const linhas = (secao.linhas || [])
            .filter((l) => l.checked !== false)
            .map((l) => ({
                codigo: sanitizarTextoPdf(l.codigo) || '',
                nome: sanitizarTextoPdf(l.procedimento ?? l.nome) || '—',
                P: formatarValorPorte(l.porteP ?? l.P),
                M: formatarValorPorte(l.porteM ?? l.M),
                G: formatarValorPorte(l.porteG ?? l.G),
            }))
            .filter((l) => l.nome && l.nome !== '—')
        if (!linhas.length) continue
        saida.push({
            nome: String(secao.categoriaNome || secao.nome || 'Categoria'),
            linhas,
        })
    }
    return saida
}

async function carregarSvgComoPngBytes(urlSvg, sizePx = ICON_RASTER_PX) {
    const resposta = await fetch(urlSvg)
    if (!resposta.ok) throw new Error('Não foi possível carregar o ícone estetoscópio.')
    const svgText = await resposta.text()
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image()
            el.onload = () => resolve(el)
            el.onerror = () => reject(new Error('Falha ao decodificar estetoscopio.svg'))
            el.src = objectUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = sizePx
        canvas.height = sizePx
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas indisponível para rasterizar o ícone.')
        ctx.clearRect(0, 0, sizePx, sizePx)
        ctx.drawImage(img, 0, 0, sizePx, sizePx)
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1] || ''
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        return bytes
    } finally {
        URL.revokeObjectURL(objectUrl)
    }
}

function desenharIconeEstetoscopio(page, iconePng, x, textY) {
    if (!iconePng) return
    const size = ICON_CAB_SIZE_PT
    page.drawImage(iconePng, {
        x,
        y: textY - 1,
        width: size,
        height: size,
    })
}

function desenharBarraTituloSecao(page, fonts, x, yTop, innerW, nomeCategoria) {
    const y = yTop - TITLE_BAR_HEIGHT
    page.drawRectangle({
        x,
        y,
        width: innerW,
        height: TITLE_BAR_HEIGHT,
        color: COR_NAVY,
        borderRadius: CARD_RADIUS,
    })
    page.drawRectangle({
        x,
        y,
        width: innerW,
        height: TITLE_BAR_HEIGHT / 2,
        color: COR_NAVY,
    })

    const baseY = y + 10
    const prefix = '| Procedimentos: '
    page.drawText(prefix, {
        x: x + 14,
        y: baseY,
        size: FONT_SIZE_TITLE_PREFIX,
        font: fonts.regular,
        color: COR_BRANCO,
    })
    const prefixW = fonts.regular.widthOfTextAtSize(prefix, FONT_SIZE_TITLE_PREFIX)
    const catNome = sanitizarTextoPdf(nomeCategoria) || 'Categoria'
    const linhasCat = quebrarTexto(
        catNome,
        fonts.bold,
        FONT_SIZE_TITLE_CAT,
        innerW - 28 - prefixW,
    )
    page.drawText(linhasCat[0], {
        x: x + 14 + prefixW,
        y: baseY,
        size: FONT_SIZE_TITLE_CAT,
        font: fonts.bold,
        color: COR_BRANCO,
    })
}

function desenharCabecalhoTabela(page, fonts, layout, yTop, iconeEstetoscopio) {
    const { xs, widths, innerW } = layout
    const y = yTop - TABLE_HEADER_HEIGHT

    page.drawRectangle({
        x: MARGIN_X,
        y,
        width: innerW,
        height: TABLE_HEADER_HEIGHT,
        color: COR_BRANCO,
    })

    const textY = y + 8
    const labels = ['Nome', 'Porte P', 'Porte M', 'Porte G']
    labels.forEach((label, idx) => {
        const colX = xs[idx]
        const colW = widths[idx]
        if (idx === 0) {
            const iconX = colX + 6
            desenharIconeEstetoscopio(page, iconeEstetoscopio, iconX, textY)
            page.drawText(label, {
                x: iconX + ICON_CAB_SIZE_PT + ICON_CAB_GAP_PT,
                y: textY,
                size: FONT_SIZE_HEADER,
                font: fonts.bold,
                color: COR_NAVY,
            })
        } else {
            page.drawText(label, {
                x: textoCentralizado(colX, colW, label, fonts.bold, FONT_SIZE_HEADER),
                y: textY,
                size: FONT_SIZE_HEADER,
                font: fonts.bold,
                color: COR_NAVY,
            })
        }
    })

    page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + innerW, y },
        thickness: 0.5,
        color: COR_BORDA,
    })

    return y
}

function yPrimeiraLinhaBloco(yTop, yBottom, numLinhas, fontSize) {
    const h = yTop - yBottom
    const blockH = (Math.max(1, numLinhas) - 1) * LINE_LEADING + fontSize
    return yBottom + (h + blockH) / 2 - fontSize
}

function desenharLinhaDados(page, fonts, layout, yTop, linha, indiceZebra) {
    const { xs, widths } = layout
    const corpo = fontCorpo(fonts)
    const h = medirAlturaLinha(linha, fonts, widths[0])
    const yBottom = yTop - h
    const fundo = indiceZebra % 2 === 1 ? COR_ZEBRA : COR_BRANCO

    page.drawRectangle({
        x: MARGIN_X,
        y: yBottom,
        width: layout.innerW,
        height: h,
        color: fundo,
    })

    const linhasNome = quebrarTexto(linha.nome, corpo, FONT_SIZE_BODY, widths[0] - 12)
    const yNome = yPrimeiraLinhaBloco(yTop, yBottom, linhasNome.length, FONT_SIZE_BODY)
    linhasNome.forEach((ln, i) => {
        page.drawText(ln, {
            x: xs[0] + 10,
            y: yNome - i * LINE_LEADING,
            size: FONT_SIZE_BODY,
            font: corpo,
            color: COR_TEXTO,
        })
    })

    const yCelulaSimples = yPrimeiraLinhaBloco(yTop, yBottom, 1, FONT_SIZE_BODY)
    ;[linha.P, linha.M, linha.G].forEach((val, i) => {
        const idx = i + 1
        const texto = sanitizarTextoPdf(val) || '—'
        page.drawText(texto, {
            x: textoCentralizado(xs[idx], widths[idx], texto, corpo, FONT_SIZE_BODY),
            y: yCelulaSimples,
            size: FONT_SIZE_BODY,
            font: corpo,
            color: COR_TEXTO,
        })
    })

    page.drawLine({
        start: { x: MARGIN_X, y: yBottom },
        end: { x: MARGIN_X + layout.innerW, y: yBottom },
        thickness: 0.4,
        color: COR_BORDA,
    })

    return { yBottom, h }
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

function desenharCarimboPagina(page, fonts, width, cidadeNome) {
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

    const cidade = sanitizarTextoPdf(cidadeNome)
    if (!cidade) return

    const larguraDisponivel = Math.max(0, stampX - MARGIN_X - GAP_CARIMBO)
    const exibir = encaixarTextoLargura(cidade, font, FONT_SIZE_STAMP, larguraDisponivel)
    if (!exibir) return

    page.drawText(exibir, {
        x: MARGIN_X,
        y,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })
}

function renderizarUmaPagina(page, fonts, width, height, secoes, cursor, iconeEstetoscopio) {
    const layout = colunasLayout(width)
    let y = height - MARGIN_TOP
    let { secaoIdx, linhaIdx, zebra } = cursor
    const secaoIdxInicial = secaoIdx
    const linhaIdxInicial = linhaIdx
    let desenhouAlgoNestaPagina = false

    while (secaoIdx < secoes.length) {
        const secao = secoes[secaoIdx]
        const linhas = secao.linhas
        if (linhaIdx >= linhas.length) {
            secaoIdx += 1
            linhaIdx = 0
            continue
        }

        const ehContinuacaoNaPrimeiraSecaoDaPagina =
            secaoIdx === secaoIdxInicial && linhaIdxInicial > 0 && !desenhouAlgoNestaPagina
        const desenharTituloCategoria = linhaIdx === 0 || ehContinuacaoNaPrimeiraSecaoDaPagina

        const overhead =
            (desenharTituloCategoria ? SECTION_GAP + TITLE_BAR_HEIGHT : 0) + TABLE_HEADER_HEIGHT
        const alturaPrimeiraLinha = medirAlturaLinha(linhas[linhaIdx], fonts, layout.widths[0])

        if (y - overhead < MARGIN_BOTTOM + alturaPrimeiraLinha) {
            return { secaoIdx, linhaIdx, zebra, done: false }
        }

        const cardTop = y - (desenharTituloCategoria ? SECTION_GAP : 0)
        const corpoTop = desenharTituloCategoria ? cardTop - TITLE_BAR_HEIGHT : cardTop

        let yCardBottom = corpoTop - TABLE_HEADER_HEIGHT
        {
            let yProbe = yCardBottom
            let iProbe = linhaIdx
            while (iProbe < linhas.length) {
                const hProbe = medirAlturaLinha(linhas[iProbe], fonts, layout.widths[0])
                if (yProbe - hProbe < MARGIN_BOTTOM) break
                yProbe -= hProbe
                iProbe += 1
            }
            yCardBottom = yProbe
        }

        const topFundo = desenharTituloCategoria ? cardTop : corpoTop
        {
            const cardH = topFundo - yCardBottom
            if (cardH > 0) {
                page.drawRectangle({
                    x: MARGIN_X,
                    y: yCardBottom,
                    width: layout.innerW,
                    height: cardH,
                    color: COR_BRANCO,
                    borderRadius: CARD_RADIUS,
                })
            }
        }
        if (desenharTituloCategoria) {
            desenharBarraTituloSecao(page, fonts, MARGIN_X, cardTop, layout.innerW, secao.nome)
        }

        let yCursor = desenharCabecalhoTabela(page, fonts, layout, corpoTop, iconeEstetoscopio)
        desenhouAlgoNestaPagina = true

        while (linhaIdx < linhas.length) {
            const linha = linhas[linhaIdx]
            const h = medirAlturaLinha(linha, fonts, layout.widths[0])
            if (yCursor - h < MARGIN_BOTTOM) {
                return { secaoIdx, linhaIdx, zebra, done: false }
            }
            const { yBottom } = desenharLinhaDados(page, fonts, layout, yCursor, linha, zebra)
            yCursor = yBottom
            zebra += 1
            linhaIdx += 1
        }

        secaoIdx += 1
        linhaIdx = 0
        y = yCursor - SECTION_GAP
    }

    return { secaoIdx, linhaIdx: 0, zebra, done: true }
}

/**
 * @param {{ secoes: object[], cidadeNome?: string, pdfUrl?: string }} opts
 */
export async function gerarImpressaoHonorariosPdf(opts) {
    const pdfUrl = opts.pdfUrl || urlHonorariosPdf
    const resposta = await fetch(pdfUrl)
    if (!resposta.ok) throw new Error('Não foi possível carregar o PDF base de honorários.')
    const templateBytes = await resposta.arrayBuffer()
    const templateDoc = await PDFDocument.load(templateBytes)
    if (templateDoc.getPageCount() < 3) {
        throw new Error('O PDF base de honorários deve conter 3 páginas (capa, listagem, observações).')
    }

    const secoes = montarSecoesImpressao(opts.secoes)
    if (!secoes.length) {
        throw new Error('Selecione ao menos um procedimento para imprimir.')
    }

    const refPage = templateDoc.getPage(TEMPLATE_PAGE_INDEX)
    const { width, height } = refPage.getSize()
    const cidadeNome = String(opts.cidadeNome || '').trim()

    const finalDoc = await PDFDocument.create()
    const fonts = await embedMontserratNoPdf(finalDoc)
    const iconPngBytes = await carregarSvgComoPngBytes(urlEstetoscopioSvg)
    const iconeEstetoscopio = await finalDoc.embedPng(iconPngBytes)

    const [capa] = await finalDoc.copyPages(templateDoc, [COVER_INDEX])
    finalDoc.addPage(capa)

    let cursor = { secaoIdx: 0, linhaIdx: 0, zebra: 0, done: false }
    let guard = 0
    const maxPaginas = Math.max(30, secoes.reduce((n, s) => n + s.linhas.length, 0) + 4)

    while (!cursor.done && guard < maxPaginas) {
        guard += 1
        const antes = `${cursor.secaoIdx}-${cursor.linhaIdx}`
        const [tpl] = await finalDoc.copyPages(templateDoc, [TEMPLATE_PAGE_INDEX])
        const page = finalDoc.addPage(tpl)
        cursor = renderizarUmaPagina(page, fonts, width, height, secoes, cursor, iconeEstetoscopio)
        desenharCarimboPagina(page, fonts, width, cidadeNome)
        const depois = `${cursor.secaoIdx}-${cursor.linhaIdx}`
        if (!cursor.done && depois === antes) {
            cursor.linhaIdx += 1
        }
    }

    // Última página (observações): sem carimbo.
    const [obs] = await finalDoc.copyPages(templateDoc, [OBS_INDEX])
    finalDoc.addPage(obs)

    return new Blob([await finalDoc.save()], { type: 'application/pdf' })
}

export function downloadImpressaoHonorariosPdf(blob, cidadeNome) {
    const limpar = (s) =>
        String(s || '')
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    const cidade = limpar(cidadeNome)
    const nome = cidade ? `Honorários - ${cidade}.pdf` : 'Honorários.pdf'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
}
