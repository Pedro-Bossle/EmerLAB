import React, { useEffect, useState } from 'react'
import './Sidebar.css'
import iconShow from "../../assets/sidepanel-ico-show.png";
import iconHide from "../../assets/sidepanel-ico-hide.png";
import logoBranco from "../../assets/logo_branco.png";
import logoE from "../../assets/logo_E.png";
import { Link, useNavigate } from 'react-router-dom';
import {
    PERMISSION_KEYS,
    hasPermission,
    podeLerFerramenta,
    useStoredAccessProfile,
} from '../../lib/accessControl';
import { getToolIdForHref } from '../../lib/permissionCatalog';
import { supabase } from '../../lib/supabase';
import { logoutSessao } from '../../lib/authSession';

/**
 * Como adicionar novos grupos:
 * 1) Adicione um objeto no array `menuItems` com:
 *    - id: identificador único
 *    - label: texto do item pai
 *    - children: array com os subitens
 *
 * Exemplo:
 * {
 *   id: 'financeiro',
 *   label: 'Financeiro',
 *   children: [
 *     { label: 'Faturas', href: '/financeiro/faturas' },
 *     { label: 'Reembolsos', href: '/financeiro/reembolsos' },
 *   ],
 * }
 */
const menuItems = [
    {
        id: 'inicio',
        label: 'Início',
        href: '/home',
    },
    {
        id: 'supertabela',
        label: 'Tabelas de Valores',
        permission: PERMISSION_KEYS.SUPERTABELA_VIEW,
        children: [
            { label: 'Visão geral', href: '/supertabelamain', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },
            { label: 'Cidades', href: '/supertabela/cidades', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },
            { label: 'Planos', href: '/supertabela/planos', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },
            { label: 'Procedimentos', href: '/supertabela/procedimentos', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },
            { label: 'Negociações', href: '/supertabela/negociacoes', permission: PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW },
            { label: 'Documentação', href: '/supertabeladoc', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },
        ],
    },
    {
        id: 'credenciamento',
        label: 'Credenciamento',
        permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
        children: [
            { label: 'Processos', href: '/credenciamento/principal', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },
            { label: 'Cadastros', href: '/credenciamento/cadastro', permission: PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW },
            { label: 'Mapa', href: '/credenciamento/mapa', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },
            {
                label: 'Prospecção',
                href: '/credenciamento/prospectos-osm',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            { label: 'Quem Realiza', href: '/credenciamento/quem-realiza', permission: PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW },
            {
                label: 'Especialistas por Cidade',
                href: '/credenciamento/especialidades-cidade',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            {
                label: 'Formulário',
                href: '/credenciamento/formulario',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            {
                label: 'Inbox formulário',
                href: '/credenciamento/formulario/entradas',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX,
            },
            /* Documentação credenciamento — inativo por hora
            { label: 'Documentação', href: '/credenciamentodoc', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },
            */

        ],
    },
    
    {
        id: 'planos',
        label: 'Planos',
        permission: PERMISSION_KEYS.PLANOS_VIEW,
        children: [
            { label: 'Impressão', href: '/planos/impressao', permission: PERMISSION_KEYS.PLANOS_VIEW },
        ],
    },
    {
        id: 'compras',
        label: 'Compras',
        permission: PERMISSION_KEYS.COMPRAS_VIEW,
        children: [
            { label: 'Valor de Venda', href: '/compras/valor-venda', permission: PERMISSION_KEYS.COMPRAS_VIEW },
            { label: 'Orçamento', href: '/compras/orcamento', permission: PERMISSION_KEYS.COMPRAS_VIEW },
        ],
    },
    {
        id: 'contratos',
        label: 'Contratos',
        permission: PERMISSION_KEYS.CONTRATOS_VIEW,
        children: [
            { label: 'Gerar PDF', href: '/contratos/gerar', permission: PERMISSION_KEYS.CONTRATOS_VIEW },
            { label: 'Clicksign', href: '/contratos/clicksign', permission: PERMISSION_KEYS.CONTRATOS_VIEW },
        ],
    },
    {
        id: 'pagamentos',
        label: 'Pagamentos',
        permission: PERMISSION_KEYS.PAGAMENTOS_VIEW,
        children: [
            { label: 'Registro', href: '/pagamentos/registro', permission: PERMISSION_KEYS.PAGAMENTOS_VIEW },
            { label: 'Resumo', href: '/pagamentos/resumo', permission: PERMISSION_KEYS.PAGAMENTOS_VIEW },
        ],
    },
    {
        id: 'configuracoes',
        label: 'Configurações',
        children: [
            { label: 'Importar KMZ', href: '/credenciamento/import-kmz', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },
            {
                label: 'Especialidades (RC)',
                href: '/credenciamento/especialidades-rc',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            {
                label: 'Importar Credenciados',
                href: '/configuracoes/importar-credenciados',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            {
                label: 'Exportar Credenciados',
                href: '/configuracoes/exportar-credenciados',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
            {
                label: 'Conferência Laboratório',
                href: '/configuracoes/conferencia-laboratorio',
                permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
            },
        ],
    },
    {
        id: 'sair',
        label: 'Sair',
        children: [
            { label: 'Redefinir senha', action: 'reset-password' },
            { label: 'Encerrar sessão', href: '/logout' },
        ],
        },
]

const Sidebar = ({ open, onToggleManual, isPinned, onAfterNavigate }) => {
    const navigate = useNavigate()
    const accessProfile = useStoredAccessProfile()
    const [darkModeAtivo, setDarkModeAtivo] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.localStorage.getItem('emerlab-dark-mode') === '1'
    })
    /**
     * Estado de submenus:
     * { [idDoMenu]: true/false }
     */
    const [openMenus, setOpenMenus] = useState({})

    const podeVerItemMenu = (child) => {
        if (child.action) return true
        const toolId = getToolIdForHref(child.href)
        if (toolId) return podeLerFerramenta(accessProfile?.permissions, toolId)
        if (child.permission) return hasPermission(accessProfile, child.permission)
        return true
    }

    const menuItemsVisiveis = menuItems
        .map((item) => {
            if (item.permission && !hasPermission(accessProfile, item.permission)) return null
            if (item.href && !item.children) {
                if (!podeVerItemMenu(item)) return null
                return item
            }
            const children = (item.children || []).filter((child) => podeVerItemMenu(child))
            if (children.length === 0) return null
            return { ...item, children }
        })
        .filter(Boolean)

    // Inicializa todos fechados ao montar
    useEffect(() => {
        const initial = {}
        menuItemsVisiveis.forEach((item) => {
            initial[item.id] = false
        })
        setOpenMenus(initial)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accessProfile?.id])

    // Se fechar a sidebar, fecha todos os submenus também
    useEffect(() => {
        if (!open) {
            const reset = {}
            menuItemsVisiveis.forEach((item) => {
                reset[item.id] = false
            })
            setOpenMenus(reset)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const toggleMenu = (id) => {
        setOpenMenus((prev) => {
            const wasOpen = !!prev[id]
            const next = {}
            menuItemsVisiveis.forEach((item) => {
                next[item.id] = false
            })
            if (!wasOpen) {
                next[id] = true
            }
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

        if (child.href === '/logout') {
            await handleLogout()
        }
    }

    useEffect(() => {
        if (darkModeAtivo) {
            document.body.classList.add('dark-mode')
            window.localStorage.setItem('emerlab-dark-mode', '1')
        } else {
            document.body.classList.remove('dark-mode')
            window.localStorage.setItem('emerlab-dark-mode', '0')
        }
    }, [darkModeAtivo])

    return (
        <div className='layout'>
            <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
                <div className="sidebar_logo_wrap">
                    <img
                        src={open ? logoBranco : logoE}
                        alt="EmerLAB"
                        className='logo logo_sidebar'
                    />
                </div>

                <nav className='sidebar_nav'>
                    {menuItemsVisiveis.map((item) => (
                        <div key={item.id} className="sidebar_group">
                            {item.href && !item.children ? (
                                <Link
                                    to={item.href}
                                    className="sidebar_group_btn sidebar_link_btn"
                                    onClick={() => {
                                        if (item.href === '/home') {
                                            window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
                                        }
                                        onAfterNavigate?.()
                                    }}
                                >
                                    <span>{item.label}</span>
                                </Link>
                            ) : (
                                <>
                                    <button
                                        className="sidebar_group_btn"
                                        onClick={() => toggleMenu(item.id)}
                                    >
                                        <span>{item.label}</span>
                                        <span>{openMenus[item.id] ? '▾' : '▸'}</span>
                                    </button>

                                    <div className={`sidebar_submenu ${openMenus[item.id] ? 'open' : ''}`}>
                                        {item.children.map((child) => (
                                            child.action || child.href === '/logout' ? (
                                                <button
                                                    key={child.action || child.href}
                                                    type="button"
                                                    className="sidebar_submenu_action"
                                                    onClick={() => handleAction(child)}
                                                >
                                                    {child.label}
                                                </button>
                                            ) : (
                                                <Link
                                                    key={child.href}
                                                    to={child.href}
                                                    onClick={() => onAfterNavigate?.()}
                                                >
                                                    {child.label}
                                                </Link>
                                            )
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </nav>

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

                    <button onClick={onToggleManual} className="toggle_btn" title={isPinned ? 'Desafixar sidebar' : 'Fixar sidebar'}>
                        <img
                            src={open ? iconHide : iconShow}
                            alt={isPinned ? "Desafixar Sidebar" : "Fixar Sidebar"}
                            className="toggle_icon"
                        />
                        <span className='toggle_text'>{isPinned ? 'Desafixar menu' : 'Fixar menu'}</span>
                    </button>

                    <button
                        type='button'
                        className='sidebar_darkmode_btn'
                        onClick={() => setDarkModeAtivo((anterior) => !anterior)}
                        title={darkModeAtivo ? 'Desativar modo escuro' : 'Ativar modo escuro'}
                    >
                        <span className='sidebar_darkmode_icon'>{darkModeAtivo ? '☀️' : '🌙'}</span>
                        <span className='sidebar_darkmode_text'>
                            {darkModeAtivo ? 'Modo claro' : 'Modo escuro'}
                        </span>
                    </button>
                </div>
            </aside>
        </div>
    )
}

export default Sidebar