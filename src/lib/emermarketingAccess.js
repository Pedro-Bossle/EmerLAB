import { EMERMARKETING_URL_PADRAO } from './permissionCatalog.js'
import {
    montarAppMetadataEmermarketing,
    usuarioPodeAbrirEmerMarketing,
    usuarioPodeVerAuditoriaEmermarketing,
    usuarioSomenteEmerMarketing,
    usuarioTemAcessoEmerlabAlemDeMarketing,
} from './emermarketingMeta.js'

export {
    montarAppMetadataEmermarketing,
    usuarioPodeAbrirEmerMarketing,
    usuarioPodeVerAuditoriaEmermarketing,
    usuarioSomenteEmerMarketing,
    usuarioTemAcessoEmerlabAlemDeMarketing,
}

/** URL pública do EmerMarketing (override com VITE_EMERMARKETING_URL). */
export function urlEmerMarketing() {
    const fromEnv = import.meta.env?.VITE_EMERMARKETING_URL
    return String(fromEnv || EMERMARKETING_URL_PADRAO).replace(/\/+$/, '')
}
