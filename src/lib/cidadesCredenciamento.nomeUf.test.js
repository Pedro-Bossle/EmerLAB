import { describe, expect, it } from 'vitest'
import {
    cidadeCredenciamentoMesmaLocalidade,
    normalizarNomeCidadeCredenciamento,
    normalizarUfCredenciamento,
} from './cidadesCredenciamento.js'

describe('cidadeCredenciamentoMesmaLocalidade', () => {
    it('distingue mesmo nome em UFs diferentes', () => {
        expect(
            cidadeCredenciamentoMesmaLocalidade(
                { nome: 'Santa Maria', uf: 'RS' },
                { nome: 'Santa Maria', uf: 'RN' },
            ),
        ).toBe(false)
    })

    it('considera iguais nome+UF iguais (acentos/caixa)', () => {
        expect(
            cidadeCredenciamentoMesmaLocalidade(
                { nome: 'São José', uf: 'sc' },
                { nome: 'Sao Jose', uf: 'SC' },
            ),
        ).toBe(true)
    })

    it('com cidadeId e sem UF, usa o id', () => {
        expect(
            cidadeCredenciamentoMesmaLocalidade(
                { nome: 'Cascavel', cidadeId: 10 },
                { nome: 'Cascavel', cidadeId: 10 },
            ),
        ).toBe(true)
        expect(
            cidadeCredenciamentoMesmaLocalidade(
                { nome: 'Cascavel', cidadeId: 10 },
                { nome: 'Cascavel', cidadeId: 11 },
            ),
        ).toBe(false)
    })
})

describe('normalizadores', () => {
    it('normaliza nome e UF', () => {
        expect(normalizarNomeCidadeCredenciamento('  São Paulo ')).toBe('sao paulo')
        expect(normalizarUfCredenciamento('rs')).toBe('RS')
    })
})
