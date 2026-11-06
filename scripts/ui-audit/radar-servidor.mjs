/** Ícone de download do servidor de prospecção + modal (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
for (const vp of ['desktop', 'mobile']) {
  const page = await newPage(VIEWPORTS.find((v) => v.name === vp))
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
  await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.emer-radar-servidor-btn', { timeout: 40000 })
  await esperar(1500)
  await page.click('.emer-radar-servidor-btn')
  await esperar(2500)
  const info = await page.evaluate(() => ({
    titulo: document.querySelector('.ek-modal h2, .ek-modal [id]')?.innerText,
    estado: document.querySelector('.er-servidor__estado')?.innerText,
    passos: document.querySelectorAll('.er-servidor__passos li').length,
    arquivo: document.querySelector('.er-servidor__arquivo')?.innerText,
    botao: [...document.querySelectorAll('.ek-modal button')].map((b) => b.innerText + (b.disabled ? ' (desativado)' : '')),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, JSON.stringify(info))
  await page.screenshot({ path: `${saida}/servidor-modal-${vp}.png` })
}
await browser.close()
