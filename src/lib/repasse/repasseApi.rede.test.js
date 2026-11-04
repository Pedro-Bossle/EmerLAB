import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MSG_SEM_CONEXAO, publicoAprovar, publicoLer } from './repasseApi.js'

const resposta = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo })

describe('falha de rede na página do prestador', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('leitura repete e se recupera quando a rede volta', async () => {
        const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(resposta({ ok: true, relatorio: { x: 1 } }))
        vi.stubGlobal('fetch', f)
        const p = publicoLer('tok')
        await vi.advanceTimersByTimeAsync(5000)
        await expect(p).resolves.toMatchObject({ ok: true })
        expect(f).toHaveBeenCalledTimes(3)
    })

    it('sem rede de vez: mensagem em português (não «Failed to fetch») marcada como erro de rede', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
        const p = publicoLer('tok')
        const visto = p.catch((e) => e)
        await vi.advanceTimersByTimeAsync(5000)
        const e = await visto
        expect(e.message).toBe(MSG_SEM_CONEXAO)
        expect(e.rede).toBe(true)
        expect(e.message).not.toMatch(/failed to fetch/i)
    })

    it('ação que muda dado (aprovar) não é repetida sozinha', async () => {
        const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
        vi.stubGlobal('fetch', f)
        const visto = publicoAprovar('tok').catch((e) => e)
        await vi.advanceTimersByTimeAsync(5000)
        expect((await visto).rede).toBe(true)
        expect(f).toHaveBeenCalledTimes(1)
    })

    it('resposta HTTP de erro continua com a mensagem do servidor', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta({ ok: false, error: 'Link inválido ou vencido.' }, 404)))
        await expect(publicoLer('tok')).rejects.toThrow('Link inválido ou vencido.')
    })
})
