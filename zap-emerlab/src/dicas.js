// Dicas (tooltips) de qualquer elemento com data-dica="texto". Uma só, no <body> e em position: fixed:
// escolhe o lado que cabe e não sai da tela. O ::after em CSS ficava preso à caixa do botão e, no topo,
// saía da tela (para cima) ou era cortado pelo overflow do painel (para baixo).
// data-dica-lado: "direita" = ao lado; "esquerda" = alinhada pela direita do botão; sem lado = centralizada.

const ATRASO_MS = 350
const FOLGA = 8 // distância das bordas da tela
const ESPACO = 6 // distância do botão

let dica = null
let alvo = null
let timer = null

function criar() {
    dica = document.createElement('div')
    dica.className = 'dica-flutuante'
    dica.setAttribute('role', 'tooltip')
    document.body.appendChild(dica)
}

function posicionar(el) {
    const r = el.getBoundingClientRect()
    const d = dica.getBoundingClientRect()
    const lado = el.getAttribute('data-dica-lado')
    const cabeAbaixo = r.bottom + ESPACO + d.height <= innerHeight - FOLGA
    let top
    let left
    if (lado === 'direita' && r.right + ESPACO + d.width <= innerWidth - FOLGA) {
        top = r.top + r.height / 2 - d.height / 2
        left = r.right + ESPACO
    } else {
        // embaixo; sem espaço embaixo, em cima
        top = cabeAbaixo ? r.bottom + ESPACO : r.top - ESPACO - d.height
        left = lado === 'esquerda' ? r.right - d.width : r.left + r.width / 2 - d.width / 2
    }
    dica.style.left = `${Math.round(Math.max(FOLGA, Math.min(left, innerWidth - d.width - FOLGA)))}px`
    dica.style.top = `${Math.round(Math.max(FOLGA, Math.min(top, innerHeight - d.height - FOLGA)))}px`
}

function mostrar(el, imediato = false) {
    clearTimeout(timer)
    alvo = el
    timer = setTimeout(
        () => {
            const texto = el.getAttribute('data-dica')
            if (!texto || !el.isConnected) return
            if (!dica) criar()
            dica.textContent = texto
            dica.classList.remove('visivel')
            posicionar(el)
            dica.classList.add('visivel')
        },
        imediato ? 0 : ATRASO_MS,
    )
}

function esconder() {
    clearTimeout(timer)
    alvo = null
    dica?.classList.remove('visivel')
}

export function iniciarDicas() {
    // toque não tem hover: a dica ficaria presa depois do toque
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return
        const el = e.target.closest?.('[data-dica]')
        if (el === alvo) return
        if (el) mostrar(el)
        else esconder()
    })
    document.addEventListener('pointerout', (e) => {
        if (alvo && !alvo.contains(e.relatedTarget)) esconder()
    })
    // teclado: mostra na hora quando o foco chega pelo Tab
    document.addEventListener('focusin', (e) => {
        const el = e.target.closest?.('[data-dica]')
        if (el && e.target.matches(':focus-visible')) mostrar(el, true)
    })
    document.addEventListener('focusout', () => alvo && esconder())
    document.addEventListener('pointerdown', esconder, true)
    document.addEventListener('keydown', (e) => e.key === 'Escape' && esconder())
    // só a rolagem de algo que contém o botão tira a dica do lugar; o chat descendo sozinho com mensagem nova não
    window.addEventListener(
        'scroll',
        (e) => {
            const rolou = e.target === document ? document.documentElement : e.target
            if (alvo && rolou?.contains?.(alvo)) esconder()
        },
        true,
    )
    window.addEventListener('resize', esconder)
}
