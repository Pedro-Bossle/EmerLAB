// Faixa com rolagem lateral para mouse: roda do mouse rola para o lado e dá para arrastar (como no celular)
import { useEffect } from 'react'

const LIMIAR_ARRASTE = 5

export function useRolagemHorizontal(ref) {
    useEffect(() => {
        const el = ref.current
        if (!el) return

        // roda vertical vira horizontal enquanto houver para onde rolar
        const roda = (e) => {
            if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
            const antes = el.scrollLeft
            el.scrollLeft += e.deltaY
            if (el.scrollLeft !== antes) e.preventDefault()
        }

        let inicio = null
        let arrastou = false
        const apertar = (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth) return
            inicio = { x: e.clientX, scroll: el.scrollLeft }
            arrastou = false
        }
        const mover = (e) => {
            if (!inicio) return
            const dx = e.clientX - inicio.x
            if (!arrastou && Math.abs(dx) < LIMIAR_ARRASTE) return
            if (!arrastou) el.setPointerCapture(e.pointerId)
            arrastou = true
            el.classList.add('arrastando')
            el.scrollLeft = inicio.scroll - dx
        }
        const soltar = () => {
            inicio = null
            el.classList.remove('arrastando')
        }
        // o clique que encerra um arraste não aciona a pill embaixo do cursor
        const clique = (e) => {
            if (!arrastou) return
            arrastou = false
            e.stopPropagation()
            e.preventDefault()
        }

        el.addEventListener('wheel', roda, { passive: false })
        el.addEventListener('pointerdown', apertar)
        el.addEventListener('pointermove', mover)
        el.addEventListener('pointerup', soltar)
        el.addEventListener('pointercancel', soltar)
        el.addEventListener('click', clique, true)
        return () => {
            el.removeEventListener('wheel', roda)
            el.removeEventListener('pointerdown', apertar)
            el.removeEventListener('pointermove', mover)
            el.removeEventListener('pointerup', soltar)
            el.removeEventListener('pointercancel', soltar)
            el.removeEventListener('click', clique, true)
        }
    }, [ref])
}
