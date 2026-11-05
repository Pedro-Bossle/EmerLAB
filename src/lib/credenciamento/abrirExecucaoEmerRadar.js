/**
 * Abre os resultados de uma execução do Emer-Radar em uma nova aba.
 * A sessão do app fica no sessionStorage: `window.open` SEM `noopener` entrega uma cópia à aba nova
 * (um <a target="_blank"> comum perderia o login).
 * @returns {boolean} false se o navegador bloqueou o pop-up
 */
export function abrirExecucaoEmerRadar(runId) {
  const aba = window.open(`/credenciamento/emer-radar/execucao/${encodeURIComponent(runId)}`, '_blank')
  return Boolean(aba)
}
