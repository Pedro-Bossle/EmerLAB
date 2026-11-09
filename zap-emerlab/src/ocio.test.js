import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OCIOSO_APOS_MS, __reiniciarOcio, aoVoltarDoOcio, estaOcioso, registrarAtividade } from './ocio.js'

const T0 = 1_000_000

describe('ociosidade do painel', () => {
    beforeEach(() => __reiniciarOcio(T0))

    it('só fica ocioso depois de 10 min sem atividade', () => {
        expect(estaOcioso(T0 + OCIOSO_APOS_MS - 1)).toBe(false)
        expect(estaOcioso(T0 + OCIOSO_APOS_MS + 1)).toBe(true)
    })

    it('atividade zera o relógio', () => {
        registrarAtividade(T0 + OCIOSO_APOS_MS - 5)
        expect(estaOcioso(T0 + OCIOSO_APOS_MS + 1000)).toBe(false)
    })

    it('avisa ao voltar depois de ocioso, mas não a cada movimento do mouse', () => {
        const volta = vi.fn()
        const sair = aoVoltarDoOcio(volta)
        registrarAtividade(T0 + 1000) // ainda ativo: sem aviso
        expect(volta).not.toHaveBeenCalled()
        registrarAtividade(T0 + 1000 + OCIOSO_APOS_MS + 1) // voltou depois de ocioso
        expect(volta).toHaveBeenCalledTimes(1)
        registrarAtividade(T0 + 1000 + OCIOSO_APOS_MS + 500) // já ativo de novo
        expect(volta).toHaveBeenCalledTimes(1)
        sair()
        registrarAtividade(T0 + 3 * OCIOSO_APOS_MS)
        expect(volta).toHaveBeenCalledTimes(1)
    })
})
