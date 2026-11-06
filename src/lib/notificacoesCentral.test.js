import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.js', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }))

const {
    agruparNotificacoes,
    rotuloAcessivelSino,
    rotuloTempoRelativo,
    tipoDeEventoContrato,
    tipoDeEventoPagamento,
    lerDispensados,
    dispensarNotificacao,
} = await import('./notificacoesCentral.js')

describe('rotuloTempoRelativo', () => {
    const agora = new Date('2026-11-06T12:00:00Z').getTime()
    it('descreve a idade do aviso em português', () => {
        expect(rotuloTempoRelativo(agora - 20_000, agora)).toBe('agora')
        expect(rotuloTempoRelativo(agora - 5 * 60_000, agora)).toBe('há 5 min')
        expect(rotuloTempoRelativo(agora - 3 * 3_600_000, agora)).toBe('há 3 h')
        expect(rotuloTempoRelativo(agora - 30 * 3_600_000, agora)).toBe('ontem')
        expect(rotuloTempoRelativo(agora - 4 * 86_400_000, agora)).toBe('há 4 dias')
    })
    it('aceita data ISO e tolera valor inválido', () => {
        expect(rotuloTempoRelativo('2026-11-06T11:55:00Z', agora)).toBe('há 5 min')
        expect(rotuloTempoRelativo(null, agora)).toBe('')
        expect(rotuloTempoRelativo('lixo', agora)).toBe('')
    })
})

describe('tipos de aviso', () => {
    it('mapeia eventos da Clicksign', () => {
        expect(tipoDeEventoContrato('sign')).toBe('assinou')
        expect(tipoDeEventoContrato('refusal')).toBe('recusou')
        expect(tipoDeEventoContrato('close')).toBe('concluido')
        expect(tipoDeEventoContrato('auto_close')).toBe('concluido')
        expect(tipoDeEventoContrato('cancel')).toBe('cancelado')
        expect(tipoDeEventoContrato('deadline')).toBe('prazo')
        expect(tipoDeEventoContrato('algo_novo')).toBe('generico')
    })
    it('mapeia eventos de repasse', () => {
        expect(tipoDeEventoPagamento('aprovado')).toBe('aprovou')
        expect(tipoDeEventoPagamento('reprovado')).toBe('reprovou')
        expect(tipoDeEventoPagamento('documento_enviado')).toBe('nota')
        expect(tipoDeEventoPagamento('x')).toBe('generico')
    })
})

describe('agruparNotificacoes', () => {
    it('agrupa na ordem fixa e ordena do mais novo para o mais antigo', () => {
        const itens = [
            { id: 'p1', fonte: 'pagamentos', at: 10 },
            { id: 'c1', fonte: 'contratos', at: 5 },
            { id: 'c2', fonte: 'contratos', at: 9 },
        ]
        const g = agruparNotificacoes(itens)
        expect(g.map((x) => x.id)).toEqual(['contratos', 'pagamentos'])
        expect(g[0].itens.map((i) => i.id)).toEqual(['c2', 'c1'])
    })
    it('omite grupos vazios', () => {
        expect(agruparNotificacoes([])).toEqual([])
    })
})

describe('rotuloAcessivelSino', () => {
    it('concorda o plural', () => {
        expect(rotuloAcessivelSino(0)).toBe('Notificações, nenhum aviso')
        expect(rotuloAcessivelSino(1)).toBe('Notificações, 1 aviso')
        expect(rotuloAcessivelSino(4)).toBe('Notificações, 4 avisos')
    })
})

describe('ids dispensados (Formulário e Pagamentos)', () => {
    it('lê vazio quando não há armazenamento', () => {
        const d = lerDispensados('u1')
        expect(d.formulario.size).toBe(0)
        expect(d.pagamentos.size).toBe(0)
    })

    it('guarda por usuário e fonte', async () => {
        const mem = new Map()
        vi.stubGlobal('localStorage', {
            getItem: (k) => (mem.has(k) ? mem.get(k) : null),
            setItem: (k, v) => mem.set(k, String(v)),
        })
        // sem usuário logado o id vai para o balde «anon»
        await dispensarNotificacao({ fonte: 'formulario', refId: 'abc' })
        await dispensarNotificacao({ fonte: 'pagamentos', refId: '42' })
        const d = lerDispensados(null)
        expect([...d.formulario]).toEqual(['abc'])
        expect([...d.pagamentos]).toEqual(['42'])
        expect(lerDispensados('outro').formulario.size).toBe(0)
        vi.unstubAllGlobals()
    })
})
