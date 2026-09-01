import { PDFDocument, rgb } from 'pdf-lib'
import { blobDePdfLib } from '../pdf/serializarPdf.js'
import { embedMontserratNoPdf } from '../impressaoPlanos/montserratPdfFonts.js'
import { formatarCarimboDataHora } from '../pdf/formatarCarimboEmissao.js'
import { nomeGrupoBeneficioVisivel } from '../credenciamento/prestadorBeneficios.js'
import urlEstetoscopioSvg from '../../assets/planos/estetoscopio.svg?url'
import urlDescontosPdf from '../../assets/honorarios/Descontos.pdf?url'

const ICON_CAB_SIZE_PT = 10
const ICON_CAB_GAP_PT = 4
const ICON_RASTER_PX = 64

const MARGIN_X = 42
const MARGIN_TOP = 86
const MARGIN_BOTTOM = 58
const SECTION_GAP = 16
const CARD_RADIUS = 8
const TITLE_BAR_HEIGHT = 32
const TABLE_HEADER_HEIGHT = 26
const ROW_BASE_HEIGHT = 36
const LINE_LEADING = 11
const FONT_SIZE_BODY = 9
const FONT_SIZE_SUB = 7.5
const FONT_SIZE_HEADER = 9
const FONT_SIZE_TITLE = 10
const FONT_SIZE_INFO = 10
const FONT_SIZE_STAMP = 7
const GAP_CARIMBO = 12
const OBS_PADDING = 12
const INFO_SEP_GAP = 14
const INFO_TITLE_GAP = 12
const INFO_MIN_BODY = 48

const COR_NAVY = rgb(22 / 255, 33 / 255, 62 / 255)
const COR_TEXTO = rgb(58 / 255, 63 / 255, 75 / 255)
const COR_TEXTO_SUB = rgb(120 / 255, 125 / 255, 135 / 255)
const COR_BRANCO = rgb(1, 1, 1)
const COR_ZEBRA = rgb(247 / 255, 248 / 255, 250 / 255)
const COR_BORDA = rgb(229 / 255, 230 / 255, 234 / 255)
const COR_SEP = rgb(170 / 255, 200 / 255, 220 / 255)
const COR_STAMP = rgb(0.72, 0.72, 0.72)

/** Serviço | Porcentagem */
const COL_FRAC = [0.72, 0.28]

function fontCorpo(fonts) {
    return fonts.light || fonts.regular
}

function sanitizarTextoPdf(texto) {
    return String(texto ?? '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .trim()
}

/** Sanitiza OBS mantendo quebras de linha do textarea. */
function sanitizarObservacoesPdf(texto) {
    return String(texto ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ +\n/g, '\n')
        .replace(/\n +/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
}

function formatarPercentual(valor) {
    const n = Number(valor)
    if (!Number.isFinite(n)) return '—'
    const texto = Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
    return `${texto}%`
}

function formatarFaixaNaLinha(item) {
    const min = Number(item.percentual)
    const maxRaw = item.percentualMax ?? item.percentual_max
    const max = maxRaw == null || maxRaw === '' ? min : Number(maxRaw)
    if (!Number.isFinite(min)) return '—'
    if (!Number.isFinite(max) || max === min) return formatarPercentual(min)
    const a = formatarPercentual(Math.min(min, max)).replace('%', '')
    const b = formatarPercentual(Math.max(min, max))
    return `${a}% à ${b}`
}

function quebrarTexto(texto, font, size, larguraMax) {
    const bruto = sanitizarTextoPdf(texto)
    if (!bruto) return []
    const palavras = bruto.split(/\s+/).filter(Boolean)
    if (!palavras.length) return []
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

/** Quebra por largura respeitando Enter do campo OBS (linhas vazias = parágrafo). */
function quebrarTextoObservacoes(texto, font, size, larguraMax) {
    const bruto = sanitizarObservacoesPdf(texto)
    if (!bruto) return []
    const paragrafos = bruto.split('\n')
    const linhas = []
    for (const paragrafo of paragrafos) {
        const trecho = String(paragrafo || '').trimEnd()
        if (!trecho) {
            linhas.push('')
            continue
        }
        const palavras = trecho.split(/\s+/).filter(Boolean)
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
    }
    while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop()
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

function montarLinhasImpressao(itens = []) {
    return (itens || [])
        .filter((i) => i.incluir !== false)
        .map((i) => ({
            titulo: sanitizarTextoPdf(nomeGrupoBeneficioVisivel(i.grupoNome || i.grupo_nome)) || 'Grupo',
            subtitulo: sanitizarTextoPdf(i.nome || i.tipoNome) || '—',
            percentual: formatarFaixaNaLinha(i),
        }))
}

function medirAlturaLinha(linha, fonts, colServicoW) {
    const corpo = fontCorpo(fonts)
    const linhasTitulo = quebrarTexto(linha.titulo, corpo, FONT_SIZE_BODY, colServicoW - 12)
    const linhasSub = quebrarTexto(linha.subtitulo, fonts.regular, FONT_SIZE_SUB, colServicoW - 12)
    const hTexto =
        Math.max(1, linhasTitulo.length) * LINE_LEADING +
        Math.max(1, linhasSub.length) * (LINE_LEADING - 1) +
        10
    return Math.max(ROW_BASE_HEIGHT, hTexto)
}

/** Barra navy: «| Grupo de» + «Descontos» em negrito */
function desenharBarraTituloGrupo(page, fonts, x, yTop, innerW) {
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
    const prefix = '| Grupo de '
    page.drawText(prefix, {
        x: x + 14,
        y: y + 10,
        size: FONT_SIZE_TITLE,
        font: fonts.regular,
        color: COR_BRANCO,
    })
    const prefixW = fonts.regular.widthOfTextAtSize(prefix, FONT_SIZE_TITLE)
    page.drawText('Descontos', {
        x: x + 14 + prefixW,
        y: y + 10,
        size: FONT_SIZE_TITLE,
        font: fonts.bold,
        color: COR_BRANCO,
    })
}

function medirBlocoInformacoes(texto, fonts, innerW) {
    const corpo = fontCorpo(fonts)
    const linhas = quebrarTextoObservacoes(texto, corpo, FONT_SIZE_BODY, innerW - OBS_PADDING * 2)
    const hTexto = Math.max(INFO_MIN_BODY, Math.max(1, linhas.length) * LINE_LEADING + 8)
    return INFO_SEP_GAP + 1 + INFO_TITLE_GAP + FONT_SIZE_INFO + INFO_TITLE_GAP + hTexto + OBS_PADDING
}

/** Fundo branco contínuo do card (linhas + Informações). */
function desenharFundoCardBranco(page, yTop, yBottom, innerW) {
    const h = yTop - yBottom
    if (h <= 0) return
    page.drawRectangle({
        x: MARGIN_X,
        y: yBottom,
        width: innerW,
        height: h,
        color: COR_BRANCO,
        borderRadius: CARD_RADIUS,
    })
}

/**
 * Dentro do campo branco: separador, «Informações» e texto das OBS.
 * Não desenha fundo próprio — usa o card branco contínuo.
 */
function desenharInformacoes(page, fonts, layout, yTop, texto) {
    const { innerW } = layout
    const corpo = fontCorpo(fonts)
    const linhas = quebrarTextoObservacoes(texto, corpo, FONT_SIZE_BODY, innerW - OBS_PADDING * 2)
    const hTexto = Math.max(INFO_MIN_BODY, Math.max(1, linhas.length) * LINE_LEADING + 8)
    const cardH = INFO_SEP_GAP + 1 + INFO_TITLE_GAP + FONT_SIZE_INFO + INFO_TITLE_GAP + hTexto + OBS_PADDING
    const yBottom = yTop - cardH

    const sepW = Math.min(120, innerW * 0.28)
    const sepY = yTop - INFO_SEP_GAP
    page.drawLine({
        start: { x: MARGIN_X + (innerW - sepW) / 2, y: sepY },
        end: { x: MARGIN_X + (innerW + sepW) / 2, y: sepY },
        thickness: 1.2,
        color: COR_SEP,
    })

    const titulo = 'Informações'
    const titW = fonts.bold.widthOfTextAtSize(titulo, FONT_SIZE_INFO)
    const titY = sepY - INFO_TITLE_GAP - FONT_SIZE_INFO
    page.drawText(titulo, {
        x: MARGIN_X + (innerW - titW) / 2,
        y: titY,
        size: FONT_SIZE_INFO,
        font: fonts.bold,
        color: COR_NAVY,
    })

    let yTxt = titY - INFO_TITLE_GAP - FONT_SIZE_BODY
    if (linhas.length) {
        linhas.forEach((ln, i) => {
            if (ln) {
                page.drawText(ln, {
                    x: MARGIN_X + OBS_PADDING,
                    y: yTxt - i * LINE_LEADING,
                    size: FONT_SIZE_BODY,
                    font: corpo,
                    color: COR_TEXTO,
                })
            }
        })
    }

    return yBottom
}

function desenharCabecalho(page, fonts, layout, yTop, icone) {
    const { xs, widths } = layout
    const y = yTop - TABLE_HEADER_HEIGHT
    // Sem retângulo próprio: fundo já é o card branco
    const textY = y + 8
    if (icone) {
        page.drawImage(icone, {
            x: xs[0] + 6,
            y: textY - 1,
            width: ICON_CAB_SIZE_PT,
            height: ICON_CAB_SIZE_PT,
        })
    }
    page.drawText('Serviço', {
        x: xs[0] + 6 + ICON_CAB_SIZE_PT + ICON_CAB_GAP_PT,
        y: textY,
        size: FONT_SIZE_HEADER,
        font: fonts.bold,
        color: COR_NAVY,
    })
    page.drawText('Porcentagem', {
        x: textoCentralizado(xs[1], widths[1], 'Porcentagem', fonts.bold, FONT_SIZE_HEADER),
        y: textY,
        size: FONT_SIZE_HEADER,
        font: fonts.bold,
        color: COR_NAVY,
    })
    page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + layout.innerW, y },
        thickness: 0.5,
        color: COR_BORDA,
    })
    return y
}

function desenharLinha(page, fonts, layout, yTop, linha, zebra) {
    const { xs, widths, innerW } = layout
    const corpo = fontCorpo(fonts)
    const h = medirAlturaLinha(linha, fonts, widths[0])
    const yBottom = yTop - h
    if (zebra % 2 === 1) {
        page.drawRectangle({
            x: MARGIN_X,
            y: yBottom,
            width: innerW,
            height: h,
            color: COR_ZEBRA,
        })
    }

    const linhasTitulo = quebrarTexto(linha.titulo, corpo, FONT_SIZE_BODY, widths[0] - 12)
    const linhasSub = quebrarTexto(linha.subtitulo, fonts.regular, FONT_SIZE_SUB, widths[0] - 12)
    const tituloDraw = linhasTitulo.length ? linhasTitulo : ['—']
    const subDraw = linhasSub.length ? linhasSub : ['—']

    let yTxt = yTop - 12
    tituloDraw.forEach((ln, i) => {
        page.drawText(ln, {
            x: xs[0] + 10,
            y: yTxt - i * LINE_LEADING,
            size: FONT_SIZE_BODY,
            font: corpo,
            color: COR_TEXTO,
        })
    })
    yTxt -= tituloDraw.length * LINE_LEADING + 2
    subDraw.forEach((ln, i) => {
        page.drawText(ln, {
            x: xs[0] + 10,
            y: yTxt - i * (LINE_LEADING - 1),
            size: FONT_SIZE_SUB,
            font: fonts.regular,
            color: COR_TEXTO_SUB,
        })
    })

    const pct = linha.percentual
    page.drawText(pct, {
        x: textoCentralizado(xs[1], widths[1], pct, corpo, FONT_SIZE_BODY),
        y: yBottom + h / 2 - FONT_SIZE_BODY / 2,
        size: FONT_SIZE_BODY,
        font: corpo,
        color: COR_TEXTO,
    })

    page.drawLine({
        start: { x: MARGIN_X, y: yBottom },
        end: { x: MARGIN_X + innerW, y: yBottom },
        thickness: 0.4,
        color: COR_BORDA,
    })
    return yBottom
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

function desenharCarimbo(page, fonts, width, textoEsquerda) {
    const stamp = formatarCarimboDataHora()
    const font = fonts.regular
    const stampW = font.widthOfTextAtSize(stamp, FONT_SIZE_STAMP)
    const stampX = width - MARGIN_X - stampW
    page.drawText(stamp, {
        x: stampX,
        y: 24,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })
    const esq = sanitizarTextoPdf(textoEsquerda)
    if (!esq) return
    const exibir = encaixarTextoLargura(esq, font, FONT_SIZE_STAMP, Math.max(0, stampX - MARGIN_X - GAP_CARIMBO))
    if (!exibir) return
    page.drawText(exibir, {
        x: MARGIN_X,
        y: 24,
        size: FONT_SIZE_STAMP,
        font,
        color: COR_STAMP,
    })
}

/**
 * @param {{
 *   itens: object[],
 *   observacoes?: string,
 *   prestadorNome?: string,
 *   cidadeNome?: string,
 * }} opts
 */
export async function gerarImpressaoDescontosPdf(opts) {
    const linhas = montarLinhasImpressao(opts.itens)
    if (!linhas.length) throw new Error('Inclua ao menos um benefício com desconto para imprimir.')

    const resposta = await fetch(urlDescontosPdf)
    if (!resposta.ok) throw new Error('Não foi possível carregar o PDF base de descontos.')
    const templateDoc = await PDFDocument.load(await resposta.arrayBuffer())
    if (templateDoc.getPageCount() < 1) throw new Error('PDF de descontos inválido.')

    const ref = templateDoc.getPage(0)
    const { width, height } = ref.getSize()
    const layout = colunasLayout(width)
    const finalDoc = await PDFDocument.create()
    const fonts = await embedMontserratNoPdf(finalDoc)
    const icone = await finalDoc.embedPng(await carregarSvgComoPngBytes(urlEstetoscopioSvg))

    const carimboEsq = [opts.prestadorNome, opts.cidadeNome]
        .map((s) => sanitizarTextoPdf(s))
        .filter(Boolean)
        .join(' · ')

    const obs = sanitizarObservacoesPdf(opts.observacoes)
    const hInfo = medirBlocoInformacoes(obs, fonts, layout.innerW)
    let linhaIdx = 0
    let zebra = 0
    let guard = 0
    const maxPag = Math.max(20, linhas.length + 4)
    let informacoesDesenhadas = false

    while (linhaIdx < linhas.length && guard < maxPag) {
        guard += 1
        const [tpl] = await finalDoc.copyPages(templateDoc, [0])
        const page = finalDoc.addPage(tpl)

        const cardTop = height - MARGIN_TOP - SECTION_GAP
        const corpoTop = cardTop - TITLE_BAR_HEIGHT
        const yFloor = MARGIN_BOTTOM

        // Planeja quantas linhas cabem nesta página (reservando Informações se for a última)
        const lote = []
        let yProbe = corpoTop - TABLE_HEADER_HEIGHT
        let i = linhaIdx
        while (i < linhas.length) {
            const h = medirAlturaLinha(linhas[i], fonts, layout.widths[0])
            const restanteApos = linhas.length - 1 - i
            const incluiInfoAqui = restanteApos === 0
            const reserva = incluiInfoAqui ? hInfo : 0
            if (yProbe - h < yFloor + reserva) break
            lote.push(linhas[i])
            yProbe -= h
            i += 1
        }

        // Se nada coube (linha muito alta), força pelo menos uma
        if (!lote.length && linhaIdx < linhas.length) {
            lote.push(linhas[linhaIdx])
            i = linhaIdx + 1
            yProbe = corpoTop - TABLE_HEADER_HEIGHT - medirAlturaLinha(lote[0], fonts, layout.widths[0])
        }

        const fechaComInfo = i >= linhas.length
        const yAposLinhas = (() => {
            let y = corpoTop - TABLE_HEADER_HEIGHT
            for (const ln of lote) {
                y -= medirAlturaLinha(ln, fonts, layout.widths[0])
            }
            return y
        })()
        const yCardBottom = fechaComInfo ? yAposLinhas - hInfo : yAposLinhas

        // Fundo branco único (tabela + Informações, se fechar nesta página)
        desenharFundoCardBranco(page, cardTop, Math.max(yCardBottom, yFloor), layout.innerW)
        desenharBarraTituloGrupo(page, fonts, MARGIN_X, cardTop, layout.innerW)

        let yCursor = desenharCabecalho(page, fonts, layout, corpoTop, icone)
        for (const linha of lote) {
            yCursor = desenharLinha(page, fonts, layout, yCursor, linha, zebra)
            zebra += 1
        }
        linhaIdx = i

        if (fechaComInfo && !informacoesDesenhadas) {
            // Continuação imediata dentro do mesmo branco (sem gap cinza)
            desenharInformacoes(page, fonts, layout, yCursor, obs)
            informacoesDesenhadas = true
        }

        desenharCarimbo(page, fonts, width, carimboEsq)
    }

    if (!informacoesDesenhadas) {
        const [tplInfo] = await finalDoc.copyPages(templateDoc, [0])
        const pageInfo = finalDoc.addPage(tplInfo)
        const cardTop = height - MARGIN_TOP - SECTION_GAP
        const yBottom = cardTop - TITLE_BAR_HEIGHT - hInfo
        desenharFundoCardBranco(pageInfo, cardTop, yBottom, layout.innerW)
        desenharBarraTituloGrupo(pageInfo, fonts, MARGIN_X, cardTop, layout.innerW)
        desenharInformacoes(pageInfo, fonts, layout, cardTop - TITLE_BAR_HEIGHT, obs)
        desenharCarimbo(pageInfo, fonts, width, carimboEsq)
    }

    return blobDePdfLib(finalDoc)
}

export function downloadImpressaoDescontosPdf(blob, prestadorNome) {
    const limpar = (s) =>
        String(s || '')
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    const base = limpar(prestadorNome)
    const nome = base ? `Descontos - ${base}.pdf` : 'Descontos.pdf'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
}
