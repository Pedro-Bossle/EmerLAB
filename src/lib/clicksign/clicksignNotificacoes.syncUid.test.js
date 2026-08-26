import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map()

vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
        store.set(String(k), String(v))
    },
    removeItem: (k) => {
        store.delete(String(k))
    },
    clear: () => store.clear(),
})

vi.mock('../supabase.js', () => ({
    supabase: {
        auth: {
            getUser: vi.fn(),
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn().mockReturnThis(),
            upsert: vi.fn().mockResolvedValue({ error: null }),
        })),
    },
}))

import { supabase } from '../supabase.js'
import { sincronizarNotificacoesClicksign } from './clicksignNotificacoes.js'

describe('sincronizarNotificacoesClicksign — UID estável', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('usa só o UID inicial se a sessão mudar a meio do sync', async () => {
        let getUserCalls = 0
        supabase.auth.getUser.mockImplementation(async () => {
            getUserCalls += 1
            return {
                data: {
                    user: { id: getUserCalls === 1 ? 'uid-inicio' : 'uid-depois' },
                },
            }
        })

        store.set(
            'emerdog_clicksign_notificacoes_v2:uid-inicio',
            JSON.stringify([{ id: 'n1', texto: 'pré', envelopeId: 'e1', at: '2026-01-01T00:00:00.000Z' }]),
        )

        const clickReq = vi.fn(async (method, path) => {
            // Simula transição de sessão após o 1.º pedido à API
            if (getUserCalls === 1) {
                await supabase.auth.getUser()
            }
            if (String(path).includes('/envelopes') && !String(path).includes('/documents')) {
                return { ok: true, data: { data: [], meta: { record_count: 0 } } }
            }
            return { ok: true, data: { data: [] } }
        })

        const out = await sincronizarNotificacoesClicksign(clickReq)

        expect(store.has('emerdog_clicksign_notif_snapshot_v2:uid-inicio')).toBe(true)
        expect(store.has('emerdog_clicksign_notif_snapshot_v2:uid-depois')).toBe(false)
        expect(store.get('emerdog_clicksign_notificacoes_v2:uid-inicio')).toContain('pré')
        expect(store.has('emerdog_clicksign_notificacoes_v2:uid-depois')).toBe(false)
        expect(out.lista.some((n) => n.id === 'n1')).toBe(true)
        // getUser: 1 no início do sync + 1 forçado no clickReq (sessão muda); helpers não voltam a resolver
        expect(getUserCalls).toBe(2)
    })
})
