/**
 * Camada de uso da tela de acessos: níveis simples por ferramenta (Sem acesso / Ver / Editar / Total),
 * modelos de perfil e comparação «antes × depois». Tudo opera sobre as chaves ACL do permissionCatalog.
 */
import {
    ACL_ACTIONS,
    EMERMARKETING_GROUP_ID,
    PERMISSION_CATALOG,
    aclKey,
    hasAcl,
    syncLegacyFromAcl,
} from './permissionCatalog.js'

export const NIVEIS = [
    { id: 'nenhum', label: 'Sem acesso' },
    { id: 'ver', label: 'Ver' },
    { id: 'editar', label: 'Editar' },
    { id: 'total', label: 'Total' },
]

const ROTULO_NIVEL = Object.fromEntries(NIVEIS.map((n) => [n.id, n.label]))
export const rotuloNivel = (id) => (id === 'personalizado' ? 'Personalizado' : ROTULO_NIVEL[id] || id)

const temEscrita = (tool) => tool.actions.includes('create') || tool.actions.includes('update')
const temExclusao = (tool) => tool.actions.includes('delete')

/** Níveis que fazem sentido para a ferramenta (uma ferramenta só de leitura não tem «Editar»). */
export function niveisDaFerramenta(tool) {
    const lista = ['nenhum']
    if (tool.actions.includes('read')) lista.push('ver')
    if (temEscrita(tool)) lista.push('editar')
    if (temExclusao(tool)) lista.push('total')
    return NIVEIS.filter((n) => lista.includes(n.id))
}

/** Ações ligadas para cada nível. */
function acoesDoNivel(tool, nivel) {
    const alvo = {}
    for (const a of ACL_ACTIONS) {
        if (!tool.actions.includes(a.id)) continue
        if (nivel === 'nenhum') alvo[a.id] = false
        else if (a.id === 'read') alvo[a.id] = true
        else if (a.id === 'delete') alvo[a.id] = nivel === 'total'
        else alvo[a.id] = nivel === 'editar' || nivel === 'total'
    }
    return alvo
}

/** Nível atual; `personalizado` quando as marcações não correspondem a nenhum nível padrão. */
export function nivelDaFerramenta(perms, tool) {
    for (const n of niveisDaFerramenta(tool)) {
        const alvo = acoesDoNivel(tool, n.id)
        if (Object.entries(alvo).every(([acao, v]) => hasAcl(perms, tool.id, acao) === v)) return n.id
    }
    return 'personalizado'
}

/** Define o nível da ferramenta e devolve as permissões já sincronizadas com as chaves legadas. */
export function aplicarNivelFerramenta(perms, tool, nivel) {
    const next = { ...perms }
    for (const [acao, valor] of Object.entries(acoesDoNivel(tool, nivel))) {
        next[aclKey(tool.id, acao)] = valor
    }
    return syncLegacyFromAcl(next)
}

/** Aplica o mesmo nível a todas as ferramentas de um grupo (cada uma até o máximo que suporta). */
export function aplicarNivelGrupo(perms, grupo, nivel) {
    let next = { ...perms }
    for (const tool of grupo.tools) {
        const disponiveis = niveisDaFerramenta(tool).map((n) => n.id)
        const efetivo = disponiveis.includes(nivel) ? nivel : disponiveis[disponiveis.length - 1]
        for (const [acao, valor] of Object.entries(acoesDoNivel(tool, efetivo))) {
            next[aclKey(tool.id, acao)] = valor
        }
    }
    return syncLegacyFromAcl(next)
}

/** «3 de 7 ferramentas com acesso» de um grupo. */
export function resumoGrupo(perms, grupo) {
    const total = grupo.tools.length
    const comAcesso = grupo.tools.filter((t) => hasAcl(perms, t.id, 'read')).length
    return { comAcesso, total }
}

// ---------- modelos de perfil ----------

/**
 * Cada modelo diz o nível por grupo do catálogo (grupo ausente = sem acesso). Não mexem em EmerMarketing
 * nem concedem Administrativo, exceto o modelo «Administrador».
 */
export const MODELOS_PERMISSAO = [
    {
        id: 'leitura',
        nome: 'Somente leitura',
        descricao: 'Vê todas as áreas do EmerLAB, sem alterar nada.',
        grupos: {
            inicio: 'ver',
            supertabela: 'ver',
            credenciamento: 'ver',
            configuracoes: 'ver',
            planos: 'ver',
            compras: 'ver',
            contratos: 'ver',
            pagamentos: 'ver',
        },
    },
    {
        id: 'credenciamento',
        nome: 'Credenciamento',
        descricao: 'Trabalha no credenciamento e configurações; vê tabelas e planos.',
        grupos: { inicio: 'ver', supertabela: 'ver', credenciamento: 'editar', configuracoes: 'editar', planos: 'editar' },
    },
    {
        id: 'financeiro',
        nome: 'Financeiro',
        descricao: 'Pagamentos e compras; vê as tabelas.',
        grupos: { inicio: 'ver', supertabela: 'ver', pagamentos: 'editar', compras: 'editar' },
    },
    {
        id: 'contratos',
        nome: 'Contratos',
        descricao: 'Gera contratos e acompanha as assinaturas.',
        grupos: { inicio: 'ver', contratos: 'editar', planos: 'ver' },
    },
    {
        id: 'administrador',
        nome: 'Administrador',
        descricao: 'Acesso total, inclusive gerenciar acessos e auditoria.',
        sensivel: true,
        grupos: {
            inicio: 'total',
            supertabela: 'total',
            credenciamento: 'total',
            configuracoes: 'total',
            planos: 'total',
            compras: 'total',
            contratos: 'total',
            pagamentos: 'total',
            administrativo: 'total',
        },
    },
]

/**
 * Aplica um modelo às áreas do EmerLAB (EmerMarketing fica como está). `preservarAdmin`: ao editar a si mesmo,
 * mantém «Gerenciar acessos» para ninguém se trancar do lado de fora.
 */
export function aplicarModelo(perms, modeloId, { preservarAdmin = false } = {}) {
    const modelo = MODELOS_PERMISSAO.find((m) => m.id === modeloId)
    if (!modelo) return perms
    let next = { ...perms }
    for (const grupo of PERMISSION_CATALOG) {
        if (grupo.id === EMERMARKETING_GROUP_ID) continue
        const nivel = modelo.grupos[grupo.id] || 'nenhum'
        next = aplicarNivelGrupo(next, grupo, nivel)
    }
    if (preservarAdmin) {
        const admin = PERMISSION_CATALOG.find((g) => g.id === 'administrativo')?.tools.find((t) => t.id === 'admin.acessos')
        if (admin) next = aplicarNivelFerramenta(next, admin, 'editar')
    }
    return next
}

/** Copia as permissões do EmerLAB de outro usuário (EmerMarketing e conta ficam como estão). */
export function copiarPermissoesEmerlab(permsDestino, permsOrigem) {
    const next = { ...permsDestino }
    for (const grupo of PERMISSION_CATALOG) {
        if (grupo.id === EMERMARKETING_GROUP_ID) continue
        for (const tool of grupo.tools) {
            for (const acao of tool.actions) {
                next[aclKey(tool.id, acao)] = Boolean(permsOrigem?.[aclKey(tool.id, acao)])
            }
        }
    }
    return syncLegacyFromAcl(next)
}

// ---------- comparação antes × depois ----------

function listaAcoesLigadas(perms, tool) {
    return tool.actions.filter((a) => hasAcl(perms, tool.id, a))
}

const ROTULO_ACAO = Object.fromEntries(ACL_ACTIONS.map((a) => [a.id, a.label]))

/** Ferramentas cujo acesso é sensível: avisar antes de salvar. */
const FERRAMENTAS_SENSIVEIS = new Set(['admin.acessos', 'admin.dev_tools'])

/**
 * Lista o que mudou entre dois conjuntos de permissões, no vocabulário da tela.
 * @returns {Array<{ toolId: string, grupoId: string, grupo: string, ferramenta: string, de: string, para: string, sensivel: boolean }>}
 */
export function diffPermissoes(antes, depois) {
    const out = []
    for (const grupo of PERMISSION_CATALOG) {
        for (const tool of grupo.tools) {
            const a = listaAcoesLigadas(antes, tool)
            const d = listaAcoesLigadas(depois, tool)
            if (a.join('|') === d.join('|')) continue
            const nivelAntes = nivelDaFerramenta(antes, tool)
            const nivelDepois = nivelDaFerramenta(depois, tool)
            const texto = (nivel, acoes) =>
                nivel === 'personalizado' ? acoes.map((x) => ROTULO_ACAO[x]).join(', ') || 'Sem acesso' : rotuloNivel(nivel)
            const ganhouExclusao = !a.includes('delete') && d.includes('delete')
            out.push({
                toolId: tool.id,
                grupoId: grupo.id,
                grupo: grupo.label,
                ferramenta: tool.label,
                de: texto(nivelAntes, a),
                para: texto(nivelDepois, d),
                sensivel: (FERRAMENTAS_SENSIVEIS.has(tool.id) && d.length > a.length) || ganhouExclusao,
            })
        }
    }
    return out
}

/** Uma linha de texto por mudança: «Credenciamento › Cadastros: Ver → Editar». */
export function linhasDoDiff(diff) {
    return diff.map((x) => `${x.grupo} › ${x.ferramenta}: ${x.de} → ${x.para}`)
}
