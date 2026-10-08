import { describe, expect, it } from 'vitest'
import {
    aclKey,
    completarAclFerramentasCredenciamento,
    expandLegacyToAcl,
    syncLegacyFromAcl,
} from './permissionCatalog.js'
import { PERMISSION_KEYS } from './accessControl.js'

describe('ACL segurança — conferência não promove view a edit', () => {
    it('credenciamento.view não concede create/update na conferência', () => {
        const base = expandLegacyToAcl({
            [PERMISSION_KEYS.CREDENCIAMENTO_VIEW]: true,
        })
        const completed = completarAclFerramentasCredenciamento(base)
        expect(completed[aclKey('configuracoes.conferencia_laboratorio', 'read')]).toBe(true)
        expect(completed[aclKey('configuracoes.conferencia_laboratorio', 'create')]).toBeFalsy()
        expect(completed[aclKey('configuracoes.conferencia_laboratorio', 'update')]).toBeFalsy()
    })

    it('só leitura na conferência não vira credenciamento.edit', () => {
        const perms = syncLegacyFromAcl({
            [aclKey('configuracoes.conferencia_laboratorio', 'read')]: true,
            [aclKey('configuracoes.conferencia_laboratorio', 'create')]: true,
            [aclKey('configuracoes.conferencia_laboratorio', 'update')]: true,
        })
        expect(perms[PERMISSION_KEYS.CREDENCIAMENTO_VIEW]).toBe(true)
        expect(perms[PERMISSION_KEYS.CREDENCIAMENTO_EDIT]).toBeFalsy()
    })

    it('credenciamento.edit legado ainda concede escrita na conferência', () => {
        const base = expandLegacyToAcl({
            [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: true,
        })
        const completed = completarAclFerramentasCredenciamento(base)
        expect(completed[aclKey('configuracoes.conferencia_laboratorio', 'create')]).toBe(true)
        expect(completed[aclKey('configuracoes.conferencia_laboratorio', 'update')]).toBe(true)
    })
})
