/**
 * Tabelas com a classe `tabela-cartoes` viram cartões abaixo de 640 px (CSS em global-styles.css).
 * Este observador copia o texto de cada cabeçalho para `data-label` das células da mesma coluna,
 * para o CSS mostrar o rótulo ao lado do valor sem editar cada <td> nas páginas.
 * Células que já trazem `data-label` no JSX são respeitadas.
 */

const SELETOR = 'table.tabela-cartoes'

function textoCabecalho(th) {
    return String(th.textContent || '')
        .replace(/[▲▼↑↓⇅]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function rotularTabela(tabela) {
    const ths = tabela.querySelectorAll(':scope > thead > tr:last-child > th')
    if (!ths.length) return
    const rotulos = []
    ths.forEach((th) => {
        const span = Number(th.colSpan) || 1
        const texto = textoCabecalho(th)
        for (let i = 0; i < span; i += 1) rotulos.push(texto)
    })
    tabela.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
        let col = 0
        for (const td of tr.children) {
            const span = Number(td.colSpan) || 1
            if (span === 1 && (!td.hasAttribute('data-label') || td.dataset.labelAuto === '1')) {
                const rotulo = rotulos[col] || ''
                if (td.getAttribute('data-label') !== rotulo) {
                    td.setAttribute('data-label', rotulo)
                    td.dataset.labelAuto = '1'
                }
            }
            col += span
        }
    })
}

let instalado = false

export function instalarRotulosTabelaCartoes() {
    if (instalado || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
    instalado = true
    let agendado = false
    const rodar = () => {
        agendado = false
        document.querySelectorAll(SELETOR).forEach(rotularTabela)
    }
    const agendar = () => {
        if (agendado) return
        agendado = true
        window.requestAnimationFrame(rodar)
    }
    new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true })
    agendar()
}
