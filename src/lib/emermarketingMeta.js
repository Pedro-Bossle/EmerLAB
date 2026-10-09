/**
 * Helpers de EmerMarketing seguros para Node (API) e browser.
 * Sem import.meta — use emermarketingAccess.js no cliente para a URL.
 */
import {
    EMERMARKETING_GROUP_ID,
    PERMISSION_CATALOG,
    hasAcl,
    podeLerFerramenta,
} from './permissionCatalog.js'

export { EMERMARKETING_GROUP_ID, EMERMARKETING_TOOL_ID } from './permissionCatalog.js'

/** Tools do grupo que liberam o app (não a aba Auditoria do EmerLAB). */
function toolsAcessoPortalEmermarketing() {
    const grupo = PERMISSION_CATALOG.find((g) => g.id === EMERMARKETING_GROUP_ID)
    return (grupo?.tools || []).filter((t) => t.id !== 'emermarketing.auditoria')
}

/**
 * True se o perfil pode abrir o app EmerMarketing (portal ou algum módulo).
 * Só «Auditoria (EmerLAB)» não conta — essa permissão é da tela de Auditoria do EmerLAB.
 */
export function usuarioPodeAbrirEmerMarketing(permissions) {
    if (podeLerFerramenta(permissions, 'emermarketing.app')) return true
    return toolsAcessoPortalEmermarketing().some((t) => hasAcl(permissions, t.id, 'read'))
}

/**
 * True se há ACL em algum módulo do EmerLAB fora de EmerMarketing (e fora de «Início»).
 * Usado para detectar contas só de marketing no dashboard.
 */
export function usuarioTemAcessoEmerlabAlemDeMarketing(permissions) {
    for (const grupo of PERMISSION_CATALOG) {
        if (grupo.id === EMERMARKETING_GROUP_ID || grupo.id === 'inicio') continue
        for (const tool of grupo.tools || []) {
            for (const action of tool.actions || []) {
                if (hasAcl(permissions, tool.id, action)) return true
            }
        }
    }
    return false
}

/** Conta com EmerMarketing e sem outras ferramentas do EmerLAB. */
export function usuarioSomenteEmerMarketing(permissions) {
    return (
        usuarioPodeAbrirEmerMarketing(permissions) &&
        !usuarioTemAcessoEmerlabAlemDeMarketing(permissions)
    )
}

export function usuarioPodeVerAuditoriaEmermarketing(permissions) {
    return (
        podeLerFerramenta(permissions, 'emermarketing.auditoria') ||
        hasAcl(permissions, 'admin.auditoria', 'read') ||
        (hasAcl(permissions, 'admin.acessos', 'read') &&
            hasAcl(permissions, 'admin.acessos', 'update'))
    )
}

/**
 * Payload para app_metadata (lido pelo EmerMarketing).
 * `emermarketing: true` só com portal ou módulo do app — não só auditoria EmerLAB.
 * @returns {{ emermarketing: boolean, emermarketing_acl: Record<string, Record<string, boolean>> }}
 */
export function montarAppMetadataEmermarketing(permissions) {
    const grupo = PERMISSION_CATALOG.find((g) => g.id === EMERMARKETING_GROUP_ID)
    const acl = {}
    for (const tool of grupo?.tools || []) {
        const entry = {}
        for (const action of tool.actions || []) {
            if (hasAcl(permissions, tool.id, action)) entry[action] = true
        }
        if (Object.keys(entry).length) acl[tool.id] = entry
    }
    const liberaApp = Object.keys(acl).some((k) => k !== 'emermarketing.auditoria')
    return {
        emermarketing: liberaApp,
        emermarketing_acl: acl,
    }
}
