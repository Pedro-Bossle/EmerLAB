import { describe, expect, it } from 'vitest'
import {
    auditLogTransicaoParaCredenciado,
    mapaUsuarioPrestadorViaAuditoria,
} from './gerarRelatorioCadastrosPdf.js'

const IDS_CRED = new Set([4])

describe('mapaUsuarioPrestadorViaAuditoria', () => {
    it('prioriza transição para credenciado sobre CREATE', () => {
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
        const { mapaUsuarioIdPorPrestadorId } = mapaUsuarioPrestadorViaAuditoria(logs, IDS_CRED)
        expect(mapaUsuarioIdPorPrestadorId.get(10)).toBe('u-cred')
    })

    it('não sobrescreve prestador já resolvido pelo Kanban', () => {
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
        const kanban = new Set([5])
        const { mapaUsuarioIdPorPrestadorId } = mapaUsuarioPrestadorViaAuditoria(
            logs,
            IDS_CRED,
            kanban,
        )
        expect(mapaUsuarioIdPorPrestadorId.has(5)).toBe(false)
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
