import { describe, expect, it } from 'vitest'
import { montarLinhasRelatorioCadastros } from './gerarRelatorioCadastrosPdf.js'

const situacoes = [
    { id: 1, descricao: 'Preenchendo Formulários' },
    { id: 2, descricao: 'Aguardando OK minuta' },
    { id: 4, descricao: 'Credenciado' },
]

describe('montarLinhasRelatorioCadastros — período', () => {
    it('inclui cadastro não credenciado pela data_cadastro no período', () => {
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 99,
                    nome: 'Clínica Nova',
                    situacao_id: 2,
                    especialidade_id: 1,
                    credenciado_em: null,
                    data_cadastro: '2026-08-31T14:00:00.000Z',
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

    it('exclui não credenciado fora do período de data_cadastro', () => {
        const linhas = montarLinhasRelatorioCadastros({
            prestadores: [
                {
                    id: 99,
                    nome: 'Antigo',
                    situacao_id: 2,
                    especialidade_id: 1,
                    data_cadastro: '2026-01-15T10:00:00.000Z',
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
