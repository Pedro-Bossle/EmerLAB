import { describe, expect, it } from 'vitest'
import {
    enderecoCanonicoDoPrestador,
    extrairCep,
    montarConsultasGeocode,
    motivoSemEndereco,
    parsearEnderecoLivre,
    bairroConfere,
    ruaConfere,
} from './enderecoBrasil.js'

describe('parsearEnderecoLivre', () => {
    it('lê o formato do cadastro com travessões e CEP', () => {
        const r = parsearEnderecoLivre('Rua São Francisco, 368 — Olímpica — Esteio/RS — CEP 93285040')
        expect(r).toMatchObject({ logradouro: 'Rua São Francisco', numero: '368', cidade: 'Esteio', uf: 'RS', cep: '93285040' })
    })

    it('lê cidade/UF colados ao bairro (Google Maps)', () => {
        const r = parsearEnderecoLivre('Av. da Serraria, 1470 - Espírito Santo Porto Alegre/RS 91770-010')
        expect(r.logradouro).toBe('Avenida da Serraria')
        expect(r.numero).toBe('1470')
        expect(r.uf).toBe('RS')
        expect(r.cep).toBe('91770010')
        expect(r.cidade).toMatch(/Porto Alegre$/)
    })

    it('lê endereço separado por vírgulas sem UF', () => {
        const r = parsearEnderecoLivre('R. José Domingos de Almeida, 460, Nossa Sra. de Lourdes, Caxias do Sul')
        expect(r).toMatchObject({ logradouro: 'Rua José Domingos de Almeida', numero: '460', cidade: 'Caxias do Sul' })
        expect(r.bairro).toMatch(/Lourdes/)
    })

    it('lê «Cidade - UF» e CEP truncado', () => {
        const r = parsearEnderecoLivre('Av. Wenceslau Escobar, 1415 - Vila Assunção, Porto Alegre - RS, 91900-')
        expect(r).toMatchObject({ numero: '1415', uf: 'RS' })
        expect(r.logradouro).toBe('Avenida Wenceslau Escobar')
        expect(r.cidade).toBe('Porto Alegre')
    })

    it('ignora vazio e hífen', () => {
        expect(parsearEnderecoLivre('-').logradouro).toBe('')
        expect(parsearEnderecoLivre('').cidade).toBe('')
    })
})

describe('extrairCep', () => {
    it('aceita máscaras', () => {
        expect(extrairCep('CEP 95076-180')).toBe('95076180')
        expect(extrairCep('90.410-003')).toBe('90410003')
        expect(extrairCep('sem cep')).toBe('')
    })
})

describe('enderecoCanonicoDoPrestador', () => {
    it('campos estruturados vencem o legado; complemento do número é descartado', () => {
        const e = enderecoCanonicoDoPrestador({
            endereco: 'Rua Itararé, 1388 sala 7 — Junto ao Petshop — Bela Vista — Caxias do Sul/RS',
            endereco_logradouro: 'Rua Itararé',
            endereco_numero: '1388 sala 7',
            endereco_bairro: 'Bela Vista',
            endereco_cidade: 'Caxias do Sul',
            endereco_uf: 'RS',
            cep: '95076180',
        })
        expect(e).toMatchObject({ logradouro: 'Rua Itararé', numero: '1388', cidade: 'Caxias do Sul', uf: 'RS', cep: '95076180' })
    })

    it('trata o endereço inteiro gravado dentro do campo logradouro', () => {
        const e = enderecoCanonicoDoPrestador({
            nome: 'Save Pet',
            endereco: 'Av. Bento Gonçalves, 4313 - Partenon Porto Alegre/RS 90650-003',
            endereco_logradouro: 'Av. Bento Gonçalves, 4313 - Partenon Porto Alegre/RS 90650-003',
        })
        expect(e.logradouro).toBe('Avenida Bento Gonçalves')
        expect(e.numero).toBe('4313')
        expect(e.uf).toBe('RS')
        expect(e.cep).toBe('90650003')
    })

    it('completa lacunas com os dados do ViaCEP', () => {
        const e = enderecoCanonicoDoPrestador(
            { endereco_numero: '2989', cep: '90410003' },
            { logradouro: 'Avenida Protásio Alves', bairro: 'Petrópolis', cidade: 'Porto Alegre', uf: 'RS' },
        )
        expect(e).toMatchObject({ logradouro: 'Avenida Protásio Alves', bairro: 'Petrópolis', cidade: 'Porto Alegre', uf: 'RS' })
    })
})

describe('montarConsultasGeocode', () => {
    it('vai do mais preciso ao mais genérico, sem repetir, e termina no nome do local', () => {
        const q = montarConsultasGeocode({
            nome: 'Clinica Madagascar',
            endereco_logradouro: 'Rua Manoel Serafim',
            endereco_numero: '1381',
            endereco_bairro: 'Centro',
            endereco_cidade: 'Sapucaia do Sul',
            endereco_uf: 'RS',
            cep: '93220250',
        })
        expect(q[0]).toEqual({
            query: 'Rua Manoel Serafim, 1381, Centro, Sapucaia do Sul, RS, Brasil',
            alvo: 'endereco',
            rotulo: 'rua+número+bairro',
        })
        expect(new Set(q.map((x) => x.query)).size).toBe(q.length)
        expect(q.map((x) => x.alvo)).toEqual(expect.arrayContaining(['endereco', 'cep', 'nome']))
        expect(q[q.length - 1].alvo).toBe('nome')
    })

    it('sem endereço nem cidade não inventa consultas', () => {
        expect(montarConsultasGeocode({ nome: 'EnkaPet', endereco: '-' })).toEqual([])
    })

    it('só com cidade, tenta apenas o nome do estabelecimento', () => {
        const q = montarConsultasGeocode({ nome: 'Vetpoa', endereco_cidade: 'Porto Alegre', endereco_uf: 'RS' })
        expect(q.length).toBeGreaterThan(0)
        expect(q.every((x) => x.alvo === 'nome')).toBe(true)
    })
})

describe('motivoSemEndereco', () => {
    it('explica a falta de dados', () => {
        expect(motivoSemEndereco({ nome: 'X', endereco: '' })).toBe('Sem endereço cadastrado')
        expect(motivoSemEndereco({ nome: 'X', endereco_cidade: 'Canoas', endereco_uf: 'RS' })).toMatch(/falta o endereço/)
        expect(motivoSemEndereco({ nome: 'X', endereco: 'Rua A, 10, Centro, Canoas/RS' })).toBe('')
    })
})

describe('ruaConfere / bairroConfere', () => {
    it('ignora o tipo de via e tolera erro de 1 letra', () => {
        expect(ruaConfere('Avenida Wenceslau Escobar', 'Avenida Wenceslau Escobar')).toBe(true)
        expect(ruaConfere('Rua José Domingos de Almeida', 'Rua José Domingues de Almeida')).toBe(true)
        expect(ruaConfere('Avenida Brasil', 'Rua Brasil')).toBe(true)
        expect(ruaConfere('Rua Manoel Serafim', 'Avenida Brasil')).toBe(false)
        expect(ruaConfere('', 'Qualquer')).toBe(true)
        // números por extenso × algarismos (caso real: «Vinte de Setembro» no cadastro, «20 de Setembro» no OSM)
        expect(ruaConfere('Rua Vinte de Setembro', 'Rua 20 de Setembro')).toBe(true)
        expect(ruaConfere('Rua Vinte e Cinco de Julho', 'Rua 25 de Julho')).toBe(true)
        expect(ruaConfere('Rua 7 de Setembro', 'Rua 15 de Setembro')).toBe(false)
    })
    it('bairro: sem dado dos dois lados não contesta', () => {
        expect(bairroConfere('Centro', 'Centro')).toBe(true)
        expect(bairroConfere('Bairro Alto', 'Atuba')).toBe(false)
        expect(bairroConfere('', 'Atuba')).toBe(true)
    })
})
