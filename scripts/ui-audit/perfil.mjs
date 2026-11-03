/**
 * Mede a abertura de um perfil de prestador (só leitura, usuário de teste). Uso: node scripts/ui-audit/perfil.mjs --real [--id N]
 * Mostra o tempo até o formulário ficar pronto e quantas requisições ao Supabase/IBGE foram feitas.
 */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'

const page = await newPage(VIEWPORTS.find((v) => v.name === 'desktop'))
const reqs = []
const marcas = []
const DO_PERFIL = new Set(['prestador_cidades', 'prestador_especialidades', 'prestador_estabelecimentos', 'prestador_procedimentos', 'procedimentos', 'prestador_laboratorios_solicitacao', 'prestador_responsaveis', 'prestador_certificados_conclusao'])
page.on('requestfinished', (r) => {
  const u = r.url()
  if (/supabase\.co\/rest/.test(u)) {
    const tabela = u.split('/rest/v1/')[1].split('?')[0]
    reqs.push(tabela)
    marcas.push([tabela, Date.now()])
  }
  if (/ibge-municipios/.test(u)) reqs.push('ibge')
})
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)))

await page.goto(BASE + '/credenciamento/cadastro', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('tbody tr', { timeout: 40000 })
const idx = Number(process.argv.find((a) => a.startsWith('--linha='))?.split('=')[1] || 0)
await page.evaluate((i) => document.querySelectorAll('tbody tr')[i].querySelector('a, td')?.click(), idx)
await page.waitForFunction(() => location.pathname.startsWith('/credenciamento/cadastro/') && location.pathname.length > 26, { timeout: 20000 })
const href = new URL(page.url()).pathname
console.log('perfil:', href)
reqs.length = 0
const t0 = Date.now()
await page.goto(BASE + href, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 12000))
await new Promise((r) => setTimeout(r, 1500))
const cont = reqs.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})
const doPerfil = marcas.filter(([t, quando]) => DO_PERFIL.has(t) && quando >= t0)
const ultima = Math.max(...doPerfil.map(([, q]) => q)) - t0
console.log('últimas consultas do perfil terminaram em', ultima, 'ms;', doPerfil.length, 'consultas do perfil (total', reqs.length, ')')
console.log(JSON.stringify(cont))
await browser.close()
