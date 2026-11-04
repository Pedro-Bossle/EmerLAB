// Teste de ponta a ponta dos avisos em tempo real, contra o Supabase real, SEM tocar em tabelas nem na WATI.
// O servidor (server/tempoReal.js) publica por REST; clientes de verdade (src/tempoReal.js, chave pública) recebem.
// Uso (na pasta zap-emerlab):  node scripts/teste-tempo-real.mjs
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })
process.env.ZAP_REALTIME = '1'
process.env.ZAP_SESSION_SECRET ||= 'segredo-de-teste-com-mais-de-16-caracteres'
process.env.ZAP_WEBHOOK_SECRET ||= 'webhook-de-teste'
process.env.SUPABASE_ANON_KEY ||= process.env.VITE_SUPABASE_PUBLISHABLE_KEY

const srv = await import('../server/tempoReal.js')
const cli = await import('../src/tempoReal.js')

let falhas = 0
const confere = (ok, msg) => {
    console.log(`${ok ? 'OK   ' : 'FALHA'} ${msg}`)
    if (!ok) falhas++
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) nomes de canal
const a = srv.nomeCanal('conv', '5551999990001')
const b = srv.nomeCanal('conv', '5551999990002')
confere(a === srv.nomeCanal('conv', '5551999990001'), 'nome do canal é determinístico')
confere(a !== b && a !== srv.nomeCanal('lista'), 'canais de conversas diferentes (e da lista) têm nomes diferentes')
confere(!a.includes('5551999990001'), 'o nome do canal não contém o telefone')

// 2) config entregue ao navegador
const cfg = srv.configTempoReal()
confere(Boolean(cfg?.url && cfg?.anonKey && cfg?.lista), 'configTempoReal devolve url, chave pública e canal da lista')
cli.configurarTempoReal(cfg)

// 3) isolamento + entrega real
const recebidos = { lista: 0, a: 0, b: 0 }
const estados = { lista: false, a: false, b: false }
const sair = [
    cli.assinar(cfg.lista, { aoAviso: () => recebidos.lista++, aoEstado: (v) => (estados.lista = v) }),
    cli.assinar(a, { aoAviso: () => recebidos.a++, aoEstado: (v) => (estados.a = v) }),
    cli.assinar(b, { aoAviso: () => recebidos.b++, aoEstado: (v) => (estados.b = v) }),
]
for (let i = 0; i < 50 && !(estados.lista && estados.a && estados.b); i++) await espera(100)
confere(estados.lista && estados.a && estados.b, 'os 3 canais conectaram (SUBSCRIBED)')

await srv.avisarConversa('5551999990001')
await espera(4500)
confere(recebidos.lista === 1 && recebidos.a === 1, `aviso da conversa A chegou na lista e no chat A (lista=${recebidos.lista}, A=${recebidos.a})`)
confere(recebidos.b === 0, 'o chat B não recebeu nada (isolamento entre conversas)')

// 4) rajada: 6 avisos em sequência viram no máximo 2 (um agora, um final)
recebidos.lista = 0
await Promise.all(Array.from({ length: 6 }, () => srv.avisar('lista'))) // chamadas simultâneas, como numa rajada real
await espera(5000)
confere(recebidos.lista >= 1 && recebidos.lista <= 2, `rajada de 6 avisos virou ${recebidos.lista} (esperado 1 ou 2)`)

// 5) agendador do cliente
let rodou = 0
const ag = cli.criarAgendadorDeAviso(() => rodou++, { esperaMs: 50, intervaloMinMs: 300 })
ag.aviso(); ag.aviso(); ag.aviso()
await espera(120)
confere(rodou === 1, 'vários avisos seguidos viram uma recarga só')
ag.aviso()
await espera(120)
confere(rodou === 1, 'respeita o intervalo mínimo entre recargas')
await espera(350)
confere(rodou === 2, 'roda de novo depois do intervalo mínimo')
ag.aviso(); ag.cancelar()
await espera(400)
confere(rodou === 2, 'cancelar() descarta a recarga agendada')

sair.forEach((fn) => fn())
await espera(300)
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
