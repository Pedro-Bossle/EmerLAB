/**
 * Setores: grupos de pessoas com um conjunto de permissões padrão (preset).
 *
 * - Cada setor guarda um mapa de permissões ACL completo (true/false por ferramenta e ação).
 * - O usuário pode ser vinculado a um ou mais setores. «Aplicar» une as permissões dos setores escolhidos e
 *   grava no perfil; depois disso o perfil pode ser ajustado individualmente (é um ponto de partida, não herança).
 * - Os setores padrão abaixo existem mesmo sem nenhuma linha no banco; ao editar um deles, a versão salva vence.
 */
import {
    EMERMARKETING_GROUP_ID,
    PERMISSION_CATALOG,
    aclKey,
    listarTodasChavesAcl,
    sanitizarPermissionsParaSalvar,
} from './permissionCatalog.js'
import { aplicarNivelFerramenta, aplicarNivelGrupo } from './permissoesNiveis.js'

/**
 * `grupos`: nível por grupo do catálogo (ausente = sem acesso). `ferramentas`: nível por ferramenta, aplicado
 * depois (serve para liberar só algumas ferramentas de um grupo).
 */
export const SETORES_PADRAO = [
    {
        id: 'credenciamento',
        nome: 'Credenciamento',
        descricao: 'Todo o Credenciamento, as configurações do setor e as Tabelas de Valores.',
        ordem: 1,
        grupos: { inicio: 'ver', credenciamento: 'editar', configuracoes: 'editar', supertabela: 'ver' },
    },
    {
        id: 'vendas',
        nome: 'Vendas',
        descricao: 'Quem Realiza, Mapa, Especialistas por Cidade, Impressão de planos e Tabelas de Valores.',
        ordem: 2,
        grupos: { inicio: 'ver', supertabela: 'ver' },
        ferramentas: {
            'credenciamento.quem_realiza': 'ver',
            'credenciamento.mapa': 'ver',
            'credenciamento.especialidades_cidade': 'ver',
            'planos.impressao': 'editar',
        },
    },
    {
        id: 'financeiro',
        nome: 'Financeiro',
        descricao: 'Pagamentos aos prestadores (Registro, Resumo e Caixa de entrada).',
        ordem: 3,
        grupos: { inicio: 'ver', pagamentos: 'editar' },
    },
    {
        id: 'comercial',
        nome: 'Comercial',
        descricao: 'Trabalha no EmerMarketing.',
        ordem: 4,
        grupos: { inicio: 'ver', emermarketing: 'editar' },
    },
    {
        id: 'gerenciamento',
        nome: 'Gerenciamento',
        descricao: 'Todas as áreas e a administração.',
        ordem: 5,
        grupos: Object.fromEntries(PERMISSION_CATALOG.map((g) => [g.id, 'total'])),
    },
]

const IDS_PADRAO = new Set(SETORES_PADRAO.map((s) => s.id))
export const ehSetorPadrao = (id) => IDS_PADRAO.has(String(id))

/** Permissões ACL completas de um setor padrão (a partir dos níveis por grupo/ferramenta). */
export function permissoesPadraoDoSetor(def) {
    let perms = {}
    for (const grupo of PERMISSION_CATALOG) {
        perms = aplicarNivelGrupo(perms, grupo, (def.grupos || {})[grupo.id] || 'nenhum')
    }
    for (const [toolId, nivel] of Object.entries(def.ferramentas || {})) {
        const tool = PERMISSION_CATALOG.flatMap((g) => g.tools).find((t) => t.id === toolId)
        if (tool) perms = aplicarNivelFerramenta(perms, tool, nivel)
    }
    return sanitizarPermissionsParaSalvar(perms)
}

/**
 * Lista efetiva de setores: o que está salvo no banco + os padrões que ainda não foram salvos.
 * @param {Array<{ id: string, nome?: string, descricao?: string, permissions?: object, ordem?: number }>} salvos
 */
export function setoresEfetivos(salvos = []) {
    const porId = new Map()
    for (const def of SETORES_PADRAO) {
        porId.set(def.id, {
            id: def.id,
            nome: def.nome,
            descricao: def.descricao,
            ordem: def.ordem,
            permissions: permissoesPadraoDoSetor(def),
            padrao: true,
            salvo: false,
        })
    }
    for (const row of salvos || []) {
        if (!row?.id) continue
        const base = porId.get(row.id)
        porId.set(row.id, {
            id: String(row.id),
            nome: String(row.nome || base?.nome || row.id),
            descricao: String(row.descricao ?? base?.descricao ?? ''),
            ordem: Number.isFinite(Number(row.ordem)) ? Number(row.ordem) : base?.ordem ?? 99,
            permissions: sanitizarPermissionsParaSalvar(row.permissions && typeof row.permissions === 'object' ? row.permissions : {}),
            padrao: IDS_PADRAO.has(String(row.id)),
            salvo: true,
        })
    }
    return [...porId.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Une (OR) as permissões de vários conjuntos ACL e devolve o conjunto completo e sincronizado. */
export function unirPermissoes(lista) {
    const out = {}
    for (const k of listarTodasChavesAcl()) {
        out[k] = (lista || []).some((p) => Boolean(p?.[k]))
    }
    return sanitizarPermissionsParaSalvar(out)
}

/**
 * Preset do usuário: une as permissões dos setores escolhidos.
 * `preservarAdmin`: ao editar a si mesmo, mantém «Gerenciar acessos» para ninguém se trancar do lado de fora.
 */
export function aplicarSetoresAoPerfil(permsAtuais, idsSetores, setores, { preservarAdmin = false } = {}) {
    const escolhidos = (setores || []).filter((s) => (idsSetores || []).includes(s.id))
    const uniao = unirPermissoes(escolhidos.map((s) => s.permissions))
    if (preservarAdmin) {
        uniao[aclKey('admin.acessos', 'read')] = true
        uniao[aclKey('admin.acessos', 'update')] = true
        return sanitizarPermissionsParaSalvar(uniao)
    }
    void permsAtuais
    return uniao
}

/** Slug estável para o id de um setor novo («Pós-venda» → «pos-venda»). */
export function slugSetor(nome) {
    return String(nome || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
}

/** Só ids de setores que existem (ignora o resto). */
export function filtrarIdsDeSetores(ids, setores) {
    const validos = new Set((setores || []).map((s) => s.id))
    return [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => validos.has(id))
}

/** Quantas ferramentas (com «Ver») o setor libera. */
export function contarFerramentasDoSetor(permissions) {
    let n = 0
    for (const g of PERMISSION_CATALOG) {
        if (g.id === EMERMARKETING_GROUP_ID) continue
        for (const t of g.tools) if (permissions?.[aclKey(t.id, 'read')]) n += 1
    }
    return n
}
