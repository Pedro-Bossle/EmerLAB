import { describe, expect, it } from 'vitest'
import { nomeContratadaVolante, removerTituloDrDra } from './nomeContrato.js'

describe('removerTituloDrDra', () => {
    it('remove Dra. e Dr. no início', () => {
        expect(removerTituloDrDra('Dra. Ana Silva')).toBe('Ana Silva')
        expect(removerTituloDrDra('Dr. João Pedro')).toBe('João Pedro')
        expect(removerTituloDrDra('Dra Maria')).toBe('Maria')
        expect(removerTituloDrDra('Dr João')).toBe('João')
    })

    it('preserva nome sem título e razão social', () => {
        expect(removerTituloDrDra('Ana Silva')).toBe('Ana Silva')
        expect(removerTituloDrDra('CLINICA VET LTDA')).toBe('CLINICA VET LTDA')
    })
})

describe('nomeContratadaVolante', () => {
    it('PF corta Dr./Dra.; PJ usa razão social', () => {
        expect(nomeContratadaVolante({ docTipo: 'cpf', nomeCompleto: 'Dra. Ana Silva' })).toBe(
            'Ana Silva',
        )
        expect(
            nomeContratadaVolante({ docTipo: 'cnpj', razaoSocial: 'VET LTDA', nomeCompleto: 'Dra. X' }),
        ).toBe('VET LTDA')
    })
})
