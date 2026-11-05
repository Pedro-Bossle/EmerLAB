/** Confere que filtros da aba Maps não vazam para as abas de redes (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const RUN = '20261023_234418_8c5ef8'
const page = await newPage(VIEWPORTS.find((v) => v.name === 'desktop'))
const ler = () =>
  page.evaluate(() => ({
    contagem: document.querySelector('.er-run__contagem')?.innerText,
    linhas: document.querySelectorAll('.er-run tbody tr').length,
  }))
await page.goto(`${BASE}/credenciamento/emer-radar/execucao/${RUN}?nota=4.5`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.er-run__aba', { timeout: 40000 })
await new Promise((r) => setTimeout(r, 800))
console.log('maps nota>=4,5', JSON.stringify(await ler()))
const abas = await page.$$('.er-run__aba')
await abas[3].click()
await new Promise((r) => setTimeout(r, 600))
console.log('emerdog após trocar', JSON.stringify(await ler()), page.url().split('?')[1])
await page.goto(`${BASE}/credenciamento/emer-radar/execucao/${RUN}?aba=emerdog&nota=4.5`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.er-run__aba', { timeout: 40000 })
await new Promise((r) => setTimeout(r, 800))
console.log('emerdog com nota na URL', JSON.stringify(await ler()))
await browser.close()
