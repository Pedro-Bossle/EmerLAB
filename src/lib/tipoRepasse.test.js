import { describe, expect, it } from 'vitest'
import { opcoesTipoRepasse } from './prestadorCadastroHelpers.js'
import { ehTipoRpa, valorLiquidoRpa } from './pagamentosValor.js'
import { rotuloTipoRepasse } from './pagamentosPrestador.js'

describe('RPA s/desc.', () => {
    it('só aparece nas opções internas (perfil do prestador), nunca no formulário público', () => {
        expect(opcoesTipoRepasse('').map((t) => t.value)).toEqual(['', 'rpa', 'nota'])
        expect(opcoesTipoRepasse('', { interno: true }).map((t) => t.value)).toEqual(['', 'rpa', 'nota', 'rpa_sd'])
    })

    it('mantém o valor gravado visível mesmo fora das opções do formulário público', () => {
        expect(opcoesTipoRepasse('rpa_sd').at(-1)).toEqual({ value: 'rpa_sd', label: 'RPA s/desc.' })
    })

    it('não recebe o desconto de 11%', () => {
        expect(ehTipoRpa('rpa')).toBe(true)
        expect(ehTipoRpa('rpa_sd')).toBe(false)
        expect(valorLiquidoRpa(1500)).toBe(1335)
        expect(rotuloTipoRepasse('rpa_sd')).toBe('RPA s/desc.')
    })
})
