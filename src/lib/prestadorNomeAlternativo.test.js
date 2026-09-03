import { describe, expect, it } from 'vitest'
import { coletarIdsVeterinariosVinculados } from './prestadorNomeAlternativo.js'

describe('coletarIdsVeterinariosVinculados', () => {
    it('sem vínculo, nenhum veterinario_id — não usa o número do cadastro', () => {
        expect(coletarIdsVeterinariosVinculados([], 82)).toEqual([])
        expect(coletarIdsVeterinariosVinculados(null, 82)).toEqual([])
    })

    it('só veterinários com prestador_id igual ao cadastro', () => {
        expect(
            coletarIdsVeterinariosVinculados([{ id: 10, prestador_id: 82 }, { id: 11, prestador_id: 82 }], 82),
        ).toEqual([10, 11])
    })

    it('não puxa negociação de outro dono só porque veterinarios.id = prestadores.id', () => {
        expect(
            coletarIdsVeterinariosVinculados(
                [
                    { id: 82, prestador_id: 25, nome: 'Coisa de Bicho' },
                    { id: 68, prestador_id: 320, nome: 'Axys' },
                    { id: 87, prestador_id: 212, nome: 'PróVita' },
                ],
                82,
            ),
        ).toEqual([])
        expect(
            coletarIdsVeterinariosVinculados([{ id: 68, prestador_id: 320, nome: 'Axys' }], 68),
        ).toEqual([])
        expect(
            coletarIdsVeterinariosVinculados([{ id: 10, prestador_id: 82 }], 82),
        ).toEqual([10])
    })

    it('permite o mesmo número de id se o vínculo prestador_id for do cadastro', () => {
        expect(coletarIdsVeterinariosVinculados([{ id: 82, prestador_id: 82 }], 82)).toEqual([82])
    })
})
