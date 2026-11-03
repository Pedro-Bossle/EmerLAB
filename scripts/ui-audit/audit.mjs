/**
 * Auditoria visual automatizada (overflow horizontal, elementos fora da viewport, alvos de toque pequenos).
 * Uso: node scripts/ui-audit/audit.mjs [--base http://localhost:5173] [--out pasta] [--shots] [--only /rota] [--vp mobile]
 * Requer: Edge/Chrome instalado e `npm run dev` rodando. Supabase é MOCKADO (sem dados reais:
 * as listagens aparecem vazias; serve para casca/layout, estados vazios e modais).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { listarTodasChavesAcl } from '../../src/lib/permissionCatalog.js'
import { loadEnv } from 'vite'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : d
}
export const BASE = arg('--base', 'http://localhost:5173')
export const OUT = arg('--out', path.resolve('ui-audit-out'))
export const SHOTS = args.includes('--shots')
const ONLY = arg('--only', null)
const ONLY_VP = arg('--vp', null)
/** --real: entra com AUDIT_EMAIL/AUDIT_PASSWORD do .env.local (usuário de teste, preferencialmente somente leitura) e usa dados reais. */
export const REAL = args.includes('--real')
const env = loadEnv('development', process.cwd(), '')
const SB = new URL(env.VITE_SUPABASE_URL)
const REF = SB.hostname.split('.')[0]

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p))

export const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'notebook', width: 1366, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'mobile-sm', width: 320, height: 640, mobile: true },
].filter((v) => !ONLY_VP || v.name === ONLY_VP)

export const ROUTES = [
  '/', '/home', '/supertabeladoc', '/supertabelamain', '/supertabela/cidades', '/planos/impressao',
  '/supertabela/planos', '/supertabela/procedimentos', '/supertabela/negociacoes',
  '/credenciamento/principal', '/credenciamento/cadastro', '/credenciamento/emer-radar',
  '/credenciamento/prospectos-osm', '/credenciamento/mapa', '/credenciamento/import-kmz',
  '/credenciamento/quem-realiza', '/credenciamento/especialidades-cidade', '/credenciamento/formulario',
  '/credenciamento/formulario/entradas', '/credenciamento/especialidades-rc',
  '/configuracoes/importar-credenciados', '/configuracoes/exportar-credenciados',
  '/configuracoes/conferencia-laboratorio', '/configuracoes/observacoes-honorarios',
  '/configuracoes/observacoes-planos', '/configuracoes/impressao-etiquetas',
  '/administrativo/acessos', '/administrativo/auditoria', '/administrativo/qualidade', '/credenciamentodoc',
  '/compras/valor-venda', '/compras/orcamento', '/contratos/gerar', '/contratos/clicksign',
  '/pagamentos/registro', '/pagamentos/resumo', '/pagamentos/caixa', '/repasse_mensal/tokeninvalido0000000000000000000000000', '/ser_parceiro', '/alterar-senha', '/rota-inexistente',
].filter((r) => !ONLY || r === ONLY)

const perms = {}
for (const k of listarTodasChavesAcl()) perms[k] = true
for (const k of [
  'access.manage', 'supertabela.view', 'supertabela.edit', 'supertabela.negociacoes.view',
  'credenciamento.view', 'credenciamento.edit', 'compras.view', 'compras.edit', 'planos.view',
  'contratos.view', 'contratos.edit', 'pagamentos.view', 'pagamentos.edit', 'bate.papo',
]) perms[k] = true

let sessaoReal = null
if (REAL) {
  if (!env.AUDIT_EMAIL || !env.AUDIT_PASSWORD) throw new Error('Defina AUDIT_EMAIL e AUDIT_PASSWORD no .env.local')
  const resp = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.AUDIT_EMAIL, password: env.AUDIT_PASSWORD }),
  })
  if (!resp.ok) throw new Error(`Login do usuário de teste falhou (HTTP ${resp.status}). Confira AUDIT_EMAIL/AUDIT_PASSWORD.`)
  sessaoReal = await resp.json()
  console.log('Login do usuário de teste: ok (dados reais, só navegação).')
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', aud: 'authenticated', exp: 4102444800 })}.x`
const user = {
  id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'auditoria@emerlab.test', app_metadata: {}, user_metadata: {}, created_at: '2024-01-01T00:00:00Z',
}
const session = { access_token: jwt, refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user }
const profile = {
  id: user.id, name: 'Auditoria UI', email: user.email, permissions: perms,
  force_password_change: false, password_changed_at: new Date().toISOString(), disable_idle_logout: true,
}

fs.mkdirSync(OUT, { recursive: true })
export const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] })

export async function newPage(vp) {
  const page = await browser.newPage()
  await page.setViewport({
    width: vp.width, height: vp.height, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile,
  })
  await page.evaluateOnNewDocument(
    (ref, s) => {
      try {
        sessionStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s))
      } catch {
        /* ignore */
      }
    },
    REF,
    sessaoReal || session,
  )
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (REAL && u.hostname === SB.hostname) return req.continue()
    if (u.hostname === SB.hostname) {
      const headers = {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range',
      }
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
      const single = /object\+json/.test(req.headers().accept || '')
      if (u.pathname.includes('/auth/v1/user')) {
        return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(user) })
      }
      if (u.pathname.includes('/rest/v1/profiles')) {
        return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(single ? profile : [profile]) })
      }
      if (u.pathname.includes('/rest/v1/')) {
        if (single) {
          return req.respond({ status: 406, headers, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) })
        }
        return req.respond({ status: 200, headers: { ...headers, 'content-range': '*/0' }, contentType: 'application/json', body: '[]' })
      }
      return req.respond({ status: 200, headers, contentType: 'application/json', body: '{}' })
    }
    if (u.hostname !== new URL(BASE).hostname && !/^(data|blob):/.test(req.url())) {
      if (/fonts\.(googleapis|gstatic)/.test(u.hostname)) return req.continue()
      return req.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{}' })
    }
    if (u.pathname.startsWith('/api/')) {
      const m = globalThis.__apiMock?.(req)
      if (m) return req.respond(m)
      return req.respond({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return req.continue()
  })
  return page
}

/** Executado no navegador. */
export const measure = () => {
  const vw = document.documentElement.clientWidth
  const doc = document.documentElement
  const res = { vw, scrollW: doc.scrollWidth, overflowX: doc.scrollWidth > vw + 1, offenders: [], small: 0, smallSamples: [], tinyText: 0 }
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true
    }
    return false
  }
  const desc = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${[...el.classList].slice(0, 3).map((c) => '.' + c).join('')}`
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (cs.position === 'fixed' && r.right <= vw + 1 && r.left >= -1) continue
    if (r.right > vw + 1 && !inScroller(el) && res.offenders.length < 8) {
      res.offenders.push({ el: desc(el), right: Math.round(r.right), w: Math.round(r.width) })
    }
    if (['BUTTON', 'A', 'INPUT', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'button') {
      const naoToque = el.tagName === 'INPUT' && ['checkbox', 'radio', 'hidden'].includes(el.type)
      if ((r.height < 32 || r.width < 32) && !naoToque && r.top < innerHeight * 3) {
        res.small++
        if (res.smallSamples.length < 4) res.smallSamples.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    if (
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
      parseFloat(cs.fontSize) < 11
    ) res.tinyText++
  }
  return res
}

if (process.argv[1] && process.argv[1].endsWith('audit.mjs')) {
  const report = []
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const page = await newPage(vp)
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
      try {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise((r) => setTimeout(r, 2200))
        const finalPath = new URL(page.url()).pathname
        const m = await page.evaluate(measure)
        if (SHOTS) {
          const dir = path.join(OUT, vp.name)
          fs.mkdirSync(dir, { recursive: true })
          await page.screenshot({ path: path.join(dir, (route.replace(/\W+/g, '_') || 'root') + '.png') })
        }
        report.push({ vp: vp.name, route, finalPath, ...m, errors })
        const flag = m.overflowX || m.offenders.length ? 'OVERFLOW' : 'ok'
        console.log(
          `${vp.name.padEnd(9)} ${route.padEnd(42)} ${flag.padEnd(8)} ${finalPath !== route ? '->' + finalPath : ''} small=${m.small} err=${errors.length} off=${m.offenders.map((o) => o.el).join('|')}`,
        )
      } catch (e) {
        report.push({ vp: vp.name, route, error: String(e.message) })
        console.log(`${vp.name} ${route} ERRO ${e.message}`)
      }
      await page.close()
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  await browser.close()
}
