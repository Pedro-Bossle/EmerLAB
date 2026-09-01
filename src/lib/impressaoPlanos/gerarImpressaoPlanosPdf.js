import { PDFDocument, rgb } from 'pdf-lib'
import { blobDePdfLib } from '../pdf/serializarPdf.js'
import { procedimentoIsentoLimiteGrupo } from '../categoriaLimitesGrupo.js'
import { embedMontserratNoPdf } from './montserratPdfFonts.js'
import { formatarCarimboDataHora } from '../pdf/formatarCarimboEmissao.js'
import {
    adicionarPaginasObservacoesDinamicas,
    normalizarListaObservacoes,
} from '../pdf/observacoesModeloPdf.js'
import urlEstetoscopioSvg from '../../assets/planos/estetoscopio.svg?url'

const ICON_CAB_SIZE_PT = 10
const ICON_CAB_GAP_PT = 4
const ICON_RASTER_PX = 64

const TEMPLATE_PAGE_INDEX = 1
const COVER_INDEX = 0
const OBS_INDEX_A = 2
const OBS_INDEX_B = 3

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

const COR_NAVY = rgb(22 / 255, 33 / 255, 62 / 255)
const COR_TEXTO = rgb(58 / 255, 63 / 255, 75 / 255)
const COR_BRANCO = rgb(1, 1, 1)
const COR_ZEBRA = rgb(247 / 255, 248 / 255, 250 / 255)
const COR_BORDA = rgb(229 / 255, 230 / 255, 234 / 255)
const COR_STAMP = rgb(0.72, 0.72, 0.72)

const COL_FRAC = [0.44, 0.18, 0.18, 0.2]

function fontCorpo(fonts) {
    return fonts.light || fonts.regular
}

function sanitizarTextoPdf(texto) {
    return String(texto ?? '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .trim()
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

function nomeProcedimentoPdf(linha) {
    return sanitizarTextoPdf(linha?.nome) || '—'
}

function limiteGrupoPreenchido(valor) {
    return Boolean(String(valor ?? '').trim())
}

function medirAlturaLinha(linha, fonts, colProcW) {
    const corpo = fontCorpo(fonts)
    const linhasNome = quebrarTexto(linha.nome, corpo, FONT_SIZE_BODY, colProcW - 12)
    let h = ROW_BASE_HEIGHT
    if (linhasNome.length > 1) h += (linhasNome.length - 1) * LINE_LEADING
    return Math.max(ROW_BASE_HEIGHT, h)
}

/**
 * @param {Array<{ id: number, nome: string, limiteGrupoValor?: string, textoLimiteGrupo?: string, linhas: object[] }>} categorias
 */
function montarSecoesImpressao(categorias) {
    const secoes = []
    for (const cat of categorias || []) {
        const linhasMarcadas = (cat.linhas || []).filter(
            (l) => l.checked !== false && !l.apenasLoja && l.selecionavel !== false,
        )
        if (!linhasMarcadas.length) continue

        // Só mescla se houver valor de limite de grupo preenchido; senão célula individual ("—").
        const limiteGrupoAtivo = limiteGrupoPreenchido(cat.limiteGrupoValor)

        secoes.push({
            nome: String(cat.nome || 'Categoria'),
            textoLimiteGrupo: limiteGrupoAtivo ? String(cat.textoLimiteGrupo || '').trim() : '',
            limiteGrupoAtivo,
            linhas: linhasMarcadas.map((l) => {
                const isento = procedimentoIsentoLimiteGrupo(l)
                const usaLimiteGrupoLinha = limiteGrupoAtivo && !isento
                return {
                    nome: nomeProcedimentoPdf(l),
                    diferenca: sanitizarTextoPdf(l.diferenca) || '—',
                    carencia: sanitizarTextoPdf(l.carenciaExibicao ?? l.carencia) || '—',
                    limiteIndividual:
                        sanitizarTextoPdf(l.limiteIndividualExibicao ?? l.limite) || '—',
                    isentoLimiteGrupo: isento,
                    usaLimiteGrupoLinha,
                }
            }),
        })
    }
    return secoes
}

function indicesGrupoLimite(linhas) {
    const idx = []
    linhas.forEach((l, i) => {
        if (l.usaLimiteGrupoLinha) idx.push(i)
    })
    return idx
}

/** Altura útil para linhas numa página (com ou sem barra de título de seção). */
function calcularAlturaUtilPagina(height, comecaSecao) {
    const reservaTitulo = comecaSecao ? TITLE_BAR_HEIGHT + SECTION_GAP : 0
    return height - MARGIN_TOP - MARGIN_BOTTOM - reservaTitulo - TABLE_HEADER_HEIGHT
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
    // Alinha o centro vertical do ícone ao meio aproximado do texto do cabeçalho.
    const y = textY - 1
    page.drawImage(iconePng, {
        x,
        y,
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
    const labels = ['Procedimento', 'Diferença', 'Carências', 'Limites']
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

function desenharLinhaDados(page, fonts, layout, yTop, linha, indiceZebra, opcoesLimite) {
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
    ;[linha.diferenca, linha.carencia].forEach((val, i) => {
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

    if (opcoesLimite?.desenharCelulaIndividual) {
        const lim = sanitizarTextoPdf(opcoesLimite.texto) || '—'
        const linhasLim = quebrarTexto(lim, corpo, FONT_SIZE_BODY, widths[3] - 8)
        const yLim = yPrimeiraLinhaBloco(yTop, yBottom, linhasLim.length, FONT_SIZE_BODY)
        linhasLim.forEach((ln, i) => {
            page.drawText(ln, {
                x: textoCentralizado(xs[3], widths[3], ln, corpo, FONT_SIZE_BODY),
                y: yLim - i * LINE_LEADING,
                size: FONT_SIZE_BODY,
                font: corpo,
                color: COR_TEXTO,
            })
        })
    }

    page.drawLine({
        start: { x: MARGIN_X, y: yBottom },
        end: { x: MARGIN_X + layout.innerW, y: yBottom },
        thickness: 0.4,
        color: COR_BORDA,
    })

    return { yBottom, h }
}

function desenharCelulaLimiteGrupoMesclada(page, fonts, layout, yTop, yBottom, texto) {
    const { xs, widths } = layout
    const corpo = fontCorpo(fonts)
    const x = xs[3]
    const w = widths[3]
    const h = yTop - yBottom
    if (h <= 0) return

    page.drawRectangle({
        x,
        y: yBottom,
        width: w,
        height: h,
        color: COR_BRANCO,
    })
    page.drawLine({
        start: { x, y: yBottom },
        end: { x, y: yTop },
        thickness: 1,
        color: COR_BORDA,
    })

    const lim = sanitizarTextoPdf(texto) || '—'
    const linhasLim = quebrarTexto(lim, corpo, FONT_SIZE_BODY, w - 10)
    const yLim = yPrimeiraLinhaBloco(yTop, yBottom, linhasLim.length, FONT_SIZE_BODY)
    linhasLim.forEach((ln, i) => {
        page.drawText(ln, {
            x: textoCentralizado(x, w, ln, corpo, FONT_SIZE_BODY),
            y: yLim - i * LINE_LEADING,
            size: FONT_SIZE_BODY,
            font: corpo,
            color: COR_TEXTO,
        })
    })
}

function alturaGrupo(linhas, indices, fonts, colProcW) {
    return indices.reduce((acc, i) => acc + medirAlturaLinha(linhas[i], fonts, colProcW), 0)
}

function desenharCarimboPagina(page, fonts, width) {
    const stamp = formatarCarimboDataHora()
    const w = fonts.regular.widthOfTextAtSize(stamp, FONT_SIZE_STAMP)
    page.drawText(stamp, {
        x: width - MARGIN_X - w,
        y: 24,
        size: FONT_SIZE_STAMP,
        font: fonts.regular,
        color: COR_STAMP,
    })
}

/**
 * Renderiza uma página de conteúdo. Sempre inicia no topo útil da página.
 * @param {object} cursor — pode incluir grupoMergeAberto indicando continuidade de rowspan entre páginas
 */
function renderizarUmaPagina(page, fonts, width, height, secoes, cursor, iconeEstetoscopio) {
    const layout = colunasLayout(width)
    let y = height - MARGIN_TOP
    let { secaoIdx, linhaIdx, zebra } = cursor
    let grupoMergeAberto = Boolean(cursor.grupoMergeAberto)
    let mergeTopY = null
    const secaoIdxInicial = secaoIdx
    const linhaIdxInicial = linhaIdx
    let desenhouAlgoNestaPagina = false

    while (secaoIdx < secoes.length) {
        const secao = secoes[secaoIdx]
        const linhas = secao.linhas
        if (linhaIdx >= linhas.length) {
            secaoIdx += 1
            linhaIdx = 0
            grupoMergeAberto = false
            mergeTopY = null
            continue
        }

        // Título da categoria em toda página onde a seção aparece (início ou continuação).
        const ehContinuacaoNaPrimeiraSecaoDaPagina =
            secaoIdx === secaoIdxInicial && linhaIdxInicial > 0 && !desenhouAlgoNestaPagina
        const desenharTituloCategoria =
            (linhaIdx === 0 && !grupoMergeAberto) || ehContinuacaoNaPrimeiraSecaoDaPagina

        const overhead =
            (desenharTituloCategoria ? SECTION_GAP + TITLE_BAR_HEIGHT : 0) + TABLE_HEADER_HEIGHT
        const alturaPrimeiraLinha = medirAlturaLinha(linhas[linhaIdx], fonts, layout.widths[0])

        // Não desenhar título/cabeçalho se a primeira linha real não couber — evita página quase vazia.
        if (y - overhead < MARGIN_BOTTOM + alturaPrimeiraLinha) {
            return {
                secaoIdx,
                linhaIdx,
                zebra,
                grupoMergeAberto: desenhouAlgoNestaPagina
                    ? grupoMergeAberto
                    : Boolean(cursor.grupoMergeAberto),
                done: false,
            }
        }

        const idxGrupoPre = indicesGrupoLimite(linhas)
        const temGrupoPre = idxGrupoPre.length > 0 && secao.textoLimiteGrupo
        if (temGrupoPre && linhaIdx === idxGrupoPre[0] && !grupoMergeAberto) {
            const hGrupo = alturaGrupo(linhas, idxGrupoPre, fonts, layout.widths[0])
            const espacoAposChrome = y - overhead - MARGIN_BOTTOM
            const cabeAqui = hGrupo <= espacoAposChrome
            const cabeEmPaginaNova = hGrupo <= calcularAlturaUtilPagina(height, true)
            if (!cabeAqui && cabeEmPaginaNova) {
                return {
                    secaoIdx,
                    linhaIdx,
                    zebra,
                    grupoMergeAberto: false,
                    done: false,
                }
            }
        }

        const cardTop = y - (desenharTituloCategoria ? SECTION_GAP : 0)
        const corpoTop = desenharTituloCategoria ? cardTop - TITLE_BAR_HEIGHT : cardTop

        // Mede até onde o card deve ir nesta página (só até a última linha que cabe).
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

        // Fundo branco só até o fim do conteúdo deste bloco (gap = cor da folha).
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

        const idxGrupo = idxGrupoPre
        const temGrupo = temGrupoPre
        const ultimoIdxGrupo = idxGrupo.length ? idxGrupo[idxGrupo.length - 1] : -1

        if (grupoMergeAberto && temGrupo) {
            mergeTopY = yCursor
        }

        while (linhaIdx < linhas.length) {
            const linha = linhas[linhaIdx]
            const h = medirAlturaLinha(linha, fonts, layout.widths[0])
            const naGrupo = temGrupo && linha.usaLimiteGrupoLinha
            const ehPrimeiroGrupo = naGrupo && linhaIdx === idxGrupo[0]
            const ehUltimoGrupo = naGrupo && linhaIdx === ultimoIdxGrupo

            if (ehPrimeiroGrupo && !grupoMergeAberto) {
                mergeTopY = yCursor
                grupoMergeAberto = true
            }

            if (yCursor - h < MARGIN_BOTTOM) {
                if (grupoMergeAberto && mergeTopY != null && naGrupo) {
                    desenharCelulaLimiteGrupoMesclada(
                        page,
                        fonts,
                        layout,
                        mergeTopY,
                        yCursor,
                        secao.textoLimiteGrupo,
                    )
                }
                return {
                    secaoIdx,
                    linhaIdx,
                    zebra,
                    grupoMergeAberto: grupoMergeAberto && naGrupo,
                    done: false,
                }
            }

            const { yBottom } = desenharLinhaDados(page, fonts, layout, yCursor, linha, zebra, {
                desenharCelulaIndividual: !linha.usaLimiteGrupoLinha,
                texto: linha.limiteIndividual,
            })

            if (ehUltimoGrupo && mergeTopY != null) {
                desenharCelulaLimiteGrupoMesclada(
                    page,
                    fonts,
                    layout,
                    mergeTopY,
                    yBottom,
                    secao.textoLimiteGrupo,
                )
                mergeTopY = null
                grupoMergeAberto = false
            }

            yCursor = yBottom
            zebra += 1
            linhaIdx += 1
        }

        secaoIdx += 1
        linhaIdx = 0
        grupoMergeAberto = false
        mergeTopY = null
        y = yCursor - SECTION_GAP
    }

    return { secaoIdx, linhaIdx: 0, zebra, grupoMergeAberto: false, done: true }
}

/**
 * @param {{
 *   pdfUrl: string,
 *   categorias: object[],
 *   observacoes?: Array<{ titulo?: string, mensagem: string }> | string | string[],
 * }} opts
 */
export async function gerarImpressaoPlanosPdf(opts) {
    const resposta = await fetch(opts.pdfUrl)
    if (!resposta.ok) throw new Error('Não foi possível carregar o PDF base do plano.')
    const templateBytes = await resposta.arrayBuffer()
    const templateDoc = await PDFDocument.load(templateBytes)
    if (templateDoc.getPageCount() < 4) {
        throw new Error('O PDF base do plano deve conter 4 páginas (capa, listagem, observações).')
    }

    const secoes = montarSecoesImpressao(opts.categorias)
    if (!secoes.length) {
        throw new Error('Selecione ao menos um procedimento para imprimir.')
    }

    const observacoesDinamicas = normalizarListaObservacoes(opts.observacoes)
    const refPage = templateDoc.getPage(TEMPLATE_PAGE_INDEX)
    const { width, height } = refPage.getSize()

    const finalDoc = await PDFDocument.create()
    const fonts = await embedMontserratNoPdf(finalDoc)
    const iconPngBytes = await carregarSvgComoPngBytes(urlEstetoscopioSvg)
    const iconeEstetoscopio = await finalDoc.embedPng(iconPngBytes)

    const [capa] = await finalDoc.copyPages(templateDoc, [COVER_INDEX])
    desenharCarimboPagina(finalDoc.addPage(capa), fonts, width)

    let cursor = {
        secaoIdx: 0,
        linhaIdx: 0,
        zebra: 0,
        grupoMergeAberto: false,
        done: false,
    }
    let guard = 0
    const maxPaginas = Math.max(30, secoes.reduce((n, s) => n + s.linhas.length, 0) + 4)

    while (!cursor.done && guard < maxPaginas) {
        guard += 1
        const antes = `${cursor.secaoIdx}-${cursor.linhaIdx}-${cursor.grupoMergeAberto}`
        const [tpl] = await finalDoc.copyPages(templateDoc, [TEMPLATE_PAGE_INDEX])
        const page = finalDoc.addPage(tpl)
        cursor = renderizarUmaPagina(page, fonts, width, height, secoes, cursor, iconeEstetoscopio)
        desenharCarimboPagina(page, fonts, width)
        const depois = `${cursor.secaoIdx}-${cursor.linhaIdx}-${cursor.grupoMergeAberto}`
        if (!cursor.done && depois === antes) {
            cursor.linhaIdx += 1
            cursor.grupoMergeAberto = false
        }
    }

    if (observacoesDinamicas.length) {
        await adicionarPaginasObservacoesDinamicas({
            finalDoc,
            templateDoc,
            templatePageIndex: TEMPLATE_PAGE_INDEX,
            fonts,
            observacoes: observacoesDinamicas,
            onPagina: (page, pageWidth) => desenharCarimboPagina(page, fonts, pageWidth),
        })
    } else {
        // Sem gatilhos: páginas de OBS do PDF molde.
        for (const idx of [OBS_INDEX_A, OBS_INDEX_B]) {
            const [obs] = await finalDoc.copyPages(templateDoc, [idx])
            finalDoc.addPage(obs)
        }
    }

    return blobDePdfLib(finalDoc)
}

export function downloadImpressaoPlanosPdf(blob, planoNome, cidadeNome) {
    const limpar = (s) =>
        String(s || '')
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    const nome = `${limpar(planoNome)} ${limpar(cidadeNome)}.pdf`.trim() || 'Plano Cidade.pdf'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
}
