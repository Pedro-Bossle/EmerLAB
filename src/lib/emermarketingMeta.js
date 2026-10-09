/**
 * Helpers de EmerMarketing seguros para Node (API) e browser.
 * Sem import.meta — use emermarketingAccess.js no cliente para a URL.
 */
import {
    EMERMARKETING_GROUP_ID,
    PERMISSION_CATALOG,
    anyAclInGroup,
    hasAcl,
    podeLerFerramenta,
} from './permissionCatalog.js'

export { EMERMARKETING_GROUP_ID, EMERMARKETING_TOOL_ID } from './permissionCatalog.js'

export function usuarioPodeAbrirEmerMarketing(permissions) {
    return (
        anyAclInGroup(permissions, EMERMARKETING_GROUP_ID, 'read') ||
        podeLerFerramenta(permissions, 'emermarketing.app')
    )
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
    return {
        emermarketing: Object.keys(acl).length > 0,
        emermarketing_acl: acl,
    }
}
