import { describe, expect, it } from 'vitest'
import { normalizarProfileAcesso } from '../accessControl.js'
import { aclKey, sanitizarPermissionsParaSalvar } from '../permissionCatalog.js'
import { acaoAclDoMetodo, clicksignPermitido } from './clicksignPermissao.js'

const perfil = (permissions) => normalizarProfileAcesso({ id: 'u', permissions: sanitizarPermissionsParaSalvar(permissions) })
const k = aclKey

describe('acaoAclDoMetodo', () => {
    it('traduz o método HTTP em ação do ACL', () => {
        expect(acaoAclDoMetodo('GET')).toBe('read')
        expect(acaoAclDoMetodo('head')).toBe('read')
        expect(acaoAclDoMetodo('POST')).toBe('create')
        expect(acaoAclDoMetodo('PATCH')).toBe('update')
        expect(acaoAclDoMetodo('PUT')).toBe('update')
        expect(acaoAclDoMetodo('DELETE')).toBe('delete')
    })
})

describe('clicksignPermitido', () => {
    it('quem só tem «Gerar PDF» NÃO acessa a API do Clicksign', () => {
        const p = perfil({ [k('contratos.gerar_pdf', 'read')]: true, [k('contratos.gerar_pdf', 'create')]: true })
        // as chaves legadas amplas continuam ligadas (contratos.view/edit)...
        expect(p.permissions['contratos.view']).toBe(true)
        expect(p.permissions['contratos.edit']).toBe(true)
        // ...mas a ferramenta Clicksign não
        expect(clicksignPermitido(p, 'GET')).toBe(false)
        expect(clicksignPermitido(p, 'POST')).toBe(false)
    })

    it('«Ver» no Clicksign lê mas não escreve', () => {
        const p = perfil({ [k('contratos.clicksign', 'read')]: true })
        expect(clicksignPermitido(p, 'GET')).toBe(true)
        expect(clicksignPermitido(p, 'POST')).toBe(false)
        expect(clicksignPermitido(p, 'PATCH')).toBe(false)
        expect(clicksignPermitido(p, 'DELETE')).toBe(false)
    })

    it('«Editar» cria e altera, mas só «Total» exclui', () => {
        const editar = perfil({
            [k('contratos.clicksign', 'read')]: true,
            [k('contratos.clicksign', 'create')]: true,
            [k('contratos.clicksign', 'update')]: true,
        })
        expect(clicksignPermitido(editar, 'POST')).toBe(true)
        expect(clicksignPermitido(editar, 'PATCH')).toBe(true)
        expect(clicksignPermitido(editar, 'DELETE')).toBe(false)
        const total = perfil({
            [k('contratos.clicksign', 'read')]: true,
            [k('contratos.clicksign', 'create')]: true,
            [k('contratos.clicksign', 'update')]: true,
            [k('contratos.clicksign', 'delete')]: true,
        })
        expect(clicksignPermitido(total, 'DELETE')).toBe(true)
    })

    it('administrador de acessos mantém o acesso que já tinha', () => {
        const p = perfil({ [k('admin.acessos', 'read')]: true, [k('admin.acessos', 'update')]: true })
        expect(clicksignPermitido(p, 'DELETE')).toBe(true)
    })
})
