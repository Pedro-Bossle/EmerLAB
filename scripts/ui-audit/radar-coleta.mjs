/** Aba Coleta automática simplificada (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

for (const vp of ['desktop', 'mobile']) {
  const page = await newPage(VIEWPORTS.find((v) => v.name === vp))
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
  await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.emer-radar-tabs button', { timeout: 40000 })
  await esperar(2500)
  const abas = await page.evaluate(() => [...document.querySelectorAll('.emer-radar-tabs button')].map((b) => b.innerText))
  await page.evaluate(() => [...document.querySelectorAll('.emer-radar-tabs button')].find((b) => /Coleta/.test(b.innerText)).click())
  await esperar(3500)
  const info = await page.evaluate(() => ({
    cartoes: [...document.querySelectorAll('.emer-radar-panel__title')].map((e) => e.innerText),
    botoes: [...document.querySelectorAll('.emer-radar-panel button')].map((b) => b.innerText).filter((t) => /tráfego|Enfileirar|Rodar|Parar/.test(t)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, JSON.stringify({ abas, ...info }))
  // cola uma cidade para ver a pré-visualização
  await page.type('textarea', 'Gramado\nCanela/RS')
  await esperar(1500)
  console.log(vp, 'preview', await page.evaluate(() => document.querySelector('.emer-radar-preview__title')?.innerText))
  await page.screenshot({ path: `${saida}/coleta-${vp}.png` })
}
await browser.close()
