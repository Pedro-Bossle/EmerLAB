import { describe, expect, it } from 'vitest'
import { montarOpcoesMunicipioFiltroCredenciamento } from './cidadesSupertabelaVinculos.js'

describe('montarOpcoesMunicipioFiltroCredenciamento', () => {
    it('não deixa a lista vazia quando o nome da cidade-tabela não bate com IBGE', () => {
        const opcoes = montarOpcoesMunicipioFiltroCredenciamento({
            municipiosIbge: [
                { id: 4314902, nome: 'Porto Alegre' },
                { id: 4305108, nome: 'Caxias do Sul' },
            ],
            uf: 'RS',
            cidades: [{ id: 1, nome: 'Serra Gaúcha', uf: 'RS' }],
            vinculos: [],
            cidadeIdsPermitidos: new Set([1]),
        })
        expect(opcoes.map((o) => o.nome)).toEqual(['Serra Gaúcha'])
    })

    it('inclui vínculos IBGE e prefere casing oficial', () => {
        const opcoes = montarOpcoesMunicipioFiltroCredenciamento({
            municipiosIbge: [
                { id: 4314902, nome: 'Porto Alegre' },
                { id: 4305108, nome: 'Caxias do Sul' },
            ],
            uf: 'RS',
            cidades: [{ id: 1, nome: 'Serra Gaúcha', uf: 'RS' }],
            vinculos: [
                { cidade_id: 1, uf: 'RS', municipio_nome: 'caxias do sul' },
                { cidade_id: 1, uf: 'RS', municipio_nome: 'Porto Alegre' },
            ],
            cidadeIdsPermitidos: new Set([1]),
        })
        expect(opcoes.map((o) => o.nome)).toEqual([
            'Caxias do Sul',
            'Porto Alegre',
            'Serra Gaúcha',
        ])
    })
})
