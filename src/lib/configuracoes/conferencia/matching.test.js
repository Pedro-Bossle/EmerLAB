import { describe, expect, it } from 'vitest'
import { montarParManual, runConferencia } from './index.js'
import { findBestMatch } from './matching.js'
import { compareValues } from './values.js'
import { compareDates } from './dates.js'
import { EQUIVALENCIAS_PADRAO, indexarEquivalencias } from './examSimilarity.js'
import { buscarValorBase, aplicarValoresBase, examesPendentesVinculo } from './lookupBase.js'
import {
    camposFaltantesMapeamento,
    linhaValoresBaseTemRegistro,
    mapearIndicesColunasConferencia,
    parsearExcelConferenciaLaboratorio,
} from '../conferenciaLaboratorioExcel.js'

const EQ = indexarEquivalencias(EQUIVALENCIAS_PADRAO)

function L(parcial) {
    return {
        prontuario: '100',
        tutor: 'João',
        pet: 'Rex',
        data: '2026-07-05',
        exame: 'Hemograma + Plaquetas',
        valor: 18.75,
        ...parcial,
    }
}

describe('conferência MellisLab × Honorários', () => {
    it('caso 1 — OK (João/Rex/Hemograma com equivalência)', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1' })],
            mellislab: [
                L({
                    id: 'm1',
                    tutor: 'JOÃO',
                    pet: 'REX',
                    exame: 'Hemograma Completo MellisLab',
                }),
            ],
        })
        expect(resultados).toHaveLength(1)
        expect(resultados[0].status).toBe('OK')
        expect(resultados[0].valor_honorarios).toBe(18.75)
        expect(resultados[0].valor_mellislab).toBe(18.75)
    })

    it('caso 2 — VALOR_DIVERGENTE +4,65', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1' })],
            mellislab: [
                L({
                    id: 'm1',
                    exame: 'Hemograma Completo MellisLab - Citometria de Fluxo',
                    valor: 23.4,
                }),
            ],
        })
        expect(resultados[0].status).toBe('VALOR_DIVERGENTE')
        expect(resultados[0].diferenca_valor).toBe(4.65)
        expect(compareValues(18.75, 23.4).diferenca_valor).toBe(4.65)
    })

    it('caso 3 — OK_COM_DATA_TOLERADA (5 dias)', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1', exame: 'Urocultura' })],
            mellislab: [L({ id: 'm1', exame: 'Urocultura', data: '2026-07-10' })],
        })
        expect(compareDates('2026-07-05', '2026-07-10').diferenca_dias).toBe(5)
        expect(resultados[0].status).toBe('OK_COM_DATA_TOLERADA')
        expect(resultados[0].diferenca_dias).toBe(5)
    })

    it('caso 4 — DATA_DIVERGENTE (15 dias)', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1', exame: 'Urocultura' })],
            mellislab: [L({ id: 'm1', exame: 'Urocultura', data: '2026-07-20' })],
        })
        expect(compareDates('2026-07-05', '2026-07-20').diferenca_dias).toBe(15)
        expect(resultados[0].status).toBe('DATA_DIVERGENTE')
    })

    it('caso 5 — OK_COM_EXAME_EQUIVALENTE (Urocultura)', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1', exame: 'Urocultura', valor: 80 })],
            mellislab: [
                L({
                    id: 'm1',
                    exame: 'Cultura Bacteriana + Antibiograma',
                    valor: 80,
                }),
            ],
        })
        expect(resultados[0].status).toBe('OK_COM_EXAME_EQUIVALENTE')
    })

    it('caso 6 — ORFAO_MELLISLAB', () => {
        const { resultados } = runConferencia({
            honorarios: [L({ id: 'h1', tutor: 'Ana', pet: 'Luna', exame: 'Creatinina' })],
            mellislab: [L({ id: 'm1', tutor: 'Pedro', pet: 'Bolt', exame: 'T4' })],
        })
        const orfao = resultados.find((r) => r.status === 'ORFAO_MELLISLAB')
        expect(orfao).toBeTruthy()
        expect(orfao.exame_mellislab).toBe('T4')
        expect(resultados.some((r) => r.status === 'ORFAO_HONORARIOS')).toBe(true)
    })

    it('extra — dois candidatos → REVISAO_MANUAL (não escolhe sozinho)', () => {
        const hon = [
            L({ id: 'h1', prontuario: '1' }),
            L({ id: 'h2', prontuario: '2' }),
        ]
        const { resultados, resumo } = runConferencia({
            honorarios: hon,
            mellislab: [L({ id: 'm1', exame: 'Hemograma Completo MellisLab' })],
        })
        expect(resultados[0].status).toBe('REVISAO_MANUAL')
        expect(resultados[0].candidatos.length).toBe(2)
        const found = findBestMatch(
            L({ id: 'm1', exame: 'Hemograma Completo MellisLab' }),
            hon,
            { equivalencias: EQ },
        )
        expect(found.tipo).toBe('ambiguo')
        expect(found.candidatos).toHaveLength(2)
        expect(resultados.some((r) => r.status === 'ORFAO_HONORARIOS')).toBe(true)
        expect(resumo.totalHonorarios).toBe(37.5)
    })
})

describe('lookup Valores de Base', () => {
    const base = [
        { id: 'b1', codigo: 'ELAB-001', nome: 'Hemograma + Plaquetas', valor: 18.75 },
        { id: 'b2', codigo: 'ELAB-002', nome: 'Urocultura', valor: 80 },
        { id: 'b3', codigo: 'ELAB-003', nome: 'Creatinina', valor: 12 },
        { id: 'b4', codigo: 'ELAB-004', nome: 'Creatinina sérica', valor: 13 },
    ]

    it('nome único busca o valor oficial da base', () => {
        const found = buscarValorBase('Hemograma + Plaquetas', base)
        expect(found.tipo).toBe('unico')
        expect(found.item.valor).toBe(18.75)
        expect(found.item.codigo).toBe('ELAB-001')
    })

    it('dois nomes semelhantes sem igualdade exata → usuário vincula', () => {
        const found = buscarValorBase('Creatinina extra', base)
        expect(found.tipo).not.toBe('unico')
        const linhas = aplicarValoresBase(
            [{ id: 'p1', exame: 'Creatinina extra', tutor: 'Ana', pet: 'Luna', data: '2026-07-05' }],
            base,
        )
        const pendentes = examesPendentesVinculo(linhas)
        expect(pendentes).toHaveLength(1)
        pendentes[0].candidatos.push({ id: 'mutado' })
        expect(linhas[0].lookup_base.candidatos.some((c) => c.id === 'mutado')).toBe(false)
    })

    it('vínculo manual desta conferência resolve a ambiguidade', () => {
        const linhas = aplicarValoresBase(
            [{ id: 'p1', exame: 'Crea', tutor: 'Ana', pet: 'Luna', data: '2026-07-05' }],
            base,
            { crea: 'b3' },
        )
        expect(linhas[0].lookup_base.tipo).toBe('unico')
        expect(linhas[0].valor).toBe(12)
        expect(linhas[0].codigo_base).toBe('ELAB-003')
    })

    it('comparação usa o valor da base, não o do laboratório, como oficial', () => {
        const { resultados } = runConferencia({
            honorarios: [
                {
                    id: 'p1',
                    tutor: 'João',
                    pet: 'Rex',
                    data: '2026-07-05',
                    exame: 'Hemograma + Plaquetas',
                },
            ],
            mellislab: [
                {
                    id: 'm1',
                    tutor: 'JOÃO',
                    pet: 'REX',
                    data: '2026-07-05',
                    exame: 'Hemograma Completo MellisLab',
                    valor: 23.4,
                },
            ],
            valoresBase: base,
        })
        expect(resultados[0].valor_honorarios).toBe(18.75)
        expect(resultados[0].valor_mellislab).toBe(23.4)
        expect(resultados[0].status).toBe('VALOR_DIVERGENTE')
        expect(resultados[0].diferenca_valor).toBe(4.65)
    })
})

describe('mapeamento das três planilhas', () => {
    it('Valores de Base: Código | Nome | Valor', () => {
        const { idx } = mapearIndicesColunasConferencia(
            ['Código', 'Nome', 'Valor'],
            {},
            'valores_base',
        )
        expect(idx.codigo).toBe(0)
        expect(idx.exame).toBe(1)
        expect(idx.valor).toBe(2)
        expect(camposFaltantesMapeamento(idx, { origem: 'valores_base' })).toEqual([])
    })

    it('Relatório Plano: Data | Tutor | Pet | Exame (sem valor)', () => {
        const { idx } = mapearIndicesColunasConferencia(
            ['Data', 'Tutor', 'Pet', 'Exame'],
            {},
            'honorarios',
        )
        expect(idx.data).toBe(0)
        expect(idx.tutor).toBe(1)
        expect(idx.pet).toBe(2)
        expect(idx.exame).toBe(3)
        expect(idx.valor).toBe(-1)
        expect(camposFaltantesMapeamento(idx, { origem: 'honorarios' })).toEqual([])
    })

    it('Relatório Laboratório: Data | Tutor | Pet | Exame | Valor', () => {
        const { idx } = mapearIndicesColunasConferencia(
            ['Data', 'Tutor', 'Pet', 'Exame', 'Valor'],
            {},
            'mellislab',
        )
        expect(idx.valor).toBe(4)
        expect(camposFaltantesMapeamento(idx, { origem: 'mellislab' })).toEqual([])
    })
})

describe('parear órfãos manualmente', () => {
    it('montarParManual classifica o par escolhido e não deixa órfãos', () => {
        const hon = L({ id: 'h9', exame: 'Urocultura', valor: 40 })
        const mel = L({ id: 'm9', exame: 'Urocultura', valor: 40, tutor: 'JOÃO' })
        const par = montarParManual(hon, mel)
        expect(par.honorarios.id).toBe('h9')
        expect(par.mellis.id).toBe('m9')
        expect(par.acao).toBe('Pareado manualmente')
        expect(par.status).toBe('OK')
        expect(par.id).toBe('par:h9|m9')
    })

    it('parear exames sem relação devolve EXAME_DIVERGENTE', () => {
        const par = montarParManual(
            L({ id: 'h8', exame: 'Hemograma + Plaquetas', valor: 40 }),
            L({ id: 'm8', exame: 'T4', valor: 40, tutor: 'JOÃO' }),
        )
        expect(par.status).toBe('EXAME_DIVERGENTE')
    })
})

describe('valor de honorários sem Valores de Base', () => {
    it('runConferencia usa o valor da linha de honorários', () => {
        const { resultados, resumo } = runConferencia({
            honorarios: [L({ id: 'h1', exame: 'Urocultura', valor: 40 })],
            mellislab: [L({ id: 'm1', exame: 'Urocultura', valor: 40 })],
        })
        expect(resultados[0].valor_honorarios).toBe(40)
        expect(resumo.totalHonorarios).toBe(40)
    })

    it('parser do Relatório Plano lê a coluna de valor quando existe', async () => {
        const html = `<table><tr><td>Data</td><td>Tutor</td><td>Pet</td><td>Exame</td><td>Valor</td></tr><tr><td>05/07/2026</td><td>João</td><td>Rex</td><td>Urocultura</td><td>40</td></tr></table>`
        const buffer = new TextEncoder().encode(html).buffer
        const parsed = await parsearExcelConferenciaLaboratorio(buffer, {
            origem: 'honorarios',
        })
        expect(parsed.linhas).toHaveLength(1)
        expect(parsed.linhas[0].valor).toBe(40)
        expect(parsed.linhas[0].valorRelatorio).toBe(40)
    })

    it('Valores de Base exige nome com letras, não só código', () => {
        expect(linhaValoresBaseTemRegistro({ codigo: 'ELAB-001', nome: '' })).toBe(false)
        expect(linhaValoresBaseTemRegistro({ codigo: 'ELAB-001', nome: '---' })).toBe(false)
        expect(linhaValoresBaseTemRegistro({ codigo: 'ELAB-001', nome: 'Hemograma' })).toBe(true)
    })
})
