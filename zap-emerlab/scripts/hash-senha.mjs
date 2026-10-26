// Gera o hash de uma senha (para inserir um usuário direto no banco, se precisar)
// Uso: npm run hash-senha -- "minha senha"
import { hashSenha } from '../server/crypto.js'

const senha = process.argv[2]
if (!senha) {
    console.error('Uso: npm run hash-senha -- "senha"')
    process.exit(1)
}
console.log(hashSenha(senha))
