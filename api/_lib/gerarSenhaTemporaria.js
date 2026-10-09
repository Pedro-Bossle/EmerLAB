/**
 * Senha aleatória para convite (só servidor — usa node:crypto).
 */
import { randomBytes } from 'node:crypto'
import {
    PASSWORD_MIN_LENGTH,
    TEMP_PASSWORD_LENGTH,
    validarPoliticaSenha,
} from '../../src/lib/passwordPolicy.js'

/**
 * @param {number} [tamanho]
 * @returns {string}
 */
export function gerarSenhaTemporaria(tamanho = TEMP_PASSWORD_LENGTH) {
    const len = Math.max(PASSWORD_MIN_LENGTH, Number(tamanho) || TEMP_PASSWORD_LENGTH)
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const nums = '23456789'
    const chars = [...letras, ...nums]
    const bytes = randomBytes(len + 8)
    const out = []
    out.push(letras[bytes[0] % letras.length])
    out.push(nums[bytes[1] % nums.length])
    for (let i = 2; i < len; i += 1) {
        out.push(chars[bytes[i] % chars.length])
    }
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = bytes[len + (i % 8)] % (i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    const senha = out.join('')
    const check = validarPoliticaSenha(senha)
    if (!check.ok) {
        return `${letras[bytes[0] % letras.length]}${nums[bytes[1] % nums.length]}${senha}`.slice(
            0,
            len,
        )
    }
    return senha
}
