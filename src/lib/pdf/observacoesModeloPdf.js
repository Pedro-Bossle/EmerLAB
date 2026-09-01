import { PDFString, rgb } from 'pdf-lib'

const MARGIN_X = 42
const MARGIN_TOP = 86
const MARGIN_BOTTOM = 58
const SECTION_GAP = 16
const LINE_LEADING = 11
const FONT_SIZE_TITLE_CAT = 10
const FONT_SIZE_OBS = 9
const FONT_SIZE_OBS_TITLE = 9.5
const FONT_SIZE_OBS_H1 = 18
const FONT_SIZE_DUVIDAS = 9
const OBS_ITEM_GAP = 12
const OBS_NESTED_INDENT = 18
const OBS_H1_GAP = 22
const DUVIDAS_GAP = 18

const LINK_WHATSAPP = 'https://wa.me/555499041695'

const COR_NAVY = rgb(22 / 255, 33 / 255, 62 / 255)
const COR_TEXTO = rgb(58 / 255, 63 / 255, 75 / 255)
const COR_TEXTO_OBS = rgb(90 / 255, 96 / 255, 108 / 255)
const COR_BRANCO = rgb(1, 1, 1)
const COR_LINK = rgb(30 / 255, 100 / 255, 180 / 255)
const COR_INFO_TEXTO = rgb(30 / 255, 70 / 255, 120 / 255)
const COR_INFO_ICON = rgb(100 / 255, 170 / 255, 220 / 255)

function fontCorpo(fonts) {
    return fonts.light || fonts.regular
}

function sanitizarTextoPdf(texto) {
    return String(texto ?? '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .trim()
}

function sanitizarObservacoesPdf(texto) {
    return String(texto ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/www\.\S+/gi, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ +\n/g, '\n')
        .replace(/\n +/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
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

export function normalizarListaObservacoes(observacoes) {
    if (observacoes == null) return []
    const lista = Array.isArray(observacoes) ? observacoes : [observacoes]
    return lista
        .map((item, idx) => {
            if (item == null) return null
            if (typeof item === 'string') {
                const mensagem = sanitizarObservacoesPdf(item)
                if (!mensagem) return null
                return { numero: idx + 1, titulo: '', mensagem }
            }
            const titulo = sanitizarTextoPdf(item.titulo || item.title || '')
            const mensagem = sanitizarObservacoesPdf(item.mensagem || item.texto || item.body || '')
            if (!mensagem && !titulo) return null
            return {
                numero: Number(item.numero) > 0 ? Number(item.numero) : idx + 1,
                titulo,
                mensagem,
            }
        })
        .filter(Boolean)
        .map((item, idx) => ({ ...item, numero: idx + 1 }))
}

function parseLinhasCorpoObservacao(mensagem) {
    const bruto = sanitizarObservacoesPdf(mensagem)
    if (!bruto) return []
    return bruto.split('\n').map((linha) => {
        const raw = String(linha || '')
        const bulletMatch = raw.match(/^\s*([-•*]|\d+[.)])\s+(.*)$/)
        const texto = bulletMatch ? bulletMatch[2] : raw.trimEnd()
        const nested = Boolean(bulletMatch)
        const segmentos = []
        const re = /\*\*(.+?)\*\*/g
        let last = 0
        let m
        while ((m = re.exec(texto)) !== null) {
            if (m.index > last) {
                segmentos.push({ text: texto.slice(last, m.index), bold: false })
            }
            segmentos.push({ text: m[1], bold: true })
            last = m.index + m[0].length
        }
        if (last < texto.length) segmentos.push({ text: texto.slice(last), bold: false })
        if (!segmentos.length && texto) segmentos.push({ text, bold: false })
        return { nested, segmentos }
    })
}

function quebrarSegmentosEmLinhas(segmentos, fonts, size, larguraMax) {
    const palavras = []
    for (const seg of segmentos || []) {
        const partes = String(seg.text || '').split(/(\s+)/)
        for (const parte of partes) {
            if (!parte) continue
            palavras.push({ text: parte, bold: Boolean(seg.bold) })
        }
    }
    if (!palavras.length) return [[]]

    const linhas = []
    let atual = []
    let larguraAtual = 0
    for (const palavra of palavras) {
        const font = palavra.bold ? fonts.bold : fontCorpo(fonts)
        const w = font.widthOfTextAtSize(palavra.text, size)
        if (atual.length && larguraAtual + w > larguraMax && !/^\s+$/.test(palavra.text)) {
            while (atual.length && /^\s+$/.test(atual[atual.length - 1].text)) atual.pop()
            linhas.push(atual)
            atual = []
            larguraAtual = 0
            if (/^\s+$/.test(palavra.text)) continue
        }
        atual.push(palavra)
        larguraAtual += w
    }
    if (atual.length) {
        while (atual.length && /^\s+$/.test(atual[atual.length - 1].text)) atual.pop()
        linhas.push(atual)
    }
    return linhas.length ? linhas : [[]]
}

function desenharSegmentos(page, fonts, x, y, segmentos, size, color) {
    let cursorX = x
    for (const seg of segmentos || []) {
        const texto = String(seg.text || '')
        if (!texto) continue
        const font = seg.bold ? fonts.bold : fontCorpo(fonts)
        page.drawText(texto, { x: cursorX, y, size, font, color })
        cursorX += font.widthOfTextAtSize(texto, size)
    }
    return cursorX
}

function medirItemObservacaoModelo(item, fonts, larguraMax) {
    const tituloFont = fonts.bold
    const prefixo = `${item.numero}) `
    const titulo = item.titulo ? `${item.titulo}:` : ''
    const prefixoW = tituloFont.widthOfTextAtSize(prefixo + titulo, FONT_SIZE_OBS_TITLE)
    const linhasCorpo = parseLinhasCorpoObservacao(item.mensagem)
    let h = FONT_SIZE_OBS_TITLE + 2
    const corpoLead = LINE_LEADING

    let firstConsumed = false
    for (const linha of linhasCorpo) {
        const indent = linha.nested ? OBS_NESTED_INDENT : 0
        const avail = Math.max(40, larguraMax - indent)
        if (!firstConsumed && !linha.nested && item.titulo) {
            const restoLargura = Math.max(40, larguraMax - prefixoW - 4)
            const wrapped = quebrarSegmentosEmLinhas(linha.segmentos, fonts, FONT_SIZE_OBS, restoLargura)
            h += Math.max(0, wrapped.length - 1) * corpoLead
            firstConsumed = true
            continue
        }
        if (!firstConsumed && !linha.nested && !item.titulo) {
            const wrapped = quebrarSegmentosEmLinhas(linha.segmentos, fonts, FONT_SIZE_OBS, avail)
            h = Math.max(h, wrapped.length * corpoLead)
            firstConsumed = true
            continue
        }
        firstConsumed = true
        if (!linha.segmentos.length) {
            h += corpoLead
            continue
        }
        const wrapped = quebrarSegmentosEmLinhas(linha.segmentos, fonts, FONT_SIZE_OBS, avail)
        h += Math.max(1, wrapped.length) * corpoLead
    }
    return h + OBS_ITEM_GAP
}

function desenharItemObservacaoModelo(page, fonts, x, yTop, item, larguraMax) {
    const tituloFont = fonts.bold
    const prefixo = `${item.numero}) `
    const tituloTxt = item.titulo ? `${sanitizarTextoPdf(item.titulo)}:` : ''
    const corTitulo = COR_TEXTO
    const corCorpo = COR_TEXTO_OBS

    page.drawText(prefixo, {
        x,
        y: yTop - FONT_SIZE_OBS_TITLE,
        size: FONT_SIZE_OBS_TITLE,
        font: tituloFont,
        color: corTitulo,
    })
    const prefixoW = tituloFont.widthOfTextAtSize(prefixo, FONT_SIZE_OBS_TITLE)
    if (tituloTxt) {
        page.drawText(tituloTxt, {
            x: x + prefixoW,
            y: yTop - FONT_SIZE_OBS_TITLE,
            size: FONT_SIZE_OBS_TITLE,
            font: tituloFont,
            color: corTitulo,
        })
    }
    const tituloW = tituloFont.widthOfTextAtSize(prefixo + tituloTxt, FONT_SIZE_OBS_TITLE)

    let y = yTop - FONT_SIZE_OBS_TITLE
    const linhasCorpo = parseLinhasCorpoObservacao(item.mensagem)
    let firstConsumed = false

    for (const linha of linhasCorpo) {
        const indent = linha.nested ? OBS_NESTED_INDENT : 0
        if (!firstConsumed && !linha.nested) {
            const gap = tituloTxt ? 4 : 0
            const startX = x + tituloW + gap
            const avail = Math.max(40, larguraMax - (tituloW + gap))
            const wrapped = quebrarSegmentosEmLinhas(linha.segmentos, fonts, FONT_SIZE_OBS, avail)
            if (wrapped.length) {
                desenharSegmentos(page, fonts, startX, y, wrapped[0], FONT_SIZE_OBS, corCorpo)
                for (let i = 1; i < wrapped.length; i += 1) {
                    y -= LINE_LEADING
                    desenharSegmentos(page, fonts, x + indent, y, wrapped[i], FONT_SIZE_OBS, corCorpo)
                }
            }
            firstConsumed = true
            continue
        }
        firstConsumed = true
        y -= LINE_LEADING
        if (!linha.segmentos.length) continue
        if (linha.nested) {
            page.drawText('•', {
                x: x + 4,
                y,
                size: FONT_SIZE_OBS,
                font: fontCorpo(fonts),
                color: corCorpo,
            })
        }
        const avail = Math.max(40, larguraMax - indent)
        const wrapped = quebrarSegmentosEmLinhas(linha.segmentos, fonts, FONT_SIZE_OBS, avail)
        wrapped.forEach((segs, i) => {
            if (i > 0) y -= LINE_LEADING
            desenharSegmentos(page, fonts, x + indent, y, segs, FONT_SIZE_OBS, corCorpo)
        })
    }

    return yTop - medirItemObservacaoModelo(item, fonts, larguraMax)
}

function adicionarLinkUri(page, uri, rect) {
    const annot = page.doc.context.register(
        page.doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
            Border: [0, 0, 0],
            A: {
                Type: 'Action',
                S: 'URI',
                URI: PDFString.of(uri),
            },
        }),
    )
    page.node.addAnnot(annot)
}

function medirBlocoEncerramento(fonts, larguraMax) {
    const corpo = fontCorpo(fonts)
    const aviso =
        'Esta tabela pode ter sofrido alguma alteração, consulte com nossa equipe para ver em sua região.'
    const linhasAviso = quebrarTexto(aviso, fonts.bold, FONT_SIZE_DUVIDAS, larguraMax - 36)
    let h = Math.max(22, linhasAviso.length * LINE_LEADING + 6)
    h += 14
    h += FONT_SIZE_DUVIDAS + 4
    h += FONT_SIZE_DUVIDAS + 4
    const resp =
        'Documento confeccionado e direcionado sob Responsabilidade Técnica homologada junto ao Conselho Regional de Medicina Veterinária.'
    const linhasResp = quebrarTexto(resp, corpo, FONT_SIZE_DUVIDAS - 0.5, larguraMax)
    h += linhasResp.length * (LINE_LEADING - 1) + 10
    h += FONT_SIZE_DUVIDAS + 6
    h += (LINE_LEADING + 2) * 3 // WhatsApp, telefone, e-mail
    return h
}

/** Rodapé do molde de planos: aviso + empresa + canais. */
function desenharBlocoEncerramento(page, fonts, x, yTop, larguraMax) {
    const corpo = fontCorpo(fonts)
    let y = yTop

    const aviso =
        'Esta tabela pode ter sofrido alguma alteração, consulte com nossa equipe para ver em sua região.'
    const linhasAviso = quebrarTexto(aviso, fonts.bold, FONT_SIZE_DUVIDAS, larguraMax - 36)
    const bannerH = Math.max(22, linhasAviso.length * LINE_LEADING + 6)
    const bannerY = y - bannerH
    const iconR = 7
    const iconCx = x + 10
    const iconCy = bannerY + bannerH / 2
    page.drawCircle({
        x: iconCx,
        y: iconCy,
        size: iconR,
        color: COR_INFO_ICON,
    })
    const iW = fonts.bold.widthOfTextAtSize('i', 9)
    page.drawText('i', {
        x: iconCx - iW / 2,
        y: iconCy - 3,
        size: 9,
        font: fonts.bold,
        color: COR_BRANCO,
    })
    let yAviso = bannerY + bannerH - 4 - FONT_SIZE_DUVIDAS
    linhasAviso.forEach((ln, i) => {
        page.drawText(ln, {
            x: x + 24,
            y: yAviso - i * LINE_LEADING,
            size: FONT_SIZE_DUVIDAS,
            font: fonts.bold,
            color: COR_INFO_TEXTO,
        })
    })
    y = bannerY - 14

    page.drawText('EMERDOG PLANO DE SAÚDE ANIMAL LTDA', {
        x,
        y: y - FONT_SIZE_DUVIDAS,
        size: FONT_SIZE_DUVIDAS,
        font: fonts.bold,
        color: COR_TEXTO,
    })
    y -= FONT_SIZE_DUVIDAS + 4
    page.drawText('CRMV RS-25732-PJ', {
        x,
        y: y - FONT_SIZE_DUVIDAS,
        size: FONT_SIZE_DUVIDAS,
        font: corpo,
        color: COR_TEXTO_OBS,
    })
    y -= FONT_SIZE_DUVIDAS + 6

    const resp =
        'Documento confeccionado e direcionado sob Responsabilidade Técnica homologada junto ao Conselho Regional de Medicina Veterinária.'
    const linhasResp = quebrarTexto(resp, corpo, FONT_SIZE_DUVIDAS - 0.5, larguraMax)
    linhasResp.forEach((ln, i) => {
        page.drawText(ln, {
            x,
            y: y - (FONT_SIZE_DUVIDAS - 0.5) - i * (LINE_LEADING - 1),
            size: FONT_SIZE_DUVIDAS - 0.5,
            font: corpo,
            color: COR_TEXTO_OBS,
        })
    })
    y -= linhasResp.length * (LINE_LEADING - 1) + 12

    page.drawText('Em caso de dúvidas, disponibilizamos os canais:', {
        x,
        y: y - FONT_SIZE_DUVIDAS,
        size: FONT_SIZE_DUVIDAS,
        font: fonts.bold,
        color: COR_NAVY,
    })
    y -= FONT_SIZE_DUVIDAS + 8

    const canais = [
        { texto: 'Canal de Atendimento pelo WhatsApp', url: LINK_WHATSAPP },
        { texto: 'Telefone: 54 3039-5909', url: null },
        { texto: 'E-mail: contato@emerdog.com.br', url: null },
    ]
    for (const canal of canais) {
        const font = canal.url ? fonts.bold : corpo
        const color = canal.url ? COR_LINK : COR_TEXTO
        const ty = y - FONT_SIZE_DUVIDAS
        page.drawText(canal.texto, {
            x,
            y: ty,
            size: FONT_SIZE_DUVIDAS,
            font,
            color,
        })
        if (canal.url) {
            const tw = font.widthOfTextAtSize(canal.texto, FONT_SIZE_DUVIDAS)
            page.drawLine({
                start: { x, y: ty - 1 },
                end: { x: x + tw, y: ty - 1 },
                thickness: 0.6,
                color: COR_LINK,
            })
            adicionarLinkUri(page, canal.url, {
                x,
                y: ty - 2,
                width: tw,
                height: FONT_SIZE_DUVIDAS + 4,
            })
        }
        y -= LINE_LEADING + 2
    }

    return y
}

/**
 * Observações em folhas do template + bloco de encerramento do molde de planos.
 * @param {{
 *   finalDoc: import('pdf-lib').PDFDocument,
 *   templateDoc: import('pdf-lib').PDFDocument,
 *   templatePageIndex?: number,
 *   fonts: object,
 *   observacoes: unknown,
 *   onPagina?: (page: object, width: number, height: number) => void,
 * }} opts
 * @returns {Promise<number>}
 */
export async function adicionarPaginasObservacoesDinamicas(opts) {
    const itens = normalizarListaObservacoes(opts.observacoes)
    if (!itens.length) return 0

    const templatePageIndex = opts.templatePageIndex ?? 1
    const finalDoc = opts.finalDoc
    const templateDoc = opts.templateDoc
    const fonts = opts.fonts

    const refPage = templateDoc.getPage(templatePageIndex)
    const { width, height } = refPage.getSize()
    const x = MARGIN_X
    const larguraMax = width - MARGIN_X * 2
    const yTopLimit = height - MARGIN_TOP
    const yBottomLimit = MARGIN_BOTTOM
    const hEncerramento = medirBlocoEncerramento(fonts, larguraMax)

    const medidos = itens.map((item) => ({
        item,
        h: medirItemObservacaoModelo(item, fonts, larguraMax),
    }))

    let idx = 0
    let paginas = 0
    let guard = 0
    const maxPaginas = Math.max(10, medidos.length + 3)
    let precisaEncerramento = true

    while ((idx < medidos.length || precisaEncerramento) && guard < maxPaginas) {
        guard += 1
        paginas += 1
        const [tpl] = await finalDoc.copyPages(templateDoc, [templatePageIndex])
        const page = finalDoc.addPage(tpl)

        let y = yTopLimit
        const ehPrimeira = paginas === 1

        if (ehPrimeira) {
            const titulo = 'Observações'
            const titW = fonts.bold.widthOfTextAtSize(titulo, FONT_SIZE_OBS_H1)
            page.drawText(titulo, {
                x: x + (larguraMax - titW) / 2,
                y: y - FONT_SIZE_OBS_H1,
                size: FONT_SIZE_OBS_H1,
                font: fonts.bold,
                color: COR_NAVY,
            })
            y -= FONT_SIZE_OBS_H1 + OBS_H1_GAP
        } else if (idx < medidos.length) {
            const cont = 'Observações (cont.)'
            const titW = fonts.bold.widthOfTextAtSize(cont, FONT_SIZE_TITLE_CAT)
            page.drawText(cont, {
                x: x + (larguraMax - titW) / 2,
                y: y - FONT_SIZE_TITLE_CAT,
                size: FONT_SIZE_TITLE_CAT,
                font: fonts.bold,
                color: COR_NAVY,
            })
            y -= FONT_SIZE_TITLE_CAT + SECTION_GAP
        }

        const inicioIdx = idx
        while (idx < medidos.length) {
            const { item, h } = medidos[idx]
            const reservarEncerramento =
                idx === medidos.length - 1 ? hEncerramento + DUVIDAS_GAP : 0
            if (y - h - reservarEncerramento < yBottomLimit) break
            desenharItemObservacaoModelo(page, fonts, x, y, item, larguraMax)
            y -= h
            idx += 1
        }

        if (idx === inicioIdx && idx < medidos.length) {
            desenharItemObservacaoModelo(page, fonts, x, y, medidos[idx].item, larguraMax)
            y -= medidos[idx].h
            idx += 1
        }

        if (idx >= medidos.length && precisaEncerramento) {
            const cabeAqui = y - hEncerramento - DUVIDAS_GAP >= yBottomLimit
            if (cabeAqui) {
                y -= DUVIDAS_GAP
                desenharBlocoEncerramento(page, fonts, x, y, larguraMax)
                precisaEncerramento = false
            } else if (inicioIdx === idx) {
                desenharBlocoEncerramento(page, fonts, x, yTopLimit, larguraMax)
                precisaEncerramento = false
            }
        }

        if (typeof opts.onPagina === 'function') {
            opts.onPagina(page, width, height)
        }
    }

    return paginas
}
