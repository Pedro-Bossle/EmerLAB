/**
 * Abre um dropdown em tela real e tira print.
 * Uso: node scripts/ui-audit/dd.mjs /rota "<seletor do gatilho>" [indice] [--real] [--vp mobile] [--out pasta]
 */
import { newPage, BASE, VIEWPORTS, OUT, browser } from './audit.mjs'
import path from 'node:path'
import fs from 'node:fs'

const [rota, seletor, idx = '0'] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const page = await newPage(VIEWPORTS.find((v) => v.name === 'notebook'))
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
await page.goto(BASE + rota, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 7000))
const n = await page.evaluate((s) => document.querySelectorAll(s).length, seletor)
console.log('gatilhos:', n)
const els = await page.$$(seletor)
if (els[Number(idx)]) {
  await els[Number(idx)].click()
  await new Promise((r) => setTimeout(r, 600))
}
const arq = path.join(OUT, 'dd_' + rota.replace(/\W+/g, '_') + '_' + idx + '.png')
await page.screenshot({ path: arq })
console.log(arq)
await browser.close()
