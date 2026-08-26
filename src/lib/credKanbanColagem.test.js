import { describe, expect, it } from 'vitest'
import {
    parseColagemCardsKanban,
    pareceColagemTabelaKanban,
    resolverResponsavelKanban,
} from './credKanbanColagem.js'

const users = [
    { id: 'u1', nome: 'Pedro Bossle', email: 'pedro@ex.com' },
    { id: 'u2', nome: 'Ana Silva', email: 'ana@ex.com' },
]

describe('credKanbanColagem', () => {
    it('detecta TSV', () => {
        expect(pareceColagemTabelaKanban('A\tB')).toBe(true)
        expect(pareceColagemTabelaKanban('so nome')).toBe(false)
        expect(pareceColagemTabelaKanban('a\nb')).toBe(true)
    })

    it('parseia colunas Nome|Esp|UF|Cidade|Tel|Resp e ignora cabeçalho', () => {
        const txt = [
            'Nome\tEspecialidade\tUF\tCIDADE\tTELEFONE\tResponsável',
            'Clinica X\tCardiologia\trs\tPorto Alegre\t51999998888\tPedro Bossle',
            'Pet Y\t\tSC\tFlorianópolis\t\tAna',
        ].join('\n')
        const rows = parseColagemCardsKanban(txt, { usuarios: users, atribuidoAPadrao: 'u1' })
        expect(rows).toHaveLength(2)
        expect(rows[0].nome).toBe('Clinica X')
        expect(rows[0].especialidade).toBe('Cardiologia')
        expect(rows[0].uf).toBe('RS')
        expect(rows[0].cidade).toBe('Porto Alegre')
        expect(rows[0].atribuidoA).toBe('u1')
        expect(rows[1].atribuidoA).toBe('u2')
        expect(rows[1].uf).toBe('SC')
    })

    it('resolve responsável por e-mail', () => {
        expect(resolverResponsavelKanban('ana@ex.com', users)).toBe('u2')
    })
})
