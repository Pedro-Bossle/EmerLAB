import { describe, expect, it } from 'vitest'
import { coletarIdsVeterinariosVinculados } from './prestadorNomeAlternativo.js'

describe('coletarIdsVeterinariosVinculados', () => {
    it('sem vínculo, nenhum veterinario_id — não usa o número do cadastro', () => {
        expect(coletarIdsVeterinariosVinculados([])).toEqual([])
        expect(coletarIdsVeterinariosVinculados(null)).toEqual([])
    })

    it('só os ids das linhas já filtradas por prestador_id', () => {
        expect(coletarIdsVeterinariosVinculados([{ id: 10 }, { id: 11 }])).toEqual([10, 11])
    })
})
