import { useEffect, useState } from 'react'
import {
  expandLegacyToAcl,
  syncLegacyFromAcl,
  completarAclFerramentasCredenciamento,
  podeLerFerramenta,
} from './permissionCatalog.js'

export const ACCESS_PROFILE_STORAGE_KEY = 'emerlab-access-profile'
export const ACCESS_PROFILE_CHANGE_EVENT = 'emerlab-access-profile-change'

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
  CREDENCIAMENTO_FORMULARIO_CONFIG: 'credenciamento.formulario.config',
  CREDENCIAMENTO_FORMULARIO_PAGINAS: 'credenciamento.formulario.paginas',
  CREDENCIAMENTO_FORMULARIO_INBOX: 'credenciamento.formulario.inbox',
  NOTIFICACOES_FORMULARIO: 'notificacoes.formulario',
  NOTIFICACOES_CONTRATOS: 'notificacoes.contratos',
  COMPRAS_VIEW: 'compras.view',
  COMPRAS_EDIT: 'compras.edit',
  PLANOS_VIEW: 'planos.view',
  CONTRATOS_VIEW: 'contratos.view',
  CONTRATOS_EDIT: 'contratos.edit',
  PAGAMENTOS_VIEW: 'pagamentos.view',
  PAGAMENTOS_EDIT: 'pagamentos.edit',
  DEV_TOOLS: 'dev.tools',
  BATE_PAPO: 'bate.papo',
}

/** Telas com chave própria: se ausente no JSON salvo, herda o «ver» do módulo. */
const HERANCA_PERMISSAO_TELA = [
  [PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW, PERMISSION_KEYS.SUPERTABELA_VIEW],
  [PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
  [PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_CONFIG, PERMISSION_KEYS.CREDENCIAMENTO_EDIT],
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_PAGINAS, PERMISSION_KEYS.CREDENCIAMENTO_EDIT],
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
  [PERMISSION_KEYS.PAGAMENTOS_VIEW, PERMISSION_KEYS.CREDENCIAMENTO_VIEW],
  [PERMISSION_KEYS.PAGAMENTOS_EDIT, PERMISSION_KEYS.CREDENCIAMENTO_EDIT],
  [PERMISSION_KEYS.PAGAMENTOS_EDIT, PERMISSION_KEYS.ACCESS_MANAGE],
  [PERMISSION_KEYS.PLANOS_VIEW, PERMISSION_KEYS.SUPERTABELA_VIEW],
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
            'Exibe a chave Dev (canto inferior direito): pesquisa NOT, colunas extras de cadastro, exclusão por lista e apagar prestadores/entradas do formulário no banco.',
      },
      {
        chave: PERMISSION_KEYS.BATE_PAPO,
        rotulo: 'Bate-papo',
        descricao:
            'Exibe a gaveta flutuante de bate-papo entre usuários (arrastar, compactar e conversar).',
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
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_CONFIG,
        rotulo: 'Editar status do formulário',
        descricao: 'Link público, slug, título e ativo/inativo (caixa «Link e definições gerais»).',
      },
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_PAGINAS,
        rotulo: 'Reorganizar páginas do formulário',
        descricao: 'Criar, ordenar, excluir páginas e categorias do wizard público.',
      },
      {
        chave: PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX,
        rotulo: 'Acessar inbox do formulário',
        descricao: 'Tela de pré-cadastros e conversão em ficha de prestador.',
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
    grupo: 'Planos',
    itens: [
      {
        chave: PERMISSION_KEYS.PLANOS_VIEW,
        rotulo: 'Ver Planos',
        descricao: 'Impressão de planos por cidade (PDF para credenciados).',
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
  {
    grupo: 'Pagamentos',
    itens: [
      {
        chave: PERMISSION_KEYS.PAGAMENTOS_VIEW,
        rotulo: 'Ver Pagamentos',
        descricao: 'Folha mensal de pagamentos a prestadores.',
      },
      {
        chave: PERMISSION_KEYS.PAGAMENTOS_EDIT,
        rotulo: 'Editar Pagamentos',
        descricao: 'Incluir, alterar e excluir linhas na folha de pagamentos.',
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
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_CONFIG]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_PAGINAS]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX]: true,
  [PERMISSION_KEYS.NOTIFICACOES_FORMULARIO]: true,
  [PERMISSION_KEYS.NOTIFICACOES_CONTRATOS]: true,
  [PERMISSION_KEYS.COMPRAS_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_EDIT]: true,
  [PERMISSION_KEYS.PLANOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_EDIT]: true,
  [PERMISSION_KEYS.PAGAMENTOS_VIEW]: true,
  [PERMISSION_KEYS.PAGAMENTOS_EDIT]: true,
  [PERMISSION_KEYS.ACCESS_MANAGE]: false,
  [PERMISSION_KEYS.DEV_TOOLS]: false,
  [PERMISSION_KEYS.BATE_PAPO]: false,
}

export const DEFAULT_INVITED_PERMISSIONS = {
  [PERMISSION_KEYS.SUPERTABELA_VIEW]: true,
  [PERMISSION_KEYS.SUPERTABELA_EDIT]: false,
  [PERMISSION_KEYS.SUPERTABELA_NEGOCIACOES_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: false,
  [PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_QUEM_REALIZA_VIEW]: true,
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_CONFIG]: false,
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_PAGINAS]: false,
  [PERMISSION_KEYS.CREDENCIAMENTO_FORMULARIO_INBOX]: false,
  [PERMISSION_KEYS.NOTIFICACOES_FORMULARIO]: false,
  [PERMISSION_KEYS.NOTIFICACOES_CONTRATOS]: false,
  [PERMISSION_KEYS.COMPRAS_VIEW]: true,
  [PERMISSION_KEYS.COMPRAS_EDIT]: false,
  [PERMISSION_KEYS.PLANOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_VIEW]: true,
  [PERMISSION_KEYS.CONTRATOS_EDIT]: false,
  [PERMISSION_KEYS.PAGAMENTOS_VIEW]: true,
  [PERMISSION_KEYS.PAGAMENTOS_EDIT]: false,
  [PERMISSION_KEYS.ACCESS_MANAGE]: false,
  [PERMISSION_KEYS.DEV_TOOLS]: false,
  [PERMISSION_KEYS.BATE_PAPO]: false,
}

export const normalizarPermissions = (profile = {}) => {
  const raw = profile?.permissions && typeof profile.permissions === 'object' ? profile.permissions : {}
  const temPermissions = Object.keys(raw).length > 0

  const base = temPermissions ? { ...DEFAULT_INVITED_PERMISSIONS } : { ...DEFAULT_PROFILE_PERMISSIONS }

  const perms = {
    ...base,
    ...raw,
  }
  const rawKeys = Object.keys(raw)
  for (const [filho, pai] of HERANCA_PERMISSAO_TELA) {
    if (!rawKeys.includes(filho) && perms[pai]) perms[filho] = true
  }
  delete perms[PERMISSION_KEYS.SUPERTABELA_DELETE_BY_LIST]
  const comAcl = completarAclFerramentasCredenciamento(expandLegacyToAcl(perms))
  return syncLegacyFromAcl(comAcl)
}

export const normalizarProfileAcesso = (profile = {}) => ({
  id: profile?.id || null,
  name: profile?.name || '',
  email: profile?.email || '',
  permissions: normalizarPermissions(profile),
})

export const hasPermission = (profileOrPermissions, key) => {
  const permissions = profileOrPermissions?.permissions || profileOrPermissions || {}
  return !!permissions[key]
}

export const hasAnyPermission = (profileOrPermissions, keys = []) =>
  keys.some((key) => hasPermission(profileOrPermissions, key))

/** True se há create/update/delete em qualquer ferramenta de módulo (ACL) ou edição legada. */
export const usuarioTemAlgumaPermissaoDeEscrita = (profileOrPermissions) => {
  const permissions = profileOrPermissions?.permissions || profileOrPermissions || {}
  if (
    hasAnyPermission(permissions, [
      PERMISSION_KEYS.SUPERTABELA_EDIT,
      PERMISSION_KEYS.CREDENCIAMENTO_EDIT,
      PERMISSION_KEYS.COMPRAS_EDIT,
      PERMISSION_KEYS.CONTRATOS_EDIT,
      PERMISSION_KEYS.PAGAMENTOS_EDIT,
      PERMISSION_KEYS.ACCESS_MANAGE,
    ])
  ) {
    return true
  }
  return Object.keys(permissions).some((chave) => {
    if (!permissions[chave]) return false
    // Dashboard/Home não conta: afazeres são liberados à parte no client Supabase
    if (chave.startsWith('inicio.dashboard.')) return false
    return (
      chave.endsWith('.create') ||
      chave.endsWith('.update') ||
      chave.endsWith('.delete')
    )
  })
}

/**
 * Flag global de «somente leitura» nos módulos (Super-Tabela, Credenciamento, etc.).
 * Não impede to-dos da Home — isso é liberado no client Supabase (guardedFetch).
 */
export const usuarioSomenteLeituraGlobal = (profileOrPermissions) =>
  !usuarioTemAlgumaPermissaoDeEscrita(profileOrPermissions)

/** Exclusão na Super-Tabela exige permissão de edição (somente «Ver» bloqueia). */
export const podeExcluirNaSuperTabela = (profileOrPermissions) =>
  hasPermission(profileOrPermissions, PERMISSION_KEYS.SUPERTABELA_EDIT)

export const podeUsarExclusaoPorLista = (profileOrPermissions) =>
  podeExcluirNaSuperTabela(profileOrPermissions) && isDevToolsEnabled(profileOrPermissions)

/** Exclusão irreversível de prestadores / entradas do formulário (Dev Tools + edição credenciamento). */
export const podeUsarExclusaoPermanenteCredenciamento = (profileOrPermissions) =>
  isDevToolsEnabled(profileOrPermissions) &&
  hasPermission(profileOrPermissions, PERMISSION_KEYS.CREDENCIAMENTO_EDIT)

export const hasStoredExclusaoPermanenteCredenciamento = () =>
  podeUsarExclusaoPermanenteCredenciamento(getStoredAccessProfile())

export const isDevToolsEnabled = (profileOrPermissions) =>
  hasPermission(profileOrPermissions, PERMISSION_KEYS.DEV_TOOLS)

export const hasStoredDevTools = () => isDevToolsEnabled(getStoredAccessProfile())

export const isBatePapoEnabled = (profileOrPermissions) =>
  hasPermission(profileOrPermissions, PERMISSION_KEYS.BATE_PAPO)

export const hasStoredBatePapo = () => isBatePapoEnabled(getStoredAccessProfile())

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
  const normalizado = normalizarProfileAcesso(profile)
  window.localStorage.setItem(ACCESS_PROFILE_STORAGE_KEY, JSON.stringify(normalizado))
  window.dispatchEvent(new CustomEvent(ACCESS_PROFILE_CHANGE_EVENT, { detail: normalizado }))
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

export { hasAcl, podeLerFerramenta, usuarioPodeEditarFerramenta } from './permissionCatalog.js'
export { PERMISSION_CATALOG, ACL_ACTIONS, aclKey, aplicarFerramentaAcl, aplicarGrupoAcl } from './permissionCatalog.js'

/** Reage a alterações de permissões (login, Gerenciamento de Acessos, etc.). */
export function useStoredAccessProfile() {
  const [profile, setProfile] = useState(() => getStoredAccessProfile())

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const sync = () => setProfile(getStoredAccessProfile())
    window.addEventListener(ACCESS_PROFILE_CHANGE_EVENT, sync)
    window.addEventListener('storage', (e) => {
      if (e.key === ACCESS_PROFILE_STORAGE_KEY) sync()
    })
    return () => {
      window.removeEventListener(ACCESS_PROFILE_CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return profile
}

export function useStoredPermission(key) {
  const profile = useStoredAccessProfile()
  return hasPermission(profile, key)
}
