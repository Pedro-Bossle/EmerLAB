import { useRef } from 'react'

const MIN = 260
const PASSO_TECLADO = 16

// Alça na borda direita da lista de conversas: arrastar muda a largura, duplo clique volta ao padrão.
// Durante o arraste só mexe na variável CSS (sem re-render); grava ao soltar.
export default function Redimensionar({ alvo, largura, aoMudar }) {
    const inicio = useRef(null)

    const maximo = () => Math.max(MIN, Math.min(720, window.innerWidth - 480))
    const limitar = (px) => Math.round(Math.max(MIN, Math.min(maximo(), px)))
    const aplicar = (px) => alvo.current?.style.setProperty('--largura-lateral', `${px}px`)
    const atual = () => alvo.current?.querySelector('.lateral')?.getBoundingClientRect().width || MIN

    const aoPressionar = (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        inicio.current = { x: e.clientX, largura: atual() }
        document.body.classList.add('redimensionando')
    }
    const aoMover = (e) => {
        if (!inicio.current) return
        aplicar(limitar(inicio.current.largura + e.clientX - inicio.current.x))
    }
    const aoSoltar = () => {
        if (!inicio.current) return
        inicio.current = null
        document.body.classList.remove('redimensionando')
        aoMudar(limitar(atual()))
    }
    const aoTeclar = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const px = limitar(atual() + (e.key === 'ArrowRight' ? PASSO_TECLADO : -PASSO_TECLADO))
        aplicar(px)
        aoMudar(px)
    }

    return (
        <div
            className="redimensionar"
            role="separator"
            aria-orientation="vertical"
            aria-label="Largura da lista de conversas"
            aria-valuenow={largura || undefined}
            aria-valuemin={MIN}
            tabIndex={0}
            title="Arraste para ajustar a largura · duplo clique volta ao padrão"
            onPointerDown={aoPressionar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            onKeyDown={aoTeclar}
            onDoubleClick={() => {
                alvo.current?.style.removeProperty('--largura-lateral')
                aoMudar(null)
            }}
        />
    )
}
