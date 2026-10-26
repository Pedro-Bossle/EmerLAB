// Servidor local da API (o Vite faz proxy de /api → aqui)
// Lê .env/.env.local desta pasta e, por último, o .env.local da raiz do repositório.
import dotenv from 'dotenv'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pasta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(pasta, '..', '.env.local'), quiet: true })
dotenv.config({ path: path.join(pasta, '.env'), override: true, quiet: true })
dotenv.config({ path: path.join(pasta, '.env.local'), override: true, quiet: true })

const { handle } = await import('../server/router.js')
const { envFaltando } = await import('../server/env.js')

const porta = Number(process.env.ZAP_API_PORT || 3001)
http.createServer((req, res) => handle(req, res)).listen(porta, '127.0.0.1', () => {
    console.log(`[zap] API em http://127.0.0.1:${porta}`)
    const faltando = envFaltando()
    if (faltando.length) console.warn(`[zap] Variáveis faltando: ${faltando.join(', ')} (veja .env.example)`)
})
