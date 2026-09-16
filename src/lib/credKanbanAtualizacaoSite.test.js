import { describe, expect, it } from 'vitest'
import {
    montarBlocoAtualizacaoDados,
    montarBlocoAtualizacaoProcedimentos,
    montarBlocoAtualizacaoSituacao,
} from './credKanbanAtualizacaoSite.js'

describe('credKanbanAtualizacaoSite diffs', () => {
    it('procedimentos: entrou e saiu', () => {
        const bloco = montarBlocoAtualizacaoProcedimentos(
            ['A1', 'B2'],
            ['B2', 'C3'],
            new Map([
                ['A1', 'Proc A'],
                ['C3', 'Proc C'],
            ]),
        )
        expect(bloco).toContain('Atualização de procedimentos')
        expect(bloco).toContain('Entrou: C3 — Proc C')
        expect(bloco).toContain('Saiu: A1 — Proc A')
    })

    it('procedimentos: sem mudança → null', () => {
        expect(montarBlocoAtualizacaoProcedimentos(['X'], ['x'], new Map())).toBeNull()
    })

    it('dados: telefone e cidade', () => {
        const bloco = montarBlocoAtualizacaoDados(
            { telefone: '111', endereco_cidade: 'POA' },
            { telefone: '222', endereco_cidade: 'Canoas' },
        )
        expect(bloco).toContain('Atualização de dados')
        expect(bloco).toContain('Telefone')
        expect(bloco).toContain('Cidade')
    })

    it('situação: só Credenciado/Cancelado', () => {
        const sits = [
            { id: 1, descricao: 'Preenchendo Formulário' },
            { id: 2, descricao: 'Credenciado' },
            { id: 3, descricao: 'Cancelado' },
        ]
        expect(montarBlocoAtualizacaoSituacao(1, 2, sits)).toContain('Credenciado')
        expect(montarBlocoAtualizacaoSituacao(2, 3, sits)).toContain('Cancelado')
        expect(montarBlocoAtualizacaoSituacao(2, 1, sits)).toBeNull()
    })
})
