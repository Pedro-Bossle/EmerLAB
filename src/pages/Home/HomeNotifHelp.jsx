import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Painel "?" das notificações: fecha ao clicar fora (e ao abrir outro).
 * O painel é desenhado com posição fixa dentro da página, para não ser cortado pelos cartões com rolagem.
 */
export default function HomeNotifHelp({ title, ariaLabel, children }) {
    const [aberto, setAberto] = useState(false)
    const [pos, setPos] = useState(null)
    const wrapRef = useRef(null)
    const btnRef = useRef(null)
    const painelRef = useRef(null)
    const id = useId()

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            if (wrapRef.current?.contains(e.target) || painelRef.current?.contains(e.target)) return
            setAberto(false)
        }
        const onEscape = (e) => {
            if (e.key === 'Escape') setAberto(false)
        }
        const onOutroHelp = (e) => {
            if (e.detail?.id !== id) setAberto(false)
        }
        const fechar = () => setAberto(false)
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onEscape)
        window.addEventListener('home-dash-notif-help-open', onOutroHelp)
        window.addEventListener('resize', fechar)
        window.addEventListener('scroll', fechar, true)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onEscape)
            window.removeEventListener('home-dash-notif-help-open', onOutroHelp)
            window.removeEventListener('resize', fechar)
            window.removeEventListener('scroll', fechar, true)
        }
    }, [aberto, id])

    const onToggle = () => {
        if (aberto) {
            setAberto(false)
            return
        }
        const r = btnRef.current?.getBoundingClientRect()
        if (r) {
            const abaixo = window.innerHeight - r.bottom - 16
            const acima = r.top - 16
            const embaixo = abaixo >= 180 || abaixo >= acima
            setPos({
                right: Math.max(8, window.innerWidth - r.right),
                ...(embaixo ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
                maxHeight: Math.max(120, Math.min(260, embaixo ? abaixo : acima)),
            })
        }
        window.dispatchEvent(new CustomEvent('home-dash-notif-help-open', { detail: { id } }))
        setAberto(true)
    }

    const destino = (aberto && wrapRef.current?.closest('.home_dash')) || null

    return (
        <div ref={wrapRef} className={`home_dash_notif_help${aberto ? ' is-open' : ''}`}>
            <button
                ref={btnRef}
                type="button"
                className="home_dash_notif_help_btn"
                title={title}
                aria-label={ariaLabel || title}
                aria-expanded={aberto}
                onClick={onToggle}
            >
                ?
            </button>
            {destino && pos
                ? createPortal(
                      <div
                          ref={painelRef}
                          className="home_dash_notif_help_panel is-fixed"
                          style={pos}
                          role="dialog"
                          aria-label={title}
                      >
                          {children}
                      </div>,
                      destino,
                  )
                : null}
        </div>
    )
}
