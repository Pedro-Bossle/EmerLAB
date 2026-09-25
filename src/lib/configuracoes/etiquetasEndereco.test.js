import { describe, expect, it } from 'vitest'
import {
    ETIQUETAS_POR_PAGINA,
    MODELO_ETIQUETA,
    agruparItensTextoEmEtiquetas,
    gerarPdfEtiquetasEndereco,
    normalizarEtiquetaRegistro,
    parseArquivoEtiquetas,
    parseLinhasEmEtiquetas,
    recomporEtiquetasCortadas,
} from './etiquetasEndereco.js'

describe('etiquetasEndereco', () => {
    it('usa modelo Colacril CA4263 (14/folha)', () => {
        expect(MODELO_ETIQUETA).toMatch(/CA4263/)
        expect(ETIQUETAS_POR_PAGINA).toBe(14)
    })

    it('normaliza registro e CEP', () => {
        const e = normalizarEtiquetaRegistro({
            nome: ' Fulano ',
            endereco: 'Rua A',
            complemento: '10',
            bairro: 'Centro',
            cidade: 'Caxias do Sul',
            uf: 'rs',
            cep: '95000000',
        })
        expect(e.nome).toBe('Fulano')
        expect(e.endereco).toBe('Rua A, 10')
        expect(e.localidade).toBe('CENTRO - CAXIAS DO SUL - RS')
        expect(e.cep).toBe('95000-000')
    })

    it('parse CSV com cabeçalhos flexíveis', async () => {
        const csv = [
            'Nome;Endereço;Bairro;Cidade;UF;CEP',
            'ANA SILVA;RUA X, 1;CENTRO;CAXIAS DO SUL;RS;95010-040',
            ';;',
            'BOB;AV Y;BAIRRO;PORTO ALEGRE;RS;90000-000',
        ].join('\n')
        const r = await parseArquivoEtiquetas(csv, { nomeArquivo: 't.csv' })
        expect(r.ok).toBe(true)
        expect(r.itens).toHaveLength(2)
        expect(r.itens[0].nome).toBe('ANA SILVA')
        expect(r.itens[0].localidade).toContain('CAXIAS DO SUL')
    })

    it('agrupa texto de PDF estilo 2509 em etiquetas', () => {
        // Coordenadas em pts a partir do topo, grade A4 99,1×38,1 (LABEL_H≈108)
        const items = [
            { str: 'LEONARDO BRAZ', x: 20, y: 55 },
            { str: 'Endereço: RUA A, 1', x: 20, y: 71 },
            { str: 'CENTRO - CAXIAS DO SUL - RS', x: 20, y: 87 },
            { str: '95000-000', x: 20, y: 103 },
            { str: 'LUIZA RIBEIRO', x: 320, y: 55 },
            { str: 'Endereço: RUA B, 2', x: 320, y: 71 },
            { str: 'CENTRO - CAXIAS DO SUL - RS', x: 320, y: 87 },
            { str: '95020-260', x: 320, y: 103 },
            { str: 'GILMAR', x: 20, y: 163 },
            { str: 'Endereço: RUA C', x: 20, y: 179 },
            { str: 'BAIRRO - CIDADE - RS', x: 20, y: 195 },
            { str: '90000-000', x: 20, y: 211 },
        ]
        const out = agruparItensTextoEmEtiquetas(items)
        expect(out.length).toBe(3)
        expect(out[0].nome).toMatch(/LEONARDO/)
        expect(out[0].endereco).toMatch(/RUA A/)
        expect(out[0].cep).toBe('95000-000')
        expect(out[1].nome).toMatch(/LUIZA/)
        expect(out[2].nome).toMatch(/GILMAR/)
    })

    it('agrupa endereço com quebra de linha na mesma etiqueta', () => {
        const items = [
            { str: 'MARIA SOUZA', x: 20, y: 55 },
            { str: 'Endereço: AV ASSIS BRASIL, 453/101', x: 20, y: 71 },
            { str: 'SALA 2', x: 20, y: 82 },
            { str: 'CENTRO - SAPUCAIA DO SUL - RS', x: 20, y: 93 },
            { str: '93220-050', x: 20, y: 104 },
        ]
        const out = agruparItensTextoEmEtiquetas(items)
        expect(out).toHaveLength(1)
        expect(out[0].endereco).toMatch(/453\/101/)
        expect(out[0].endereco).toMatch(/SALA 2/)
        expect(out[0].localidade).toMatch(/SAPUCAIA/)
        expect(out[0].cep).toBe('93220-050')
    })

    it('recompõe etiqueta partida entre folhas', () => {
        const out = recomporEtiquetasCortadas([
            {
                nome: 'JOAO SILVA',
                endereco: 'RUA DAS FLORES, 100',
                localidade: '',
                cep: '',
            },
            {
                nome: '',
                endereco: '',
                localidade: 'CENTRO - CAXIAS DO SUL - RS',
                cep: '95000-000',
            },
            {
                nome: 'ANA COSTA',
                endereco: 'AV B, 2',
                localidade: 'CENTRO - PORTO ALEGRE - RS',
                cep: '90000-000',
            },
        ])
        expect(out).toHaveLength(2)
        expect(out[0].nome).toBe('JOAO SILVA')
        expect(out[0].endereco).toMatch(/FLORES/)
        expect(out[0].localidade).toMatch(/CAXIAS/)
        expect(out[0].cep).toBe('95000-000')
        expect(out[1].nome).toBe('ANA COSTA')
    })

    it('religar CEPs órfãos aos cards cortados, sem cascata no card seguinte', () => {
        const out = recomporEtiquetasCortadas([
            {
                nome: 'MARIA HELENA MACIEL DA SILVA',
                endereco: 'DARCY NARCIZO DE OLIVEIRA, 411',
                localidade: 'ESPLANADA - CAXIAS DO SUL - RS',
                cep: '',
            },
            {
                nome: 'GILMAR GANTZEL',
                endereco: 'DOUTOR PEDROSA, 313 - AP 402',
                localidade: 'CENTRO - CURITIBA - PR',
                cep: '',
            },
            { nome: '', endereco: '', localidade: '', cep: '95096-175' },
            { nome: '', endereco: '', localidade: '', cep: '80420-120' },
            {
                nome: 'LUIZA RIBEIRO GEREMIA',
                endereco: 'RUA MAE ANGELICA, 323',
                localidade: 'PETROPOLIS - CAXIAS DO SUL - RS',
                cep: '95020-260',
            },
            {
                nome: 'GUILHERME DE MATOS',
                endereco: 'ANTONIO PRIMO CALEFI, 401',
                localidade: 'DESVIO RIZZO - CAXIAS DO SUL - RS',
                cep: '95080-390',
            },
        ])
        expect(out).toHaveLength(4)
        expect(out[0].nome).toMatch(/MARIA HELENA/)
        expect(out[0].cep).toBe('95096-175')
        expect(out[1].nome).toMatch(/GILMAR/)
        expect(out[1].cep).toBe('80420-120')
        expect(out[2].nome).toMatch(/LUIZA/)
        expect(out[2].cep).toBe('95020-260')
        expect(out[3].nome).toMatch(/GUILHERME/)
        expect(out[3].cep).toBe('95080-390')
    })

    it('separa CEP órfão grudado na célula do card seguinte', () => {
        const items = [
            { str: '95096-175', x: 20, y: 20 },
            { str: 'LUIZA RIBEIRO GEREMIA', x: 20, y: 55 },
            { str: 'Endereço: RUA MAE ANGELICA, 323', x: 20, y: 71 },
            { str: 'PETROPOLIS - CAXIAS DO SUL - RS', x: 20, y: 87 },
            { str: '95020-260', x: 20, y: 103 },
        ]
        const agrupados = agruparItensTextoEmEtiquetas(items)
        const out = recomporEtiquetasCortadas([
            {
                nome: 'MARIA HELENA',
                endereco: 'RUA A, 1',
                localidade: 'ESPLANADA - CAXIAS DO SUL - RS',
                cep: '',
            },
            ...agrupados,
        ])
        expect(out[0].cep).toBe('95096-175')
        expect(out[1].nome).toMatch(/LUIZA/)
        expect(out[1].cep).toBe('95020-260')
    })

    it('gera PDF com 14 por página', async () => {
        const itens = Array.from({ length: 15 }, (_, i) => ({
            nome: `PESSOA ${i + 1}`,
            endereco: `RUA ${i + 1}, 100`,
            localidade: 'CENTRO - CAXIAS DO SUL - RS',
            cep: '95000-000',
        }))
        const r = await gerarPdfEtiquetasEndereco(itens)
        expect(r.ok).toBe(true)
        expect(r.total).toBe(15)
        expect(r.paginas).toBe(2)
        expect(r.blob.type).toBe('application/pdf')
        expect(r.nomeArquivo).toMatch(/ca4263/)
    })

    it('gera PDF com endereço longo sem falhar', async () => {
        const r = await gerarPdfEtiquetasEndereco([
            {
                nome: 'CLIENTE COM NOME BEM EXTENSO PARA TESTAR',
                endereco:
                    'AVENIDA PRESIDENTE GETULIO VARGAS, 1234, BLOCO B, APARTAMENTO 1201, TORRE NORTE',
                localidade: 'JARDIM AMERICA - CAXIAS DO SUL - RS',
                cep: '95000-000',
            },
        ])
        expect(r.ok).toBe(true)
        expect(r.total).toBe(1)
        expect(r.blob.size).toBeGreaterThan(100)
    })

    it('separa nome do próximo card colado na localidade', () => {
        const out = parseLinhasEmEtiquetas([
            'LEONARDO BRAZ',
            'Endereço: RUA A, 1',
            'SAO JOSE - CAXIAS DO SUL - RS ALEXANDRE SOMACAL',
            '95010-040',
        ])
        expect(out[0].nome).toMatch(/LEONARDO/)
        expect(out[0].localidade).toBe('SAO JOSE - CAXIAS DO SUL - RS')
        expect(out[0].localidade).not.toMatch(/ALEXANDRE/)
        expect(out.some((e) => /ALEXANDRE/i.test(e.nome))).toBe(true)
    })

    it('separa localidade + CEP + nome colados no card seguinte', () => {
        const out = parseLinhasEmEtiquetas([
            'CENTRO - CAXIAS DO SUL - RS 95020-260 TATIANA VOLTOLINI DA SILVA',
            'Endereço: DOS TANGARÁS, 1839 - AP204L',
            'SANTA FÉ - CAXIAS DO SUL - RS',
            '95047-570',
        ])
        const tatiana = out.find((e) => /TATIANA/i.test(e.nome))
        expect(tatiana).toBeTruthy()
        expect(tatiana.nome).toBe('TATIANA VOLTOLINI DA SILVA')
        expect(tatiana.nome).not.toMatch(/CENTRO|95020/)
        expect(tatiana.endereco).toMatch(/TANGAR/)
        expect(tatiana.cep).toBe('95047-570')
        // remanescentes emitidos à parte (para recompor no card de cima)
        expect(out.some((e) => e.cep === '95020-260' && !e.nome)).toBe(true)
        expect(out.some((e) => /CENTRO - CAXIAS DO SUL - RS/.test(e.localidade) && !e.nome)).toBe(
            true,
        )
    })

    it('recompõe loc+CEP órfãos sem sujar o nome do card seguinte', () => {
        const parsed = parseLinhasEmEtiquetas([
            'CENTRO - CAXIAS DO SUL - RS 95020-260 TATIANA VOLTOLINI DA SILVA',
            'Endereço: DOS TANGARÁS, 1839',
            'SANTA FÉ - CAXIAS DO SUL - RS',
            '95047-570',
        ])
        const out = recomporEtiquetasCortadas([
            {
                nome: 'LUIZA RIBEIRO GEREMIA',
                endereco: 'MARQUES DO HERVAL, 1216',
                localidade: '',
                cep: '',
            },
            ...parsed,
        ])
        expect(out[0].nome).toMatch(/LUIZA/)
        expect(out[0].localidade).toMatch(/CENTRO/)
        expect(out[0].cep).toBe('95020-260')
        expect(out[1].nome).toBe('TATIANA VOLTOLINI DA SILVA')
        expect(out[1].cep).toBe('95047-570')
    })
})
