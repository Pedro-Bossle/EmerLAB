import { useEffect } from 'react'
import Icone from './Icone.jsx'

export default function Modal({ titulo, aoFechar, children, largo = false }) {
    useEffect(() => {
        const esc = (e) => e.key === 'Escape' && aoFechar()
        document.addEventListener('keydown', esc)
        return () => document.removeEventListener('keydown', esc)
    }, [aoFechar])

    return (
        <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
            <div className={`modal ${largo ? 'modal-largo' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
                <header className="modal-topo">
                    <h2>{titulo}</h2>
                    <button className="icone-botao" onClick={aoFechar} aria-label="Fechar">
                        <Icone nome="fechar" />
                    </button>
                </header>
                <div className="modal-corpo">{children}</div>
            </div>
        </div>
    )
}
