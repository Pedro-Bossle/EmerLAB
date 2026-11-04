import { describe, expect, it } from 'vitest'
import { desdeNotificacoesPagamentos, textoNotificacaoPagamento } from './notificacoesPagamentos.js'

describe('textoNotificacaoPagamento', () => {
    it('RPA que aprovou o relatório', () => {
        expect(textoNotificacaoPagamento({ tipo: 'aprovado', prestador: 'Dra. Ana', competencia: '10/2026' })).toBe('Dra. Ana aprovou o relatório de 10/2026 (RPA)')
    })
    it('reprovação', () => {
        expect(textoNotificacaoPagamento({ tipo: 'reprovado', prestador: 'Clínica X', competencia: '10/2026' })).toBe('Clínica X reprovou o relatório de 10/2026')
    })
    it('nota fiscal e boleto, com valor', () => {
        const nf = textoNotificacaoPagamento({ tipo: 'documento_enviado', prestador: 'Clínica X', competencia: '10/2026', dados: { tipo: 'nota', valor: 150 } })
        expect(nf).toMatch(/^Clínica X enviou a nota fiscal de R\$\s?150,00 de 10\/2026$/)
        expect(textoNotificacaoPagamento({ tipo: 'documento_enviado', prestador: 'Y', dados: { tipo: 'boleto' } })).toBe('Y enviou o boleto')
    })
    it('sem nome do prestador', () => {
        expect(textoNotificacaoPagamento({ tipo: 'aprovado' })).toBe('Um prestador aprovou o relatório (RPA)')
    })
})

describe('desdeNotificacoesPagamentos', () => {
    const agora = new Date('2026-11-14T12:00:00Z').getTime()
    it('sem «Limpar»: janela de 14 dias', () => {
        expect(desdeNotificacoesPagamentos(agora, null)).toBe('2026-10-31T12:00:00.000Z')
    })
    it('depois de «Limpar»: só o que veio depois', () => {
        expect(desdeNotificacoesPagamentos(agora, '2026-11-13T08:00:00.000Z')).toBe('2026-11-13T08:00:00.000Z')
    })
    it('«Limpar» antigo (fora da janela) não estende a janela', () => {
        expect(desdeNotificacoesPagamentos(agora, '2026-09-01T00:00:00.000Z')).toBe('2026-10-31T12:00:00.000Z')
    })
})
