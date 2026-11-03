/**
 * Remove de um .css os seletores que casam com a regex (migração para o UI Kit: apagar o que ficou sem uso).
 * Uso: node scripts/css-prune.cjs <arquivo.css> "<regex de seletor>"
 * Seletores de uma lista são removidos um a um; regras e @media que ficam vazios também saem.
 */
const fs = require('fs')
const postcss = require('postcss')
const [, , arquivo, padrao] = process.argv
const re = new RegExp(padrao)
const css = fs.readFileSync(arquivo, 'utf8')
let removidos = 0
const root = postcss.parse(css)
root.walkRules((rule) => {
  const mantidos = rule.selectors.filter((s) => !re.test(s))
  if (mantidos.length === rule.selectors.length) return
  removidos += rule.selectors.length - mantidos.length
  if (mantidos.length) rule.selectors = mantidos
  else rule.remove()
})
root.walkAtRules((at) => {
  if (at.nodes && at.nodes.length === 0) at.remove()
})
fs.writeFileSync(arquivo, root.toString())
console.log(`${arquivo}: ${removidos} seletor(es) removido(s)`)
