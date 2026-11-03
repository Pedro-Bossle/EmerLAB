import { describe, expect, it } from 'vitest'
import {
    aplicarVariaveis,
    avaliarValorDocumento,
    distribuirHorarios,
    ehCompetenciaNovoModelo,
    descontoRpaDoRepasse,
    instrucaoPorTipo,
    linkWhatsapp,
    periodoMesAnteriorLabel,
    validarArquivoRepasse,
} from './repasseCore.js'

describe('ehCompetenciaNovoModelo', () => {
    it('meses anteriores à inicial são legado; a partir dela, novo modelo', () => {
        expect(ehCompetenciaNovoModelo(9, 2026, '2026-10')).toBe(false)
        expect(ehCompetenciaNovoModelo(10, 2026, '2026-10')).toBe(true)
        expect(ehCompetenciaNovoModelo(1, 2027, '2026-10')).toBe(true)
        expect(ehCompetenciaNovoModelo(12, 2025, '2026-10')).toBe(false)
    })
})

describe('avaliarValorDocumento', () => {
    it('ok quando igual ao repasse', () => {
        expect(avaliarValorDocumento(150, 150, 30).nivel).toBe('ok')
    })
    it('erro quando igual ao pago pelo tutor', () => {
        expect(avaliarValorDocumento(30, 150, 30).nivel).toBe('erro_tutor')
    })
    it('aviso quando só difere do repasse', () => {
        const r = avaliarValorDocumento(140, 150, 30)
        expect(r.nivel).toBe('aviso_diferente')
        expect(r.diferenca).toBe(-10)
    })
    it('inválido sem número', () => {
        expect(avaliarValorDocumento(null, 1, 1).nivel).toBe('erro_invalido')
    })
})

describe('distribuirHorarios', () => {
    const inicio = '2026-11-05T09:00:00Z'
    const fim = '2026-11-05T17:00:00Z'
    it('intervalos iguais', () => {
        const h = distribuirHorarios({ n: 3, inicio, fim, ordem: 'iguais' })
        expect(h.map((d) => d.toISOString())).toEqual([
            '2026-11-05T09:00:00.000Z',
            '2026-11-05T13:00:00.000Z',
            '2026-11-05T17:00:00.000Z',
        ])
    })
    it('aleatórios: ordenados, dentro da janela e com intervalo mínimo de 20 s', () => {
        const h = distribuirHorarios({ n: 92, inicio, fim })
        for (let i = 1; i < h.length; i++) expect(h[i] - h[i - 1]).toBeGreaterThanOrEqual(20_000)
        expect(+h[0]).toBeGreaterThanOrEqual(+new Date(inicio))
        expect(+h[h.length - 1]).toBeLessThanOrEqual(+new Date(fim))
    })
    it('rejeita janela curta demais', () => {
        expect(() => distribuirHorarios({ n: 100, inicio, fim: '2026-11-05T09:10:00Z' })).toThrow()
    })
})

describe('textos e arquivos', () => {
    it('substitui variáveis conhecidas', () => {
        expect(aplicarVariaveis('Olá {prestador} {x}', { prestador: 'Ana' })).toBe('Olá Ana {x}')
    })
    it('instrução por tipo', () => {
        expect(instrucaoPorTipo('rpa', 'R$ 1')).toMatch(/aprovar/)
        expect(instrucaoPorTipo('nota', 'R$ 1')).toMatch(/nota fiscal no valor de R\$ 1/)
        expect(instrucaoPorTipo('boleto', 'R$ 1')).toMatch(/boleto/)
    })

    it('RPA com desconto avisa o desconto de 11% e o valor a receber; sem desconto segue simples', () => {
        const t = instrucaoPorTipo('rpa', 'R$ 1.500,00', { descontoRpa: true, valorBruto: 1500 })
        expect(t).toMatch(/aprovar o relatório/)
        expect(t).toMatch(/desconto de 11% de INSS/)
        expect(t).toMatch(/165,00/)
        expect(t).toMatch(/1\.335,00/)
        expect(instrucaoPorTipo('rpa', 'R$ 1.500,00', { descontoRpa: false, valorBruto: 1500 })).toBe('é só aprovar o relatório')
        expect(descontoRpaDoRepasse(1500)).toEqual({ pct: 11, desconto: 165, liquido: 1335 })
    })
    it('valida arquivo', () => {
        expect(validarArquivoRepasse({ nome: 'a.exe', tamanho: 10 })).toMatch(/Formato/)
        expect(validarArquivoRepasse({ nome: 'a.pdf', tamanho: 11 * 1024 * 1024 })).toMatch(/10 MB/)
        expect(validarArquivoRepasse({ nome: 'a.pdf', tamanho: 100 })).toBeNull()
    })
    it('link do WhatsApp', () => {
        expect(linkWhatsapp('(55) 4999-0416', 'oi a')).toBe('https://wa.me/55499904' + '16?text=oi%20a')
    })
})

describe('periodoMesAnteriorLabel', () => {
    it('é sempre o mês anterior inteiro, do dia 1 ao último dia', () => {
        expect(periodoMesAnteriorLabel(new Date('2026-11-03T15:00:00Z'))).toBe('01/10/2026 a 31/10/2026')
        expect(periodoMesAnteriorLabel(new Date('2026-03-15T15:00:00Z'))).toBe('01/02/2026 a 28/02/2026')
        expect(periodoMesAnteriorLabel(new Date('2028-03-15T15:00:00Z'))).toBe('01/02/2028 a 29/02/2028')
    })

    it('vira o ano em janeiro', () => {
        expect(periodoMesAnteriorLabel(new Date('2027-01-10T15:00:00Z'))).toBe('01/12/2026 a 31/12/2026')
    })

    it('usa o fuso de Brasília na virada do mês', () => {
        // 01/12 02:00 UTC ainda é 30/11 23:00 em Brasília: continua novembro → mês anterior = outubro
        expect(periodoMesAnteriorLabel(new Date('2026-12-01T02:00:00Z'))).toBe('01/10/2026 a 31/10/2026')
    })
})
