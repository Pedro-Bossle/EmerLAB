import { describe, expect, it } from 'vitest'
import {
    montarAppMetadataEmermarketing,
    usuarioPodeAbrirEmerMarketing,
} from './emermarketingMeta.js'

describe('usuarioPodeAbrirEmerMarketing', () => {
    it('nega sem ACL de marketing', () => {
        expect(usuarioPodeAbrirEmerMarketing({})).toBe(false)
        expect(usuarioPodeAbrirEmerMarketing({ 'credenciamento.view': true })).toBe(false)
    })

    it('libera com portal ou módulo; não só auditoria EmerLAB', () => {
        expect(usuarioPodeAbrirEmerMarketing({ 'emermarketing.app.read': true })).toBe(true)
        expect(usuarioPodeAbrirEmerMarketing({ 'emermarketing.dashboard.read': true })).toBe(true)
        expect(usuarioPodeAbrirEmerMarketing({ 'emermarketing.auditoria.read': true })).toBe(false)
    })
})

describe('montarAppMetadataEmermarketing', () => {
    it('emermarketing false se só auditoria', () => {
        const meta = montarAppMetadataEmermarketing({ 'emermarketing.auditoria.read': true })
        expect(meta.emermarketing).toBe(false)
        expect(meta.emermarketing_acl['emermarketing.auditoria']?.read).toBe(true)
    })

    it('emermarketing true com portal', () => {
        const meta = montarAppMetadataEmermarketing({ 'emermarketing.app.read': true })
        expect(meta.emermarketing).toBe(true)
    })
})
