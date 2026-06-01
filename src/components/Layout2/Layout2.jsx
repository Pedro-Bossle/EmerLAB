import React, { useEffect, useState } from 'react'
import Sidebar from '../Sidebar/Sidebar'
import DevToolsFloating from '../DevTools/DevToolsFloating'
import FormularioInboxBell from '../Credenciamento/FormularioInboxBell'
import { Outlet } from 'react-router-dom'
import './Layout2.css'

const MQ_COMPACT = '(max-width: 1023px)'

const Layout2 = () => {
    const [openManual, setOpenManual] = useState(false)
    const [isHovering, setIsHovering] = useState(false)
    const [isCompact, setIsCompact] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia(MQ_COMPACT).matches : false,
    )

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const mq = window.matchMedia(MQ_COMPACT)
        const onChange = () => setIsCompact(mq.matches)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        if (!isCompact || !openManual) return undefined
        const onKey = (e) => {
            if (e.key === 'Escape') setOpenManual(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isCompact, openManual])

    /** Em ecrã compacto só o pin/manual abre a gaveta; em desktop mantém-se o hover. */
    const navOpen = isCompact ? openManual : openManual || isHovering

    const handleToggleManual = () => {
        setOpenManual((prev) => !prev)
    }

    const closeDrawer = () => {
        if (isCompact) setOpenManual(false)
    }

    const hoverHandlers =
        !isCompact
            ? {
                  onMouseEnter: () => setIsHovering(true),
                  onMouseLeave: () => setIsHovering(false),
              }
            : {}

    return (
        <div
            className={`app-shell${isCompact ? ' app-shell--compact' : ''}`}
            data-nav-open={isCompact && openManual ? 'true' : 'false'}
        >
            {isCompact && openManual && (
                <button
                    type="button"
                    className="layout2_nav_backdrop"
                    aria-label="Fechar menu de navegação"
                    onClick={() => setOpenManual(false)}
                />
            )}
            {isCompact && (
                <button
                    type="button"
                    className="layout2_nav_fab"
                    aria-label={openManual ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
                    aria-expanded={openManual}
                    onClick={handleToggleManual}
                >
                    {openManual ? '✕' : '☰'}
                </button>
            )}

            <div {...hoverHandlers}>
                <Sidebar
                    open={navOpen}
                    onToggleManual={handleToggleManual}
                    isPinned={openManual}
                    onAfterNavigate={closeDrawer}
                />
            </div>

            <main
                className={
                    isCompact ? 'content content--compact' : `content ${navOpen ? 'open' : 'closed'}`
                }
            >
                <Outlet />
            </main>
            <FormularioInboxBell />
            <DevToolsFloating />
        </div>
    )
}

export default Layout2
