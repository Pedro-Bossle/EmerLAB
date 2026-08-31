import { describe, expect, it } from 'vitest'
import {
    auditLogNovaSituacaoId,
    auditLogTransicaoParaCredenciado,
    mapaUsuarioAlteracaoSituacaoViaAuditoria,
    mapaUsuarioPrestadorViaAuditoria,
} from './gerarRelatorioCadastrosPdf.js'

const IDS_CRED = new Set([4])

describe('mapaUsuarioAlteracaoSituacaoViaAuditoria', () => {
    it('prioriza transição para credenciado sobre CREATE na chave por situação', () => {
        const logs = [
            {
                data_hora: '2026-01-10T12:00:00Z',
                acao: 'CREATE',
                registro_id: 10,
                usuario_id: 'u-create',
                usuario_nome: 'Ana',
                valor_novo: { situacao_id: 1 },
                valor_antigo: null,
            },
            {
                data_hora: '2026-02-01T12:00:00Z',
                acao: 'UPDATE',
                registro_id: 10,
                usuario_id: 'u-cred',
                usuario_nome: 'Bruno',
                valor_antigo: { situacao_id: 2 },
                valor_novo: { situacao_id: 4 },
            },
        ]
        const { mapaUsuarioIdPorPrestadorId, mapaUsuarioIdPorPrestadorSituacao } =
            mapaUsuarioAlteracaoSituacaoViaAuditoria(logs)
        expect(mapaUsuarioIdPorPrestadorId.get(10)).toBe('u-cred')
        expect(mapaUsuarioIdPorPrestadorSituacao.get('10|4')).toBe('u-cred')
        expect(mapaUsuarioIdPorPrestadorSituacao.get('10|1')).toBe('u-create')
    })

    it('regista quem moveu para situação não credenciada', () => {
        const logs = [
            {
                data_hora: '2026-03-01T12:00:00Z',
                acao: 'UPDATE',
                registro_id: 7,
                usuario_id: 'u-minuta',
                usuario_nome: 'Diana',
                valor_antigo: { situacao_id: 1 },
                valor_novo: { situacao_id: 3 },
            },
        ]
        const { mapaUsuarioIdPorPrestadorSituacao } = mapaUsuarioAlteracaoSituacaoViaAuditoria(logs)
        expect(mapaUsuarioIdPorPrestadorSituacao.get('7|3')).toBe('u-minuta')
    })

    it('ignora UPDATE que não alterou situacao_id', () => {
        const logs = [
            {
                data_hora: '2026-03-02T12:00:00Z',
                acao: 'UPDATE',
                registro_id: 8,
                usuario_id: 'u-nome',
                usuario_nome: 'Edu',
                valor_antigo: { situacao_id: 2, nome: 'A' },
                valor_novo: { situacao_id: 2, nome: 'B' },
            },
            {
                data_hora: '2026-03-01T12:00:00Z',
                acao: 'UPDATE',
                registro_id: 8,
                usuario_id: 'u-sit',
                usuario_nome: 'Fábio',
                valor_antigo: { situacao_id: 1 },
                valor_novo: { situacao_id: 2 },
            },
        ]
        const { mapaUsuarioIdPorPrestadorId } = mapaUsuarioAlteracaoSituacaoViaAuditoria(logs)
        expect(mapaUsuarioIdPorPrestadorId.get(8)).toBe('u-sit')
    })
})

describe('mapaUsuarioPrestadorViaAuditoria (legado)', () => {
    it('delega para mapa por alteração de situação', () => {
        const logs = [
            {
                data_hora: '2026-02-01T12:00:00Z',
                acao: 'UPDATE',
                registro_id: 5,
                usuario_id: 'u-audit',
                usuario_nome: 'Carla',
                valor_antigo: { situacao_id: 2 },
                valor_novo: { situacao_id: 4 },
            },
        ]
        const { mapaUsuarioIdPorPrestadorId } = mapaUsuarioPrestadorViaAuditoria(logs, IDS_CRED, new Set([5]))
        expect(mapaUsuarioIdPorPrestadorId.get(5)).toBe('u-audit')
    })
})

describe('auditLogTransicaoParaCredenciado', () => {
    it('detecta mudança para situação credenciada', () => {
        expect(
            auditLogTransicaoParaCredenciado(
                {
                    acao: 'UPDATE',
                    valor_antigo: { situacao_id: 1 },
                    valor_novo: { situacao_id: 4 },
                },
                IDS_CRED,
            ),
        ).toBe(true)
    })
})

describe('auditLogNovaSituacaoId', () => {
    it('retorna null quando situacao_id não mudou', () => {
        expect(
            auditLogNovaSituacaoId({
                acao: 'UPDATE',
                valor_antigo: { situacao_id: 2 },
                valor_novo: { situacao_id: 2 },
            }),
        ).toBe(null)
    })
})
