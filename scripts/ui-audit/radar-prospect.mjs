/** Prospect Maps: prints da busca e do catálogo (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
for (const vp of ['desktop', 'mobile']) {
  const page = await newPage(VIEWPORTS.find((v) => v.name === vp))
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
  await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.emer-radar-tabs button', { timeout: 40000 })
  await page.evaluate(() => [...document.querySelectorAll('.emer-radar-tabs button')].find((b) => /Prospect/.test(b.innerText)).click())
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: `${saida}/prospect-busca-${vp}.png` })
  await page.evaluate(() => [...document.querySelectorAll('.emer-radar-mode-toggle button')].find((b) => /Catálogo/.test(b.innerText)).click())
  await new Promise((r) => setTimeout(r, 3500))
  const info = await page.evaluate(() => ({
    cartoes: document.querySelectorAll('.emer-radar-prospect-card, [class*="prospect-card"]').length,
    hint: [...document.querySelectorAll('.ek-hint')].map((e) => e.innerText).filter((t) => /prospecto/.test(t)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, JSON.stringify(info))
  await page.screenshot({ path: `${saida}/prospect-catalogo-${vp}.png` })
}
await browser.close()
