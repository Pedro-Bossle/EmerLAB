import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Menu flutuante ancorado a um botão. Renderiza no body (a tabela rola em X e cortaria o menu),
 * fecha com Esc, clique fora ou rolagem da página.
 */
export default function PagamentosMenuFlutuante({ ancora, onFechar, alinhar = 'esquerda', children }) {
    const ref = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        if (!ancora) return
        const r = ancora.getBoundingClientRect()
        const larg = ref.current?.offsetWidth || 220
        const alt = ref.current?.offsetHeight || 160
        let left = alinhar === 'direita' ? r.right - larg : r.left
        left = Math.max(8, Math.min(left, window.innerWidth - larg - 8))
        let top = r.bottom + 4
        if (top + alt > window.innerHeight - 8) top = Math.max(8, r.top - alt - 4)
        setPos({ top, left })
    }, [ancora, alinhar])

    useEffect(() => {
        if (!ancora) return undefined
        const aoTecla = (e) => e.key === 'Escape' && onFechar()
        const aoClicar = (e) => {
            if (ref.current?.contains(e.target) || ancora.contains(e.target)) return
            onFechar()
        }
        document.addEventListener('keydown', aoTecla)
        document.addEventListener('mousedown', aoClicar)
        // Rolagem dentro do próprio menu (ex.: texto longo rolando num input) não fecha o menu.
        const aoRolar = (e) => {
            if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
            onFechar()
        }
        window.addEventListener('scroll', aoRolar, true)
        window.addEventListener('resize', onFechar)
        return () => {
            document.removeEventListener('keydown', aoTecla)
            document.removeEventListener('mousedown', aoClicar)
            window.removeEventListener('scroll', aoRolar, true)
            window.removeEventListener('resize', onFechar)
        }
    }, [ancora, onFechar])

    if (!ancora) return null
    return createPortal(
        <div
            ref={ref}
            role="menu"
            className="pag_reg_menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        >
            {children}
        </div>,
        document.body,
    )
}
