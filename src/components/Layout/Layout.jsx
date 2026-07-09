import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from '../Header/Header'
import Footer from '../Footer/Footer'
import SessionSecurity from '../SessionSecurity/SessionSecurity'
import './Layout.css'

const MQ_COMPACT = '(max-width: 1023px)'

const Layout = () => {
    const [headerOpen, setHeaderOpen] = useState(false)
    const [isCompact, setIsCompact] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia(MQ_COMPACT).matches : false,
    )

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const mq = window.matchMedia(MQ_COMPACT)
        const onChange = () => {
            setIsCompact(mq.matches)
            if (!mq.matches) setHeaderOpen(false)
        }
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        if (!isCompact || !headerOpen) return undefined
        const onKey = (e) => {
            if (e.key === 'Escape') setHeaderOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isCompact, headerOpen])

    const closeHeader = () => {
        if (isCompact) setHeaderOpen(false)
    }

    return (
        <div
            className={`layout1-shell${isCompact ? ' layout1-shell--compact' : ''}`}
            data-header-open={isCompact && headerOpen ? 'true' : 'false'}
        >
            <SessionSecurity />
            {isCompact && headerOpen && (
                <button
                    type="button"
                    className="layout1_header_backdrop"
                    aria-label="Fechar menu superior"
                    onClick={() => setHeaderOpen(false)}
                />
            )}
            {isCompact && (
                <button
                    type="button"
                    className="layout1_header_fab"
                    aria-label={headerOpen ? 'Fechar menu superior' : 'Abrir menu superior'}
                    aria-expanded={headerOpen}
                    onClick={() => setHeaderOpen((v) => !v)}
                >
                    ☰
                </button>
            )}
            <div className={`layout1_header_wrap${isCompact && headerOpen ? ' is-open' : ''}`}>
                <Header onNavigate={closeHeader} />
            </div>
            <main className="layout1_main">
                <Outlet />
            </main>
            <Footer />
        </div>
    )
}

export default Layout
