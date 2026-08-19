import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase.js', () => ({
    supabase: {
        rpc: vi.fn(),
        from: vi.fn(),
        auth: {
            getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
        },
    },
}))

vi.mock('../conferenciaLaboratorio.js', () => ({
    carregarAliasesPessoaLaboratorio: vi.fn(),
    salvarAliasPessoa: vi.fn(),
    carregarMapeamentosLaboratorio: vi.fn(),
    salvarMapeamentoExame: vi.fn(),
    carregarSessaoConferencia: vi.fn(),
    salvarSessaoConferencia: vi.fn(),
}))

import { supabase } from '../../supabase.js'
import { salvarPerfilExame } from './persist.js'

describe('salvarPerfilExame', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('não deixa perfil parcial quando a RPC falha nos itens', async () => {
        supabase.rpc.mockResolvedValue({
            data: null,
            error: { message: 'duplicate key value violates unique constraint' },
        })

        const out = await salvarPerfilExame({
            laboratorioId: 12,
            nome: 'Perfil cardio',
            exames: ['Hemograma', 'T4'],
            userId: 'user-1',
        })

        expect(out.ok).toBe(false)
        expect(out.motivo).toMatch(/duplicate key/i)
        expect(supabase.rpc).toHaveBeenCalledTimes(1)
        expect(supabase.rpc.mock.calls[0][0]).toBe('salvar_lab_exame_perfil')
        expect(supabase.from).not.toHaveBeenCalled()
    })

    it('devolve o id retornado pela RPC', async () => {
        supabase.rpc.mockResolvedValue({ data: 77, error: null })
        const out = await salvarPerfilExame({
            laboratorioId: 12,
            nome: 'Perfil cardio',
            exames: ['Hemograma'],
            userId: 'user-1',
        })
        expect(out).toEqual({ ok: true, id: 77 })
        expect(supabase.from).not.toHaveBeenCalled()
    })
})
