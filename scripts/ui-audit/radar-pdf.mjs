/** Exportação (PDF/Excel) só com os não removidos (só leitura: remoção simulada via localStorage, --real). */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const page = await newPage(VIEWPORTS.find((v) => v.name === 'desktop'))
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)))
page.on('console', (m) => {
  if (m.type() === 'error' && !/502|Failed to load|same key/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200))
})

await page.goto(BASE + '/credenciamento/emer-radar', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.emer-radar-card', { timeout: 40000 })
await esperar(1500)

// captura os downloads sem salvar arquivo
await page.evaluate(() => {
  window.__baixados = []
  const orig = URL.createObjectURL
  URL.createObjectURL = (blob) => {
    window.__ultimoBlob = blob
    return orig(blob)
  }
  HTMLAnchorElement.prototype.click = function () {
    window.__baixados.push({ nome: this.download, bytes: window.__ultimoBlob?.size })
  }
})

const total = await page.evaluate(() => document.querySelectorAll('.emer-radar-card').length)
console.log('cartões exibidos:', total)

for (const rotulo of ['PDF', 'Excel']) {
  await page.evaluate((r) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === r)?.click(), rotulo)
  await esperar(rotulo === 'PDF' ? 6000 : 3000)
}
console.log('downloads:', JSON.stringify(await page.evaluate(() => window.__baixados)))

// o próprio gerador devolve quantos itens entraram: testa com a lista completa x sem os removidos
const r = await page.evaluate(async () => {
  const { exportarProspectosMapsParaPdf } = await import('/src/lib/credenciamento/exportProspectosMapsPdf.js')
  const base = [
    { nome: 'A', endereco: 'Rua 1', cidade: 'Imbé', uf: 'RS', telefone: '(51) 1', horario: 'Seg 08-18', nota: '4,5' },
    { nome: 'B', endereco: 'Rua 2', cidade: 'Imbé', uf: 'RS', telefone: '(51) 2' },
    { nome: 'C', endereco: 'Rua 3', cidade: 'Imbé', uf: 'RS', telefone: '(51) 3', planos: ['petlove'] },
  ]
  const todos = await exportarProspectosMapsParaPdf(base)
  const semB = await exportarProspectosMapsParaPdf(base.filter((x) => x.nome !== 'B'))
  const vazio = await exportarProspectosMapsParaPdf([])
  return { todos: todos.total, semB: semB.total, vazio }
})
console.log('gerador:', JSON.stringify(r))
await browser.close()
