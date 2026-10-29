import { describe, expect, it } from 'vitest'
import {
    aplicarSelecaoModo,
    montarSelecaoDeCategorias,
    rotuloModoImpressao,
} from './modoImpressaoPlanos.js'

const cats = [
    {
        id: 1,
        nome: 'Consultas',
        linhas: [
            { linhaKey: 'A|base', codigo: 'A', checked: true, selecionavel: true },
            { linhaKey: 'B|base', codigo: 'B', checked: false, selecionavel: true },
            { linhaKey: 'C|base', codigo: 'C', checked: true, apenasLoja: true },
            { linhaKey: 'D|alt:x', codigo: 'D', checked: true, selecionavel: true },
        ],
    },
]

describe('aplicarSelecaoModo', () => {
    it('aplica mapa conhecido e preserva default em linha nova', () => {
        const selecao = { 'A|base': false, 'B|base': true }
        const out = aplicarSelecaoModo(cats, selecao)
        const linhas = out[0].linhas
        expect(linhas.find((l) => l.linhaKey === 'A|base').checked).toBe(false)
        expect(linhas.find((l) => l.linhaKey === 'B|base').checked).toBe(true)
        // nova (não estava no mapa): mantém checked original
        expect(linhas.find((l) => l.linhaKey === 'D|alt:x').checked).toBe(true)
        // apenas loja: sempre false
        expect(linhas.find((l) => l.linhaKey === 'C|base').checked).toBe(false)
    })

    it('sem selecao devolve categorias intactas', () => {
        expect(aplicarSelecaoModo(cats, null)).toBe(cats)
        expect(aplicarSelecaoModo(cats, undefined)).toBe(cats)
    })
})

describe('montarSelecaoDeCategorias', () => {
    it('ignora apenasLoja e monta mapa booleano', () => {
        expect(montarSelecaoDeCategorias(cats)).toEqual({
            'A|base': true,
            'B|base': false,
            'D|alt:x': true,
        })
    })
})

describe('rotuloModoImpressao', () => {
    it('sem modo', () => {
        expect(rotuloModoImpressao(null)).toMatch(/sem modo salvo/i)
    })

    it('com modo recente', () => {
        const txt = rotuloModoImpressao({
            atualizadoEm: new Date().toISOString(),
            atualizadoPorNome: 'Alfa',
        })
        expect(txt).toMatch(/Modo da equipe/)
        expect(txt).toMatch(/Alfa/)
    })
})
