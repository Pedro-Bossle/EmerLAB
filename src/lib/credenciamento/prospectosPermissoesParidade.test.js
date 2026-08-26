import { describe, expect, it } from 'vitest'
import {
    hasPermission,
    normalizarPermissions,
    PERMISSION_KEYS,
    usuarioPodeEditarFerramenta,
} from '../accessControl.js'

/** Espelho da lógica em supabase/functions/_shared/requireUser.ts (perms brutas). */
function podeFerramentaProspectosEditEdge(permissions) {
    const p = permissions || {}
    const isTruthy = (v) => v === true || v === 'true' || v === 1 || v === '1'
    const hasLegacy = (key) => isTruthy(p[key])
    const hasAcl = (toolId, action) => {
        if (isTruthy(p[`${toolId}.${action}`])) return true
        const block = p[toolId]
        if (block && typeof block === 'object' && isTruthy(block[action])) return true
        return false
    }
    const hasAclWrite = (toolId) =>
        hasAcl(toolId, 'update') || hasAcl(toolId, 'create') || hasAcl(toolId, 'delete')
    if (hasAclWrite('credenciamento.prospectos_osm')) return true
    if (hasLegacy('credenciamento.edit')) return true
    return false
}

/** Predicado Vercel pós-normalização (validarJwtFerramentaCredenciamento requireEdit). */
function podeFerramentaProspectosEditVercel(rawPermissions) {
    const normalized = normalizarPermissions({ permissions: rawPermissions })
    return (
        hasPermission(normalized, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) &&
        usuarioPodeEditarFerramenta(normalized, 'credenciamento.prospectos_osm')
    )
}

describe('paridade prospectos edit (Vercel ↔ Edge)', () => {
    it('tool-write-only: ambos aceitam', () => {
        const raw = { 'credenciamento.prospectos_osm.update': true }
        expect(podeFerramentaProspectosEditEdge(raw)).toBe(true)
        expect(podeFerramentaProspectosEditVercel(raw)).toBe(true)
    })

    it('credenciamento.edit legado (edit-only): ambos aceitam', () => {
        const raw = { [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: true }
        expect(podeFerramentaProspectosEditEdge(raw)).toBe(true)
        expect(podeFerramentaProspectosEditVercel(raw)).toBe(true)
    })

    it('legado edit + tool-read: ambos aceitam', () => {
        const raw = {
            [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: true,
            'credenciamento.prospectos_osm.read': true,
        }
        expect(podeFerramentaProspectosEditEdge(raw)).toBe(true)
        expect(podeFerramentaProspectosEditVercel(raw)).toBe(true)
    })

    it('write ACL noutro módulo: ambos rejeitam', () => {
        const raw = { 'compras.valor_venda.update': true }
        expect(podeFerramentaProspectosEditEdge(raw)).toBe(false)
        expect(podeFerramentaProspectosEditVercel(raw)).toBe(false)
    })
})
