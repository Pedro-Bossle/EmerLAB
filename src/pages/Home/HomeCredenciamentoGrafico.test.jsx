import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { GraficoLinhas, tetoDoEixo } from './HomeCredenciamentoGrafico.jsx'
import { montarResumo } from '../../lib/homeCredenciamentoResumo.js'

describe('HomeCredenciamentoGrafico', () => {
    it('arredonda o teto do eixo de 4 em 4, com mínimo 4', () => {
        expect(tetoDoEixo([])).toBe(4)
        expect(tetoDoEixo([1, 3])).toBe(4)
        expect(tetoDoEixo([5])).toBe(8)
        expect(tetoDoEixo([9, 2])).toBe(12)
    })

    it('desenha uma linha por série e os rótulos de data', () => {
        const hoje = new Date(2026, 10, 6, 12)
        const resumo = montarResumo({ credenciadoEm: [hoje], canceladoEm: [], cards: [] }, { dias: 14, hoje })
        const html = renderToString(<GraficoLinhas resumo={resumo} />)
        expect((html.match(/<polyline/g) || []).length).toBe(3)
        expect(html).toContain('24/10')
        expect(html).toContain('06/11')
    })
})
