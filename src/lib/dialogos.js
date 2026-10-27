/**
 * Confirmações e avisos no lugar de window.confirm / window.alert (auditoria V-D09).
 *
 * Uso: `if (!(await confirmarAcao({ titulo, mensagem, confirmar: 'Excluir prestador', perigo: true }))) return`
 * O <DialogosHost /> (montado em App.jsx) desenha o pedido com ui/Modal — no celular abre por baixo.
 * Sem host montado (testes, scripts), cai para os diálogos nativos para não travar o fluxo.
 */

/** @typedef {{ titulo: string, mensagem?: string, confirmar?: string, cancelar?: string, perigo?: boolean }} OpcoesConfirmacao */
/** @typedef {{ titulo: string, mensagem?: string, ok?: string }} OpcoesAviso */

let ouvinte = null
const fila = []

function emitir(pedido) {
    if (ouvinte) ouvinte(pedido)
    else fila.push(pedido)
}

/** Registra o host. Retorna a função de cancelamento do registro. */
export function registrarHostDialogos(fn) {
    ouvinte = fn
    while (fila.length) fn(fila.shift())
    return () => {
        if (ouvinte === fn) ouvinte = null
    }
}

function semHost() {
    return typeof window === 'undefined' || !ouvinte
}

/**
 * Pede confirmação. Resolve `true` só quando a pessoa escolhe a ação.
 * @param {OpcoesConfirmacao} opcoes
 * @returns {Promise<boolean>}
 */
export function confirmarAcao(opcoes) {
    const o = { confirmar: 'Confirmar', cancelar: 'Cancelar', perigo: false, ...opcoes }
    if (semHost()) {
        const texto = [o.titulo, o.mensagem].filter(Boolean).join('\n\n')
        return Promise.resolve(typeof window !== 'undefined' ? window.confirm(texto) : false)
    }
    return new Promise((resolve) => emitir({ tipo: 'confirmar', ...o, resolver: resolve }))
}

/**
 * Mostra um aviso com um único botão. Resolve quando é fechado.
 * @param {OpcoesAviso | string} opcoes
 * @returns {Promise<void>}
 */
export function avisar(opcoes) {
    const o = typeof opcoes === 'string' ? { titulo: opcoes } : opcoes
    const final = { ok: 'Entendi', ...o }
    if (semHost()) {
        if (typeof window !== 'undefined') window.alert([final.titulo, final.mensagem].filter(Boolean).join('\n\n'))
        return Promise.resolve()
    }
    return new Promise((resolve) => emitir({ tipo: 'avisar', ...final, resolver: () => resolve() }))
}
