import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn(async () => ({
    data: {
        session: {
            access_token: 'tok',
            refresh_token: 'ref',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
    },
}))
const refreshSession = vi.fn(async () => ({ data: { session: null } }))

vi.mock('../supabase.js', () => ({
    supabase: { auth: { getSession: (...a) => getSession(...a), refreshSession: (...a) => refreshSession(...a) } },
}))

const resp = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('clicksignRequest: recuo em 429 e sessão compartilhada', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.useFakeTimers()
        getSession.mockClear()
        refreshSession.mockClear()
    })

    afterEach(async () => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        const { limparCacheClicksign } = await import('./clicksignClient.js')
        limparCacheClicksign()
    })

    it('espera e repete em 429, devolvendo o sucesso sem erro', async () => {
        const f = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(resp(429, { ok: false, origem: 'clicksign', retryAfterSec: 2 }))
            .mockResolvedValueOnce(resp(200, { data: [] }))
        const { clicksignRequest } = await import('./clicksignClient.js')
        const p = clicksignRequest('GET', '/envelopes?page[number]=1')
        await vi.advanceTimersByTimeAsync(5000)
        const r = await p
        expect(r.ok).toBe(true)
        expect(f).toHaveBeenCalledTimes(2)
    })

    it('desiste depois de 3 tentativas e devolve o 429', async () => {
        const f = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () => resp(429, { ok: false, origem: 'emerlab', retryAfterSec: 2 }))
        const { clicksignRequest } = await import('./clicksignClient.js')
        const p = clicksignRequest('GET', '/envelopes?page[number]=2')
        await vi.advanceTimersByTimeAsync(30_000)
        const r = await p
        expect(r.status).toBe(429)
        expect(f).toHaveBeenCalledTimes(3)
    })

    it('chamadas simultâneas leem a sessão uma única vez', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => resp(200, { data: [] }))
        const { clicksignRequest, limparCacheClicksign } = await import('./clicksignClient.js')
        limparCacheClicksign()
        const ps = [
            clicksignRequest('GET', '/envelopes?a=1'),
            clicksignRequest('GET', '/envelopes?a=2'),
            clicksignRequest('GET', '/envelopes?a=3'),
        ]
        await vi.advanceTimersByTimeAsync(3000)
        const out = await Promise.all(ps)
        expect(out.every((r) => r.ok)).toBe(true)
        expect(refreshSession).not.toHaveBeenCalled()
    })
})
