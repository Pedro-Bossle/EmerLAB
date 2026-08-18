import { describe, expect, it } from 'vitest'
import {
    aliasesPessoaDePareamento,
    alinharExamesLabAoCodigoDoPlano,
    autoAprovarPareamentosPerfeitos,
    ehPareamentoExamePerfeito,
    montarCardsConferencia,
    montarFilaExamesIndividuais,
    montarMapasAliasesPessoa,
    motivoComparacaoValor,
    normalizarNomeExame,
    pontuarPareamentoExamesIndividuais,
    preencherPrecosZeroNosGruposComparacao,
    agruparCardsComparacaoPorAtendimento,
    cardTemDiffPendente,
    mesmoCardConferencia,
    scorePareamentoExame,
    scoreSimilaridadeNome,
} from './conferenciaLaboratorio.js'
import { parsearValorMonetario, matrizDeHtmlTabela, matrizDeSpreadsheetMl, matrizDeWorksheetXmlXlsx, linhaConferenciaTemRegistro } from './conferenciaLaboratorioExcel.js'
import { precoNegociacaoUtil } from './conferenciaLaboratorioPrecos.js'

describe('scoreSimilaridadeNome', () => {
    it('idêntico = 1000', () => {
        expect(scoreSimilaridadeNome('CREATININA', 'creatinina')).toBe(1000)
    })

    it('substring fraca de 1 palavra não vira 650', () => {
        const s = scoreSimilaridadeNome(
            'CREATININA',
            'RELACAO PROTEINA CREATININA URINARIA',
        )
        expect(s).toBeLessThan(650)
    })
})

describe('scorePareamentoExame', () => {
    it('códigos iguais = match pleno', () => {
        expect(
            scorePareamentoExame(
                { codigo: 'ABC', nome: 'X' },
                { codigo: 'ABC', nome: 'Y' },
            ),
        ).toBe(1000)
    })

    it('códigos diferentes = 0 mesmo com nomes parecidos', () => {
        expect(
            scorePareamentoExame(
                { codigo: 'CREA', nome: 'CREATININA', nomeNorm: 'creatinina' },
                { codigo: 'PCRU', nome: 'PCR URINARIA', nomeNorm: 'pcr urinaria' },
            ),
        ).toBe(0)
    })
})

describe('alinharExamesLabAoCodigoDoPlano', () => {
    it('não pareia códigos distintos', () => {
        const { examesLab, examesEm } = alinharExamesLabAoCodigoDoPlano(
            [{ idLocal: 'l1', nome: 'CREATININA', codigo: 'CREA', valor: 10 }],
            [{ idLocal: 'e1', nome: 'PCR URINARIA', codigo: 'PCRU', valor: 20 }],
        )
        expect(examesLab.every((x) => x.semPar && !x.idParEm)).toBe(true)
        expect(examesEm.every((x) => x.semPar && !x.idParLab)).toBe(true)
    })

    it('pareia pelo código idêntico', () => {
        const { examesLab, examesEm } = alinharExamesLabAoCodigoDoPlano(
            [{ idLocal: 'l1', nome: 'CREAT', codigo: 'CREA', valor: 10 }],
            [{ idLocal: 'e1', nome: 'CREATININA', codigo: 'CREA', valor: 12 }],
        )
        expect(examesLab[0].idParEm).toBe('e1')
        expect(examesEm[0].idParLab).toBe('l1')
        expect(examesLab[0].valoresDiferem).toBe(true)
    })
})

describe('pontuarPareamentoExamesIndividuais', () => {
    it('recalcula badges ao mudar o lado do plano', () => {
        const lab = {
            tipo: 'orfao_lab',
            tutor: 'ADRIANE V DE OLIVEIRA',
            pet: 'THOMAS',
            data: '2026-06-09',
            exameLaboratorio: 'ALT',
            codigo: 'ELAB-025',
            valorLab: 13.16,
        }
        const planoBom = {
            tipo: 'orfao_emerdog',
            tutor: 'ADRIANE V DE OLIVEIRA BOLDT',
            pet: 'THOMAS',
            data: '2026-06-09',
            exameEmerdog: 'ALT',
            codigo: 'ELAB-025',
            valorEmerdog: 13.16,
        }
        const planoOutro = {
            tipo: 'orfao_emerdog',
            tutor: 'OUTRO TUTOR',
            pet: 'REX',
            data: '2026-01-01',
            exameEmerdog: 'UREIA',
            codigo: 'ELAB-099',
            valorEmerdog: 99,
        }
        const a = pontuarPareamentoExamesIndividuais(lab, planoBom)
        const b = pontuarPareamentoExamesIndividuais(lab, planoOutro)
        expect(a.motivos).toEqual(expect.arrayContaining(['Valor OK', 'Animal idêntico']))
        expect(b.motivos).toEqual(expect.arrayContaining(['Valor diferente']))
        expect(b.motivos).not.toEqual(expect.arrayContaining(['Animal idêntico']))
        expect(a.total).toBeGreaterThan(b.total)
    })
})

describe('aliasesPessoaDePareamento', () => {
    it('cria alias tutor quando grafias diferem', () => {
        const aliases = aliasesPessoaDePareamento({
            tutorLab: 'ANA ELISA F. MORAIS',
            tutorPlano: 'ANA ELISA FRANCIO MORAIS',
            petLab: 'OHANA',
            petPlano: 'OHANA',
        })
        expect(aliases).toEqual([
            {
                tipo: 'tutor',
                nomeLab: 'ANA ELISA F. MORAIS',
                nomePlano: 'ANA ELISA FRANCIO MORAIS',
            },
        ])
        const mapas = montarMapasAliasesPessoa(aliases)
        expect(
            scoreSimilaridadeNome(
                'ANA ELISA F. MORAIS',
                'ANA ELISA FRANCIO MORAIS',
                mapas.tutor,
            ),
        ).toBe(1000)
    })

    it('cria alias pet quando diferem', () => {
        const aliases = aliasesPessoaDePareamento({
            tutorLab: 'JOAO',
            tutorPlano: 'JOAO',
            petLab: 'BOLT',
            petPlano: 'BOLT JR',
        })
        expect(aliases).toEqual([
            { tipo: 'pet', nomeLab: 'BOLT', nomePlano: 'BOLT JR' },
        ])
    })
})

describe('autoAprovarPareamentosPerfeitos', () => {
    it('remove da fila quando tutor/pet/data/exame/valor estão 100%', () => {
        const cards = [
            {
                tipo: 'orfao_lab',
                idLabLocal: 'lab-1',
                tutor: 'ANA ELISA F. MORAIS',
                pet: 'OHANA',
                data: '2026-06-16',
                exameLaboratorio: 'ALT',
                codigo: 'ELAB-025',
                valorLab: 13.16,
                valorEmerdog: null,
            },
            {
                tipo: 'orfao_emerdog',
                idEmerdogLocal: 'em-1',
                tutor: 'ANA ELISA F. MORAIS',
                pet: 'OHANA',
                data: '2026-06-16',
                exameEmerdog: 'ALT',
                codigo: 'ELAB-025',
                valorLab: null,
                valorEmerdog: 13.16,
            },
            {
                tipo: 'orfao_lab',
                idLabLocal: 'lab-2',
                tutor: 'OUTRO',
                pet: 'REX',
                data: '2026-06-16',
                exameLaboratorio: 'UREIA',
                codigo: 'ELAB-099',
                valorLab: 10,
                valorEmerdog: null,
            },
        ]
        const scores = pontuarPareamentoExamesIndividuais(cards[0], cards[1])
        expect(ehPareamentoExamePerfeito(scores)).toBe(true)

        const { cards: out, qtdAuto } = autoAprovarPareamentosPerfeitos(cards)
        expect(qtdAuto).toBe(1)
        expect(out.some((c) => c.tipo === 'pareado')).toBe(true)
        expect(out.some((c) => c.idLabLocal === 'lab-1' && c.tipo === 'orfao_lab')).toBe(
            false,
        )
        expect(out.some((c) => c.idLabLocal === 'lab-2')).toBe(true)

        const fila = montarFilaExamesIndividuais(out)
        expect(fila.fila.some((i) => i.idLabLocal === 'lab-1')).toBe(false)
    })
})

describe('parsearValorMonetario', () => {
    it('parseia BR', () => {
        expect(parsearValorMonetario('R$ 1.234,56')).toBeCloseTo(1234.56)
    })
})

describe('motivoComparacaoValor', () => {
    it('OK / parecido (≤ R$ 1,70) / diferente', () => {
        expect(motivoComparacaoValor(50, 50)).toBe('Valor OK')
        expect(motivoComparacaoValor(13.16, 14.86)).toBe('Valor parecido')
        expect(motivoComparacaoValor(50, 51.7)).toBe('Valor parecido')
        expect(motivoComparacaoValor(50, 51.71)).toBe('Valor diferente')
        expect(motivoComparacaoValor(30, 40)).toBe('Valor diferente')
        expect(motivoComparacaoValor(50, null)).toBe(null)
    })
})

describe('montarFilaExamesIndividuais', () => {
    it('cria item por órfão lab e diff', () => {
        const cards = [
            {
                tipo: 'orfao_lab',
                idLabLocal: 'lab-1',
                tutor: 'ANA',
                pet: 'BOLT',
                data: '2026-01-10',
                exameLaboratorio: 'HEMOGRAMA',
                valorLab: 50,
            },
            {
                tipo: 'orfao_emerdog',
                idEmerdogLocal: 'em-1',
                tutor: 'ANA SILVA',
                pet: 'BOLT',
                data: '2026-01-10',
                exameEmerdog: 'HEMOGRAMA COMPLETO',
                valorLab: null,
                valorEmerdog: 55,
            },
            {
                tipo: 'pareado',
                idLabLocal: 'lab-2',
                idEmerdogLocal: 'em-2',
                tutor: 'BOB',
                pet: 'REX',
                data: '2026-01-11',
                exameLaboratorio: 'UREIA',
                exameEmerdog: 'UREIA',
                codigo: 'URE',
                valorLab: 30,
                valorEmerdog: 40,
                valoresDiferem: true,
            },
        ]
        const { fila, totalDiffs, totalOrfaosLab } = montarFilaExamesIndividuais(cards)
        expect(totalOrfaosLab).toBe(1)
        expect(totalDiffs).toBe(1)
        expect(fila.some((i) => i.tipo === 'orfao_lab')).toBe(true)
        expect(fila.some((i) => i.tipo === 'diff_valor')).toBe(true)
        expect(fila.find((i) => i.tipo === 'orfao_lab')?.candidatos?.length).toBeGreaterThan(0)
        expect(fila.find((i) => i.tipo === 'orfao_lab')?.candidatos?.[0]?.motivos).toEqual(
            expect.arrayContaining([expect.stringMatching(/^Valor /)]),
        )
        expect(fila.find((i) => i.tipo === 'diff_valor')?.motivos).toEqual(
            expect.arrayContaining(['Valor diferente']),
        )
    })

    it('badge Valor OK quando lab e plano têm o mesmo valor (valorLab null no plano)', () => {
        const cards = [
            {
                tipo: 'orfao_lab',
                idLabLocal: 'lab-1',
                tutor: 'ADRIANE',
                pet: 'THOMAS',
                data: '2026-06-09',
                exameLaboratorio: 'ALT',
                codigo: 'ELAB-025',
                valorLab: 13.16,
                valorEmerdog: null,
            },
            {
                tipo: 'orfao_emerdog',
                idEmerdogLocal: 'em-1',
                tutor: 'ADRIANE BOLDT',
                pet: 'THOMAS',
                data: '2026-06-09',
                exameEmerdog: 'ALT',
                codigo: 'ELAB-025',
                valorLab: null,
                valorEmerdog: 13.16,
            },
        ]
        const { fila } = montarFilaExamesIndividuais(cards)
        const item = fila.find((i) => i.tipo === 'orfao_lab')
        expect(item?.candidatos?.[0]?.motivos).toEqual(
            expect.arrayContaining(['Valor OK']),
        )
        expect(item?.candidatos?.[0]?.motivos).not.toEqual(
            expect.arrayContaining(['Valor diferente']),
        )
    })
})

describe('matrizDeHtmlTabela', () => {
    it('lê tabela HTML de relatório', () => {
        const html = `<html><table>
          <tr><td>Tutor</td><td>Animal</td><td>Data</td><td>Exame</td></tr>
          <tr><td>Ana</td><td>Thor</td><td>01/08/2026</td><td>ALT</td></tr>
        </table></html>`
        const m = matrizDeHtmlTabela(html)
        expect(m[0]).toEqual(['Tutor', 'Animal', 'Data', 'Exame'])
        expect(m[1][0]).toBe('Ana')
        expect(m[1][3]).toBe('ALT')
    })
})

describe('matrizDeWorksheetXmlXlsx', () => {
    it('resolve shared strings e colunas esparsas', () => {
        const xml = `<worksheet><sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="C1"><v>45812</v></c>
          </row>
        </sheetData></worksheet>`
        const m = matrizDeWorksheetXmlXlsx(xml, ['Tutor'])
        expect(m[0][0]).toBe('Tutor')
        expect(m[0][1]).toBe('')
        expect(m[0][2]).toBe('45812')
    })

    it('não trata shared string vazia como índice 0', () => {
        const xml = `<worksheet><sheetData>
          <row r="2">
            <c r="A2" t="s"><v></v></c>
            <c r="B2" t="s"><v>  </v></c>
          </row>
        </sheetData></worksheet>`
        const m = matrizDeWorksheetXmlXlsx(xml, ['NAO_DEVE_APARECER'])
        expect(m.length).toBe(0)
    })
})

describe('linhaConferenciaTemRegistro', () => {
    it('aceita tutor + exame com nome', () => {
        expect(
            linhaConferenciaTemRegistro({
                tutor: 'Ana Silva',
                pet: 'Thor',
                exame: 'ALT',
            }),
        ).toBe(true)
    })

    it('rejeita linha só com número / placeholder', () => {
        expect(linhaConferenciaTemRegistro({ tutor: '', pet: '', exame: '97' })).toBe(false)
        expect(linhaConferenciaTemRegistro({ tutor: '--', pet: '-', exame: '—' })).toBe(false)
        expect(linhaConferenciaTemRegistro({ tutor: 'Total', pet: '', exame: 'ALT' })).toBe(false)
        expect(linhaConferenciaTemRegistro({ tutor: 'Ana', pet: 'Thor', exame: '' })).toBe(false)
        expect(linhaConferenciaTemRegistro({ tutor: 'Ana', pet: 'Thor', exame: '--' })).toBe(false)
    })
})

describe('preço da negociação zerado', () => {
    const labNome = '.HEMOGRAMA COMPLETO MELLISLAB - Citometria de Fluxo'
    const planoNome = 'Hemograma + Plaquetas'
    const labNorm = normalizarNomeExame(labNome)
    const planoNorm = normalizarNomeExame(planoNome)
    const codigoNorm = normalizarNomeExame('ELAB-035')

    const linhaLab = {
        idLocal: 'lab-1',
        tutor: 'Ana Silva',
        pet: 'Thor',
        data: '2026-08-01',
        exame: labNome,
        exameNorm: labNorm,
        valorRelatorio: 23.4,
    }
    const linhaEm = {
        idLocal: 'em-1',
        tutor: 'Ana Silva',
        pet: 'Thor',
        data: '2026-08-01',
        exame: planoNome,
        exameNorm: planoNorm,
        valorRelatorio: 0,
    }
    const resolvidos = new Map([
        [
            labNorm,
            {
                nomeLab: labNome,
                nomeEmerdog: planoNome,
                status: 'mapeado_manualmente_confirmado',
            },
        ],
    ])

    it('precoNegociacaoUtil ignora 0 e usa o código', () => {
        const mapa = new Map([
            [planoNorm, 0],
            [codigoNorm, 18.75],
        ])
        expect(precoNegociacaoUtil(mapa, planoNome)).toBe(null)
        expect(precoNegociacaoUtil(mapa, planoNome, 'ELAB-035')).toBe(18.75)
    })

    it('preenche R$ 18,75 no plano quando o nome está zerado e o código tem preço', () => {
        const cards = montarCardsConferencia({
            linhasLab: [linhaLab],
            linhasEmerdog: [linhaEm],
            resolvidosMapeamento: resolvidos,
            precosPorNomeNorm: new Map([
                [planoNorm, 0],
                [codigoNorm, 18.75],
            ]),
            codigoPorNomeNorm: new Map([
                [planoNorm, 'ELAB-035'],
                [labNorm, 'ELAB-035'],
            ]),
            nomeSistemaPorNorm: new Map([[planoNorm, planoNome]]),
        })
        const par = cards.find((c) => c.tipo === 'pareado')
        expect(par).toBeTruthy()
        expect(par.valorEmerdog).toBe(18.75)
        expect(par.codigo).toBe('ELAB-035')
    })

    it('corrige grupo da comparação que ainda veio com R$ 0,00', () => {
        const grupos = agruparCardsComparacaoPorAtendimento([
            {
                tipo: 'pareado',
                idLocal: 'c1',
                idLabLocal: 'lab-1',
                idEmerdogLocal: 'em-1',
                tutor: 'Ana Silva',
                pet: 'Thor',
                data: '2026-08-01',
                exameLaboratorio: labNome,
                exameEmerdog: planoNome,
                nomeNegociacao: planoNome,
                codigo: 'ELAB-035',
                valorLab: 23.4,
                valorEmerdog: 0,
                diferenca: 23.4,
                valoresDiferem: true,
                status: 'pendente',
            },
        ])
        const out = preencherPrecosZeroNosGruposComparacao(
            grupos,
            new Map([[codigoNorm, 18.75]]),
        )
        expect(out[0].examesEm[0].valor).toBe(18.75)
        expect(out[0].subtotalEm).toBe(18.75)
    })
})

describe('marcar conferido no atendimento', () => {
    it('atendimento sai das diferenças quando o único diff foi conferido', () => {
        const cards = [
            {
                tipo: 'pareado',
                idLocal: 'c1',
                idLabLocal: 'lab-1',
                idEmerdogLocal: 'em-1',
                tutor: 'Ana Silva',
                pet: 'Thor',
                data: '2026-08-01',
                exameLaboratorio: 'ALT',
                exameEmerdog: 'ALT',
                valorLab: 13.16,
                valorEmerdog: 13.16,
                valoresDiferem: false,
                status: 'verde',
            },
            {
                tipo: 'pareado',
                idLocal: 'c2',
                idLabLocal: 'lab-2',
                idEmerdogLocal: 'em-2',
                tutor: 'Ana Silva',
                pet: 'Thor',
                data: '2026-08-01',
                exameLaboratorio: '.HEMOGRAMA COMPLETO',
                exameEmerdog: 'Hemograma + Plaquetas',
                codigo: 'ELAB-035',
                valorLab: 23.4,
                valorEmerdog: 18.75,
                valoresDiferem: true,
                status: 'conferido_manual',
            },
        ]
        const grupos = agruparCardsComparacaoPorAtendimento(cards)
        expect(grupos).toHaveLength(1)
        expect(grupos[0].temDiff).toBe(false)
        expect(grupos[0].status).toBe('conferido_manual')
        expect(cardTemDiffPendente(cards[1])).toBe(false)
        expect(
            mesmoCardConferencia(cards[1], {
                idLabLocal: 'lab-2',
                idEmerdogLocal: 'em-2',
            }),
        ).toBe(true)
    })
})
