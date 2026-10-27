import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Menu de botão direito: abre no ponto do clique, fecha ao clicar fora, rolar, Esc ou escolher
export default function MenuContexto({ x, y, titulo, itens, aoFechar }) {
    const ref = useRef(null)
    const [pos, setPos] = useState({ left: x, top: y })

    // não deixa o menu sair da tela perto das bordas
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const { width, height } = el.getBoundingClientRect()
        setPos({ left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) })
        el.querySelector('button:not(:disabled)')?.focus()
    }, [x, y])

    useEffect(() => {
        const fora = (e) => !ref.current?.contains(e.target) && aoFechar()
        const tecla = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                aoFechar()
                return
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const botoes = [...ref.current.querySelectorAll('button:not(:disabled)')]
            const i = botoes.indexOf(document.activeElement)
            botoes[(i + (e.key === 'ArrowDown' ? 1 : -1) + botoes.length) % botoes.length]?.focus()
        }
        document.addEventListener('mousedown', fora)
        document.addEventListener('keydown', tecla)
        window.addEventListener('resize', aoFechar)
        window.addEventListener('scroll', aoFechar, true)
        return () => {
            document.removeEventListener('mousedown', fora)
            document.removeEventListener('keydown', tecla)
            window.removeEventListener('resize', aoFechar)
            window.removeEventListener('scroll', aoFechar, true)
        }
    }, [aoFechar])

    return (
        <ul ref={ref} className="menu-lista menu-contexto" role="menu" aria-label={titulo} style={pos} onContextMenu={(e) => e.preventDefault()}>
            {titulo ? (
                <li className="menu-contexto-titulo" role="presentation">
                    {titulo}
                </li>
            ) : null}
            {itens.filter(Boolean).map((it) => (
                <li key={it.rotulo} role="none">
                    <button
                        role="menuitem"
                        className={it.perigo ? 'perigo' : ''}
                        disabled={it.desabilitado}
                        onClick={() => {
                            aoFechar()
                            it.acao()
                        }}
                    >
                        {it.rotulo}
                    </button>
                </li>
            ))}
        </ul>
    )
}
