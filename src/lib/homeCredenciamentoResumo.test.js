import { describe, expect, it } from 'vitest'
import { chaveDia, contarPorDia, montarResumo, ultimosDias } from './homeCredenciamentoResumo.js'

const HOJE = new Date(2026, 10, 6, 15, 0, 0) // 06/11/2026

describe('homeCredenciamentoResumo', () => {
    it('lista os últimos dias do mais antigo ao de hoje', () => {
        const dias = ultimosDias(14, HOJE)
        expect(dias).toHaveLength(14)
        expect(dias[0].rotulo).toBe('24/10')
        expect(dias[13].rotulo).toBe('06/11')
        expect(dias[13].chave).toBe('2026-11-06')
    })

    it('conta por dia local e ignora datas fora da janela ou inválidas', () => {
        const dias = ultimosDias(3, HOJE)
        const n = contarPorDia(
            [new Date(2026, 10, 6, 9), new Date(2026, 10, 6, 23, 30), new Date(2026, 10, 5, 1), new Date(2026, 9, 1), 'x', null],
            dias,
        )
        expect(n).toEqual([0, 1, 2])
    })

    it('monta totais, a divisão do que está em processo e o total em processo por dia', () => {
        const r = montarResumo(
            {
                credenciadoEm: [new Date(2026, 10, 6, 10), new Date(2026, 10, 4, 10)],
                canceladoEm: [new Date(2026, 10, 6, 11)],
                cards: [
                    { coluna: 'preenchendo_form', criado_em: new Date(2026, 10, 1, 8).toISOString() },
                    { coluna: 'preenchendo_form', criado_em: new Date(2026, 10, 5, 8).toISOString() },
                    { coluna: 'aguardando_ok_minuta', criado_em: new Date(2026, 10, 5, 9).toISOString() },
                    { coluna: 'aguardando_assinatura', criado_em: new Date(2026, 9, 20, 9).toISOString() },
                    { coluna: 'contatado', criado_em: new Date(2026, 10, 5, 9).toISOString() },
                ],
            },
            { dias: 14, hoje: HOJE },
        )
        expect(r.totais).toEqual({ credenciados: 2, cancelados: 1 })
        expect(r.emProcesso.total).toBe(4)
        expect(r.emProcesso.etapas.map((e) => [e.label, e.quantidade])).toEqual([
            ['Formulário', 2],
            ['OK minuta', 1],
            ['Assinatura', 1],
        ])
        // hoje: os 4 cards. 05/11: 4 + 2 saídas de 06/11. 04/11: 2 cards antigos + 2 saídas. 03/11: 2 cards + 1 (04/11) + 2 (06/11)
        expect(r.series.emProcesso.at(-1)).toBe(4)
        expect(r.series.emProcesso.at(-2)).toBe(6)
        expect(r.series.emProcesso.at(-3)).toBe(4)
        expect(r.series.emProcesso.at(-4)).toBe(5)
    })

    it('chaveDia devolve null para data inválida', () => {
        expect(chaveDia('nao-e-data')).toBeNull()
    })
})
