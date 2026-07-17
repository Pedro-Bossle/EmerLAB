/**
 * Catálogo único: grupo (sidebar) → ferramenta → ações CRUD.
 * Chaves persistidas: `${toolId}.${action}` (ex.: credenciamento.cadastro.read).
 * Chaves legadas em accessControl.js são derivadas via syncLegacyFromAcl.
 */

/** Espelha PERMISSION_KEYS em accessControl.js (evita import circular). */
const L = {
    ACCESS_MANAGE: 'access.manage',
    SUPERTABELA_VIEW: 'supertabela.view',
    SUPERTABELA_EDIT: 'supertabela.edit',
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
}

export const ACL_ACTIONS = [
    { id: 'read', label: 'Ler' },
    { id: 'create', label: 'Adicionar' },
    { id: 'update', label: 'Editar' },
    { id: 'delete', label: 'Excluir' },
]

const A = ['read', 'create', 'update', 'delete']
const R = ['read']
const RC = ['read', 'create']
const RU = ['read', 'update']
const RUD = ['read', 'update', 'delete']
const RCUD = ['read', 'create', 'update', 'delete']

/** @type {Array<{ id: string, label: string, tools: Array<{ id: string, label: string, descricao: string, actions: string[], href?: string }> }>} */
export const PERMISSION_CATALOG = [
    {
        id: 'inicio',
        label: 'Início',
        tools: [
            {
                id: 'inicio.dashboard',
                label: 'Dashboard',
                descricao: 'Página inicial com atalhos às ferramentas.',
                actions: R,
                href: '/home',
            },
        ],
    },
    {
        id: 'supertabela',
        label: 'Tabelas de Valores',
        tools: [
            {
                id: 'supertabela.main',
                label: 'Visão geral',
                descricao: 'Painel principal da Super-Tabela.',
                actions: RU,
                href: '/supertabelamain',
            },
            {
                id: 'supertabela.cidades',
                label: 'Cidades',
                descricao: 'Tabelas por cidade, vínculos e procedimentos locais.',
                actions: RCUD,
                href: '/supertabela/cidades',
            },
            {
                id: 'supertabela.planos',
                label: 'Planos (tabela)',
                descricao: 'Valores e procedimentos por plano na Super-Tabela.',
                actions: RCUD,
                href: '/supertabela/planos',
            },
            {
                id: 'supertabela.procedimentos',
                label: 'Procedimentos',
                descricao: 'Cadastro de procedimentos e modo categorias.',
                actions: RCUD,
                href: '/supertabela/procedimentos',
            },
            {
                id: 'supertabela.negociacoes',
                label: 'Negociações',
                descricao: 'Vínculos com prestadores e exportação.',
                actions: RU,
                href: '/supertabela/negociacoes',
            },
            {
                id: 'supertabela.doc',
                label: 'Documentação',
                descricao: 'Documentação interna da Super-Tabela.',
                actions: R,
                href: '/supertabeladoc',
            },
        ],
    },
    {
        id: 'credenciamento',
        label: 'Credenciamento',
        tools: [
            {
                id: 'credenciamento.processos',
                label: 'Processos',
                descricao: 'Lista operacional e geração do PDF da Rede Credenciada.',
                actions: RC,
                href: '/credenciamento/principal',
            },
            {
                id: 'credenciamento.cadastro',
                label: 'Cadastros',
                descricao: 'Lista e ficha de prestadores credenciados.',
                actions: RCUD,
                href: '/credenciamento/cadastro',
            },
            {
                id: 'credenciamento.mapa',
                label: 'Mapa de credenciados',
                descricao: 'Visualização geográfica de credenciados do tipo LOCAL.',
                actions: R,
                href: '/credenciamento/mapa',
            },
            {
                id: 'credenciamento.prospectos_osm',
                label: 'Catálogo prospectos (OSM)',
                descricao:
                    'Locais do OpenStreetMap (veterinárias, pet shops, etc.) para prospecção de parceiros.',
                actions: RU,
                href: '/credenciamento/prospectos-osm',
            },
            {
                id: 'credenciamento.quem_realiza',
                label: 'Quem Realiza',
                descricao: 'Busca por UF, cidade e procedimentos.',
                actions: R,
                href: '/credenciamento/quem-realiza',
            },
            {
                id: 'credenciamento.especialidades_cidade',
                label: 'Especialidades por cidade',
                descricao: 'Gráfico e contagem de credenciados por especialidade na cidade.',
                actions: R,
                href: '/credenciamento/especialidades-cidade',
            },
            {
                id: 'credenciamento.formulario',
                label: 'Formulário público',
                descricao: 'Configuração do link e definições gerais do formulário.',
                actions: RU,
                href: '/credenciamento/formulario',
            },
            {
                id: 'credenciamento.formulario_paginas',
                label: 'Páginas do formulário',
                descricao: 'Criar, ordenar e excluir páginas do wizard público.',
                actions: RCUD,
            },
            {
                id: 'credenciamento.formulario_inbox',
                label: 'Inbox do formulário',
                descricao:
                    'Pré-cadastros, conversão em ficha e alertas de formulário na Home.',
                actions: RU,
                href: '/credenciamento/formulario/entradas',
            },
        ],
    },
    {
        id: 'configuracoes',
        label: 'Configurações',
        tools: [
            {
                id: 'credenciamento.import_kmz',
                label: 'Importar KMZ',
                descricao: 'Coordenadas do Google My Maps com vínculo por nome ao cadastro.',
                actions: RU,
                href: '/credenciamento/import-kmz',
            },
            {
                id: 'credenciamento.especialidades_rc',
                label: 'Especialidades (RC)',
                descricao: 'Ordem e cadastro de especialidades no PDF da RC.',
                actions: RCUD,
                href: '/credenciamento/especialidades-rc',
            },
            {
                id: 'configuracoes.importar_credenciados',
                label: 'Importar Credenciados',
                descricao:
                    'Upload de Excel (credenciado × procedimento) para revisar e vincular ao perfil.',
                actions: RU,
                href: '/configuracoes/importar-credenciados',
            },
            {
                id: 'configuracoes.exportar_credenciados',
                label: 'Exportar Credenciados',
                descricao: 'Exportar Excel dos prestadores com status credenciado e procedimentos.',
                actions: R,
                href: '/configuracoes/exportar-credenciados',
            },
            {
                id: 'configuracoes.conferencia_laboratorio',
                label: 'Conferência Laboratório',
                descricao:
                    'Conferir relatórios mensais do laboratório e da Emerdog com valores negociados.',
                actions: RU,
                href: '/configuracoes/conferencia-laboratorio',
            },
        ],
    },
    {
        id: 'planos',
        label: 'Planos',
        tools: [
            {
                id: 'planos.impressao',
                label: 'Impressão de planos',
                descricao: 'Selecionar procedimentos e gerar PDF do plano por cidade.',
                actions: RC,
                href: '/planos/impressao',
            },
        ],
    },
    {
        id: 'compras',
        label: 'Compras',
        tools: [
            {
                id: 'compras.valor_venda',
                label: 'Valor de Venda',
                descricao: 'Tabela de valores de venda.',
                actions: RCUD,
                href: '/compras/valor-venda',
            },
            {
                id: 'compras.orcamento',
                label: 'Orçamento',
                descricao: 'Cálculo de orçamento para clientes.',
                actions: R,
                href: '/compras/orcamento',
            },
        ],
    },
    {
        id: 'contratos',
        label: 'Contratos',
        tools: [
            {
                id: 'contratos.gerar_pdf',
                label: 'Gerar PDF',
                descricao: 'Montagem de contratos em PDF.',
                actions: RC,
                href: '/contratos/gerar',
            },
            {
                id: 'contratos.clicksign',
                label: 'Clicksign',
                descricao:
                    'Envelopes, assinaturas e alertas de atualização na Home.',
                actions: RCUD,
                href: '/contratos/clicksign',
            },
        ],
    },
    {
        id: 'pagamentos',
        label: 'Pagamentos',
        tools: [
            {
                id: 'pagamentos.registro',
                label: 'Registro',
                descricao: 'Folha mensal de pagamentos a prestadores.',
                actions: RCUD,
                href: '/pagamentos/registro',
            },
            {
                id: 'pagamentos.resumo',
                label: 'Resumo',
                descricao: 'Pendências com nota/resposta enviada e ainda não pagas.',
                actions: R,
                href: '/pagamentos/resumo',
            },
        ],
    },
    {
        id: 'administrativo',
        label: 'Administrativo',
        tools: [
            {
                id: 'admin.acessos',
                label: 'Gerenciar acessos',
                descricao: 'Convites, permissões e auditoria de usuários.',
                actions: RCUD,
                href: '/administrativo/acessos',
            },
            {
                id: 'admin.auditoria',
                label: 'Auditoria',
                descricao: 'Logs imutáveis de alterações no sistema.',
                actions: R,
                href: '/administrativo/auditoria',
            },
            {
                id: 'admin.dev_tools',
                label: 'Ferramentas Dev',
                descricao: 'Colunas extras e exclusão por lista.',
                actions: R,
            },
        ],
    },
]

export function aclKey(toolId, action) {
    return `${toolId}.${action}`
}

export function listarTodasChavesAcl() {
    const keys = []
    for (const grupo of PERMISSION_CATALOG) {
        for (const tool of grupo.tools) {
            for (const action of tool.actions) {
                keys.push(aclKey(tool.id, action))
            }
        }
    }
    return keys
}

const TOOL_BY_ID = new Map()
const TOOL_BY_HREF = new Map()
for (const grupo of PERMISSION_CATALOG) {
    for (const tool of grupo.tools) {
        TOOL_BY_ID.set(tool.id, { ...tool, groupId: grupo.id, groupLabel: grupo.label })
        if (tool.href) TOOL_BY_HREF.set(tool.href, tool.id)
    }
}

export function getToolMeta(toolId) {
    return TOOL_BY_ID.get(toolId) || null
}

export function getToolIdForHref(href) {
    const path = String(href || '').split('?')[0].replace(/\/$/, '') || '/'
    return TOOL_BY_HREF.get(path) || null
}

export function hasAcl(permissions, toolId, action) {
    if (!toolId || !action) return false
    return Boolean(permissions?.[aclKey(toolId, action)])
}

export function anyAclInGroup(permissions, groupId, action) {
    const grupo = PERMISSION_CATALOG.find((g) => g.id === groupId)
    if (!grupo) return false
    return grupo.tools.some((t) => hasAcl(permissions, t.id, action))
}

function toolSupportsAction(toolId, action) {
    const meta = getToolMeta(toolId)
    return meta?.actions?.includes(action) ?? false
}

/** Preenche chaves ACL a partir das permissões legadas (migração). */
export function expandLegacyToAcl(perms) {
    const p = { ...perms }
    const hasAclKeys = listarTodasChavesAcl().some((k) => Object.prototype.hasOwnProperty.call(p, k))
    if (hasAclKeys) return p

    const setTool = (toolId, spec) => {
        const meta = getToolMeta(toolId)
        if (!meta) return
        for (const action of meta.actions) {
            if (spec[action]) p[aclKey(toolId, action)] = true
        }
    }

    if (p[L.SUPERTABELA_VIEW]) {
        ;['supertabela.main', 'supertabela.cidades', 'supertabela.planos', 'supertabela.procedimentos', 'supertabela.doc'].forEach(
            (id) => setTool(id, { read: true })
        )
        if (p[L.SUPERTABELA_NEGOCIACOES_VIEW]) setTool('supertabela.negociacoes', { read: true })
    }
    if (p[L.SUPERTABELA_EDIT]) {
        ;['supertabela.main', 'supertabela.cidades', 'supertabela.planos', 'supertabela.procedimentos'].forEach((id) =>
            setTool(id, { read: true, create: true, update: true, delete: true })
        )
        if (p[L.SUPERTABELA_NEGOCIACOES_VIEW]) {
            setTool('supertabela.negociacoes', { read: true, update: true })
        }
    }

    if (p[L.CREDENCIAMENTO_VIEW]) {
        setTool('credenciamento.processos', { read: true })
        setTool('credenciamento.mapa', { read: true })
        setTool('credenciamento.prospectos_osm', { read: true })
        setTool('credenciamento.import_kmz', { read: true })
        setTool('credenciamento.especialidades_cidade', { read: true })
        setTool('credenciamento.formulario', { read: true })
        setTool('credenciamento.especialidades_rc', { read: true })
        setTool('configuracoes.importar_credenciados', { read: true })
        setTool('configuracoes.exportar_credenciados', { read: true })
    }
    if (p[L.CREDENCIAMENTO_CADASTRO_VIEW]) {
        setTool('credenciamento.cadastro', { read: true })
    }
    if (p[L.CREDENCIAMENTO_QUEM_REALIZA_VIEW]) {
        setTool('credenciamento.quem_realiza', { read: true })
    }
    if (p[L.CREDENCIAMENTO_FORMULARIO_INBOX]) {
        setTool('credenciamento.formulario_inbox', { read: true, update: true })
    }
    if (p[L.CREDENCIAMENTO_EDIT]) {
        setTool('credenciamento.processos', { read: true, create: true })
        setTool('credenciamento.cadastro', { read: true, create: true, update: true, delete: true })
        setTool('credenciamento.especialidades_rc', { read: true, create: true, update: true, delete: true })
        setTool('credenciamento.formulario_inbox', { read: true, update: true })
        setTool('credenciamento.import_kmz', { read: true, update: true })
        setTool('credenciamento.prospectos_osm', { read: true, update: true })
        setTool('configuracoes.importar_credenciados', { read: true, update: true })
    }
    if (p[L.CREDENCIAMENTO_FORMULARIO_CONFIG]) {
        setTool('credenciamento.formulario', { read: true, update: true })
    }
    if (p[L.CREDENCIAMENTO_FORMULARIO_PAGINAS]) {
        setTool('credenciamento.formulario_paginas', { read: true, create: true, update: true, delete: true })
    }

    if (p[L.PLANOS_VIEW]) {
        setTool('planos.impressao', { read: true, create: true })
    }
    if (p[L.COMPRAS_VIEW]) {
        setTool('compras.valor_venda', { read: true })
        setTool('compras.orcamento', { read: true })
    }
    if (p[L.COMPRAS_EDIT]) {
        setTool('compras.valor_venda', { read: true, create: true, update: true, delete: true })
    }
    if (p[L.CONTRATOS_VIEW]) {
        setTool('contratos.gerar_pdf', { read: true })
        setTool('contratos.clicksign', { read: true })
    }
    if (p[L.CONTRATOS_EDIT]) {
        setTool('contratos.gerar_pdf', { read: true, create: true })
        setTool('contratos.clicksign', { read: true, create: true, update: true, delete: true })
    }
    if (p[L.PAGAMENTOS_VIEW]) {
        setTool('pagamentos.registro', { read: true })
        setTool('pagamentos.resumo', { read: true })
    }
    if (p[L.PAGAMENTOS_EDIT]) {
        setTool('pagamentos.registro', { read: true, create: true, update: true, delete: true })
        setTool('pagamentos.resumo', { read: true })
    }
    if (p[L.ACCESS_MANAGE]) {
        setTool('admin.acessos', { read: true, create: true, update: true, delete: true })
        setTool('admin.auditoria', { read: true })
    }
    if (p[L.DEV_TOOLS]) {
        setTool('admin.dev_tools', { read: true })
    }
    // Alertas da Home herdados das páginas (legado notificacoes.* → ferramenta).
    if (p[L.NOTIFICACOES_FORMULARIO] || p['notificacoes.formulario.read']) {
        if (!hasAcl(p, 'credenciamento.formulario_inbox', 'read')) {
            p[aclKey('credenciamento.formulario_inbox', 'read')] = true
        }
    }
    if (p[L.NOTIFICACOES_CONTRATOS] || p['notificacoes.contratos.read']) {
        if (!hasAcl(p, 'contratos.clicksign', 'read')) {
            p[aclKey('contratos.clicksign', 'read')] = true
        }
    }

    setTool('inicio.dashboard', { read: true })

    return p
}

/** Concede ACL de ferramentas novas a perfis que já tinham chaves ACL antes delas existirem. */
export function completarAclFerramentasCredenciamento(perms) {
    const p = { ...perms }
    const kRead = aclKey('credenciamento.prospectos_osm', 'read')
    const kUpd = aclKey('credenciamento.prospectos_osm', 'update')
    if (!p[kRead]) {
        if (
            hasAcl(p, 'credenciamento.mapa', 'read') ||
            hasAcl(p, 'credenciamento.processos', 'read') ||
            hasAcl(p, 'credenciamento.import_kmz', 'read') ||
            p[L.CREDENCIAMENTO_VIEW]
        ) {
            p[kRead] = true
        }
    }
    if (!p[kUpd]) {
        if (hasAcl(p, 'credenciamento.import_kmz', 'update') || p[L.CREDENCIAMENTO_EDIT]) {
            p[kUpd] = true
        }
    }
    const kResumo = aclKey('pagamentos.resumo', 'read')
    if (!p[kResumo]) {
        if (hasAcl(p, 'pagamentos.registro', 'read') || p[L.PAGAMENTOS_VIEW]) {
            p[kResumo] = true
        }
    }
    const kAud = aclKey('admin.auditoria', 'read')
    if (!p[kAud]) {
        if (hasAcl(p, 'admin.acessos', 'read') || p[L.ACCESS_MANAGE]) {
            p[kAud] = true
        }
    }
    return p
}

/** Atualiza chaves legadas a partir do ACL (rotas e código antigo). */
export function syncLegacyFromAcl(perms) {
    const p = { ...perms }

    p[L.SUPERTABELA_VIEW] = anyAclInGroup(p, 'supertabela', 'read')
    p[L.SUPERTABELA_NEGOCIACOES_VIEW] = hasAcl(p, 'supertabela.negociacoes', 'read')
    p[L.SUPERTABELA_EDIT] =
        hasAcl(p, 'supertabela.cidades', 'update') ||
        hasAcl(p, 'supertabela.cidades', 'create') ||
        hasAcl(p, 'supertabela.planos', 'update') ||
        hasAcl(p, 'supertabela.procedimentos', 'update')

    p[L.CREDENCIAMENTO_VIEW] =
        hasAcl(p, 'credenciamento.processos', 'read') ||
        hasAcl(p, 'credenciamento.mapa', 'read') ||
        hasAcl(p, 'credenciamento.prospectos_osm', 'read') ||
        hasAcl(p, 'credenciamento.import_kmz', 'read') ||
        hasAcl(p, 'credenciamento.especialidades_cidade', 'read') ||
        hasAcl(p, 'credenciamento.formulario', 'read') ||
        hasAcl(p, 'credenciamento.especialidades_rc', 'read') ||
        hasAcl(p, 'configuracoes.importar_credenciados', 'read') ||
        hasAcl(p, 'configuracoes.exportar_credenciados', 'read')
    p[L.CREDENCIAMENTO_CADASTRO_VIEW] = hasAcl(p, 'credenciamento.cadastro', 'read')
    p[L.CREDENCIAMENTO_QUEM_REALIZA_VIEW] = hasAcl(p, 'credenciamento.quem_realiza', 'read')
    p[L.CREDENCIAMENTO_FORMULARIO_INBOX] = hasAcl(p, 'credenciamento.formulario_inbox', 'read')
    p[L.CREDENCIAMENTO_FORMULARIO_CONFIG] = hasAcl(p, 'credenciamento.formulario', 'update')
    p[L.CREDENCIAMENTO_FORMULARIO_PAGINAS] =
        hasAcl(p, 'credenciamento.formulario_paginas', 'read') &&
        (hasAcl(p, 'credenciamento.formulario_paginas', 'update') ||
            hasAcl(p, 'credenciamento.formulario_paginas', 'create'))
    p[L.CREDENCIAMENTO_EDIT] =
        hasAcl(p, 'credenciamento.cadastro', 'update') ||
        hasAcl(p, 'credenciamento.cadastro', 'create') ||
        hasAcl(p, 'credenciamento.especialidades_rc', 'update') ||
        hasAcl(p, 'credenciamento.formulario_inbox', 'update') ||
        hasAcl(p, 'credenciamento.import_kmz', 'update') ||
        hasAcl(p, 'configuracoes.importar_credenciados', 'update')

    p[L.PLANOS_VIEW] = hasAcl(p, 'planos.impressao', 'read')
    p[L.COMPRAS_VIEW] = anyAclInGroup(p, 'compras', 'read')
    p[L.COMPRAS_EDIT] =
        hasAcl(p, 'compras.valor_venda', 'update') ||
        hasAcl(p, 'compras.valor_venda', 'create') ||
        hasAcl(p, 'compras.valor_venda', 'delete')
    p[L.CONTRATOS_VIEW] = anyAclInGroup(p, 'contratos', 'read')
    p[L.CONTRATOS_EDIT] =
        hasAcl(p, 'contratos.clicksign', 'update') ||
        hasAcl(p, 'contratos.clicksign', 'create') ||
        hasAcl(p, 'contratos.gerar_pdf', 'create')
    p[L.PAGAMENTOS_VIEW] =
        hasAcl(p, 'pagamentos.registro', 'read') || hasAcl(p, 'pagamentos.resumo', 'read')
    p[L.PAGAMENTOS_EDIT] =
        hasAcl(p, 'pagamentos.registro', 'update') ||
        hasAcl(p, 'pagamentos.registro', 'create') ||
        hasAcl(p, 'pagamentos.registro', 'delete')

    p[L.ACCESS_MANAGE] = hasAcl(p, 'admin.acessos', 'read') && hasAcl(p, 'admin.acessos', 'update')
    p[L.DEV_TOOLS] = hasAcl(p, 'admin.dev_tools', 'read')
    // Alertas da Home = permissão de Ver na página correspondente.
    p[L.NOTIFICACOES_FORMULARIO] = hasAcl(p, 'credenciamento.formulario_inbox', 'read')
    p[L.NOTIFICACOES_CONTRATOS] = hasAcl(p, 'contratos.clicksign', 'read')

    delete p['notificacoes.formulario.read']
    delete p['notificacoes.contratos.read']

    return p
}

const LEGACY_KEYS = new Set(Object.values(L))

export function sanitizarPermissionsParaSalvar(raw = {}) {
    const allowed = new Set([...listarTodasChavesAcl(), ...LEGACY_KEYS])
    const out = {}
    for (const [key, val] of Object.entries(raw)) {
        if (!allowed.has(key)) continue
        out[key] = Boolean(val)
    }
    const expanded = expandLegacyToAcl(out)
    return syncLegacyFromAcl(expanded)
}

export function permissionsFromLegacyObject(legacy = {}) {
    return syncLegacyFromAcl(expandLegacyToAcl({ ...legacy }))
}

export function aplicarGrupoAcl(perms, groupId, action, valor) {
    const grupo = PERMISSION_CATALOG.find((g) => g.id === groupId)
    if (!grupo) return perms
    const next = { ...perms }
    for (const tool of grupo.tools) {
        if (!toolSupportsAction(tool.id, action)) continue
        next[aclKey(tool.id, action)] = valor
        if (valor && action !== 'read') {
            next[aclKey(tool.id, 'read')] = true
        }
    }
    return syncLegacyFromAcl(next)
}

export function aplicarFerramentaAcl(perms, toolId, action, valor) {
    const meta = getToolMeta(toolId)
    if (!meta || !toolSupportsAction(toolId, action)) return perms
    const next = { ...perms, [aclKey(toolId, action)]: valor }
    if (valor && action !== 'read') {
        next[aclKey(toolId, 'read')] = true
    }
    return syncLegacyFromAcl(next)
}

export const LEGACY_SCREEN_TO_TOOL = {
    'supertabela.negociacoes.view': 'supertabela.negociacoes',
    'credenciamento.cadastro.view': 'credenciamento.cadastro',
    'credenciamento.quem_realiza.view': 'credenciamento.quem_realiza',
    'credenciamento.formulario.inbox': 'credenciamento.formulario_inbox',
    'access.manage': 'admin.acessos',
    'admin.auditoria': 'admin.auditoria',
}

export function podeLerFerramenta(permissions, toolId) {
    return hasAcl(permissions, toolId, 'read')
}

export function usuarioPodeEditarFerramenta(permissions, toolId) {
    return (
        hasAcl(permissions, toolId, 'update') ||
        hasAcl(permissions, toolId, 'create') ||
        hasAcl(permissions, toolId, 'delete')
    )
}
