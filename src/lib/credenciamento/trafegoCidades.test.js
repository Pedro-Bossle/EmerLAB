import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIMIAR_MARCADORES_CRON,
  dataLocalYmd,
  filtrarCidadesNoLimiar,
  filtrarMunicipiosIbgeExistentes,
  normalizarCidadeTrafego,
  parseCidadesTrafego,
  parseLinhaCidadeTrafego,
} from './trafegoCidades.js'

vi.mock('../ibgeLocalidades.js', () => ({
  buscarMunicipiosPorUf: vi.fn(async (uf) => {
    if (uf === 'PR') return [{ id: 1, nome: 'Pato Branco' }, { id: 2, nome: 'Cascavel' }]
    if (uf === 'RS') return [{ id: 3, nome: 'Porto Alegre' }]
    return []
  }),
}))

describe('trafegoCidades parse', () => {
  it('parseia cidade simples com UF padrão', () => {
    expect(parseLinhaCidadeTrafego('Pato Branco', 'PR')).toEqual({
      cidade: 'Pato Branco',
      uf: 'PR',
    })
  })

  it('parseia Cidade/UF e Cidade - UF', () => {
    expect(parseLinhaCidadeTrafego('Cascavel/PR', 'RS')).toEqual({
      cidade: 'Cascavel',
      uf: 'PR',
    })
    expect(parseLinhaCidadeTrafego('Joinville - SC', 'RS')).toEqual({
      cidade: 'Joinville',
      uf: 'SC',
    })
  })

  it('ignora cabeçalho e linha sem UF válida', () => {
    expect(parseLinhaCidadeTrafego('Cidade', 'RS')).toBeNull()
    expect(parseLinhaCidadeTrafego('Somewhere', '')).toBeNull()
    expect(parseLinhaCidadeTrafego('Foo/XX', '')).toBeNull()
  })

  it('deduplica no texto colado', () => {
    const txt = ['Pato Branco', 'pato branco', 'Cascavel/PR', ''].join('\n')
    const rows = parseCidadesTrafego(txt, 'PR')
    expect(rows).toHaveLength(2)
    expect(rows[0].cidade).toBe('Pato Branco')
    expect(rows[1].uf).toBe('PR')
  })

  it('normaliza cidade para chave', () => {
    expect(normalizarCidadeTrafego('São José')).toBe('SAO JOSE')
  })
})

describe('filtrarMunicipiosIbgeExistentes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejeita cidades inexistentes na UF', async () => {
    const { validas, rejeitadas } = await filtrarMunicipiosIbgeExistentes([
      { cidade: 'Pato Branco', uf: 'PR' },
      { cidade: 'Cidade Inventada', uf: 'PR' },
      { cidade: 'Porto Alegre', uf: 'RS' },
    ])
    expect(validas.map((r) => r.cidade)).toEqual(['Pato Branco', 'Porto Alegre'])
    expect(rejeitadas).toEqual([{ cidade: 'Cidade Inventada', uf: 'PR' }])
  })
})

describe('trafegoCidades limiar', () => {
  it('LIMIAR é 4', () => {
    expect(LIMIAR_MARCADORES_CRON).toBe(4)
  })

  it('filtra só quem bateu o limiar', () => {
    const rows = [
      { cidade: 'A', uf: 'RS', marcadores: 3 },
      { cidade: 'B', uf: 'RS', marcadores: 4 },
      { cidade: 'C', uf: 'SC', marcadores: 7 },
    ]
    const hit = filtrarCidadesNoLimiar(rows)
    expect(hit.map((r) => r.cidade)).toEqual(['B', 'C'])
  })

  it('dataLocalYmd formato YYYY-MM-DD', () => {
    expect(dataLocalYmd(new Date('2026-03-15T12:00:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
