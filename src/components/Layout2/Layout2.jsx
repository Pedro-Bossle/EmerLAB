import React, { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../Sidebar/Sidebar'
import DevToolsFloating from '../DevTools/DevToolsFloating'
import BatePapoFloating from '../BatePapo/BatePapoFloating'
import FormularioInboxBell from '../Credenciamento/FormularioInboxBell'
import SessionSecurity from '../SessionSecurity/SessionSecurity'
import BottomNav from './BottomNav'
import { cn } from '../../lib/cn'
import { lerSidebarFixada, salvarSidebarFixada } from '../../lib/sidebarPrefs'
import './Layout2.css'

const MQ_COMPACT = '(max-width: 1023px)'

const Layout2 = () => {
  const { pathname } = useLocation()
  const [openManual, setOpenManual] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia(MQ_COMPACT).matches) return false
    return lerSidebarFixada()
  })
  const [isHovering, setIsHovering] = useState(false)
  const hoverTimerRef = useRef(null)
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [pathname])

  useEffect(() => {
    if (!isCompact || !openManual) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenManual(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCompact, openManual])

  /** Desktop: fixada OU hover. Conteúdo só empurra quando fixada. */
  const navOpen = isCompact ? openManual : openManual || isHovering
  const contentPushed = !isCompact && openManual

  const handleToggleManual = () => {
    setOpenManual((prev) => {
      const next = !prev
      if (!isCompact) salvarSidebarFixada(next)
      return next
    })
  }

  const closeDrawer = () => {
    if (isCompact) setOpenManual(false)
  }

  const hoverHandlers =
    !isCompact && !openManual
      ? {
          onMouseEnter: () => {
            if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
            hoverTimerRef.current = window.setTimeout(() => setIsHovering(true), 30)
          },
          onMouseLeave: () => {
            if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
            hoverTimerRef.current = window.setTimeout(() => setIsHovering(false), 160)
          },
        }
      : {
          onMouseLeave: () => {
            if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
            setIsHovering(false)
          },
        }

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    }
  }, [])

  return (
    <div className="relative min-h-dvh max-w-[100vw] overflow-x-clip bg-surface-page dark:bg-[#0d1520]">
      <SessionSecurity />

      {isCompact && openManual ? (
        <button
          type="button"
          className="fixed inset-0 z-[49] bg-ink/45 lg:hidden"
          aria-label="Fechar menu de navegação"
          onClick={() => setOpenManual(false)}
        />
      ) : null}

      {!isCompact ? (
        <div {...hoverHandlers} className="contents">
          <Sidebar
            open={navOpen}
            onToggleManual={handleToggleManual}
            isPinned={openManual}
            onAfterNavigate={closeDrawer}
          />
        </div>
      ) : openManual ? (
        <Sidebar
          open
          onToggleManual={handleToggleManual}
          isPinned
          onAfterNavigate={closeDrawer}
        />
      ) : null}

      <main
        className={cn(
          'min-h-dvh max-w-full overflow-x-clip bg-surface-page transition-[margin,width] duration-200 ease-out dark:bg-[#0d1520]',
          isCompact
            ? 'w-full pb-nav-bottom'
            : contentPushed
              ? 'lg:ml-sidebar lg:w-[calc(100%-theme(spacing.sidebar))]'
              : 'lg:ml-sidebar-collapsed lg:w-[calc(100%-theme(spacing.sidebar-collapsed))]',
        )}
      >
        <Outlet />
      </main>

      {isCompact ? <BottomNav /> : null}

      <div className={cn(isCompact && 'pb-nav-bottom')}>
        <BatePapoFloating />
        <DevToolsFloating />
        {pathname !== '/home' ? <FormularioInboxBell /> : null}
      </div>
    </div>
  )
}

export default Layout2
