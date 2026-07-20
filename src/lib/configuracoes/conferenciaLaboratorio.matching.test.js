import { describe, expect, it } from 'vitest'
import {
    aliasesPessoaDePareamento,
    alinharExamesLabAoCodigoDoPlano,
    autoAprovarPareamentosPerfeitos,
    ehPareamentoExamePerfeito,
    montarFilaExamesIndividuais,
    montarMapasAliasesPessoa,
    motivoComparacaoValor,
    pontuarPareamentoExamesIndividuais,
    scorePareamentoExame,
    scoreSimilaridadeNome,
} from './conferenciaLaboratorio.js'
import { parsearValorMonetario } from './conferenciaLaboratorioExcel.js'

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
