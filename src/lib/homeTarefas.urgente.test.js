import { describe, expect, it } from 'vitest'
import { tarefaMaisUrgente } from './homeTarefas.js'

const dia = (delta) => {
    const d = new Date()
    d.setDate(d.getDate() + delta)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const t = (id, prazo, extra = {}) => ({ id, titulo: id, prazo, horario: null, status: 'pendente', atribuidoA: 'eu', criadoPor: 'x', ...extra })

describe('tarefaMaisUrgente', () => {
    it('devolve null sem tarefas em aberto visíveis para a pessoa', () => {
        expect(tarefaMaisUrgente([], 'eu')).toBeNull()
        expect(
            tarefaMaisUrgente([t('a', dia(1), { atribuidoA: 'outro', criadoPor: 'outro' }), t('b', dia(1), { status: 'concluida' })], 'eu'),
        ).toBeNull()
    })

    it('prioriza a atrasada, depois o prazo mais próximo, e deixa sem prazo por último', () => {
        expect(tarefaMaisUrgente([t('futura', dia(2)), t('atrasada', dia(-3)), t('semPrazo', null)], 'eu').id).toBe('atrasada')
        expect(tarefaMaisUrgente([t('depois', dia(5)), t('antes', dia(1)), t('semPrazo', null)], 'eu').id).toBe('antes')
        expect(tarefaMaisUrgente([t('semPrazo', null), t('depois', dia(5))], 'eu').id).toBe('depois')
    })

    it('inclui tarefas criadas pela pessoa e atribuídas a outra', () => {
        const criadaPorMim = t('delegada', dia(-5), { atribuidoA: 'outro', criadoPor: 'eu' })
        expect(tarefaMaisUrgente([t('minha', dia(1)), criadaPorMim], 'eu').id).toBe('delegada')
    })
})
