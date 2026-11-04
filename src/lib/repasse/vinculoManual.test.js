import { describe, expect, it } from 'vitest'
import { COLUNAS_RELATORIO, interpretarAba, lerRelatorioXlsx, validarAbaRelatorio } from './lerRelatorioExcel.js'
import { gerarModeloRelatorioXlsx } from './modeloRelatorio.js'

const CAB = [...COLUNAS_RELATORIO]
const abaOk = () => [
    ['CLINICA X'],
    ['DR. FULANO'],
    CAB,
    ['1', 'Ana', 'Rex', '02/10/2026', 'Consulta', '100,00', '20,00'],
    ['', '', '', '', 'Vacina', '50,00', '10,00'],
    ['Totais', 'Atendimentos: 1'],
    ['Totais Prestador', '', '', '', '', '150,00', '30,00'],
]

describe('vínculo manual: validação da planilha', () => {
    it('planilha correta: sem erros nem avisos', () => {
        const a = interpretarAba(abaOk())
        expect(a.cabecalhoOk).toBe(true)
        expect(validarAbaRelatorio(a, { valorRegistro: 150 })).toEqual({ erros: [], avisos: [] })
    })

    it('cabeçalho com colunas fora de ordem é erro e cita as colunas esperadas', () => {
        const l = abaOk()
        l[2] = ['Atendimento', 'Pet', 'Tutor', 'Data', 'Procedimento', 'Repasse', 'Diferença']
        const { erros } = validarAbaRelatorio(interpretarAba(l))
        expect(erros.join(' ')).toMatch(/nesta ordem: Atendimento \| Tutor \| Pet \| Data \| Procedimento \| Repasse \| Diferença/)
    })

    it('aceita «Diferenca» sem acento e maiúsculas', () => {
        const l = abaOk()
        l[2] = ['ATENDIMENTO', 'tutor', 'Pet', 'Data', 'Procedimento', 'Repasse', 'Diferenca']
        expect(interpretarAba(l).cabecalhoOk).toBe(true)
    })

    it('sem cabeçalho, sem «Totais Prestador» e sem A1: erros claros', () => {
        expect(validarAbaRelatorio(interpretarAba([['CLINICA X'], ['1', 'Ana', 'Rex', '', 'Consulta', '10', '1']])).erros[0]).toMatch(/linha de cabeçalho/)
        const l = abaOk()
        l.pop()
        expect(validarAbaRelatorio(interpretarAba(l)).erros.join(' ')).toMatch(/Totais Prestador/)
        expect(validarAbaRelatorio(interpretarAba([[''], CAB])).erros.join(' ')).toMatch(/A1/)
    })

    it('total do arquivo diferente da soma das linhas ou do valor do registro vira aviso (não erro)', () => {
        const l = abaOk()
        l[6] = ['Totais Prestador', '', '', '', '', '999,00', '30,00']
        const v = validarAbaRelatorio(interpretarAba(l), { valorRegistro: 150 })
        expect(v.erros).toEqual([])
        expect(v.avisos.join(' ')).toMatch(/não bate/)
        const w = validarAbaRelatorio(interpretarAba(abaOk()), { valorRegistro: 200 })
        expect(w.avisos.join(' ')).toMatch(/diferente do valor do registro/)
    })
})

describe('modelo .xlsx do vínculo manual', () => {
    it('o próprio modelo passa na validação (ida e volta pelo leitor)', async () => {
        const blob = await gerarModeloRelatorioXlsx('Clínica Teste')
        const buf = await blob.arrayBuffer()
        const rel = await lerRelatorioXlsx({ name: 'modelo.xlsx', arrayBuffer: async () => buf })
        expect(rel.abas).toHaveLength(1)
        const aba = rel.abas[0]
        expect(aba.nomeA1).toBe('CLÍNICA TESTE')
        expect(aba.grupos[0].titulo).toBe('DR(A). NOME DO VETERINÁRIO')
        expect(aba.atendimentos).toBe(2)
        expect(aba.grupos[0].atendimentos[1].itens).toHaveLength(2) // 2 procedimentos no mesmo atendimento
        expect(aba.totalAba).toBe(115)
        expect(aba.totalTutor).toBe(80)
        expect(validarAbaRelatorio(aba, { valorRegistro: 115 })).toEqual({ erros: [], avisos: [] })
    })
})
