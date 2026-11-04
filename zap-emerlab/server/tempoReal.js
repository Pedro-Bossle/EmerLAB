// Avisos em tempo real (Supabase Realtime · Broadcast).
//
// O aviso só diz "mudou" (tipo + horário). Nenhum telefone, nome ou texto trafega pelo canal: quem recebe
// busca o dado pela API do painel, que exige a sessão. Os nomes dos canais são derivados por HMAC com o
// segredo da sessão e só são entregues a quem está logado, então não dá para adivinhá-los.
//
// Desligado por padrão: só funciona com ZAP_REALTIME=1, webhook da WATI configurado e a chave pública
// do Supabase (SUPABASE_ANON_KEY) disponível para o navegador.
import crypto from 'node:crypto'
import process from 'node:process'
import { getEnv } from './env.js'

const INTERVALO_MIN_MS = 700 // no máximo ~1 aviso por canal a cada 0,7 s (rajadas viram um só)
const TIMEOUT_MS = 1500 // quanto quem chamou espera no máximo (webhook da WATI / ação do atendente)

const ultimoEnvio = new Map()
const pendentes = new Map() // canal → timer do aviso final (quando uma rajada foi agrupada)

/** Chave pública (anon/publishable) que o navegador usa só para assinar os canais. */
function chavePublica() {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
}

/** Liga só com ZAP_REALTIME=1 E tudo o que o navegador precisa para ouvir (sem ouvinte não há por que avisar). */
export function tempoRealAtivo() {
    const env = getEnv()
    return process.env.ZAP_REALTIME === '1' && Boolean(env.supabaseUrl && env.supabaseKey && env.sessionSecret && env.webhookSecret && chavePublica())
}

/** Configuração entregue ao navegador em /auth/me. `null` = o painel segue só com polling. */
export function configTempoReal() {
    if (!tempoRealAtivo()) return null
    return { url: getEnv().supabaseUrl, anonKey: chavePublica(), lista: nomeCanal('lista') }
}

/** Nome do canal: 'lista' (todas as conversas) ou 'conv' + waId (uma conversa). Determinístico e secreto. */
export function nomeCanal(tipo, waId = '') {
    const h = crypto.createHmac('sha256', getEnv().sessionSecret).update(`canal:${tipo}:${waId}`).digest('hex')
    return `zap:${h.slice(0, 32)}`
}

async function enviar(topico, tipo) {
    const { supabaseUrl, supabaseKey } = getEnv()
    // A chamada NÃO é abortada no timeout: o Broadcast leva de 0,9 a 1,5 s daqui até o Supabase e abortar
    // descartaria um aviso que ia chegar. Quem chamou só espera até TIMEOUT_MS; o resto segue em segundo plano.
    const chamada = fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: topico, event: 'ping', payload: { t: tipo, em: new Date().toISOString() }, private: false }] }),
    }).catch(() => {
        // sem aviso o painel apenas espera o próximo polling: nunca derruba quem chamou
    })
    let timer
    await Promise.race([chamada, new Promise((r) => (timer = setTimeout(r, TIMEOUT_MS)))])
    clearTimeout(timer)
}

/** Avisa o canal. Nunca lança. Rajadas dentro de 0,7 s viram um aviso agora + um final. */
export async function avisar(tipo, waId = '') {
    if (!tempoRealAtivo()) return
    const topico = nomeCanal(tipo, waId)
    const agora = Date.now()
    const desde = agora - (ultimoEnvio.get(topico) || 0)
    if (desde < INTERVALO_MIN_MS) {
        if (!pendentes.has(topico)) {
            const timer = setTimeout(() => {
                pendentes.delete(topico)
                ultimoEnvio.set(topico, Date.now())
                void enviar(topico, tipo)
            }, INTERVALO_MIN_MS - desde)
            timer.unref?.()
            pendentes.set(topico, timer)
        }
        return
    }
    if (ultimoEnvio.size > 2000) ultimoEnvio.clear()
    ultimoEnvio.set(topico, agora)
    await enviar(topico, tipo)
}

/** Mudança em uma conversa: avisa a lista e o chat aberto dela. `waId` já normalizado. */
export async function avisarConversa(waId) {
    if (!tempoRealAtivo() || !waId) return
    await Promise.all([avisar('lista'), avisar('conv', waId)])
}
