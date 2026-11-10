import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'))
const rewrites = config.rewrites
const indice = (fn) => rewrites.findIndex(fn)
const fallback = indice((r) => r.source === '/((?!api/|email/).*)')

describe('vercel.json: reescritas da API v1', () => {
    it('reescreve /api/v1/:path* para a função de e-mail', () => {
        const i = indice((r) => r.source === '/api/v1/:path*')
        expect(i).toBeGreaterThanOrEqual(0)
        expect(rewrites[i].destination).toBe('/api/email?_fn=api-v1&_path=:path*')
        expect(i).toBeLessThan(fallback)
    })

    it('reescreve /v1/:path* só no host api.emerlab.com.br', () => {
        const i = indice((r) => r.source === '/v1/:path*')
        expect(i).toBeGreaterThanOrEqual(0)
        expect(rewrites[i].has).toEqual([{ type: 'host', value: 'api.emerlab.com.br' }])
        expect(rewrites[i].destination).toBe('/api/email?_fn=api-v1&_path=:path*')
        expect(i).toBeLessThan(fallback)
    })

    it('serve a documentação em /docs e / no host da API', () => {
        for (const source of ['/docs', '/']) {
            const i = indice((r) => r.source === source)
            expect(i).toBeGreaterThanOrEqual(0)
            expect(rewrites[i].has).toEqual([{ type: 'host', value: 'api.emerlab.com.br' }])
            expect(rewrites[i].destination).toBe('/api-docs/index.html')
            expect(i).toBeLessThan(fallback)
        }
    })
})
