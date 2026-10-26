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
const servidor = http.createServer((req, res) => handle(req, res))
// porta ocupada quase sempre é um "npm run dev" anterior que ficou aberto: explica em vez de despejar o stack
servidor.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e
    const comando =
        process.platform === 'win32'
            ? `netstat -ano | findstr :${porta}   (e depois: taskkill /PID <número> /F)`
            : `lsof -ti tcp:${porta} | xargs kill`
    console.error('')
    console.error(`[zap] A porta ${porta} já está em uso: provavelmente um "npm run dev" anterior ainda aberto.`)
    console.error(`[zap] Feche o outro terminal ou encerre o processo: ${comando}`)
    console.error('[zap] Ou use outra porta: defina ZAP_API_PORT no .env.local.')
    console.error('')
    process.exit(1)
})
// node --watch reinicia mandando SIGTERM: fecha na hora para a nova instância conseguir a porta
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => process.exit(0))
servidor.listen(porta, '127.0.0.1', () => {
    console.log(`[zap] API em http://127.0.0.1:${porta}`)
    const faltando = envFaltando()
    if (faltando.length) console.warn(`[zap] Variáveis faltando: ${faltando.join(', ')} (veja .env.example)`)
})
