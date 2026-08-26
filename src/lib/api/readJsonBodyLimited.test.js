import { describe, expect, it } from 'vitest'
import { readJsonBodyLimited } from '../api/serverAuth.js'

function reqComBody(body) {
    return { body, headers: {} }
}

describe('readJsonBodyLimited', () => {
    it('aceita objeto válido', async () => {
        const out = await readJsonBodyLimited(reqComBody({ action: 'list' }))
        expect(out).toEqual({ action: 'list' })
    })

    it('normaliza null / array / primitivo para {}', async () => {
        expect(await readJsonBodyLimited(reqComBody(null))).toEqual({})
        expect(await readJsonBodyLimited(reqComBody([1, 2]))).toEqual({})
        expect(await readJsonBodyLimited(reqComBody('"x"'))).toEqual({})
        expect(await readJsonBodyLimited(reqComBody('null'))).toEqual({})
        expect(await readJsonBodyLimited(reqComBody('[1]'))).toEqual({})
        expect(await readJsonBodyLimited(reqComBody(Buffer.from('42')))).toEqual({})
    })
})
