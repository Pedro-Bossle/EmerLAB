import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./geocodeNominatim.js', () => ({
    geocodificarEnderecoNominatim: vi.fn(),
    delayMs: vi.fn(async () => {}),
}))

import { geocodificarEnderecoNominatim } from './geocodeNominatim.js'
import { cidadeConfere, decidirGeocode, geocodificarPrestadorNominatim, nomeDoLocalConfere } from './geocodePrestadorServer.js'

const prestador = {
    id: 1,
    nome: 'Clínica Veterinária Madagascar',
    endereco_logradouro: 'Rua Manoel Serafim',
    endereco_numero: '1381',
    endereco_bairro: 'Centro',
    endereco_cidade: 'Sapucaia do Sul',
    endereco_uf: 'RS',
}

const cand = (extra) => ({
    latitude: -29.83,
    longitude: -51.15,
    displayName: 'Rua Manoel Serafim, Centro, Sapucaia do Sul, Rio Grande do Sul, Brasil',
    nome: '',
    rua: 'Rua Manoel Serafim',
    bairro: 'Centro',
    cidade: 'Sapucaia do Sul',
    estado: 'Rio Grande do Sul',
    precisao: 'casa',
    ...extra,
})
const resp = (...c) => ({ ok: true, ...c[0], candidatos: c })

const opts = { delayEntreConsultasMs: 0, consultarCep: async () => null }

describe('cidadeConfere / nomeDoLocalConfere', () => {
    it('compara município sem acento e tolera sufixos', () => {
        expect(cidadeConfere('Sapucaia do Sul', 'Sapucaia do Sul')).toBe(true)
        expect(cidadeConfere('São Leopoldo', 'Sao Leopoldo')).toBe(true)
        expect(cidadeConfere('Canoas', 'Porto Alegre')).toBe(false)
        expect(cidadeConfere('', 'Qualquer')).toBe(true)
        expect(cidadeConfere('Esteio', '', 'Rua A, Esteio, RS')).toBe(true)
    })

    it('só aceita o estabelecimento quando o nome distintivo bate', () => {
        expect(nomeDoLocalConfere('Clínica Veterinária Madagascar', { nome: 'Madagascar Pet', displayName: '' })).toBe(true)
        expect(nomeDoLocalConfere('Clínica Veterinária Madagascar', { nome: 'Clínica Veterinária Bicho', displayName: '' })).toBe(false)
        // todas as palavras distintivas: «Rio Branco» não pode casar só com «Rio» ou «Branco»
        expect(nomeDoLocalConfere('Consultório Veterinário Rio Branco', { nome: 'Pet Rio Doce', displayName: '' })).toBe(false)
        expect(nomeDoLocalConfere('Pet Shop', { nome: 'Pet Shop', displayName: '' })).toBe(true)
    })
})

describe('geocodificarPrestadorNominatim', () => {
    beforeEach(() => vi.mocked(geocodificarEnderecoNominatim).mockReset())

    it('para na primeira resposta exata (casa) e informa a fonte precisa', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValueOnce(resp(cand({})))
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r).toMatchObject({ ok: true, precisao: 'casa', aproximado: false, geocodeFonte: 'nominatim' })
        expect(geocodificarEnderecoNominatim).toHaveBeenCalledTimes(1)
    })

    it('descarta resultado de outra cidade e usa o próximo candidato válido', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValueOnce(
            resp(
                cand({ cidade: 'Canoas', displayName: 'Rua Manoel Serafim, Canoas, Rio Grande do Sul' }),
                cand({ latitude: -29.84, longitude: -51.14 }),
            ),
        )
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r.ok).toBe(true)
        expect(r.latitude).toBe(-29.84)
    })

    it('rejeita resultado de outro estado', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValue(
            resp(cand({ displayName: 'Rua Manoel Serafim, Sapucaia do Sul, Pará, Brasil', estado: 'Pará' })),
        )
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r.ok).toBe(false)
        expect(r.diagnostico.tentativas.every((t) => t.codigo === 'resultado_rejeitado')).toBe(true)
    })

    it('sem número exato aceita a rua, mas continua procurando o ponto exato (nome do local)', async () => {
        vi.mocked(geocodificarEnderecoNominatim)
            .mockResolvedValueOnce({ ok: false, erro: 'Endereço não encontrado.' })
            .mockResolvedValueOnce({ ok: false, erro: 'Endereço não encontrado.' })
            .mockResolvedValueOnce(resp(cand({ precisao: 'rua', latitude: -29.8, longitude: -51.1 })))
            .mockResolvedValue(resp(cand({ nome: 'Madagascar Pet', latitude: -29.8005, longitude: -51.1005 })))
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r).toMatchObject({ ok: true, precisao: 'casa', latitude: -29.8005 })
    })

    it('descarta resultado de outra rua', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValue(resp(cand({ rua: 'Avenida Brasil', precisao: 'rua' })))
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r.ok).toBe(false)
        expect(r.diagnostico.tentativas[0].detalhe).toMatch(/outra rua/)
    })

    it('guarda a rua como aproximada quando nada melhor aparece', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValue(resp(cand({ precisao: 'rua' })))
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r).toMatchObject({ ok: true, precisao: 'rua', aproximado: true, geocodeFonte: 'nominatim_rua' })
    })

    it('resultado genérico (só a cidade) nunca vira pin', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValue(resp(cand({ precisao: 'cidade' })))
        const r = await geocodificarPrestadorNominatim(prestador, opts)
        expect(r.ok).toBe(false)
    })

    it('completa o cadastro com o ViaCEP quando falta a cidade', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockResolvedValue(resp(cand({})))
        const r = await geocodificarPrestadorNominatim(
            { id: 2, nome: 'X', cep: '93220250', endereco_numero: '1381' },
            {
                ...opts,
                consultarCep: async () => ({ logradouro: 'Rua Manoel Serafim', bairro: 'Centro', cidade: 'Sapucaia do Sul', uf: 'RS' }),
            },
        )
        expect(r.ok).toBe(true)
        expect(vi.mocked(geocodificarEnderecoNominatim).mock.calls[0][0]).toContain('Sapucaia do Sul')
    })

    it('sem endereço utilizável nem chama o mapa', async () => {
        const r = await geocodificarPrestadorNominatim({ id: 3, nome: 'EnkaPet', endereco: '-' }, opts)
        expect(r).toMatchObject({ ok: false, codigo: 'sem_endereco' })
        expect(geocodificarEnderecoNominatim).not.toHaveBeenCalled()
    })

    it('respeita o orçamento de tempo', async () => {
        vi.mocked(geocodificarEnderecoNominatim).mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 15))
            return { ok: false, erro: 'Endereço não encontrado.' }
        })
        const r = await geocodificarPrestadorNominatim(prestador, { ...opts, orcamentoMs: 5 })
        expect(r.ok).toBe(false)
        expect(geocodificarEnderecoNominatim).toHaveBeenCalledTimes(1)
        expect(r.diagnostico.tentativas.some((t) => t.codigo === 'orcamento_tempo')).toBe(true)
    })
})

describe('decidirGeocode', () => {
    const pt = (extra) => ({ alvo: 'endereco', precisao: 'rua', latitude: -29.8, longitude: -51.1, bairro: '', ...extra })

    it('«imóvel» longe do ponto da rua e de outro bairro não é confirmado: vale a rua (caso real de 1,5 km)', () => {
        const d = decidirGeocode(
            [pt({ precisao: 'casa', latitude: -29.786, longitude: -51.1, bairro: 'Atuba' }), pt({})],
            { bairroEsperado: 'Bairro Alto' },
        )
        expect(d).toMatchObject({ precisao: 'rua', confirmado: false })
        expect(d.ponto.latitude).toBe(-29.8)
    })

    it('«imóvel» perto do ponto da rua é confirmado', () => {
        const d = decidirGeocode([pt({}), pt({ precisao: 'casa', latitude: -29.8003 })], { bairroEsperado: '' })
        expect(d).toMatchObject({ precisao: 'casa', confirmado: true })
    })

    it('«imóvel» com o mesmo bairro do cadastro é confirmado mesmo sem ponto da rua', () => {
        const d = decidirGeocode([pt({ precisao: 'casa', bairro: 'Centro' })], { bairroEsperado: 'Centro' })
        expect(d).toMatchObject({ precisao: 'casa', confirmado: true })
    })

    it('sem confirmação nenhuma, o «imóvel» vira rua (aproximado)', () => {
        const d = decidirGeocode([pt({ precisao: 'casa' })], { bairroEsperado: '' })
        expect(d).toMatchObject({ precisao: 'rua', confirmado: false })
    })

    it('busca pelo nome só refina quando está a até 600 m da rua (caso real: 13 km de erro)', () => {
        const longe = decidirGeocode([pt({}), pt({ alvo: 'nome', precisao: 'casa', latitude: -29.9, longitude: -51.2 })])
        expect(longe.precisao).toBe('rua')
        const perto = decidirGeocode([pt({}), pt({ alvo: 'nome', precisao: 'casa', latitude: -29.8021 })])
        expect(perto).toMatchObject({ precisao: 'casa', confirmado: true })
    })

    it('sem endereço, o nome sozinho vira região (aproximado), e o CEP vence o nome', () => {
        expect(decidirGeocode([pt({ alvo: 'nome', precisao: 'casa' })]).precisao).toBe('bairro')
        expect(decidirGeocode([pt({ alvo: 'nome', precisao: 'casa' }), pt({ alvo: 'cep', precisao: 'cep' })]).precisao).toBe('cep')
        expect(decidirGeocode([])).toBeNull()
    })
})
