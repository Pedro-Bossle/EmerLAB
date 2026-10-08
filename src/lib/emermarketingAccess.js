import { EMERMARKETING_URL_PADRAO } from './permissionCatalog.js'
import {
    montarAppMetadataEmermarketing,
    usuarioPodeAbrirEmerMarketing,
    usuarioPodeVerAuditoriaEmermarketing,
} from './emermarketingMeta.js'

export {
    montarAppMetadataEmermarketing,
    usuarioPodeAbrirEmerMarketing,
    usuarioPodeVerAuditoriaEmermarketing,
}

/** URL pública do EmerMarketing (override com VITE_EMERMARKETING_URL). */
export function urlEmerMarketing() {
    const fromEnv = import.meta.env?.VITE_EMERMARKETING_URL
    return String(fromEnv || EMERMARKETING_URL_PADRAO).replace(/\/+$/, '')
}
