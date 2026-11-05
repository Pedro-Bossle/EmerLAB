/** Testa a página de resultados e a lista de tráfego (só leitura, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
const page = await newPage(VIEWPORTS.find((v) => v.name === 'desktop'))
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' && !/502|Failed to load/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200))
})

await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.er-exec tbody tr', { timeout: 40000 })
const trafego = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.er-trafego__chip')].map((e) => e.innerText.replace(/\n/g, ' ')),
  quase: document.querySelector('.er-trafego__quase')?.innerText,
  linhasSemAbrir: document.querySelectorAll('.er-trafego tbody tr').length,
}))
console.log('tráfego', JSON.stringify(trafego))
await page.click('.er-trafego__chip')
await new Promise((r) => setTimeout(r, 500))
console.log('linhas após abrir:', await page.evaluate(() => document.querySelectorAll('.er-trafego tbody tr').length))
await (await page.$('.er-trafego')).scrollIntoView()
await page.screenshot({ path: `${saida}/radar-trafego.png` })

await page.goto(BASE + '/credenciamento/emer-radar/execucao/20261023_234418_8c5ef8', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.er-run tbody tr', { timeout: 40000 })
const info = async () =>
  page.evaluate(() => ({
    abas: [...document.querySelectorAll('.er-run__aba')].map((e) => e.innerText.replace(/\n/g, ' ')),
    contagem: document.querySelector('.er-run__contagem')?.innerText,
    primeiras: [...document.querySelectorAll('.er-run tbody tr')].slice(0, 3).map((tr) => tr.querySelector('td').innerText.split('\n')[0]),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
console.log('resultados', JSON.stringify(await info()))
await page.screenshot({ path: `${saida}/radar-resultados.png` })
await page.click('.er-run thead th:nth-child(4) button')
await new Promise((r) => setTimeout(r, 400))
console.log('ordenado por nota', JSON.stringify(await info()))
await page.type('.ek-toolbar input[type=search]', 'vet')
await new Promise((r) => setTimeout(r, 600))
console.log('filtro vet', JSON.stringify(await info()), page.url().split('?')[1])
const abas = await page.$$('.er-run__aba')
if (abas[1]) {
  await abas[1].click()
  await new Promise((r) => setTimeout(r, 400))
  console.log('aba 2', JSON.stringify(await info()))
}
await browser.close()
