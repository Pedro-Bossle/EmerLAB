/**
 * Teste geométrico dos modais legados: injeta a estrutura real de cada família (mesmas classes que
 * os componentes usam) com conteúdo longo e verifica, em cada resolução, se painel, cabeçalho e
 * rodapé ficam dentro da área visível e sem rolagem horizontal.
 * Uso: node scripts/ui-audit/modais.mjs [--shots]   (precisa do `npm run dev`)
 */
import fs from 'node:fs'
import path from 'node:path'
import { newPage, BASE, OUT, VIEWPORTS, SHOTS, browser } from './audit.mjs'

const longo = Array.from({ length: 40 }, (_, i) => `<p>Linha ${i + 1} — conteúdo extenso do modal para forçar rolagem interna e checar limites.</p>`).join('')
const botoes = '<button type="button">Cancelar</button><button type="button">Salvar alterações</button>'

// rota que carrega a folha da família · seletor do backdrop · painel · corpo rolável (se houver) · rodapé (se houver)
const FAMILIAS = [
  { nome: 'home_dash_modal', rota: '/home', backdrop: 'home_dash_modal_backdrop', panel: 'home_dash_modal', head: 'home_dash_modal_head', foot: 'home_dash_modal_actions' },
  { nome: 'credenciamento_modal', rota: '/credenciamento/principal', backdrop: 'credenciamento_modal_backdrop', panel: 'credenciamento_modal', foot: 'credenciamento_modal_actions' },
  { nome: 'contratos_modal', rota: '/contratos/gerar', backdrop: 'contratos_modal_backdrop', panel: 'contratos_modal', head: 'contratos_modal_head', body: 'contratos_modal_body', foot: 'contratos_modal_foot' },
  { nome: 'pcad_modal', rota: '/credenciamento/cadastro', backdrop: 'pcad_modal_backdrop', panel: 'pcad_modal', head: 'pcad_modal_head', body: 'pcad_honorarios_scroll', foot: 'pcad_modal_foot' },
  { nome: 'pag_exp_modal', rota: '/pagamentos/registro', backdrop: 'pag_exp_backdrop', panel: 'pag_exp_modal', head: 'pag_exp_head' },
  { nome: 'admin_auditoria_modal', rota: '/administrativo/auditoria', backdrop: 'admin_auditoria_modal_backdrop', panel: 'admin_auditoria_modal' },
  { nome: 'cred_kanban_modal', rota: '/credenciamento/principal', backdrop: 'cred_kanban_modal_backdrop', panel: 'cred_kanban_modal', foot: 'cred_kanban_modal_footer' },
  { nome: 'ui/Modal (Tailwind)', rota: '/home', ui: true },
]

const falhas = []
for (const vp of VIEWPORTS) {
  for (const f of FAMILIAS) {
    const page = await newPage(vp)
    await page.goto(BASE + f.rota, { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 1800))
    const r = await page.evaluate(
      (fam, conteudo, bts) => {
        const el = document.createElement('div')
        const mk = (c, inner = '') => `<div class="${c}">${inner}</div>`
        if (fam.ui) {
          el.innerHTML = `<div class="ek-modal-overlay"><div role="dialog" class="ek-modal"><div class="ek-modal__head" data-head>Título</div><div class="ek-modal__body" data-body>${conteudo}</div><div class="ek-modal__foot" data-foot>${bts}</div></div></div>`
        } else {
          const head = fam.head ? mk(fam.head, '<h3>Título do modal</h3><button type="button" class="sih_modal_close pcad_modal_close">×</button>') : '<h3>Título do modal</h3>'
          const body = fam.body ? mk(fam.body, conteudo) : conteudo
          const foot = fam.foot ? mk(fam.foot, bts) : ''
          el.innerHTML = `<div class="${fam.backdrop}"><div class="${fam.panel}" role="dialog">${head}${body}${foot}</div></div>`
        }
        document.body.appendChild(el)
        const vw = document.documentElement.clientWidth
        const vh = window.innerHeight
        const panel = el.querySelector('[role=dialog]')
        const pr = panel.getBoundingClientRect()
        const foot = el.querySelector(fam.ui ? '[data-foot]' : fam.foot ? '.' + fam.foot : '____')
        const fr = foot?.getBoundingClientRect()
        const lastBtn = foot?.querySelector('button')?.getBoundingClientRect()
        const sw = document.documentElement.scrollWidth
        const backdrop = el.firstElementChild
        const rolavel = backdrop.scrollHeight > backdrop.clientHeight + 1 || panel.scrollHeight > panel.clientHeight + 1 || [...panel.querySelectorAll('*')].some((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY))
        return {
          panel: { l: Math.round(pr.left), t: Math.round(pr.top), r: Math.round(pr.right), b: Math.round(pr.bottom) },
          vw, vh,
          foraH: pr.left < -1 || pr.right > vw + 1,
          foraV: pr.top < -1 || pr.bottom > vh + 1,
          rodapeVisivel: fr ? fr.bottom <= vh + 1 && fr.top >= 0 : null,
          botaoToque: lastBtn ? Math.round(lastBtn.height) : null,
          overflowPagina: sw > vw + 1,
          rolavel,
        }
      },
      f, longo, botoes,
    )
    // O painel pode rolar com o backdrop (kanban/auditoria): só exigimos que o topo esteja visível e que haja rolagem.
    const rolaComBackdrop = ['admin_auditoria_modal', 'cred_kanban_modal'].includes(f.nome)
    const problemas = []
    if (r.foraH) problemas.push('fora na horizontal')
    if (r.foraV && !rolaComBackdrop) problemas.push('fora na vertical')
    if (r.rodapeVisivel === false) problemas.push('rodapé fora da área visível')
    if (r.overflowPagina) problemas.push('overflow horizontal da página')
    if (r.botaoToque !== null && vp.mobile && !f.ui && r.botaoToque < 40) problemas.push(`botão ${r.botaoToque}px`)
    if (!r.rolavel) problemas.push('sem rolagem interna')
    console.log(`${vp.name.padEnd(9)} ${f.nome.padEnd(24)} ${problemas.length ? 'FALHA: ' + problemas.join('; ') : 'ok'} panel=${JSON.stringify(r.panel)}`)
    if (problemas.length) falhas.push({ vp: vp.name, fam: f.nome, problemas })
    if (SHOTS) {
      const dir = path.join(OUT, 'modais', vp.name)
      fs.mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: path.join(dir, f.nome.replace(/\W+/g, '_') + '.png') })
    }
    await page.close()
  }
}
console.log(`\n${falhas.length} falha(s)`)
await browser.close()
process.exit(falhas.length ? 1 : 0)
