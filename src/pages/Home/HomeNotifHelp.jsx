import React, { useEffect, useId, useRef, useState } from 'react'

/**
 * Painel "?" das notificações: fecha ao clicar fora (e ao abrir outro).
 */
export default function HomeNotifHelp({ title, ariaLabel, children }) {
    const [aberto, setAberto] = useState(false)
    const wrapRef = useRef(null)
    const id = useId()

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            if (wrapRef.current?.contains(e.target)) return
            setAberto(false)
        }
        const onEscape = (e) => {
            if (e.key === 'Escape') setAberto(false)
        }
        const onOutroHelp = (e) => {
            if (e.detail?.id !== id) setAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onEscape)
        window.addEventListener('home-dash-notif-help-open', onOutroHelp)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onEscape)
            window.removeEventListener('home-dash-notif-help-open', onOutroHelp)
        }
    }, [aberto, id])

    const onToggle = () => {
        setAberto((prev) => {
            const next = !prev
            if (next) {
                window.dispatchEvent(
                    new CustomEvent('home-dash-notif-help-open', { detail: { id } }),
                )
            }
            return next
        })
    }

    return (
        <div
            ref={wrapRef}
            className={`home_dash_notif_help${aberto ? ' is-open' : ''}`}
        >
            <button
                type="button"
                className="home_dash_notif_help_btn"
                title={title}
                aria-label={ariaLabel || title}
                aria-expanded={aberto}
                onClick={onToggle}
            >
                ?
            </button>
            {aberto ? (
                <div className="home_dash_notif_help_panel" role="dialog" aria-label={title}>
                    {children}
                </div>
            ) : null}
        </div>
    )
}
