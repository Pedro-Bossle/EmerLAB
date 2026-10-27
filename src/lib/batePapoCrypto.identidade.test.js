import { describe, expect, it } from 'vitest'
import {
    gerarNovoParChaves,
    parDaIdentidade,
    privadaCorrespondePublica,
    publicaDaIdentidade,
} from './batePapoCrypto.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function cifrarComPublica(publicKey, texto) {
    return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, encoder.encode(texto))
}

describe('identidade local do Emerzap', () => {
    it('par da chave legada (JWK) cifra e decifra', async () => {
        const { privJwk } = await gerarNovoParChaves()
        const par = await parDaIdentidade({ privJwk })
        const cifrado = await cifrarComPublica(par.publicKey, 'olá')
        const claro = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, par.privateKey, cifrado)
        expect(decoder.decode(claro)).toBe('olá')
    })

    it('identidade protegida usa CryptoKey não exportável e continua decifrando', async () => {
        const { privJwk, publicJwk } = await gerarNovoParChaves()
        const privateKey = await crypto.subtle.importKey(
            'jwk',
            privJwk,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            false,
            ['decrypt'],
        )
        const identidade = { privateKey, publicJwk }

        await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toThrow()

        const par = await parDaIdentidade(identidade)
        expect(par.privJwk).toBeNull()
        const cifrado = await cifrarComPublica(par.publicKey, 'mensagem')
        const claro = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, par.privateKey, cifrado)
        expect(decoder.decode(claro)).toBe('mensagem')
    })

    it('publicaDaIdentidade compara com a pública da conta nos dois formatos', async () => {
        const { privJwk, publicJwk } = await gerarNovoParChaves()
        expect(privadaCorrespondePublica(publicaDaIdentidade({ privJwk }), publicJwk)).toBe(true)
        expect(privadaCorrespondePublica(publicaDaIdentidade({ privateKey: {}, publicJwk }), publicJwk)).toBe(true)
        expect(publicaDaIdentidade(null)).toBeNull()
    })
})
