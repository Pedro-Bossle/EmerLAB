/**
 * Prints de UMA rota nas resoluções escolhidas, em claro e escuro.
 * Uso: node scripts/ui-audit/shot.mjs /rota [--real] [--vp desktop|notebook|tablet|mobile|mobile-sm] [--dark] [--out pasta]
 */
import path from 'node:path'
import fs from 'node:fs'
import { newPage, BASE, OUT, VIEWPORTS, measure, browser } from './audit.mjs'
const rota = process.argv[2]
const claroEscuro = process.argv.includes('--dark') ? ['claro', 'escuro'] : ['claro']
fs.mkdirSync(OUT, { recursive: true })
for (const vp of VIEWPORTS) {
  for (const modo of claroEscuro) {
    const page = await newPage(vp)
    await page.evaluateOnNewDocument((m) => {
      if (m === 'escuro') localStorage.setItem('emerlab-dark-mode', 'true')
    }, modo)
    await page.goto(BASE + rota, { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 2500))
    if (modo === 'escuro') await page.evaluate(() => document.body.classList.add('dark-mode'))
    if (modo === 'escuro') await new Promise((r) => setTimeout(r, 500))
    const m = await page.evaluate(measure)
    const arq = path.join(OUT, `${rota.replace(/\W+/g, '_')}_${vp.name}_${modo}.png`)
    await page.screenshot({ path: arq })
    console.log(vp.name, modo, m.overflowX ? 'OVERFLOW' : 'ok', 'small=' + m.small, arq)
    await page.close()
  }
}
await browser.close()
