import { PDFDocument, rgb } from 'pdf-lib'
import { procedimentoIsentoLimiteGrupo } from '../categoriaLimitesGrupo.js'
import { embedMontserratNoPdf } from './montserratPdfFonts.js'

const TEMPLATE_PAGE_INDEX = 1
const COVER_INDEX = 0
const OBS_INDEX_A = 2
const OBS_INDEX_B = 3

const MARGIN_X = 42
const MARGIN_TOP = 86
const MARGIN_BOTTOM = 58
const SECTION_GAP = 8
const CARD_RADIUS = 8
const TITLE_BAR_HEIGHT = 32
const TABLE_HEADER_HEIGHT = 26
const ROW_BASE_HEIGHT = 26
const LINE_LEADING = 11
const FONT_SIZE_BODY = 9
const FONT_SIZE_OBS = 7.5
const FONT_SIZE_HEADER = 9
const FONT_SIZE_TITLE_PREFIX = 10
const FONT_SIZE_TITLE_CAT = 10
const FONT_SIZE_STAMP = 7

const COR_NAVY = rgb(22 / 255, 33 / 255, 62 / 255)
const COR_TEXTO = rgb(58 / 255, 63 / 255, 75 / 255)
const COR_TEXTO_OBS = rgb(120 / 255, 125 / 255, 135 / 255)
const COR_BRANCO = rgb(1, 1, 1)
const COR_ZEBRA = rgb(247 / 255, 248 / 255, 250 / 255)
const COR_BORDA = rgb(229 / 255, 230 / 255, 234 / 255)
const COR_STAMP = rgb(0.72, 0.72, 0.72)
const COR_SOMBRA = rgb(0, 0, 0)
const COR_GRUPO_FUNDO = rgb(240 / 255, 247 / 255, 252 / 255)

const COL_FRAC = [0.44, 0.18, 0.18, 0.2]

function formatarCarimboDataHora() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
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

function observacaoLinha(linha) {
    const obs = linha?.observacao ?? linha?.nomeSecundario ?? linha?.subtitulo
    if (obs) return sanitizarTextoPdf(obs)
    const nome = String(linha?.nome || '')
    const parts = nome.split(/\s*[—–-]\s*/)
    if (parts.length > 1) return sanitizarTextoPdf(parts.slice(1).join(' - '))
    return ''
}

function nomePrincipalLinha(linha) {
    const nome = sanitizarTextoPdf(linha?.nome)
    const parts = nome.split(/\s*[—–-]\s*/)
    return parts[0]?.trim() || nome || '—'
}

const ROW_HEIGHT_OBS = 10

function medirAlturaLinha(linha, fonts, colProcW) {
    const linhasNome = quebrarTexto(linha.nome, fonts.regular, FONT_SIZE_BODY, colProcW - 12)
    const obs = linha.observacao
    let h = ROW_BASE_HEIGHT
    if (linhasNome.length > 1) h += (linhasNome.length - 1) * LINE_LEADING
    if (obs) h += ROW_HEIGHT_OBS
    return Math.max(ROW_BASE_HEIGHT, h)
}

/**
 * @param {Array<{ id: number, nome: string, limiteGrupoValor?: string, textoLimiteGrupo?: string, linhas: object[] }>} categorias
 */
function montarSecoesImpressao(categorias) {
    const secoes = []
    for (const cat of categorias || []) {
        const linhasMarcadas = (cat.linhas || []).filter((l) => l.checked !== false)
        if (!linhasMarcadas.length) continue

        const limiteGrupoAtivo = Boolean(cat.limiteGrupoValor && cat.textoLimiteGrupo)

        secoes.push({
            nome: String(cat.nome || 'Categoria'),
            textoLimiteGrupo: limiteGrupoAtivo ? String(cat.textoLimiteGrupo) : '',
            limiteGrupoAtivo,
            linhas: linhasMarcadas.map((l) => {
                const isento = procedimentoIsentoLimiteGrupo(l)
                const usaLimiteGrupoLinha = limiteGrupoAtivo && !isento
                return {
                    nome: nomePrincipalLinha(l),
                    observacao: observacaoLinha(l),
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

function desenharIconeSeringa(page, x, y, color) {
    const bx = x + 4
    const by = y + 2
    page.drawRectangle({
        x: bx,
        y: by,
        width: 3,
        height: 10,
        borderColor: color,
        borderWidth: 0.8,
        color: COR_BRANCO,
    })
    page.drawLine({
        start: { x: bx + 1.5, y: by + 10 },
        end: { x: bx + 1.5, y: by + 14 },
        thickness: 0.8,
        color,
    })
    page.drawLine({
        start: { x: bx - 1, y: by + 3 },
        end: { x: bx + 4, y: by + 8 },
        thickness: 0.6,
        color,
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

function desenharCabecalhoTabela(page, fonts, layout, yTop) {
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
            desenharIconeSeringa(page, colX + 6, textY, COR_NAVY)
            page.drawText(label, {
                x: colX + 22,
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

function desenharFundoCard(page, x, yBottom, innerW, yTop) {
    const h = yTop - yBottom
    if (h <= 0) return
    page.drawRectangle({
        x: x + 2,
        y: yBottom - 4,
        width: innerW,
        height: h + 4,
        color: COR_SOMBRA,
        opacity: 0.08,
        borderRadius: CARD_RADIUS,
    })
    page.drawRectangle({
        x,
        y: yBottom,
        width: innerW,
        height: h,
        color: COR_BRANCO,
        borderColor: COR_BORDA,
        borderWidth: 0.6,
        borderRadius: CARD_RADIUS,
    })
}

function desenharLinhaDados(
    page,
    fonts,
    layout,
    yTop,
    linha,
    indiceZebra,
    opcoesLimite,
) {
    const { xs, widths } = layout
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

    const linhasNome = quebrarTexto(linha.nome, fonts.regular, FONT_SIZE_BODY, widths[0] - 12)
    let textY = yTop - 14
    linhasNome.forEach((ln, i) => {
        page.drawText(ln, {
            x: xs[0] + 10,
            y: textY - i * LINE_LEADING,
            size: FONT_SIZE_BODY,
            font: fonts.regular,
            color: COR_TEXTO,
        })
    })

    if (linha.observacao) {
        const obsY = yBottom + 4
        const obsLinhas = quebrarTexto(linha.observacao, fonts.medium, FONT_SIZE_OBS, widths[0] - 12)
        page.drawText(obsLinhas[0], {
            x: xs[0] + 10,
            y: obsY,
            size: FONT_SIZE_OBS,
            font: fonts.medium,
            color: COR_TEXTO_OBS,
        })
    }

    const vals = [
        { val: linha.diferenca, bold: true },
        { val: linha.carencia, bold: true },
    ]
    vals.forEach((item, i) => {
        const idx = i + 1
        const font = item.bold ? fonts.bold : fonts.regular
        page.drawText(sanitizarTextoPdf(item.val) || '—', {
            x: textoCentralizado(xs[idx], widths[idx], item.val, font, FONT_SIZE_BODY),
            y: yTop - 14,
            size: FONT_SIZE_BODY,
            font,
            color: COR_TEXTO,
        })
    })

    if (opcoesLimite?.desenharCelulaIndividual) {
        const lim = sanitizarTextoPdf(opcoesLimite.texto) || '—'
        const linhasLim = quebrarTexto(lim, fonts.regular, FONT_SIZE_BODY, widths[3] - 8)
        page.drawText(linhasLim[0], {
            x: textoCentralizado(xs[3], widths[3], linhasLim[0], fonts.regular, FONT_SIZE_BODY),
            y: yTop - 14,
            size: FONT_SIZE_BODY,
            font: fonts.regular,
            color: COR_TEXTO,
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
    const x = xs[3]
    const w = widths[3]
    const h = yTop - yBottom
    page.drawRectangle({
        x,
        y: yBottom,
        width: w,
        height: h,
        color: COR_GRUPO_FUNDO,
        borderColor: COR_BORDA,
        borderWidth: 0.4,
    })
    page.drawLine({
        start: { x, y: yBottom },
        end: { x, y: yTop },
        thickness: 2,
        color: rgb(31 / 255, 126 / 255, 194 / 255),
    })

    const lim = sanitizarTextoPdf(texto) || '—'
    const linhasLim = quebrarTexto(lim, fonts.bold, FONT_SIZE_BODY, w - 10)
    const blockH = linhasLim.length * LINE_LEADING
    let ty = yBottom + (h - blockH) / 2 + 2
    linhasLim.forEach((ln) => {
        page.drawText(ln, {
            x: textoCentralizado(x, w, ln, fonts.bold, FONT_SIZE_BODY),
            y: ty,
            size: FONT_SIZE_BODY,
            font: fonts.bold,
            color: COR_NAVY,
        })
        ty += LINE_LEADING
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
 */
function renderizarUmaPagina(page, fonts, width, height, secoes, cursor) {
    const layout = colunasLayout(width)
    let y = height - MARGIN_TOP
    let { secaoIdx, linhaIdx, zebra } = cursor

    while (secaoIdx < secoes.length) {
        const secao = secoes[secaoIdx]
        const linhas = secao.linhas
        if (linhaIdx >= linhas.length) {
            secaoIdx += 1
            linhaIdx = 0
            continue
        }

        const comecaSecao = linhaIdx === 0
        const overhead = comecaSecao
            ? SECTION_GAP + TITLE_BAR_HEIGHT + TABLE_HEADER_HEIGHT
            : TABLE_HEADER_HEIGHT

        if (y - overhead < MARGIN_BOTTOM + ROW_BASE_HEIGHT) {
            return { secaoIdx, linhaIdx, zebra, done: false }
        }

        const cardTop = y - (comecaSecao ? SECTION_GAP : 0)
        const corpoTop = comecaSecao ? cardTop - TITLE_BAR_HEIGHT : cardTop

        if (comecaSecao) {
            desenharBarraTituloSecao(page, fonts, MARGIN_X, cardTop, layout.innerW, secao.nome)
        }

        let yCursor = desenharCabecalhoTabela(page, fonts, layout, corpoTop)

        if (comecaSecao) {
            page.drawRectangle({
                x: MARGIN_X + 2,
                y: MARGIN_BOTTOM - 4,
                width: layout.innerW,
                height: corpoTop - MARGIN_BOTTOM + 4,
                color: COR_SOMBRA,
                opacity: 0.07,
                borderRadius: CARD_RADIUS,
            })
            page.drawRectangle({
                x: MARGIN_X,
                y: MARGIN_BOTTOM,
                width: layout.innerW,
                height: corpoTop - MARGIN_BOTTOM,
                color: COR_BRANCO,
                borderColor: COR_BORDA,
                borderWidth: 0.5,
                borderRadius: CARD_RADIUS,
            })
        }

        const idxGrupo = indicesGrupoLimite(linhas)
        const temGrupo = idxGrupo.length > 0 && secao.textoLimiteGrupo
        let mergeTopY = null

        while (linhaIdx < linhas.length) {
            const linha = linhas[linhaIdx]
            const h = medirAlturaLinha(linha, fonts, layout.widths[0])

            if (temGrupo && linha.usaLimiteGrupoLinha && linhaIdx === idxGrupo[0]) {
                const hGrupo = alturaGrupo(linhas, idxGrupo, fonts, layout.widths[0])
                if (yCursor - hGrupo < MARGIN_BOTTOM) {
                    return { secaoIdx, linhaIdx, zebra, done: false }
                }
                mergeTopY = yCursor
            }

            if (yCursor - h < MARGIN_BOTTOM) {
                return { secaoIdx, linhaIdx, zebra, done: false }
            }

            const yTopLinha = yCursor
            const ehUltimoGrupo =
                temGrupo && linha.usaLimiteGrupoLinha && linhaIdx === idxGrupo[idxGrupo.length - 1]

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
            }

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
 * @param {{ pdfUrl: string, categorias: object[] }} opts
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

    const refPage = templateDoc.getPage(TEMPLATE_PAGE_INDEX)
    const { width, height } = refPage.getSize()

    const finalDoc = await PDFDocument.create()
    const fonts = await embedMontserratNoPdf(finalDoc)

    const [capa] = await finalDoc.copyPages(templateDoc, [COVER_INDEX])
    desenharCarimboPagina(finalDoc.addPage(capa), fonts, width)

    let cursor = { secaoIdx: 0, linhaIdx: 0, zebra: 0, done: false }
    let guard = 0
    const maxPaginas = Math.max(30, secoes.reduce((n, s) => n + s.linhas.length, 0) + 4)

    while (!cursor.done && guard < maxPaginas) {
        guard += 1
        const antes = `${cursor.secaoIdx}-${cursor.linhaIdx}`
        const [tpl] = await finalDoc.copyPages(templateDoc, [TEMPLATE_PAGE_INDEX])
        const page = finalDoc.addPage(tpl)
        cursor = renderizarUmaPagina(page, fonts, width, height, secoes, cursor)
        desenharCarimboPagina(page, fonts, width)
        const depois = `${cursor.secaoIdx}-${cursor.linhaIdx}`
        if (!cursor.done && depois === antes) {
            cursor.linhaIdx += 1
        }
    }

    for (const idx of [OBS_INDEX_A, OBS_INDEX_B]) {
        const [obs] = await finalDoc.copyPages(templateDoc, [idx])
        desenharCarimboPagina(finalDoc.addPage(obs), fonts, width)
    }

    return new Blob([await finalDoc.save()], { type: 'application/pdf' })
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
