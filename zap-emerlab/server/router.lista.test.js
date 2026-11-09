import { describe, it, expect, vi, beforeEach } from 'vitest'

// Linhas do banco: uma conversa do setor 1, uma do setor 2 e uma atribuída a ana
const linhas = [
    { wa_id: '5511911111111', nome: 'Cliente Um', departamento_id: 1, atendente_email: null, status: 'aberta', ultima_msg_em: '2026-11-09T10:00:00Z' },
    { wa_id: '5511922222222', nome: 'Cliente Dois', departamento_id: 2, atendente_email: null, status: 'aberta', ultima_msg_em: '2026-11-09T11:00:00Z' },
    { wa_id: '5511933333333', nome: 'Cliente Três', departamento_id: 2, atendente_email: 'ana@x.com', status: 'aberta', ultima_msg_em: '2026-11-09T12:00:00Z' },
]
const chamadas = { contatos: 0, banco: 0 }

vi.mock('./db.js', () => {
    const consultaDe = (tabela) => {
        const consulta = {
            select: () => consulta,
            eq: () => consulta,
            order: () => consulta,
            limit: () => consulta,
            then: (res, rej) => {
                if (tabela === 'zap_conversas') chamadas.banco += 1
                return Promise.resolve({ data: tabela === 'zap_conversas' ? linhas : [], error: null }).then(res, rej)
            },
        }
        return consulta
    }
    return {
        db: () => ({ from: consultaDe }),
        ok: ({ data, error }) => {
            if (error) throw new Error(error.message)
            return data
        },
        DbError: class extends Error {},
        buscarUsuarioPorEmail: vi.fn(),
        buscarUsuarioPorId: vi.fn(),
        idsDepartamentos: vi.fn(() => []),
        invalidarUsuarios: vi.fn(),
        listarDepartamentos: vi.fn(async () => []),
        invalidarDepartamentos: vi.fn(),
    }
})

vi.mock('./wati.js', () => {
    class WatiError extends Error {}
    return {
        WatiError,
        watiEmPausa: () => true, // sem conferência com a WATI neste teste
        listarContatos: vi.fn(async () => {
            chamadas.contatos += 1
            return { contatos: [] }
        }),
        invalidarCache: vi.fn(),
    }
})

const { __teste } = await import('./router.js')
const { invalidar } = await import('./cache.js')

const usuario = (extra) => ({ id: 'u', papel: 'atendente', email: 'u@x.com', departamentos: [], ...extra })
const query = (q = '') => new URLSearchParams(q ? { q } : {})
const ids = (r) => r.conversas.map((c) => c.waId)

describe('lista de conversas compartilhada entre atendentes', () => {
    beforeEach(() => {
        invalidar('conversas:')
        chamadas.contatos = 0
        chamadas.banco = 0
    })

    it('calcula a parte pesada uma vez para vários atendentes ao mesmo tempo', async () => {
        const rs = await Promise.all([
            __teste.listarConversas(usuario({ departamentos: [1] }), query()),
            __teste.listarConversas(usuario({ email: 'b@x.com', departamentos: [2] }), query()),
            __teste.listarConversas(usuario({ papel: 'admin' }), query()),
        ])
        expect(chamadas.contatos).toBe(1)
        expect(chamadas.banco).toBe(1)
        expect(rs).toHaveLength(3)
    })

    it('cada atendente vê só o que a permissão dele permite', async () => {
        const setor1 = await __teste.listarConversas(usuario({ departamentos: [1] }), query())
        const setor2 = await __teste.listarConversas(usuario({ email: 'b@x.com', departamentos: [2] }), query())
        const ana = await __teste.listarConversas(usuario({ email: 'ana@x.com', departamentos: [] }), query())
        const admin = await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(ids(setor1)).toEqual(['5511911111111'])
        expect(ids(setor2).sort()).toEqual(['5511922222222', '5511933333333'])
        expect(ids(ana)).toContain('5511933333333')
        expect(ids(admin)).toHaveLength(3)
        // ordem: mais recente primeiro
        expect(ids(admin)).toEqual(['5511933333333', '5511922222222', '5511911111111'])
    })

    it('uma gravação (invalidar) faz a lista ser recalculada', async () => {
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(1)
        invalidar('conversas:')
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(2)
    })
})
