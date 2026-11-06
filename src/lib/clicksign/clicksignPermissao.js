/**
 * Autorização da API do Clicksign pela FERRAMENTA (ACL `contratos.clicksign.*`), no servidor.
 *
 * Antes o servidor usava `contratos.view` / `contratos.edit`, chaves legadas ligadas por QUALQUER ferramenta
 * de Contratos: quem só tinha «Gerar PDF» passava a ler e escrever na API do Clicksign.
 *
 * Ação por método HTTP: GET/HEAD/OPTIONS → read · POST → create · DELETE → delete · demais (PATCH/PUT) → update.
 */
import { PERMISSION_KEYS, hasPermission } from '../accessControl.js'
import { hasAcl } from '../permissionCatalog.js'

export const FERRAMENTA_CLICKSIGN = 'contratos.clicksign'

export function acaoAclDoMetodo(method) {
    const m = String(method || 'GET').toUpperCase()
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read'
    if (m === 'POST') return 'create'
    if (m === 'DELETE') return 'delete'
    return 'update'
}

/**
 * @param {{ permissions?: Record<string, boolean> }} profile — perfil normalizado (validarJwtComPermissao)
 * @param {string} method
 */
export function clicksignPermitido(profile, method) {
    // Quem gerencia acessos já podia tudo aqui (e pode conceder a si mesmo): mantém o comportamento.
    if (hasPermission(profile, PERMISSION_KEYS.ACCESS_MANAGE)) return true
    return hasAcl(profile?.permissions, FERRAMENTA_CLICKSIGN, acaoAclDoMetodo(method))
}

export const MENSAGEM_SEM_PERMISSAO_CLICKSIGN =
    'Sem permissão na ferramenta Clicksign para esta operação. Peça ao administrador (Contratos › Clicksign).'
