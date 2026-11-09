// Detecta quem deixou o painel parado: sem mouse, toque, tecla ou rolagem por OCIOSO_APOS_MS.
// Usado por atualizacao.js para espaçar o polling de quem não está mexendo (o tempo real continua avisando na hora).
export const OCIOSO_APOS_MS = 10 * 60 * 1000

let ultimaAtividade = Date.now()
const ouvintes = new Set()

export const estaOcioso = (agora = Date.now()) => agora - ultimaAtividade > OCIOSO_APOS_MS

/** Marca atividade. Se a pessoa estava ociosa, avisa quem quer atualizar na hora ao voltar. */
export function registrarAtividade(agora = Date.now()) {
    const estavaOcioso = estaOcioso(agora)
    ultimaAtividade = agora
    if (estavaOcioso) for (const fn of [...ouvintes]) fn()
}

/** Chama `fn` quando a pessoa volta a mexer depois de ociosa. Devolve a função que cancela. */
export function aoVoltarDoOcio(fn) {
    ouvintes.add(fn)
    return () => ouvintes.delete(fn)
}

let instalado = false
/** Liga os ouvintes de atividade uma única vez (no navegador). */
export function observarAtividade() {
    if (instalado || typeof window === 'undefined') return
    instalado = true
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove']) {
        window.addEventListener(ev, () => registrarAtividade(), { passive: true })
    }
}

/** Só para testes. */
export function __reiniciarOcio(agora = Date.now()) {
    ultimaAtividade = agora
    ouvintes.clear()
}
