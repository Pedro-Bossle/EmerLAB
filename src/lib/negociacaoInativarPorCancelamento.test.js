import { describe, expect, it } from 'vitest'
import { situacaoDescricaoEhCancelado } from './prestadorCadastroHelpers.js'

/** Espelha a condição de inativarNegociacoesSeCancelado (sem DB). */
function deveInativarNegociacao(situacaoIdAnterior, situacaoIdNova, situacoes) {
    const descAnt =
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdAnterior))?.descricao || ''
    const descNova =
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdNova))?.descricao || ''
    return situacaoDescricaoEhCancelado(descNova) && !situacaoDescricaoEhCancelado(descAnt)
}

describe('inativar negociação ao cancelar perfil', () => {
    const sits = [
        { id: 1, descricao: 'Credenciado' },
        { id: 2, descricao: 'Cancelado' },
        { id: 3, descricao: 'Preenchendo Formulário' },
    ]

    it('Credenciado → Cancelado dispara inativação', () => {
        expect(deveInativarNegociacao(1, 2, sits)).toBe(true)
    })

    it('já Cancelado não re-dispara', () => {
        expect(deveInativarNegociacao(2, 2, sits)).toBe(false)
    })

    it('outras situações não disparam', () => {
        expect(deveInativarNegociacao(1, 3, sits)).toBe(false)
        expect(deveInativarNegociacao(3, 1, sits)).toBe(false)
    })
})
