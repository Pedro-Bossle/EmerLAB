import { describe, expect, it } from 'vitest'
import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import {
    classificarBusca,
    enquadramentoDe,
    escolherMelhorResultado,
    filtrarSugestoesPorTermo,
    marcadorCombinaTermo,
    pontuarMarcador,
    proximosDe,
    textoCombinaBusca,
    viewboxDaRede,
} from './mapaProximidade.js'

const n = normalizarTextoBusca
const m = (id, nome, lat, lng, extra = {}) => ({ id, nome, lat, lng, cidade: '', uf: '', bairro: '', logradouro: '', numero: '', ...extra })

describe('textoCombinaBusca', () => {
    it('palavra digitada precisa ser começo de palavra do cadastro', () => {
        expect(textoCombinaBusca(n('Clínica Clavel Petrópolis'), n('pet'))).toBe(true)
        expect(textoCombinaBusca(n('Clínica Clavel'), n('av'))).toBe(false)
        expect(textoCombinaBusca(n('Rua Itararé 1388'), n('itar'))).toBe(true)
    })

    it('número pequeno só vale inteiro (100 não acha 1000)', () => {
        expect(textoCombinaBusca(n('Rua A 1000'), n('100'))).toBe(false)
        expect(textoCombinaBusca(n('Rua A 100'), n('100'))).toBe(true)
    })

    it('ignora conectivos e ordem', () => {
        expect(textoCombinaBusca(n('Bairro Centro Caxias do Sul'), n('caxias sul centro'))).toBe(true)
        expect(textoCombinaBusca(n('Centro Canoas'), n('centro de caxias'))).toBe(false)
    })

    it('começo de CEP casa com o CEP do cadastro', () => {
        expect(textoCombinaBusca('95076180', '95076')).toBe(true)
        expect(textoCombinaBusca('95076180', '95076180')).toBe(true)
    })
})

describe('marcadorCombinaTermo / pontuarMarcador', () => {
    const vet = m(1, 'Clínica Madagascar', 0, 0, { cidade: 'Canoas', uf: 'RS', bairro: 'Centro', raw: { cep: '92010-000' } })
    it('procura em nome, cidade, bairro e CEP', () => {
        expect(marcadorCombinaTermo(vet, n('madagascar'))).toBe(true)
        expect(marcadorCombinaTermo(vet, n('canoas centro'))).toBe(true)
        expect(marcadorCombinaTermo(vet, n('92010'))).toBe(true)
        expect(marcadorCombinaTermo(vet, n('porto alegre'))).toBe(false)
    })
    it('nome exato pontua mais que combinação em outro campo', () => {
        expect(pontuarMarcador(vet, n('clinica madagascar'))).toBe(100)
        expect(pontuarMarcador(vet, n('clinica'))).toBe(90)
        expect(pontuarMarcador(vet, n('canoas'))).toBe(50)
        expect(pontuarMarcador(vet, n('xyz'))).toBe(0)
    })
})

describe('filtrarSugestoesPorTermo', () => {
    const itens = [
        { rotulo: 'Rua Itararé · Bela Vista, Caxias do Sul — Rio Grande do Sul' },
        { rotulo: 'Rua Itararé · Centro, Pelotas — Rio Grande do Sul' },
        { rotulo: 'Avenida Brasil · Centro, Canoas' },
    ]
    it('não descarta endereço só porque o número da casa não aparece no rótulo', () => {
        const r = filtrarSugestoesPorTermo(itens, 'Rua Itararé 1388 Caxias')
        expect(r).toHaveLength(1)
        expect(r[0].rotulo).toMatch(/Caxias/)
    })
    it('termo só numérico não filtra', () => {
        expect(filtrarSugestoesPorTermo(itens, '1388')).toHaveLength(3)
    })
})

describe('classificarBusca', () => {
    it('reconhece CEP', () => {
        expect(classificarBusca('95076-180')).toBe('cep')
        expect(classificarBusca('cep 95076180')).toBe('cep')
        expect(classificarBusca('Rua A 12345678')).toBe('texto')
        expect(classificarBusca('Canoas')).toBe('texto')
    })
})

describe('proximosDe', () => {
    // ~1 grau de latitude ≈ 111 km
    const ref = { lat: -29.9, lng: -51.2 }
    const rede = [
        m(1, 'A', -29.9, -51.2),
        m(2, 'B', -29.92, -51.2), // ~2,2 km
        m(3, 'C', -29.93, -51.2), // ~3,3 km
        m(4, 'D', -30.1, -51.2), // ~22 km
        m(5, 'E', -31.9, -51.2), // ~222 km
    ]

    it('usa o menor raio que já tenha 3 credenciados', () => {
        const r = proximosDe(rede, ref)
        expect(r.raioKm).toBe(5)
        expect(r.itens.map((x) => x.id)).toEqual([1, 2, 3])
        expect(r.alemDoRaio).toBe(false)
    })

    it('alarga o raio quando a vizinhança é vazia e ordena por distância', () => {
        const r = proximosDe(rede, { lat: -30.1, lng: -51.19 })
        expect(r.itens[0].id).toBe(4)
        expect(r.itens.every((x, i, a) => i === 0 || a[i - 1].distanciaKm <= x.distanciaKm)).toBe(true)
        expect(r.raioKm).toBeGreaterThanOrEqual(25)
    })

    it('sem ninguém no raio máximo devolve os mais próximos e avisa que é além', () => {
        const r = proximosDe([m(9, 'Longe', -23.5, -46.6), m(8, 'Longe2', -22.9, -43.2)], ref)
        expect(r.alemDoRaio).toBe(true)
        expect(r.itens).toHaveLength(2)
        expect(r.raioKm).toBeGreaterThan(100)
    })

    it('sem referência ou sem rede não quebra', () => {
        expect(proximosDe(rede, null).itens).toEqual([])
        expect(proximosDe([], ref).itens).toEqual([])
    })
})

describe('enquadramentoDe / viewboxDaRede', () => {
    it('calcula o retângulo dos pontos', () => {
        expect(enquadramentoDe([m(1, 'a', -29, -51), m(2, 'b', -30, -50)])).toMatchObject({ south: -30, north: -29, west: -51, east: -50 })
        expect(enquadramentoDe([])).toBeNull()
    })
    it('viewbox só com rede suficiente, no formato oeste,norte,leste,sul', () => {
        expect(viewboxDaRede([m(1, 'a', -29, -51)])).toBe('')
        const vb = viewboxDaRede([m(1, 'a', -29, -51), m(2, 'b', -30, -50), m(3, 'c', -29.5, -50.5)], { margemGraus: 1 })
        expect(vb).toBe('-52.0000,-28.0000,-49.0000,-31.0000')
    })
})

describe('escolherMelhorResultado', () => {
    const rede = [m(1, 'a', -29.9, -51.2), m(2, 'b', -29.7, -53.2)]
    it('prefere o resultado perto da rede ao primeiro da lista', () => {
        const longe = { lat: -23.5, lng: -46.6, rotulo: 'Centro, São Paulo' }
        const perto = { lat: -29.95, lng: -51.15, rotulo: 'Centro, Canoas' }
        expect(escolherMelhorResultado([longe, perto], rede)).toBe(perto)
    })
    it('sem nenhum perto, mantém o primeiro (busca fora da área da rede)', () => {
        const a = { lat: -23.5, lng: -46.6 }
        const b = { lat: -22.9, lng: -43.2 }
        expect(escolherMelhorResultado([a, b], rede)).toBe(a)
    })
    it('lista vazia → null', () => {
        expect(escolherMelhorResultado([], rede)).toBeNull()
    })
})
