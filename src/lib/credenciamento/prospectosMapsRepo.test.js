import { describe, expect, it } from 'vitest'
import {
    mapearEstabelecimentoMapsParaRow,
    mapsIdDeEstabelecimento,
    rowMapsParaCardUi,
} from './prospectosMapsRepo.js'

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
})
