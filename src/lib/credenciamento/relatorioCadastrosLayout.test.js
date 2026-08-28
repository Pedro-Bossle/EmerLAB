import { describe, expect, it } from 'vitest'
import {
    colunasTabelaRelatorioAtivas,
    layoutRelatorioCadastrosPadrao,
    normalizarLayoutRelatorioCadastros,
    validarLayoutRelatorioCadastros,
} from './relatorioCadastrosLayout.js'

describe('relatorioCadastrosLayout', () => {
    it('respeita ordem e colunas ativas', () => {
        const layout = normalizarLayoutRelatorioCadastros({
            ordemColunas: ['usuario', 'nome', 'cidade'],
            colunasAtivas: ['nome', 'usuario'],
        })
        expect(colunasTabelaRelatorioAtivas(layout)).toEqual(['usuario', 'nome'])
    })

    it('exige ao menos uma seção', () => {
        const vazio = normalizarLayoutRelatorioCadastros({
            incluirTabelaGeral: false,
            incluirGraficoMeses: false,
            resumosAtivos: {
                situacao: false,
                usuario: false,
                especialidade: false,
                cidade: false,
            },
        })
        expect(validarLayoutRelatorioCadastros(vazio)).toMatch(/ao menos/)
    })

    it('layout padrão é válido', () => {
        expect(validarLayoutRelatorioCadastros(layoutRelatorioCadastrosPadrao())).toBe('')
    })
})
