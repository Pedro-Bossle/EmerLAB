// Avisos em tempo real (Supabase Realtime · Broadcast) — lado do navegador.
// O canal só diz "mudou"; o dado continua vindo da API do painel (que exige a sessão).
// Sem configuração do servidor (config.realtime = null) nada aqui é carregado e o painel segue só com polling.
import { createClient } from '@supabase/supabase-js'

let cliente = null

/** Cria o cliente uma única vez (chamado depois de /auth/me). Qualquer falha deixa o painel só com polling. */
export function configurarTempoReal(cfg) {
    if (cliente || !cfg?.url || !cfg?.anonKey) return
    try {
        cliente = createClient(cfg.url, cfg.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            realtime: { params: { eventsPerSecond: 5 } },
        })
    } catch {
        cliente = null
    }
}

/**
 * Assina um canal de avisos. `aoEstado(true|false)` informa se está conectado (false = cair para o polling).
 * Devolve a função que cancela a assinatura.
 */
export function assinar(nome, { aoAviso, aoEstado }) {
    if (!cliente || !nome) return () => {}
    let canal = null
    try {
        canal = cliente.channel(nome, { config: { broadcast: { self: false } } })
        canal.on('broadcast', { event: 'ping' }, () => aoAviso())
        canal.subscribe((status) => aoEstado(status === 'SUBSCRIBED'))
    } catch {
        aoEstado(false)
        return () => {}
    }
    return () => {
        try {
            cliente?.removeChannel(canal)
        } catch {
            // já removido
        }
    }
}

/**
 * Agrupa avisos: espera `esperaMs` (vários avisos seguidos viram uma recarga) e nunca roda `fn`
 * mais de uma vez a cada `intervaloMinMs` (um canal barulhento não vira DoS na própria API).
 */
export function criarAgendadorDeAviso(fn, { esperaMs = 400, intervaloMinMs = 2000 } = {}) {
    let timer = null
    let ultima = 0
    return {
        aviso() {
            if (timer) return // já há uma recarga agendada: este aviso entra nela
            const espera = Math.max(esperaMs, ultima + intervaloMinMs - Date.now())
            timer = setTimeout(() => {
                timer = null
                ultima = Date.now()
                fn()
            }, espera)
        },
        cancelar() {
            clearTimeout(timer)
            timer = null
        },
    }
}
