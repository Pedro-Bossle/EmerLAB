import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  hasPermission,
  podeLerFerramenta,
  useStoredAccessProfile,
} from '../../lib/accessControl'
import { getToolIdForHref } from '../../lib/permissionCatalog'
import { NAV_HUBS, filtrarChildrenNav, hubMatchesPath } from '../../lib/navConfig'
import { cn } from '../../lib/cn'
import { Drawer } from '../ui'
import { supabase } from '../../lib/supabase'
import { logoutSessao } from '../../lib/authSession'
import { lerDarkModeAtivo, salvarDarkModeAtivo } from '../../lib/sidebarPrefs'

const HubIcon = ({ name }) => {
  const common = 'h-5 w-5'
  if (name === 'home') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'table') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M3.5 9.5h17M10 9.5v10" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    )
  }
  if (name === 'cred') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
        <path d="M5 19.5c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'ops') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 7h16M4 12h10M4 17h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="18" cy="15" r="3" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    )
  }
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const accessProfile = useStoredAccessProfile()
  const [drawerHub, setDrawerHub] = useState(null)
  const [darkModeAtivo, setDarkModeAtivo] = useState(() => lerDarkModeAtivo())

  useEffect(() => {
    if (darkModeAtivo) document.body.classList.add('dark-mode')
    else document.body.classList.remove('dark-mode')
    salvarDarkModeAtivo(darkModeAtivo)
  }, [darkModeAtivo])

  const podeVer = (child) => {
    if (child?.type === 'section') return true
    if (child.action) return true
    const toolId = getToolIdForHref(child.href)
    if (toolId) return podeLerFerramenta(accessProfile?.permissions, toolId)
    if (child.permission) return hasPermission(accessProfile, child.permission)
    return true
  }

  const hubs = useMemo(
    () =>
      NAV_HUBS.map((hub) => {
        if (hub.permission && !hasPermission(accessProfile, hub.permission)) return null
        if (hub.href && !hub.children) return hub
        const children = filtrarChildrenNav(hub.children || [], podeVer)
        if (hub.children && children.length === 0) return null
        return { ...hub, children }
      }).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessProfile],
  )

  const handleLogout = async () => {
    await logoutSessao({
      navigate,
      onError: () => alert('Erro ao sair da sessão'),
    })
  }

  const handleResetPassword = async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user?.email) {
      alert('Não foi possível identificar o usuário logado')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(userData.user.email, {
      redirectTo: window.location.origin,
    })
    if (error) alert('Erro ao enviar redefinição de senha')
    else alert('E-mail de redefinição enviado com sucesso')
  }

  const openHub = (hub) => {
    if (hub.href && !hub.children?.length) {
      navigate(hub.href)
      return
    }
    setDrawerHub(hub)
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-nav border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-white/10 dark:bg-[#0f1a26]/95 lg:hidden"
        aria-label="Navegação inferior"
      >
        <ul
          className="grid gap-0 px-1 pt-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(hubs.length, 1)}, minmax(0, 1fr))` }}
        >
          {hubs.map((hub) => {
            const active = hubMatchesPath(hub, pathname)
            return (
              <li key={hub.id}>
                <button
                  type="button"
                  onClick={() => openHub(hub)}
                  className={cn(
                    'flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-bold',
                    active ? 'text-brand' : 'text-ink-muted dark:text-[#9eb4c8]',
                  )}
                >
                  <HubIcon name={hub.icon} />
                  <span className="truncate">{hub.shortLabel || hub.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <Drawer
        open={Boolean(drawerHub)}
        onClose={() => setDrawerHub(null)}
        title={drawerHub?.label || ''}
        side="bottom"
      >
        <ul className="flex flex-col gap-1">
          {(drawerHub?.children || []).map((child) =>
            child.type === 'section' ? (
              <li
                key={`section-${child.label}`}
                className="mt-2 px-3 text-[0.68rem] font-bold uppercase tracking-wider text-ink-muted first:mt-0 dark:text-[#9eb4c8]"
              >
                {child.label}
              </li>
            ) : child.action ? (
              <li key={child.action + child.label}>
                <button
                  type="button"
                  className={cn(
                    'flex min-h-touch w-full items-center rounded-xl px-3 text-left text-sm font-bold text-ink hover:bg-brand-pale dark:text-[#e8f1f8] dark:hover:bg-white/5',
                    child.action === 'logout' && 'text-status-erro hover:bg-status-erro-bg dark:text-red-300',
                  )}
                  onClick={async () => {
                    if (child.action === 'toggle-dark-mode') {
                      setDarkModeAtivo((v) => !v)
                      return
                    }
                    setDrawerHub(null)
                    if (child.action === 'logout') await handleLogout()
                    if (child.action === 'reset-password') await handleResetPassword()
                  }}
                >
                  {child.action === 'toggle-dark-mode'
                    ? darkModeAtivo
                      ? 'Modo claro'
                      : 'Modo escuro'
                    : child.label}
                </button>
              </li>
            ) : (
              <li key={child.href}>
                <Link
                  to={child.href}
                  className={cn(
                    'flex min-h-touch items-center rounded-xl px-3 text-sm font-bold text-ink hover:bg-brand-pale dark:text-[#e8f1f8] dark:hover:bg-white/5',
                    pathname === child.href && 'bg-brand-pale text-brand dark:bg-white/10',
                  )}
                  onClick={() => setDrawerHub(null)}
                >
                  {child.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </Drawer>
    </>
  )
}
