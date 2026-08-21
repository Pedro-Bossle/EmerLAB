import { PERMISSION_KEYS } from './accessControl'



/**

 * Navegação global EmerLAB — hubs para sidebar (desktop) e bottom nav (mobile).

 * Filtrar sempre com podeLerFerramenta / hasPermission antes de renderizar.

 *

 * Em children, `{ type: 'section', label }` cria um cabeçalho visual (só sidebar).

 */



export const OPS_CHILDREN = [

  { label: 'Impressão', href: '/planos/impressao', permission: PERMISSION_KEYS.PLANOS_VIEW },

  { label: 'Valor de Venda', href: '/compras/valor-venda', permission: PERMISSION_KEYS.COMPRAS_VIEW },

  { label: 'Orçamento', href: '/compras/orcamento', permission: PERMISSION_KEYS.COMPRAS_VIEW },

  { type: 'section', label: 'Contratos' },

  { label: 'Gerar Contrato', href: '/contratos/gerar', permission: PERMISSION_KEYS.CONTRATOS_VIEW },

  { label: 'Clicksign', href: '/contratos/clicksign', permission: PERMISSION_KEYS.CONTRATOS_VIEW },

  { type: 'section', label: 'Financeiro' },

  {

    label: 'Pagamentos - Registro',

    href: '/pagamentos/registro',

    permission: PERMISSION_KEYS.PAGAMENTOS_VIEW,

  },

  {

    label: 'Pagamentos - Resumo',

    href: '/pagamentos/resumo',

    permission: PERMISSION_KEYS.PAGAMENTOS_VIEW,

  },

]



export const CONFIG_TOOLS = [
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
]

/** Ações de sessão — Encerrar deve ficar sempre no fim do menu Mais (mobile). */
export const SESSION_CHILDREN = [
  { label: 'Modo escuro', action: 'toggle-dark-mode' },
  { label: 'Redefinir senha', action: 'reset-password' },
  { label: 'Encerrar sessão', action: 'logout' },
]

export const CONFIG_CHILDREN = [
  ...CONFIG_TOOLS,
  { label: 'Redefinir senha', action: 'reset-password' },
  { label: 'Encerrar sessão', action: 'logout' },
]

export const ADMIN_CHILDREN = [

  { label: 'Gerenciar acessos', href: '/administrativo/acessos', permission: PERMISSION_KEYS.ACCESS_MANAGE },

  { label: 'Auditoria', href: '/administrativo/auditoria', permission: PERMISSION_KEYS.ACCESS_MANAGE },

]

/** Drawer «Mais» no mobile: ferramentas + admin + sessão (Encerrar por último). */
export const MAIS_CHILDREN = [...CONFIG_TOOLS, ...ADMIN_CHILDREN, ...SESSION_CHILDREN]



export const NAV_HUBS = [

  {

    id: 'inicio',

    label: 'Início',

    shortLabel: 'Início',

    href: '/home',

    icon: 'home',

  },

  {

    id: 'tabelas',

    label: 'Tabelas',

    shortLabel: 'Tabelas',

    icon: 'table',

    permission: PERMISSION_KEYS.SUPERTABELA_VIEW,

    children: [

      { label: 'Visão geral', href: '/supertabelamain', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },

      { label: 'Cidades', href: '/supertabela/cidades', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },

      { label: 'Planos', href: '/supertabela/planos', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },

      { label: 'Procedimentos', href: '/supertabela/procedimentos', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },

      {

        label: 'Negociações',

        href: '/supertabela/negociacoes',

        permission: PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW,

      },

      { label: 'Documentação', href: '/supertabeladoc', permission: PERMISSION_KEYS.SUPERTABELA_VIEW },

    ],

  },

  {

    id: 'credenciamento',

    label: 'Credenciamento',

    shortLabel: 'Credenc.',

    icon: 'cred',

    permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,

    children: [

      { label: 'Processos', href: '/credenciamento/principal', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },

      {

        label: 'Cadastros',

        href: '/credenciamento/cadastro',

        permission: PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW,

      },

      { label: 'Mapa', href: '/credenciamento/mapa', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },

      {

        label: 'Prospecção',

        href: '/credenciamento/prospectos-osm',

        permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,

      },

      {

        label: 'Quem Realiza',

        href: '/credenciamento/quem-realiza',

        permission: PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW,

      },

      {

        label: 'Especialistas por Cidade',

        href: '/credenciamento/especialidades-cidade',

        permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,

      },

      { label: 'Formulário', href: '/credenciamento/formulario', permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW },

      {

        label: 'Inbox formulário',

        href: '/credenciamento/formulario/entradas',

        permission: PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX,

      },

    ],

  },

  {

    id: 'operacoes',

    label: 'Operações',

    shortLabel: 'Ops',

    icon: 'ops',

    children: OPS_CHILDREN,

  },

  {

    id: 'mais',

    label: 'Mais',

    shortLabel: 'Mais',

    icon: 'more',

    children: MAIS_CHILDREN,

  },

]



/** Sidebar clássica (grupos detalhados) — Config e Admin separados. */

export const SIDEBAR_GROUPS = [

  { id: 'inicio', label: 'Início', href: '/home' },

  {

    id: 'supertabela',

    label: 'Tabelas de Valores',

    permission: PERMISSION_KEYS.SUPERTABELA_VIEW,

    children: NAV_HUBS.find((h) => h.id === 'tabelas').children,

  },

  {

    id: 'credenciamento',

    label: 'Credenciamento',

    permission: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,

    children: NAV_HUBS.find((h) => h.id === 'credenciamento').children,

  },

  {

    id: 'operacoes',

    label: 'Operações',

    children: OPS_CHILDREN,

  },

  {

    id: 'configuracoes',

    label: 'Configurações',

    children: CONFIG_CHILDREN,

  },

  {

    id: 'administrativo',

    label: 'Admin',

    permission: PERMISSION_KEYS.ACCESS_MANAGE,

    children: ADMIN_CHILDREN,

  },

]



/** Remove secções órfãs após filtrar por permissão. */

export function filtrarChildrenNav(children, podeVerChild) {

  const list = (children || []).filter((c) => c?.type === 'section' || podeVerChild(c))

  return list.filter((c, i) => {

    if (c.type !== 'section') return true

    const rest = list.slice(i + 1)

    const nextSection = rest.findIndex((x) => x.type === 'section')

    const group = nextSection === -1 ? rest : rest.slice(0, nextSection)

    return group.some((x) => x.type !== 'section')

  })

}



export function hubMatchesPath(hub, pathname) {

  if (hub.href) return pathname === hub.href || pathname.startsWith(`${hub.href}/`)

  return (hub.children || []).some(

    (c) => c.href && (pathname === c.href || pathname.startsWith(`${c.href}/`)),

  )

}


