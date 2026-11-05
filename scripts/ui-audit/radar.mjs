/**
 * Abre o Emer-Radar com login de teste (só leitura) e tira prints. Uso: node scripts/ui-audit/radar.mjs --real [--out=pasta]
 */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
for (const vp of ['desktop', 'mobile']) {
  const page = await newPage(VIEWPORTS.find((v) => v.name === vp))
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
  await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.er-exec tbody tr', { timeout: 40000 })
  const info = await page.evaluate(() => ({
    stats: [...document.querySelectorAll('.er-stat')].map((e) => e.innerText.replace(/\n+/g, ' | ')),
    alertas: document.querySelectorAll('.er-exec__alerta').length,
    linhas: document.querySelectorAll('.er-exec tbody tr').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, JSON.stringify(info))
  if (vp === 'desktop') {
    await page.evaluate(() => document.querySelector('.er-exec tbody tr button').click())
    await new Promise((r) => setTimeout(r, 5000))
    const n = await page.evaluate(() => ({
      tabelas: document.querySelectorAll('.emer-radar-table').length,
      linhas: document.querySelectorAll('.emer-radar-table tbody tr').length,
      botao: document.querySelector('.er-exec tbody tr button')?.innerText,
    }))
    console.log('após abrir a execução:', JSON.stringify(n))
    await page.screenshot({ path: `${saida}/radar-desktop-resultados.png`, fullPage: false })
  }
}
await browser.close()
