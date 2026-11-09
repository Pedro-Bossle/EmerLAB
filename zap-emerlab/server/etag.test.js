import { describe, it, expect } from 'vitest'
import { enviarComEtag, etagDe, etagConfere } from './etag.js'

function resFalsa() {
    const h = {}
    return {
        statusCode: 0,
        h,
        corpo: undefined,
        setHeader(k, v) {
            h[k.toLowerCase()] = v
        },
        end(c) {
            this.corpo = c
        },
    }
}

describe('ETag das respostas de polling', () => {
    it('primeira consulta: 200 com corpo, ETag e cache privado que revalida', () => {
        const res = resFalsa()
        enviarComEtag({ headers: {} }, res, { conversas: [1, 2] })
        expect(res.statusCode).toBe(200)
        expect(res.corpo).toBe(JSON.stringify({ conversas: [1, 2] }))
        expect(res.h.etag).toBe(etagDe(JSON.stringify({ conversas: [1, 2] })))
        expect(res.h['cache-control']).toBe('private, no-cache')
        expect(res.h.vary).toBe('Cookie')
    })

    it('mesma versão no If-None-Match: 304 sem corpo', () => {
        const etag = etagDe(JSON.stringify({ a: 1 }))
        const res = resFalsa()
        enviarComEtag({ headers: { 'if-none-match': etag } }, res, { a: 1 })
        expect(res.statusCode).toBe(304)
        expect(res.corpo).toBeUndefined()
    })

    it('conteúdo mudou: 200 com corpo novo mesmo com ETag antigo', () => {
        const antigo = etagDe(JSON.stringify({ a: 1 }))
        const res = resFalsa()
        enviarComEtag({ headers: { 'if-none-match': antigo } }, res, { a: 2 })
        expect(res.statusCode).toBe(200)
        expect(res.corpo).toBe(JSON.stringify({ a: 2 }))
    })

    it('If-None-Match com vários valores e com *', () => {
        const e = etagDe('x')
        expect(etagConfere(`W/"outro", ${e}`, e)).toBe(true)
        expect(etagConfere('*', e)).toBe(true)
        expect(etagConfere('W/"outro"', e)).toBe(false)
        expect(etagConfere(undefined, e)).toBe(false)
    })

    it('corpo vazio/nulo vira {}', () => {
        const res = resFalsa()
        enviarComEtag({ headers: {} }, res, null)
        expect(res.corpo).toBe('{}')
    })
})
