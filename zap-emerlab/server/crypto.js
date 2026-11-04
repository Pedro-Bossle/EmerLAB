// Hash de senha (scrypt) e token de sessão assinado (HMAC-SHA256), só com node:crypto
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

const SCRYPT_N = 16384

export function hashSenha(senha) {
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(String(senha), salt, 64, { N: SCRYPT_N })
    return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function conferirSenha(senha, armazenado) {
    const [alg, n, saltB64, hashB64] = String(armazenado || '').split('$')
    if (alg !== 'scrypt' || !saltB64 || !hashB64) return false
    const esperado = Buffer.from(hashB64, 'base64url')
    const calc = crypto.scryptSync(String(senha), Buffer.from(saltB64, 'base64url'), esperado.length, { N: Number(n) || SCRYPT_N })
    return crypto.timingSafeEqual(esperado, calc)
}

export function compararSeguro(a, b) {
    const ba = Buffer.from(String(a))
    const bb = Buffer.from(String(b))
    if (ba.length !== bb.length) return false
    return crypto.timingSafeEqual(ba, bb)
}

export const segredoAleatorio = () => crypto.randomBytes(24).toString('base64url')

// resumo curto de um valor (ex.: senha_hash) para amarrar um token ao estado atual dele
export const impressao = (valor) => crypto.createHash('sha256').update(String(valor)).digest('base64url').slice(0, 16)

function assinar(dados, segredo) {
    return crypto.createHmac('sha256', segredo).update(dados).digest('base64url')
}

export function criarToken(payload, segredo) {
    const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${corpo}.${assinar(corpo, segredo)}`
}

export function lerToken(token, segredo) {
    const [corpo, assinatura] = String(token || '').split('.')
    if (!corpo || !assinatura) return null
    if (!compararSeguro(assinatura, assinar(corpo, segredo))) return null
    try {
        const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'))
        if (!payload.exp || payload.exp < Date.now()) return null
        return payload
    } catch {
        return null
    }
}

// Cifra simétrica (AES-256-GCM) para segredos guardados no banco, como o refresh token da Microsoft.
// Formato: v1.<iv>.<tag>.<dados> (base64url). A chave é qualquer texto longo; vira 32 bytes por SHA-256.
const chaveAes = (segredo) => crypto.createHash('sha256').update(String(segredo)).digest()

export function cifrar(texto, segredo) {
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', chaveAes(segredo), iv)
    const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
    return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${dados.toString('base64url')}`
}

export function decifrar(valor, segredo) {
    const [v, iv, tag, dados] = String(valor || '').split('.')
    if (v !== 'v1' || !iv || !tag || !dados) return null
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', chaveAes(segredo), Buffer.from(iv, 'base64url'))
        d.setAuthTag(Buffer.from(tag, 'base64url'))
        return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8')
    } catch {
        return null
    }
}
