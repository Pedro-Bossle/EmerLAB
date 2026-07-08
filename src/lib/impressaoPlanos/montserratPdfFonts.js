import { StandardFonts } from 'pdf-lib'

const FONT_URLS = {
    light: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.8/latin-300-normal.ttf',
    regular:
        'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.8/latin-400-normal.ttf',
    bold: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.8/latin-700-normal.ttf',
    medium: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.8/latin-500-normal.ttf',
    italic: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.8/latin-400-italic.ttf',
}

async function fetchFontBytes(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fonte não carregada: ${url}`)
    return res.arrayBuffer()
}

/**
 * @returns {Promise<{
 *   light: import('pdf-lib').PDFFont,
 *   regular: import('pdf-lib').PDFFont,
 *   bold: import('pdf-lib').PDFFont,
 *   medium: import('pdf-lib').PDFFont,
 *   italic: import('pdf-lib').PDFFont,
 * }>}
 */
export async function embedMontserratNoPdf(pdfDoc) {
    try {
        const [light, reg, bold, medium, italic] = await Promise.all([
            fetchFontBytes(FONT_URLS.light),
            fetchFontBytes(FONT_URLS.regular),
            fetchFontBytes(FONT_URLS.bold),
            fetchFontBytes(FONT_URLS.medium),
            fetchFontBytes(FONT_URLS.italic),
        ])
        return {
            light: await pdfDoc.embedFont(light, { subset: true }),
            regular: await pdfDoc.embedFont(reg, { subset: true }),
            bold: await pdfDoc.embedFont(bold, { subset: true }),
            medium: await pdfDoc.embedFont(medium, { subset: true }),
            italic: await pdfDoc.embedFont(italic, { subset: true }),
        }
    } catch {
        const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
        return {
            light: regular,
            regular,
            bold,
            medium: regular,
            italic: regular,
        }
    }
}
