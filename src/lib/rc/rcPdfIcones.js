import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
export const RC_ASSETS_DIR = path.resolve(LIB_DIR, '..', '..', 'assets', 'rc')

const ICON_RASTER_PX = 48

async function rasterizarSvgParaDataUriPng(page, svgPath) {
    const svg = await fs.readFile(svgPath, 'utf8')
    const px = ICON_RASTER_PX
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 2 })
    await page.setContent(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:transparent">${svg}</body></html>`,
        { waitUntil: 'load' }
    )
    const handle = await page.$('svg')
    if (!handle) throw new Error(`SVG inválido ou ausente: ${svgPath}`)
    const png = await handle.screenshot({ type: 'png' })
    await handle.dispose()
    return `data:image/png;base64,${png.toString('base64')}`
}

/** Ícones em PNG (data URI) para impressão confiável em todos os cards do overlay RC. */
export async function carregarIconesRcParaHtml(browser) {
    const iconPage = await browser.newPage()
    try {
        const estetoscopioPath = path.join(RC_ASSETS_DIR, 'estetoscopio.svg')
        const telefonePath = path.join(RC_ASSETS_DIR, 'telefone.svg')
        // Mesma página não pode rasterizar dois SVGs em paralelo (setContent disputa).
        const estetoscopio = await rasterizarSvgParaDataUriPng(iconPage, estetoscopioPath)
        const telefone = await rasterizarSvgParaDataUriPng(iconPage, telefonePath)
        return { estetoscopio, telefone }
    } finally {
        await iconPage.close()
    }
}

export async function aguardarImagensIcones(page) {
    await page.evaluate(() =>
        Promise.all(
            [...document.querySelectorAll('img.icon')].map((img) => {
                if (img.complete && img.naturalWidth > 0) return Promise.resolve()
                return new Promise((resolve) => {
                    img.addEventListener('load', resolve, { once: true })
                    img.addEventListener('error', resolve, { once: true })
                })
            })
        )
    )
}

/**
 * Reduz a fonte de nomes/títulos até caberem numa linha (sem reticências).
 * Alvos: `.card-corpo h3` e `.card-topo > span`.
 */
export async function ajustarFontesTextosRc(page) {
    await page.evaluate(() => {
        const reduzirAteCabar = (el, minPx) => {
            if (!el) return
            let size = parseFloat(window.getComputedStyle(el).fontSize)
            if (!Number.isFinite(size) || size <= 0) return
            // Garante medição em linha única.
            el.style.whiteSpace = 'nowrap'
            el.style.overflow = 'hidden'
            el.style.textOverflow = 'clip'
            let guard = 80
            while (guard-- > 0 && el.scrollWidth > el.clientWidth + 0.5 && size > minPx) {
                size -= 0.25
                el.style.fontSize = `${size}px`
            }
        }

        document.querySelectorAll('.card-corpo h3').forEach((el) => reduzirAteCabar(el, 7))
        document.querySelectorAll('.card-topo > span, .card-topo').forEach((el) => {
            // Preferir o span interno quando existir.
            if (el.matches('.card-topo') && el.querySelector(':scope > span')) return
            reduzirAteCabar(el, 8)
        })
    })
}
