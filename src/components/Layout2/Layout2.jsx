import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../Sidebar/Sidebar'
import DevToolsFloating from '../DevTools/DevToolsFloating'
import BatePapoFloating from '../BatePapo/BatePapoFloating'
import FormularioInboxBell from '../Credenciamento/FormularioInboxBell'
import SessionSecurity from '../SessionSecurity/SessionSecurity'
import BottomNav from './BottomNav'
import FloatingToolsDock from './FloatingToolsDock'
import FloatingLayerPortal from './FloatingLayerPortal'
import { cn } from '../../lib/cn'
import { lerSidebarFixada, salvarSidebarFixada } from '../../lib/sidebarPrefs'
import {
  isBatePapoEnabled,
  isDevToolsEnabled,
  PERMISSION_KEYS,
  useStoredAccessProfile,
  useStoredPermission,
} from '../../lib/accessControl'
import './Layout2.css'

const MQ_COMPACT = '(max-width: 1023px)'

const Layout2 = () => {
  const { pathname } = useLocation()
  const profile = useStoredAccessProfile()
  const podeNotifForm = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_FORMULARIO)
  const podeNotifContratos = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_CONTRATOS)
  const [openManual, setOpenManual] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia(MQ_COMPACT).matches) return false
    return lerSidebarFixada()
  })
  const [isHovering, setIsHovering] = useState(false)
  const hoverTimerRef = useRef(null)
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MQ_COMPACT).matches : false,
  )
  const [dockExpanded, setDockExpanded] = useState(false)
  const [activeFloatingTool, setActiveFloatingTool] = useState(null)
  const [badgeBatePapo, setBadgeBatePapo] = useState(0)
  const [badgeNotif, setBadgeNotif] = useState(0)

  const showBatePapo = isBatePapoEnabled(profile)
  const showDevTools = isDevToolsEnabled(profile)
  const showNotif = (podeNotifForm || podeNotifContratos) && pathname !== '/home'

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

  useEffect(() => {
    if (!isCompact) {
      setDockExpanded(false)
      setActiveFloatingTool(null)
    }
  }, [isCompact])

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

  const dockTools = useMemo(() => {
    const list = []
    if (showBatePapo) list.push({ id: 'emerzap', label: 'Emerzap', badge: badgeBatePapo })
    if (showDevTools) list.push({ id: 'devtools', label: 'Dev Tools', badge: 0 })
    if (showNotif) list.push({ id: 'notif', label: 'Notificações', badge: badgeNotif })
    return list
  }, [showBatePapo, showDevTools, showNotif, badgeBatePapo, badgeNotif])

  const onSelectTool = useCallback((id) => {
    setActiveFloatingTool(id)
    if (id) setDockExpanded(true)
  }, [])

  const floatMode = isCompact ? 'dock' : 'fab'

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
          'relative min-h-dvh max-w-full overflow-x-clip bg-surface-page transition-[margin,width] duration-200 ease-out dark:bg-[#0d1520]',
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

      <FloatingLayerPortal>
        {isCompact ? (
          <FloatingToolsDock
            expanded={dockExpanded}
            onExpandedChange={(v) => {
              setDockExpanded(v)
              if (!v) setActiveFloatingTool(null)
            }}
            tools={dockTools}
            activeToolId={activeFloatingTool}
            onSelectTool={onSelectTool}
          />
        ) : null}

        <div className={cn('el-floating-layer', isCompact && 'el-floating-layer--compact')}>
          {showBatePapo ? (
            <BatePapoFloating
              mode={floatMode}
              open={isCompact ? activeFloatingTool === 'emerzap' : undefined}
              onOpenChange={
                isCompact
                  ? (v) => setActiveFloatingTool(v ? 'emerzap' : null)
                  : undefined
              }
              onBadgeChange={setBadgeBatePapo}
            />
          ) : null}
          {showDevTools ? (
            <DevToolsFloating
              mode={floatMode}
              open={isCompact ? activeFloatingTool === 'devtools' : undefined}
              onOpenChange={
                isCompact
                  ? (v) => setActiveFloatingTool(v ? 'devtools' : null)
                  : undefined
              }
            />
          ) : null}
          {showNotif ? (
            <FormularioInboxBell
              mode={floatMode}
              open={isCompact ? activeFloatingTool === 'notif' : undefined}
              onOpenChange={
                isCompact
                  ? (v) => setActiveFloatingTool(v ? 'notif' : null)
                  : undefined
              }
              onBadgeChange={setBadgeNotif}
            />
          ) : null}
        </div>
      </FloatingLayerPortal>
    </div>
  )
}

export default Layout2
