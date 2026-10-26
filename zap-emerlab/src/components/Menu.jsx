import { useEffect, useRef, useState } from 'react'

// Menu suspenso (⋮) que fecha ao clicar fora ou com Esc
export default function Menu({ itens, children, titulo = 'Menu', alinhar = 'direita' }) {
    const [aberto, setAberto] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!aberto) return
        const fora = (e) => {
            if (!ref.current?.contains(e.target)) setAberto(false)
        }
        const esc = (e) => e.key === 'Escape' && setAberto(false)
        document.addEventListener('mousedown', fora)
        document.addEventListener('keydown', esc)
        return () => {
            document.removeEventListener('mousedown', fora)
            document.removeEventListener('keydown', esc)
        }
    }, [aberto])

    return (
        <div className="menu" ref={ref}>
            <button className={`icone-botao ${aberto ? 'ativo' : ''}`} title={titulo} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
                {children}
            </button>
            {aberto ? (
                <ul className={`menu-lista menu-${alinhar}`} role="menu">
                    {itens.filter(Boolean).map((it) => (
                        <li key={it.rotulo} role="none">
                            <button
                                role="menuitem"
                                className={it.perigo ? 'perigo' : ''}
                                disabled={it.desabilitado}
                                onClick={() => {
                                    setAberto(false)
                                    it.acao()
                                }}
                            >
                                {it.rotulo}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}
