export const ACCESS_PROFILE_STORAGE_KEY = 'sfsc-access-profile'

export const PERMISSION_KEYS = {
  ACCESS_MANAGE: 'access.manage',
  SUPERTABELA_VIEW: 'supertabela.view',
  SUPERTABELA_EDIT: 'supertabela.edit',
  SUPERTABELA_DELETE_BY_LIST: 'supertabela.tools.deleteByList',
  SUPERTABELA_NEGOCIACOES_VIEW: 'supertabela.negociacoes.view',
  CREDENCIAMENTO_VIEW: 'credenciamento.view',
  CREDENCIAMENTO_EDIT: 'credenciamento.edit',
  CREDENCIAMENTO_CADASTRO_VIEW: 'credenciamento.cadastro.view',
  CREDENCIAMENTO_QUEM_REALIZA_VIEW: 'credenciamento.quem_realiza.view',
  COMPRAS_VIEW: 'compras.view',
  COMPRAS_EDIT: 'compras.edit',
  CONTRATOS_VIEW: 'contratos.view',
  CONTRATOS_EDIT: 'contratos.edit',
  DEV_TOOLS: 'dev.tools',
}

/** Telas com chave própria: se ausente no JSON salvo, herda o «ver» do módulo. */
const HERANCA_PERMISSAO_TELA = [
  [PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW, PERMISSION_KEYS.SUPERTABELA_VIEW],
  [PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
  [PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
]

export const PERMISSOES = [
  {
    grupo: 'Administrativo',
    itens: [
      {
        chave: PERMISSION_KEYS.ACCESS_MANAGE,
        rotulo: 'Gerenciar acessos',
        descricao: 'Pode abrir a tela administrativa, convidar usuarios e alterar permissoes.',
      },
      {
        chave: PERMISSION_KEYS.DEV_TOOLS,
        rotulo: 'Dev Tool',
        descricao:
            'Exibe a chave Dev (canto inferior direito) para ligar pesquisa NOT, colunas extras e exclusão por lista.',
      },
    ],
  },
  {
    grupo: 'Super-Tabela',
    itens: [
      {
        chave: PERMISSION_KEYS.SUPERTABELA_VIEW,
        rotulo: 'Ver Super-Tabela',
        descricao: 'Acesso geral à Super-Tabela (exceto telas com permissão própria desligada).',
      },
      {
        chave: PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW,
        rotulo: 'Ver Negociações',
        descricao: 'Tela Super-Tabela > Negociações (vínculo com prestador, exportação).',
      },
      {
        chave: PERMISSION_KEYS.SUPERTABELA_EDIT,
        rotulo: 'Editar Super-Tabela',
        descricao: 'Necessário para criar, editar ou excluir linhas na Super-Tabela.',
      },
    ],
  },
  {
    grupo: 'Credenciamento',
    itens: [
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_VIEW,
        rotulo: 'Ver Credenciamento',
        descricao: 'Painel principal e documentação de credenciamento.',
      },
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW,
        rotulo: 'Ver Cadastro de Prestadores',
        descricao: 'Lista e formulário em Credenciamento > Cadastros.',
      },
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW,
        rotulo: 'Ver Quem Realiza',
        descricao: 'Busca por UF, cidade e procedimentos (Credenciamento > Quem Realiza).',
      },
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_EDIT,
        rotulo: 'Editar Credenciamento',
        descricao: 'Pode alterar dados de Credenciamento.',
      },
    ],
  },
  {
    grupo: 'Compras',
    itens: [
      {
        chave: PERMISSION_KEYS.COMPRAS_VIEW,
        rotulo: 'Ver Compras',
        descricao: 'Pode acessar Valor de Venda e Orçamento.',
      },
      {
        chave: PERMISSION_KEYS.COMPRAS_EDIT,
        rotulo: 'Editar Compras',
        descricao: 'Pode criar, editar e excluir registros em Valor de Venda.',
      },
    ],
  },
  {
    grupo: 'Contratos',
    itens: [
      {
        chave: PERMISSION_KEYS.CONTRATOS_VIEW,
        rotulo: 'Ver Contratos',
        descricao: 'Acessa Gerar PDF e o painel Clicksign (consulta).',
      },
      {
        chave: PERMISSION_KEYS.CONTRATOS_EDIT,
        rotulo: 'Editar Contratos',
        descricao: 'Gera PDFs, monta envelopes, envia e altera dados na Clicksign.',
      },
    ],
  },
]

export const DEFAULT_PROFILE_PERMISSIONS = {
  [PERMISSION_KEYS.SUPERTABELA_VIEW]: true,
  [PERMISSION_KEYS.SUPERTABELA_EDIT]: true,
  [PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_EDIT]: true,
  [PERMISSION_KEYS.CONTRATOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_EDIT]: true,
  [PERMISSION_KEYS.ACCESS_MANAGE]: false,
  [PERMISSION_KEYS.DEV_TOOLS]: false,
}

export const DEFAULT_INVITED_PERMISSIONS = {
  [PERMISSION_KEYS.SUPERTABELA_VIEW]: true,
  [PERMISSION_KEYS.SUPERTABELA_EDIT]: false,
  [PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: false,
  [PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_EDIT]: false,
  [PERMISSION_KEYS.CONTRATOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_EDIT]: false,
  [PERMISSION_KEYS.ACCESS_MANAGE]: false,
  [PERMISSION_KEYS.DEV_TOOLS]: false,
}

export const normalizarPermissions = (profile = {}) => {
  const raw = profile?.permissions && typeof profile.permissions === 'object' ? profile.permissions : {}
  const temPermissions = Object.keys(raw).length > 0
  const legadoCredReadonly = !!profile?.credenciamento_read_only

  const base = temPermissions
    ? { ...DEFAULT_INVITED_PERMISSIONS }
    : {
        ...DEFAULT_PROFILE_PERMISSIONS,
        [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: !legadoCredReadonly,
      }

  const perms = {
    ...base,
    ...raw,
  }
  const rawKeys = Object.keys(raw)
  for (const [filho, pai] of HERANCA_PERMISSAO_TELA) {
    if (!rawKeys.includes(filho) && perms[pai]) perms[filho] = true
  }
  delete perms[PERMISSION_KEYS.SUPERTABELA_DELETE_BY_LIST]
  return perms
}

export const normalizarProfileAcesso = (profile = {}) => ({
  id: profile?.id || null,
  name: profile?.name || '',
  email: profile?.email || '',
  credenciamento_read_only: !!profile?.credenciamento_read_only,
  permissions: normalizarPermissions(profile),
})

export const hasPermission = (profileOrPermissions, key) => {
  const permissions = profileOrPermissions?.permissions || profileOrPermissions || {}
  return !!permissions[key]
}

export const hasAnyPermission = (profileOrPermissions, keys = []) =>
  keys.some((key) => hasPermission(profileOrPermissions, key))

export const usuarioSomenteLeituraGlobal = (profileOrPermissions) =>
  !hasAnyPermission(profileOrPermissions, [
    PERMISSION_KEYS.SUPERTABELA_EDIT,
    PERMISSION_KEYS.CREDENCIAMENTO_EDIT,
    PERMISSION_KEYS.COMPRAS_EDIT,
    PERMISSION_KEYS.CONTRATOS_EDIT,
    PERMISSION_KEYS.ACCESS_MANAGE,
  ])

/** Exclusão na Super-Tabela exige permissão de edição (somente «Ver» bloqueia). */
export const podeExcluirNaSuperTabela = (profileOrPermissions) =>
  hasPermission(profileOrPermissions, PERMISSION_KEYS.SUPERTABELA_EDIT)

export const podeUsarExclusaoPorLista = (profileOrPermissions) =>
  podeExcluirNaSuperTabela(profileOrPermissions) && isDevToolsEnabled(profileOrPermissions)

export const isDevToolsEnabled = (profileOrPermissions) =>
  hasPermission(profileOrPermissions, PERMISSION_KEYS.DEV_TOOLS)

export const hasStoredDevTools = () => isDevToolsEnabled(getStoredAccessProfile())

const ROTULOS_PERMISSAO = Object.fromEntries(
  PERMISSOES.flatMap((g) => g.itens.map((i) => [i.chave, i.rotulo])),
)

/** Resumo legível das permissões alteradas (para log). */
export const resumirAlteracoesPermissoes = (antes = {}, depois = {}) => {
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
  const linhas = []
  for (const chave of chaves) {
    const a = !!antes[chave]
    const b = !!depois[chave]
    if (a === b) continue
    const rotulo = ROTULOS_PERMISSAO[chave] || chave
    linhas.push(`${rotulo}: ${a ? 'sim' : 'não'} → ${b ? 'sim' : 'não'}`)
  }
  return linhas
}

export const setStoredAccessProfile = (profile) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_PROFILE_STORAGE_KEY, JSON.stringify(normalizarProfileAcesso(profile)))
}

export const getStoredAccessProfile = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACCESS_PROFILE_STORAGE_KEY)
    return raw ? normalizarProfileAcesso(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export const clearStoredAccessProfile = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_PROFILE_STORAGE_KEY)
}

export const hasStoredPermission = (key) => hasPermission(getStoredAccessProfile(), key)
