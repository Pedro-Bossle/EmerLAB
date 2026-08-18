import { describe, expect, it } from 'vitest'
import { montarEstadoSessao, sessaoExpirada, sessaoTemConteudo } from './sessaoLocal.js'

describe('sessão local da conferência', () => {
    it('expira no instante de expiraEm', () => {
        const agora = Date.parse('2026-08-18T12:00:00.000Z')
        expect(sessaoExpirada({ expiraEm: '2026-08-18T11:59:00.000Z' }, agora)).toBe(true)
        expect(sessaoExpirada({ expiraEm: '2026-08-18T12:00:00.000Z' }, agora)).toBe(true)
        expect(sessaoExpirada({ expiraEm: '2026-08-18T12:01:00.000Z' }, agora)).toBe(false)
    })

    it('cai no TTL de 30 dias quando não há expiraEm', () => {
        const agora = Date.parse('2026-08-18T12:00:00.000Z')
        expect(
            sessaoExpirada({ atualizadoEm: '2026-07-18T12:00:00.000Z' }, agora),
        ).toBe(true)
        expect(
            sessaoExpirada({ atualizadoEm: '2026-07-19T12:00:00.000Z' }, agora),
        ).toBe(false)
    })

    it('remove bruto e detecta conteúdo', () => {
        const estado = montarEstadoSessao({
            linhasHonorarios: [{ id: 'h1', tutor: 'Ana', bruto: { x: 1 } }],
            resultados: [],
        })
        expect(estado.linhasHonorarios[0].tutor).toBe('Ana')
        expect(estado.linhasHonorarios[0].bruto).toBeUndefined()
        expect(sessaoTemConteudo(estado)).toBe(true)
        expect(sessaoTemConteudo(montarEstadoSessao())).toBe(false)
    })
})
