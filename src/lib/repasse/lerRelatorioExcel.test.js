import { describe, expect, it } from 'vitest'
import {
    ehLaboratorio,
    interpretarAba,
    interpretarRelatorio,
    linhasResumoMassa,
    nomeAbaRepasse,
    periodoDoNomeArquivo,
} from './lerRelatorioExcel.js'

const CAB = ['Atendimento', 'Tutor', 'Pet', 'Data', 'Procedimento', 'Repasse', 'Diferença']

function abaClinica(totalInformado = '300,00') {
    return [
        ['CLINICA VETERINARIA PET FELIZ LTDA'],
        ['CLINICA VETERINARIA PET FELIZ LTDA'],
        CAB,
        ['101', 'Ana', 'Rex', '02/10/2026', 'Consulta', '100,00', '20,00'],
        ['', '', '', '', 'Vacina', '50,00', '10,00'],
        ['102', 'Bia', 'Mel', '03/10/2026', 'Exame', '150,00', '0,00'],
        ['Totais', '', '', '', '', '300,00', '30,00'],
        ['Totais Prestador', '', '', '', '', totalInformado, '30,00'],
    ]
}

describe('interpretarAba com o nome do veterinário em célula mesclada', () => {
    // O exceljs repete o valor da célula mestre em A..E; essa linha é título, não atendimento.
    const mesclada = (nome) => [nome, nome, nome, nome, nome, '', '']
    const aba = () => [
        ['CLINICA VETERINARIA PIO X'],
        mesclada('DRA. MARIA DA GLORIA KRAEMER'),
        CAB,
        ['101', 'Ana', 'Rex', '02/10/2026', 'Consulta', '100,00', '20,00'],
        ['Totais', '', '', '', '', '100,00', '20,00'],
        mesclada('DR. FABIO PETEFFI'),
        CAB,
        ['201', 'Bia', 'Mel', '03/10/2026', 'Exame', '150,00', '0,00'],
        ['Totais', '', '', '', '', '150,00', '0,00'],
        ['Totais Prestador', '', '', '', '', '250,00', '20,00'],
    ]

    it('usa o nome do veterinário como título do grupo e não cria atendimento falso', () => {
        const a = interpretarAba(aba())
        expect(a.grupos.map((g) => g.titulo)).toEqual(['DRA. MARIA DA GLORIA KRAEMER', 'DR. FABIO PETEFFI'])
        expect(a.grupos.map((g) => g.atendimentos.length)).toEqual([1, 1])
        expect(a.atendimentos).toBe(2)
        expect(a.somaLinhas).toBe(250)
        expect(a.divergente).toBe(false)
    })
})

describe('nomeAbaRepasse', () => {
    it('aplica as regras da macro RearAbasPorA1', () => {
        expect(nomeAbaRepasse('Clinica Veterinaria  Pet Feliz')).toBe('PET FELIZ')
        expect(nomeAbaRepasse('Dra. Maria Souza')).toBe('MARIA SOUZA')
        expect(nomeAbaRepasse('HOSPITAL VETERINÁRIO Central')).toBe('CENTRAL')
    })
    it('corta em 31 caracteres', () => {
        expect(nomeAbaRepasse('A'.repeat(50))).toHaveLength(31)
    })
    it('mantém o original se ficar vazio, inválido ou repetido', () => {
        expect(nomeAbaRepasse('DR. ')).toBe('DR.')
        expect(nomeAbaRepasse('Clinica/Veterinaria X')).toBe('Clinica/Veterinaria X'.slice(0, 31))
        expect(nomeAbaRepasse('Dr. Pedro', new Set(['pedro']))).toBe('Dr. Pedro')
    })
})

describe('periodoDoNomeArquivo', () => {
    it('lê o período do nome', () => {
        expect(periodoDoNomeArquivo('Repasse_01_10_2026_ate_31_10_2026.xlsx')).toEqual({
            inicio: '2026-10-01',
            fim: '2026-10-31',
        })
        expect(periodoDoNomeArquivo('outro.xlsx')).toBeNull()
    })
})

describe('interpretarAba', () => {
    it('agrupa atendimentos, soma linhas e confere o total', () => {
        const a = interpretarAba(abaClinica())
        expect(a.atendimentos).toBe(2)
        expect(a.grupos).toHaveLength(1)
        expect(a.grupos[0].atendimentos[0].itens).toHaveLength(2) // linha com A vazia = outro procedimento
        expect(a.somaLinhas).toBe(300)
        expect(a.totalTutor).toBe(30)
        expect(a.totalAba).toBe(300)
        expect(a.divergente).toBe(false)
    })
    it('marca divergência quando total ≠ soma das linhas', () => {
        const a = interpretarAba(abaClinica('350,00'))
        expect(a.divergente).toBe(true)
        expect(a.diferencaTotais).toBe(50)
    })
    it('separa blocos por veterinário (título só com a coluna A)', () => {
        const a = interpretarAba([
            ['CLINICA X'],
            ['CLINICA X'],
            CAB,
            ['1', 'T', 'P', '01/10/2026', 'Consulta', '10,00', '0,00'],
            ['Totais', '', '', '', '', '10,00', '0,00'],
            ['Dr. João'],
            CAB,
            ['2', 'T2', 'P2', '02/10/2026', 'Consulta', '20,00', '0,00'],
            ['Totais', '', '', '', '', '20,00', '0,00'],
            ['Totais Prestador', '', '', '', '', '30,00', '0,00'],
        ])
        expect(a.grupos.map((g) => g.titulo)).toEqual(['CLINICA X', 'Dr. João'])
        expect(a.divergente).toBe(false)
    })
    it('aceita células numéricas', () => {
        const linhas = abaClinica()
        linhas[3][5] = 100
        linhas[4][5] = 50
        linhas[5][5] = 150
        linhas[7][5] = 300
        expect(interpretarAba(linhas).divergente).toBe(false)
    })
})

describe('interpretarRelatorio / resumo', () => {
    it('ignora Resumo, usa A1 (não o nome da aba) e gera linhas A1[TAB]valor', () => {
        const r = interpretarRelatorio(
            [
                { nome: 'Resumo', linhas: [['x']] },
                { nome: 'qualquer', linhas: abaClinica() },
            ],
            'Repasse_01_10_2026_ate_31_10_2026.xlsx',
        )
        expect(r.abas).toHaveLength(1)
        expect(r.abas[0].abaNome).toBe('PET FELIZ LTDA')
        expect(r.periodo.fim).toBe('2026-10-31')
        expect(linhasResumoMassa(r.abas)).toBe('CLINICA VETERINARIA PET FELIZ LTDA\t300,00')
    })
    it('laboratório vira fluxo manual e não fica divergente', () => {
        expect(ehLaboratorio('LABORATORIO AXYS')).toBe(true)
        const linhas = abaClinica('999,00')
        linhas[0] = ['LABORATORIO AXYS']
        const r = interpretarRelatorio([{ nome: 'a', linhas }])
        expect(r.abas[0].fluxo).toBe('laboratorio_manual')
        expect(r.abas[0].divergente).toBe(false)
    })
})
