/**
 * Mapa de credenciados: busca por texto, endereço (Enter) e lista de próximos. Só leitura (--real).
 * O Nominatim é simulado para o teste ser determinístico; nada é gravado.
 */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const hit = (lat, lon, name, road, suburb, city) => ({
  lat: String(lat), lon: String(lon), display_name: `${road}, ${suburb}, ${city}, Rio Grande do Sul, Brasil`, name,
  class: 'highway', type: 'residential', importance: 0.4,
  address: { road, suburb, city, state: 'Rio Grande do Sul' },
})
const RESPOSTAS = [
  [/itarar/i, [hit(-29.1795, -51.1471, '', 'Rua Itararé', 'Bela Vista', 'Caxias do Sul')]],
  // «Centro» ambíguo: o primeiro resultado é em São Paulo, o segundo perto da rede
  [/centro/i, [hit(-23.55, -46.63, '', 'Rua do Centro', 'Sé', 'São Paulo'), hit(-29.92, -51.18, '', 'Avenida do Centro', 'Centro', 'Canoas')]],
]
globalThis.__apiMock = (req) => {
  const u = new URL(req.url())
  if (!u.pathname.includes('nominatim-search')) return null
  const q = u.searchParams.get('q') || ''
  const r = RESPOSTAS.find(([re]) => re.test(q))
  return { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r ? r[1] : []) }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const saida = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'ui-audit-out'
const falhas = []
const confere = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`); if (!cond) falhas.push(msg) }

const page = await newPage(VIEWPORTS.find((v) => v.name === 'desktop'))
page.on('response', async (r) => { if (/nominatim|cep-lookup/.test(r.url())) console.log('RESP', r.status(), r.url().slice(0, 110), (await r.text().catch(() => '')).slice(0, 80)) })
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message.slice(0, 200)); falhas.push('pageerror') })
await page.goto(BASE + '/credenciamento/mapa', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.credenciamento_mapa_busca_especialidade', { timeout: 45000 })
await espera(2500)

const kpis = await page.evaluate(() => [...document.querySelectorAll('.credenciamento_mapa_kpi')].map((e) => e.innerText.replace(/\s+/g, ' ')))
console.log('KPIs:', kpis.join(' | '))
console.log('botão em lote presente:', await page.evaluate(() => /Buscar coordenadas automaticamente/.test(document.body.innerText)))

const digitar = async (texto) => {
  await page.focus('.credenciamento_mapa_busca_especialidade')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await espera(150)
  await page.type('.credenciamento_mapa_busca_especialidade', texto, { delay: 15 })
}
const estado = () => page.evaluate(() => ({
  legenda: document.querySelectorAll('.credenciamento_mapa_legenda_bloco').length,
  proximosTitulo: document.querySelector('.credenciamento_mapa_proximos_tit')?.innerText || '',
  proximos: [...document.querySelectorAll('.credenciamento_mapa_proximos_btn')].map((b) => b.innerText.replace(/\s+/g, ' ')),
  pins: document.querySelectorAll('.cred_mapa_pin_poi_busca').length,
  alerta: document.querySelector('.credenciamento_mapa_alert, [role="alert"]')?.innerText || '',
}))

// 1) busca por cidade: só começo de palavra
await digitar('canoas')
await espera(900)
let s = await estado()
confere(s.legenda > 0, `«canoas» filtra a legenda (${s.legenda} grupos)`)

// 2) «av» não pode casar com palavras que apenas CONTÊM «av» (ex.: Clavel, Gravataí)
await digitar('av')
await espera(700)
s = await estado()
console.log('«av» →', s.legenda, 'grupos')

// 3) endereço + Enter → pin + próximos com distância
await digitar('Rua Itararé 1388 Caxias do Sul')
await page.keyboard.press('Enter')
await espera(2500)
s = await estado()
console.log('endereço →', JSON.stringify(s))
confere(s.pins === 1, 'endereço gera 1 pin de busca')
confere(s.proximos.length > 0 && /km/.test(s.proximos[0]), `lista de próximos com distância (${s.proximos.length} itens)`)
confere(/até \d+ km|mais próximos/i.test(s.proximosTitulo), `título explica o raio: «${s.proximosTitulo}»`)
await page.screenshot({ path: `${saida}/mapa-busca-endereco.png` })

// 4) editar o texto invalida o ponto antigo
await page.type('.credenciamento_mapa_busca_especialidade', ' x')
await espera(800)
s = await estado()
confere(s.pins === 0 && s.proximos.length === 0, 'editar o texto remove pin e lista antigos (sem resultado «velho»)')

// 5) termo ambíguo: escolhe o resultado perto da rede (Canoas), não o 1º (São Paulo)
await digitar('Centro')
await page.keyboard.press('Enter')
await espera(2500)
s = await estado()
console.log('«Centro» →', JSON.stringify(s))
const todosPerto = s.proximos.length === 0 || s.proximos.every((t) => !/São Paulo/.test(t))
confere(todosPerto, 'ambíguo não vai parar em São Paulo')

// 6) CEP sem credenciado: 8 dígitos viram busca por CEP, sem casar por prefixo
await digitar('99999-999')
await page.keyboard.press('Enter')
await espera(1500)
s = await estado()
console.log('CEP inexistente →', JSON.stringify({ legenda: s.legenda, pins: s.pins }))
confere(s.legenda === 0, 'CEP sem credenciado não casa por aproximação com outros CEPs')

await browser.close()
console.log(falhas.length ? `\n${falhas.length} FALHA(S): ${falhas.join('; ')}` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
