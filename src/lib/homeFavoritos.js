import { PERMISSION_CATALOG, getToolIdForHref, podeLerFerramenta } from './permissionCatalog.js'

const STORAGE_PREFIX = 'sfsc_home_favoritos_v1:'

/** Catálogo de páginas favoritáveis (com href no permission catalog). */
export function listarPaginasFavoritaveis(permissions) {
    const out = []
    for (const grupo of PERMISSION_CATALOG) {
        for (const tool of grupo.tools || []) {
            if (!tool.href) continue
            if (!podeLerFerramenta(permissions, tool.id)) continue
            out.push({
                id: tool.id,
                label: tool.label,
                descricao: tool.descricao || '',
                href: tool.href,
                grupo: grupo.label,
                grupoId: grupo.id,
            })
        }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Mesmas páginas, agrupadas por categoria (ordem do permission catalog). */
export function listarPaginasFavoritaveisPorGrupo(permissions) {
    const grupos = []
    for (const grupo of PERMISSION_CATALOG) {
        const itens = []
        for (const tool of grupo.tools || []) {
            if (!tool.href) continue
            if (!podeLerFerramenta(permissions, tool.id)) continue
            itens.push({
                id: tool.id,
                label: tool.label,
                descricao: tool.descricao || '',
                href: tool.href,
                grupo: grupo.label,
                grupoId: grupo.id,
            })
        }
        if (!itens.length) continue
        itens.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
        grupos.push({
            id: grupo.id,
            label: grupo.label,
            itens,
        })
    }
    return grupos
}

export function lerFavoritosHome(userId) {
    if (typeof window === 'undefined' || !userId) return []
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + userId)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
    } catch {
        return []
    }
}

export function salvarFavoritosHome(userId, ids) {
    if (typeof window === 'undefined' || !userId) return
    const limpos = [...new Set((ids || []).filter(Boolean))]
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(limpos))
}

export function alternarFavoritoHome(userId, toolId) {
    const atual = lerFavoritosHome(userId)
    const set = new Set(atual)
    if (set.has(toolId)) set.delete(toolId)
    else set.add(toolId)
    const next = [...set]
    salvarFavoritosHome(userId, next)
    return next
}

export function resolverFavoritosComMeta(userId, permissions) {
    const ids = lerFavoritosHome(userId)
    const catalogo = listarPaginasFavoritaveis(permissions)
    const porId = new Map(catalogo.map((p) => [p.id, p]))
    return ids.map((id) => porId.get(id)).filter(Boolean)
}

/** Atalhos sugeridos se o usuário ainda não favoritou nada. */
export function favoritosPadraoSugeridos(permissions) {
    const preferidos = [
        'credenciamento.cadastro',
        'credenciamento.formulario_inbox',
        'pagamentos.resumo',
        'supertabela.planos',
        'contratos.clicksign',
        'admin.auditoria',
    ]
    const catalogo = listarPaginasFavoritaveis(permissions)
    const porId = new Map(catalogo.map((p) => [p.id, p]))
    return preferidos.map((id) => porId.get(id)).filter(Boolean).slice(0, 6)
}

export function toolIdVisivelParaHref(href, permissions) {
    const id = getToolIdForHref(href)
    if (!id) return true
    return podeLerFerramenta(permissions, id)
}
