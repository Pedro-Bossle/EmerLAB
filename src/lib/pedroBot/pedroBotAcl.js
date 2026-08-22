import { PERMISSION_KEYS, hasPermission } from '../accessControl.js'

/** Ferramenta de menu / rota `/pedrobot`. */
export const PEDRO_BOT_TOOL_ID = 'inicio.pedro_bot'

/**
 * Enquanto true, qualquer autenticado com acesso ao Pedro Bot pode editar a base.
 * Passe a false para restringir a `access.manage`.
 */
export const PEDRO_BOT_EDITOR_ABERTO = true

export function podeEditarConhecimentoPedroBot(profile) {
    if (!profile) return false
    if (PEDRO_BOT_EDITOR_ABERTO) return true
    return hasPermission(profile, PERMISSION_KEYS.ACCESS_MANAGE)
}
