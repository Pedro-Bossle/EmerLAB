import { describe, expect, it } from 'vitest'
import {
    linhasUnicasDeColeta,
    mapearEstabelecimentoMapsParaRow,
    mesclarComExistentes,
    pareceUrlFachadaMaps,
    rowMapsParaCardUi,
} from './prospectosMapsCore.js'

const FACHADA = 'https://lh3.googleusercontent.com/grass-cs/AABkmLc3amQ'

describe('prospectosMapsCore', () => {
    it('guarda a fachada do Maps e os planos em tags, e devolve no card', () => {
        const row = mapearEstabelecimentoMapsParaRow({
            id: 'p1',
            nome: 'Pet Shop X',
            imagem: FACHADA,
            planos: ['petlove'],
            match_status: 'vinculado',
            cidade: 'Imbé',
            uf: 'RS',
        })
        expect(row.tags.imagem).toBe(FACHADA)
        expect(row.tags.planos).toEqual(['petlove'])
        const card = rowMapsParaCardUi({ ...row, id: 'uuid-1' })
        expect(card.imagem).toBe(FACHADA)
        expect(card.planos).toEqual(['petlove'])
    })

    it('não guarda imagens que não são fachada (tile, avatar, outro domínio)', () => {
        for (const url of [
            'https://maps.gstatic.com/tile.png',
            'https://lh3.googleusercontent.com/a/avatar',
            'https://cdn.example/foto.jpg',
            '',
        ]) {
            expect(pareceUrlFachadaMaps(url)).toBe(false)
            expect(mapearEstabelecimentoMapsParaRow({ id: 'x', nome: 'A', imagem: url }).tags).not.toHaveProperty('imagem')
        }
    })

    it('mescla sem apagar dado salvo com vazio e sem rebaixar status', () => {
        const rows = [
            mapearEstabelecimentoMapsParaRow({ id: 'p1', nome: 'Clínica', telefone: '', horario: '', cidade: 'Imbé', uf: 'RS' }),
        ]
        mesclarComExistentes(rows, [
            {
                maps_id: 'p1',
                telefone: '(51) 3333-4444',
                whatsapp: '',
                horario: 'Seg 08:00 – 18:00',
                horario_detalhado: '',
                endereco: '',
                cidade: 'Imbé',
                uf: 'RS',
                status_prospeccao: 'contactado',
                tags: { imagem: FACHADA, fonte: 'emer_radar_maps' },
            },
        ])
        expect(rows[0].telefone).toBe('(51) 3333-4444')
        expect(rows[0].horario).toBe('Seg 08:00 – 18:00')
        expect(rows[0].status_prospeccao).toBe('contactado')
        expect(rows[0].tags.imagem).toBe(FACHADA) // a coleta nova não trouxe foto: mantém a anterior
    })

    it('"preferirNovos" deixa o valor novo vencer', () => {
        const rows = [mapearEstabelecimentoMapsParaRow({ id: 'p1', nome: 'A', telefone: '(51) 9999-0000', cidade: 'Imbé', uf: 'RS' })]
        mesclarComExistentes(rows, [{ maps_id: 'p1', telefone: '(51) 1111-2222', whatsapp: '', tags: {} }], { preferirNovos: true })
        expect(rows[0].telefone).toBe('(51) 9999-0000')
    })

    it('linhasUnicasDeColeta remove duplicados por id', () => {
        const rows = linhasUnicasDeColeta([
            { id: 'a', nome: 'A' },
            { id: 'a', nome: 'A de novo' },
            { id: 'b', nome: 'B' },
        ])
        expect(rows.map((r) => r.maps_id)).toEqual(['a', 'b'])
    })
})
