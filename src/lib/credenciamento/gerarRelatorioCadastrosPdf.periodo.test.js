import { describe, expect, it } from 'vitest'
import {
    isoReferenciaPeriodoRelatorioCadastros,
    montarLinhasRelatorioCadastros,
} from './gerarRelatorioCadastrosPdf.js'

const situacoes = [
    { id: 1, descricao: 'Preenchendo Formulários' },
    { id: 2, descricao: 'Aguardando OK minuta' },
    { id: 3, descricao: 'Aguardando assinatura minuta' },
    { id: 4, descricao: 'Credenciado' },
    { id: 5, descricao: 'Cancelado' },
]

describe('montarLinhasRelatorioCadastros — período', () => {
    it('inclui não credenciado pela data_atualizacao no período (fallback)', () => {
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 99,
                    nome: 'Clínica Nova',
                    situacao_id: 2,
                    especialidade_id: 1,
                    credenciado_em: null,
                    data_cadastro: '2025-01-10T14:00:00.000Z',
                    data_atualizacao: '2026-08-31T14:00:00.000Z',
                },
            ],
            situacoes,
            especialidades: [{ id: 1, nome: 'Clínica' }],
            cidadesCred: [],
            periodoDe: '2026-08-31',
            periodoAte: '2026-08-31',
            situacaoIds: [2],
        })
        expect(linhas).toHaveLength(1)
        expect(linhas[0].nome).toBe('Clínica Nova')
    })

    it('exclui não credenciado fora do período de data_atualizacao', () => {
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 99,
                    nome: 'Antigo',
                    situacao_id: 2,
                    especialidade_id: 1,
                    data_cadastro: '2025-01-15T10:00:00.000Z',
                    data_atualizacao: '2026-01-15T10:00:00.000Z',
                },
            ],
            situacoes,
            especialidades: [{ id: 1, nome: 'Clínica' }],
            periodoDe: '2026-08-31',
            periodoAte: '2026-08-31',
            situacaoIds: [2],
        })
        expect(linhas).toHaveLength(0)
    })

    it('usa data da auditoria ao entrar na situação atual', () => {
        const mapa = new Map([['50|5', '2026-08-20T12:00:00.000Z']])
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 50,
                    nome: 'Cancelado recente',
                    situacao_id: 5,
                    especialidade_id: 1,
                    data_cadastro: '2024-03-01T10:00:00.000Z',
                    data_atualizacao: '2026-09-01T10:00:00.000Z',
                },
            ],
            situacoes,
            especialidades: [{ id: 1, nome: 'Clínica' }],
            periodoDe: '2026-08-01',
            periodoAte: '2026-08-31',
            situacaoIds: [5],
            mapaDataHoraPorPrestadorSituacao: mapa,
        })
        expect(linhas).toHaveLength(1)
        expect(linhas[0].situacao).toBe('Cancelado')
    })

    it('inclui aguardando assinatura quando a auditoria cai no período', () => {
        const mapa = new Map([['77|3', '2026-08-15T09:00:00.000Z']])
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 77,
                    nome: 'Assinatura minuta',
                    situacao_id: 3,
                    especialidade_id: 1,
                    data_cadastro: '2025-06-01T10:00:00.000Z',
                    data_atualizacao: '2026-08-15T09:00:00.000Z',
                },
            ],
            situacoes,
            especialidades: [{ id: 1, nome: 'Clínica' }],
            periodoDe: '2026-08-01',
            periodoAte: '2026-08-31',
            situacaoIds: [2, 3, 5],
            mapaDataHoraPorPrestadorSituacao: mapa,
        })
        expect(linhas).toHaveLength(1)
        expect(linhas[0].situacao).toMatch(/assinatura/i)
    })

    it('credenciado continua filtrado por credenciado_em', () => {
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 1,
                    nome: 'Vet OK',
                    situacao_id: 4,
                    especialidade_id: 1,
                    credenciado_em: '2026-08-31T18:00:00.000Z',
                    data_cadastro: '2026-01-01T10:00:00.000Z',
                },
            ],
            situacoes,
            especialidades: [{ id: 1, nome: 'Clínica' }],
            periodoDe: '2026-08-31',
            periodoAte: '2026-08-31',
            situacaoIds: [4],
        })
        expect(linhas).toHaveLength(1)
    })
})

describe('isoReferenciaPeriodoRelatorioCadastros', () => {
    it('prioriza auditoria sobre data_atualizacao para não credenciado', () => {
        const iso = isoReferenciaPeriodoRelatorioCadastros(
            {
                id: 9,
                situacao_id: 2,
                data_cadastro: '2024-01-01T00:00:00.000Z',
                data_atualizacao: '2026-09-01T00:00:00.000Z',
            },
            situacoes,
            new Map([['9|2', '2026-08-10T00:00:00.000Z']]),
        )
        expect(iso).toBe('2026-08-10T00:00:00.000Z')
    })
})
