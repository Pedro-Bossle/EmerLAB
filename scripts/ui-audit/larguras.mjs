/**
 * Confere se a barra de filtros (.ek-toolbar) tem a MESMA largura/posição do conteúdo logo abaixo
 * (tabela ou quadro da tabela). Uso: node scripts/ui-audit/larguras.mjs [--real] [--vp notebook]
 */
import { newPage, BASE, VIEWPORTS, browser } from './audit.mjs'
const ROTAS = ['/supertabelamain', '/supertabela/cidades', '/supertabela/planos', '/supertabela/procedimentos', '/supertabela/negociacoes',
  '/pagamentos/registro', '/pagamentos/resumo', '/compras/valor-venda', '/compras/orcamento', '/credenciamento/principal', '/credenciamento/cadastro',
  '/credenciamento/especialidades-rc', '/administrativo/auditoria', '/administrativo/qualidade', '/configuracoes/observacoes-planos', '/configuracoes/observacoes-honorarios', '/planos/impressao']
const vps = VIEWPORTS.filter((v) => ['desktop', 'notebook', 'tablet'].includes(v.name))
for (const vp of vps) {
  for (const rota of ROTAS) {
    const page = await newPage(vp)
    await page.goto(BASE + rota, { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 3500))
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.ek-toolbar')
      if (!bar) return { sem: 'sem toolbar' }
      const b = bar.getBoundingClientRect()
      const alvos = [...document.querySelectorAll('[class*="table_wrap"], .table_container, .ek-table-wrap, .categoria_secao, .pag_res_card, .cred_kanban_board, table')]
        .filter((e) => e.getBoundingClientRect().top >= b.bottom - 2 && e.getBoundingClientRect().width > 300)
      let a = alvos[0]
      if (!a) { let n = bar.nextElementSibling; while (n && (n.getBoundingClientRect().width < 300 || n.getBoundingClientRect().height < 20)) n = n.nextElementSibling; a = n }
      if (!a) return { sem: 'sem tabela' }
      const t = a.getBoundingClientRect()
      return { alvo: (a.className || a.tagName).toString().split(' ')[0], dl: Math.round(t.left - b.left), dr: Math.round(b.right - t.right), w: Math.round(b.width) }
    })
    const ok = r.sem ? '-' : Math.abs(r.dl) <= 1 && Math.abs(r.dr) <= 1 ? 'ok' : 'DIFERE'
    console.log(vp.name.padEnd(9), rota.padEnd(40), ok.padEnd(7), JSON.stringify(r))
    await page.close()
  }
}
await browser.close()
