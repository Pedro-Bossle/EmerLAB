import { describe, expect, it } from 'vitest'
import {
    mapearEstabelecimentoMapsParaRow,
    mapsIdDeEstabelecimento,
    montarFilaAtualizacaoCatalogo,
    rowMapsParaCardUi,
} from './prospectosMapsRepo.js'
import {
    displayCategory,
    formatarNotaMaps,
    resolverCidadeProspectoMaps,
} from './emerRadarUi.js'

describe('prospectosMapsRepo', () => {
    it('não inclui imagem no row do banco', () => {
        const row = mapearEstabelecimentoMapsParaRow({
            id: 'abc123',
            nome: 'Clínica X',
            imagem: 'https://cdn.example/foto.jpg',
            cidade: 'Caxias do Sul',
            uf: 'RS',
            horario: 'Aberto 24h',
            horario_detalhado: 'Segunda-feira=Aberto 24h',
        })
        expect(row.maps_id).toBe('abc123')
        expect(row).not.toHaveProperty('imagem')
        expect(JSON.stringify(row)).not.toContain('cdn.example')
        expect(row.horario).toBe('Aberto 24h')
    })

    it('card UI do catálogo vem sem foto', () => {
        const card = rowMapsParaCardUi({
            id: 'uuid-1',
            maps_id: 'abc123',
            nome: 'Clínica X',
            cidade: 'Caxias do Sul',
            uf: 'RS',
            lat: -29.1,
            lng: -51.1,
        })
        expect(card.imagem).toBeNull()
        expect(card.maps_db_id).toBe('uuid-1')
        expect(card.latitude).toBe('-29.1')
    })

    it('mapsIdDeEstabelecimento é estável sem id', () => {
        const a = mapsIdDeEstabelecimento({ nome: 'A', cidade: 'B', uf: 'RS' })
        const b = mapsIdDeEstabelecimento({ nome: 'A', cidade: 'B', uf: 'RS' })
        expect(a).toBe(b)
        expect(a.startsWith('gen_')).toBe(true)
    })

    it('descarta categoria irrelevante e normaliza nota 0–10', () => {
        const row = mapearEstabelecimentoMapsParaRow(
            {
                id: 'roma1',
                nome: 'ROMACLINVET',
                endereco: 'Av. Assis Brasil, 453 - Centro, Sapucaia do Sul - RS',
                cidade: 'Esteio',
                categoria: 'ESCRITÓRIO DO GOVERNO DO ESTADO',
                nota: '10,0',
                termo_busca: 'veterinário',
            },
            { cidadePadrao: 'Esteio', ufPadrao: 'RS' },
        )
        expect(row.categoria).toBe('')
        expect(row.nota).toBe('5,0')
        expect(row.cidade).toBe('Sapucaia do Sul')
        expect(row.uf).toBe('RS')
    })

    it('card UI oculta categoria irrelevante e formata nota', () => {
        const card = rowMapsParaCardUi({
            id: 'uuid-2',
            maps_id: 'roma1',
            nome: 'ROMACLINVET',
            categoria: 'ESCRITÓRIO DO GOVERNO DO ESTADO',
            nota: '10',
            termo_busca: 'veterinário',
        })
        expect(card.categoria).toBe('')
        expect(card.nota).toBe('5,0')
        expect(displayCategory({ ...card, termo_busca: 'veterinário' })).toBe('Veterinário')
    })

    it('montarFilaAtualizacaoCatalogo agrupa por cidade/UF', () => {
        const fila = montarFilaAtualizacaoCatalogo(
            [
                { nome: 'A', cidade: 'Esteio', uf: 'RS', termo_busca: 'veterinário' },
                { nome: 'B', cidade: 'Esteio', uf: 'rs', termo_busca: 'pet shop veterinário' },
                { nome: 'C', cidade: 'Sapucaia do Sul', uf: 'RS' },
                { nome: 'D', cidade: '', uf: 'RS' },
            ],
            { termosPadrao: ['clínica veterinária'], maxResultsPadrao: 80 },
        )
        expect(fila.ok).toBe(true)
        expect(fila.totalProspectos).toBe(3)
        expect(fila.jobs).toHaveLength(2)
        const esteio = fila.jobs.find((j) => j.cidade === 'Esteio')
        expect(esteio.termos).toEqual(expect.arrayContaining(['veterinário', 'pet shop veterinário']))
        expect(esteio.prospectos).toBe(2)
        const sap = fila.jobs.find((j) => j.cidade === 'Sapucaia do Sul')
        expect(sap.termos).toEqual(['clínica veterinária'])
    })
})

describe('emerRadarUi maps quality', () => {
    it('formatarNotaMaps divide escala 0–10', () => {
        expect(formatarNotaMaps('10,0')).toBe('5,0')
        expect(formatarNotaMaps('5,0')).toBe('5,0')
        expect(formatarNotaMaps('4.5')).toBe('4,5')
    })

    it('resolverCidadeProspectoMaps prefere endereço quando worker ecoa cidade da busca', () => {
        expect(
            resolverCidadeProspectoMaps(
                {
                    cidade: 'Esteio',
                    endereco: 'Av. Assis Brasil, 453 - Centro, Sapucaia do Sul - RS',
                },
                { cidadePadrao: 'Esteio' },
            ),
        ).toBe('Sapucaia do Sul')
    })
})
