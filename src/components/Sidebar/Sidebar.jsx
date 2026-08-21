import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logoBranco from '../../assets/logo_branco.png'
import logoE from '../../assets/logo_E.png'
import {
  PERMISSION_KEYS,
  hasPermission,
  podeLerFerramenta,
  useStoredAccessProfile,
} from '../../lib/accessControl'
import { getToolIdForHref } from '../../lib/permissionCatalog'
import { SIDEBAR_GROUPS, filtrarChildrenNav } from '../../lib/navConfig'
import { cn } from '../../lib/cn'
import { supabase } from '../../lib/supabase'
import { logoutSessao } from '../../lib/authSession'
import { lerDarkModeAtivo, salvarDarkModeAtivo } from '../../lib/sidebarPrefs'

const SIDEBAR_ICONS = {
  inicio: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  ),
  supertabela: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3.5 9.5h17M10 9.5v10" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  ),
  credenciamento: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M5 19.5c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  operacoes: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h10M4 17h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="18" cy="15" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  ),
  configuracoes: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  administrativo: (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5 19 7v5.2c0 4.1-2.8 7.4-7 8.3-4.2-.9-7-4.2-7-8.3V7l7-3.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M9.5 12.2 11.2 14l3.5-3.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

function grupoIdPorPathname(items, pathname) {
  for (const item of items || []) {
    if (
      (item.children || []).some(
        (c) => c.href && (pathname === c.href || pathname.startsWith(`${c.href}/`)),
      )
    ) {
      return item.id
    }
  }
  return null
}

const Sidebar = ({ open, onToggleManual, isPinned, onAfterNavigate }) => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const accessProfile = useStoredAccessProfile()
  const [darkModeAtivo, setDarkModeAtivo] = useState(() => lerDarkModeAtivo())
  const [openMenus, setOpenMenus] = useState({})

  const podeVerItemMenu = (child) => {
    if (child?.type === 'section') return true
    if (child.action) return true
    const toolId = getToolIdForHref(child.href)
    if (toolId) return podeLerFerramenta(accessProfile?.permissions, toolId)
    if (child.permission) return hasPermission(accessProfile, child.permission)
    return true
  }

  const menuItemsVisiveis = useMemo(
    () =>
      SIDEBAR_GROUPS.map((item) => {
        if (item.permission && !hasPermission(accessProfile, item.permission)) return null
        if (item.href && !item.children) {
          if (!podeVerItemMenu(item)) return null
          return item
        }
        const children = filtrarChildrenNav(item.children || [], podeVerItemMenu)
        if (children.length === 0) return null
        return { ...item, children }
      }).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessProfile],
  )

  const grupoAtivoId = useMemo(
    () => grupoIdPorPathname(menuItemsVisiveis, pathname),
    [menuItemsVisiveis, pathname],
  )

  /** Mantém aberta a categoria da página atual (ex.: Ops) mesmo ao recolher/expandir a sidebar. */
  useEffect(() => {
    setOpenMenus((prev) => {
      const next = {}
      menuItemsVisiveis.forEach((item) => {
        next[item.id] = false
      })
      if (grupoAtivoId) {
        next[grupoAtivoId] = true
      } else {
        // Sem rota de grupo: preserva o que o utilizador tinha aberto, se ainda existir
        menuItemsVisiveis.forEach((item) => {
          if (prev[item.id]) next[item.id] = true
        })
      }
      return next
    })
  }, [grupoAtivoId, menuItemsVisiveis, accessProfile?.id])

  useEffect(() => {
    if (!open || !grupoAtivoId) return
    setOpenMenus((prev) => {
      if (prev[grupoAtivoId]) return prev
      const next = { ...prev }
      menuItemsVisiveis.forEach((item) => {
        if (item.id !== grupoAtivoId) next[item.id] = false
      })
      next[grupoAtivoId] = true
      return next
    })
  }, [open, grupoAtivoId, menuItemsVisiveis])

  const toggleMenu = (id) => {
    setOpenMenus((prev) => {
      const wasOpen = !!prev[id]
      const next = {}
      menuItemsVisiveis.forEach((item) => {
        next[item.id] = false
      })
      // Não deixa fechar o grupo da página atual — só troca para outro
      if (wasOpen && id === grupoAtivoId) {
        next[id] = true
        return next
      }
      if (!wasOpen) next[id] = true
      else if (grupoAtivoId) next[grupoAtivoId] = true
      return next
    })
  }

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
    if (error) {
      alert('Erro ao enviar redefinição de senha')
      return
    }
    alert('E-mail de redefinição enviado com sucesso')
  }

  const handleAction = async (child) => {
    if (child.action === 'reset-password') {
      await handleResetPassword()
      return
    }
    if (child.action === 'logout' || child.href === '/logout') {
      await handleLogout()
    }
  }

  useEffect(() => {
    if (darkModeAtivo) {
      document.body.classList.add('dark-mode')
    } else {
      document.body.classList.remove('dark-mode')
    }
    salvarDarkModeAtivo(darkModeAtivo)
  }, [darkModeAtivo])

  const labelClass = cn(
    'overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150',
    open ? 'max-w-[14rem] opacity-100' : 'max-w-0 opacity-0',
  )

  return (
    <aside
      className={cn(
        'fixed inset-y-0 right-0 z-drawer flex flex-col border-l border-white/10 bg-[#0f3a56] text-white shadow-lg lg:left-0 lg:right-auto lg:border-l-0 lg:border-r lg:shadow-none',
        'transition-[width,transform] duration-200 ease-out',
        open
          ? cn('w-sidebar translate-x-0', !isPinned && 'lg:shadow-xl')
          : 'w-sidebar translate-x-full lg:w-sidebar-collapsed lg:translate-x-0',
      )}
      aria-label="Navegação principal"
      data-open={open ? 'true' : 'false'}
      data-pinned={isPinned ? 'true' : 'false'}
    >
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-white/10 px-2">
        {open ? (
          <img src={logoBranco} alt="EmerLAB" className="h-9 w-auto object-contain" />
        ) : (
          <img src={logoE} alt="EmerLAB" className="h-8 w-auto object-contain" />
        )}
      </div>

                <div className='sidebar_footer'>
                    {hasPermission(accessProfile, PERMISSION_KEYS.DEV_TOOLS) && (
                        <button
                            type='button'
                            className='sidebar_admin_btn'
                            onClick={() => {
                                navigate('/aitest')
                                onAfterNavigate?.()
                            }}
                            title='Playground Gemini'
                        >
                            <span className='sidebar_admin_icon' aria-hidden>✦</span>
                            <span className='sidebar_admin_text'>AI Test</span>
                        </button>
                    )}
                    {hasPermission(accessProfile, PERMISSION_KEYS.ACCESS_MANAGE) && (
                        <>
                            <button
                                type='button'
                                className='sidebar_admin_btn'
                                onClick={() => {
                                    navigate('/administrativo/auditoria')
                                    onAfterNavigate?.()
                                }}
                                title='Auditoria de alterações'
                            >
                                <span className='sidebar_admin_icon' aria-hidden>📋</span>
                                <span className='sidebar_admin_text'>Auditoria</span>
                            </button>
                            <button
                                type='button'
                                className='sidebar_admin_btn'
                                onClick={() => {
                                    navigate('/administrativo/acessos')
                                    onAfterNavigate?.()
                                }}
                                title='Gerenciamento de acessos'
                            >
                                <span className='sidebar_admin_icon' aria-hidden>🛡️</span>
                                <span className='sidebar_admin_text'>Admin</span>
                            </button>
                        </>
                    )}
                    onClick={() => (open ? toggleMenu(item.id) : onToggleManual?.())}
                    title={item.label}
                  >
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
                    <span className={cn(labelClass, 'flex-1 text-left')}>{item.label}</span>
                    {open ? (
                      <span className="shrink-0 text-white/70" aria-hidden>
                        {openMenus[item.id] ? '▾' : '▸'}
                      </span>
                    ) : null}
                  </button>
                  {open && openMenus[item.id] ? (
                    <div className="ml-2 mt-1 flex flex-col gap-0.5 border-l border-white/15 pl-2">
                      {item.children.map((child) =>
                        child.type === 'section' ? (
                          <div
                            key={`section-${child.label}`}
                            className="mt-2 px-2.5 pb-0.5 pt-1 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-white/45 first:mt-0"
                            role="presentation"
                          >
                            {child.label}
                          </div>
                        ) : child.action || child.href === '/logout' ? (
                          <button
                            key={child.action || child.href || child.label}
                            type="button"
                            className="min-h-10 whitespace-nowrap rounded-lg px-2.5 text-left text-[0.88rem] font-medium text-white/90 hover:bg-white/10 hover:text-white"
                            onClick={() => handleAction(child)}
                          >
                            {child.label}
                          </button>
                        ) : (
                          <Link
                            key={child.href}
                            to={child.href}
                            className={cn(
                              'min-h-10 whitespace-nowrap rounded-lg px-2.5 py-2 text-[0.88rem] font-medium text-white/90 hover:bg-white/10 hover:text-white',
                              pathname === child.href && 'bg-white/15 text-white',
                            )}
                            onClick={() => onAfterNavigate?.()}
                          >
                            {child.label}
                          </Link>
                        ),
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-white/10 p-1.5">
        <button
          type="button"
          className={cn(
            'flex min-h-11 items-center rounded-xl text-[0.88rem] font-semibold hover:bg-white/10',
            open ? 'gap-2 px-3' : 'justify-center px-0',
          )}
          onClick={onToggleManual}
          title={isPinned ? 'Recolher menu (salvar preferência)' : 'Manter menu aberto (salvar preferência)'}
        >
          <span className="inline-flex w-5 shrink-0 justify-center" aria-hidden>
            {isPinned ? '«' : '»'}
          </span>
          <span className={labelClass}>{isPinned ? 'Recolher menu' : 'Manter aberto'}</span>
        </button>

        <button
          type="button"
          className={cn(
            'flex min-h-11 items-center rounded-xl text-[0.88rem] font-semibold hover:bg-white/10',
            open ? 'gap-2 px-3' : 'justify-center px-0',
          )}
          onClick={() => setDarkModeAtivo((v) => !v)}
          title={darkModeAtivo ? 'Modo claro' : 'Modo escuro'}
        >
          <span className="inline-flex w-5 shrink-0 justify-center" aria-hidden>
            {darkModeAtivo ? '☀' : '☾'}
          </span>
          <span className={labelClass}>{darkModeAtivo ? 'Modo claro' : 'Modo escuro'}</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
