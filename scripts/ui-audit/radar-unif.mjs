/** Emer-Radar unificado: abas do topo, catálogo, página de resultados com cartões (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
const RUN = '20261023_234418_8c5ef8'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

for (const vp of ['desktop', 'mobile']) {
  const page = await newPage(VIEWPORTS.find((v) => v.name === vp))
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/502|Failed to load|same key/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200))
  })

  await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.emer-radar-tabs button', { timeout: 40000 })
  await esperar(3500)
  const topo = await page.evaluate(() => ({
    abas: [...document.querySelectorAll('.emer-radar-tabs button')].map((b) => b.innerText + (b.className.includes('is-active') ? '*' : '')),
    cartoes: document.querySelectorAll('.emer-radar-card').length,
    filtros: document.querySelectorAll('.emer-radar-filters > *').length,
    planosOpcoes: !!document.body.innerText.match(/Planos: todos|Já estão em algum plano/),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, 'catálogo', JSON.stringify(topo))
  await page.screenshot({ path: `${saida}/unif-catalogo-${vp}.png` })

  await page.goto(`${BASE}/credenciamento/emer-radar/execucao/${RUN}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.er-run__aba', { timeout: 40000 })
  await esperar(4000)
  const run = await page.evaluate(() => ({
    abas: [...document.querySelectorAll('.er-run__aba')].map((e) => e.innerText.replace(/\n/g, ' ')),
    cartoes: document.querySelectorAll('.emer-radar-card').length,
    comFoto: document.querySelectorAll('.emer-radar-card__media img').length,
    comHorario: document.querySelectorAll('.emer-radar-card__hours').length,
    aviso: document.querySelector('.er-exec__alerta')?.innerText,
    botaoCatalogo: [...document.querySelectorAll('button')].map((b) => b.innerText).find((t) => /ao catálogo/.test(t)),
    kanban: [...document.querySelectorAll('.emer-radar-card__btn-kanban')].length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  console.log(vp, 'execução/maps', JSON.stringify(run))
  await page.screenshot({ path: `${saida}/unif-execucao-${vp}.png` })

  if (vp === 'desktop') {
    const abas = await page.$$('.er-run__aba')
    await abas[1].click()
    await esperar(600)
    console.log('aba 2', JSON.stringify(await page.evaluate(() => ({ linhas: document.querySelectorAll('.er-run tbody tr').length, contagem: document.querySelector('.er-run__contagem')?.innerText }))))
  }
}
await browser.close()
