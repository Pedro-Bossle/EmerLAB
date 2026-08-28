import { supabase } from '../supabase'
import {
    extrairListaDocumentos,
    extrairListaEnvelopes,
    extrairListaSignatarios,
    extrairResumoAssinaturaPorSignatario,
    montarPathListagemEnvelopes,
    obterRequisitosEnvelope,
} from './clicksignClient.js'

const KEY_NOTIF_PREFIX = 'emerdog_clicksign_notificacoes_v2:'
const KEY_SNAP_PREFIX = 'emerdog_clicksign_notif_snapshot_v2:'
/** Legado (pré per-user) — lido só para migração / limpeza. */
const KEY_NOTIF_LEGACY = 'emerdog_clicksign_notificacoes_v1'
const KEY_SNAP_LEGACY = 'emerdog_clicksign_notif_snapshot_v1'
const MAX_NOTIF = 80
const MAX_WEBHOOK_FETCH = 120

/** Evita repescar no polling eventos que o utilizador limpou no sininho. */
const KEY_DISMISSED_PREFIX = 'emerdog_clicksign_notif_dismissed_v2:'
const KEY_BELL_LIMPO_PREFIX = 'emerdog_clicksign_bell_limpo_em_v2:'
const MAX_DISMISSED_CHAVES = 500

/** Incrementado em cada «Limpar» — evita sync em voo repor notificações antigas. */
let clearGeneration = 0

/** Limites de sync (polling) — reduz 429 na Clicksign. */
const SYNC_MIN_INTERVAL_MS = 120_000
const SYNC_COOLDOWN_429_MS = 120_000
const SYNC_MAX_RUNNING_PAGES = 2
const SYNC_PAGE_SIZE = 25
const SYNC_MAX_ENVELOPE_DETAIL = 20
const SYNC_REQUEST_GAP_MS = 150

let syncInFlight = null
let lastSyncFinishedAt = 0
let syncBlockedUntil = 0

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

function carregarDismissedLocalSync(uid) {
    try {
        const raw = localStorage.getItem(`${KEY_DISMISSED_PREFIX}${uid || 'anon'}`)
        const arr = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(arr) ? arr.filter(Boolean) : [])
    } catch {
        return new Set()
    }
}

function gravarDismissedLocalSync(uid, set) {
    if (!uid) return
    const arr = [...set].slice(-MAX_DISMISSED_CHAVES)
    localStorage.setItem(`${KEY_DISMISSED_PREFIX}${uid}`, JSON.stringify(arr))
}

function chaveBellLimpo(uid) {
    return `${KEY_BELL_LIMPO_PREFIX}${uid || 'anon'}`
}

function obterBellLimpoEmSync(uid) {
    if (!uid) return null
    try {
        return localStorage.getItem(chaveBellLimpo(uid)) || null
    } catch {
        return null
    }
}

function gravarBellLimpoEmSync(uid, iso = new Date().toISOString()) {
    if (!uid) return
    try {
        localStorage.setItem(chaveBellLimpo(uid), iso)
    } catch {
        /* ignore */
    }
}

function filtrarNotificacoesAposLimpeza(lista, limpoEm) {
    if (!limpoEm) return lista || []
    const corte = new Date(limpoEm).getTime()
    if (Number.isNaN(corte)) return lista || []
    return (lista || []).filter((n) => {
        const at = new Date(n.at || n.criado_em || 0).getTime()
        return !Number.isNaN(at) && at > corte
    })
}

async function uidAtual() {
    const { data } = await supabase.auth.getUser()
    return data?.user?.id || null
}

function chaveNotif(uid) {
    return `${KEY_NOTIF_PREFIX}${uid || 'anon'}`
}

function chaveSnap(uid) {
    return `${KEY_SNAP_PREFIX}${uid || 'anon'}`
}

export function carregarNotificacoes(uid = null) {
    try {
        const raw = uid
            ? localStorage.getItem(chaveNotif(uid))
            : localStorage.getItem(KEY_NOTIF_LEGACY)
        const arr = raw ? JSON.parse(raw) : []
        return Array.isArray(arr) ? arr : []
    } catch {
        return []
    }
}

async function carregarNotificacoesDoUtilizador(uidCapturado = undefined) {
    const uid = uidCapturado !== undefined ? uidCapturado : await uidAtual()
    if (!uid) return carregarNotificacoes(null)
    try {
        const raw = localStorage.getItem(chaveNotif(uid))
        let arr = []
        if (raw) {
            const parsed = JSON.parse(raw)
            arr = Array.isArray(parsed) ? parsed : []
        } else {
            // Migração one-shot do legado partilhado → chave do user
            const legado = localStorage.getItem(KEY_NOTIF_LEGACY)
            if (legado) {
                localStorage.setItem(chaveNotif(uid), legado)
                localStorage.removeItem(KEY_NOTIF_LEGACY)
                const parsed = JSON.parse(legado)
                arr = Array.isArray(parsed) ? parsed : []
            }
        }
        const dismissed = carregarDismissedLocalSync(uid)
        const limpoEm = obterBellLimpoEmSync(uid)
        let out = arr
        if (dismissed.size) {
            out = out.filter((n) => !dismissed.has(chaveNotificacaoContrato(n)))
        }
        return filtrarNotificacoesAposLimpeza(out, limpoEm)
    } catch {
        return []
    }
}

function emitirMudancaNotificacoes() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('emerdog-clicksign-notif-change'))
}

export function gravarNotificacoes(lista, uid = null) {
    const arr = Array.isArray(lista) ? lista.slice(0, MAX_NOTIF) : []
    if (uid) {
        localStorage.setItem(chaveNotif(uid), JSON.stringify(arr))
    } else {
        localStorage.setItem(KEY_NOTIF_LEGACY, JSON.stringify(arr))
    }
    emitirMudancaNotificacoes()
    return arr
}

async function gravarNotificacoesDoUtilizador(lista, uidCapturado = undefined, opts = {}) {
    const emitir = opts.emitir !== false
    const uid = uidCapturado !== undefined ? uidCapturado : await uidAtual()
    if (!uid) return gravarNotificacoes(lista, null)
    const arr = Array.isArray(lista) ? lista.slice(0, MAX_NOTIF) : []
    localStorage.setItem(chaveNotif(uid), JSON.stringify(arr))
    if (emitir) emitirMudancaNotificacoes()
    return arr
}

export function limparNotificacoes() {
    void uidAtual().then((uid) => {
        if (uid) localStorage.setItem(chaveNotif(uid), '[]')
        else localStorage.setItem(KEY_NOTIF_LEGACY, '[]')
        emitirMudancaNotificacoes()
    })
    return []
}

export function limparSnapshotNotificacoes() {
    void (async () => {
        try {
            const uid = await uidAtual()
            if (uid) localStorage.removeItem(chaveSnap(uid))
            localStorage.removeItem(KEY_SNAP_LEGACY)
        } catch {
            /* ignore */
        }
    })()
}

/**
 * Marca dismissals só para o utilizador atual (não apaga o evento partilhado).
 * @returns {Promise<boolean>}
 */
export async function marcarNotificacoesWebhookDismissedParaMim() {
    try {
        const uid = await uidAtual()
        if (!uid) return false
        const { data: rows, error } = await supabase
            .from('clicksign_notificacoes_webhook')
            .select('id')
            .order('criado_em', { ascending: false })
            .limit(MAX_WEBHOOK_FETCH)
        if (error || !rows?.length) return !error
        const payload = rows.map((r) => ({
            user_id: uid,
            notificacao_id: r.id,
            dismissed_at: new Date().toISOString(),
        }))
        const { error: upErr } = await supabase
            .from('clicksign_notificacoes_user_dismissed')
            .upsert(payload, { onConflict: 'user_id,notificacao_id' })
        return !upErr
    } catch {
        return false
    }
}

/** @deprecated Use marcarNotificacoesWebhookDismissedParaMim — não marcar lido global. */
export async function marcarTodasNotificacoesWebhookComoLidas() {
    return marcarNotificacoesWebhookDismissedParaMim()
}

/**
 * Limpa sininho só para o utilizador atual.
 * @param {(method: string, path: string, body?: object) => Promise<{ ok: boolean, status?: number, data?: object }>} [clickReq]
 *   Se informado, alinha o snapshot com a API (evita o polling recriar eventos antigos com texto diferente).
 */
export async function limparTodasNotificacoesContratos(clickReq = null) {
    clearGeneration += 1
    const uid = await uidAtual()
    const local = uid ? await carregarNotificacoesDoUtilizador(uid) : carregarNotificacoes(null)
    const webhook = await listarNotificacoesWebhookRecentes(MAX_NOTIF)
    if (uid) {
        gravarBellLimpoEmSync(uid)
        const dismissed = carregarDismissedLocalSync(uid)
        for (const n of [...local, ...webhook]) {
            const k = chaveNotificacaoContrato(n)
            if (k.replace(/\|/g, '').trim()) dismissed.add(k)
        }
        gravarDismissedLocalSync(uid, dismissed)
        localStorage.setItem(chaveNotif(uid), '[]')
    } else {
        localStorage.setItem(KEY_NOTIF_LEGACY, '[]')
    }
    await marcarNotificacoesWebhookDismissedParaMim()
    if (typeof clickReq === 'function') {
        try {
            await sincronizarNotificacoesClicksign(clickReq, { somenteSnapshot: true, forcar: true })
        } catch {
            /* limpeza local já aplicada */
        }
    }
    emitirMudancaNotificacoes()
}

function notificacaoJaExiste(lista, item, janelaMs = 7 * 24 * 60 * 60 * 1000) {
    const chave = chaveNotificacaoContrato(item)
    if (!chave.replace(/\|/g, '').trim()) return false
    const limite = Date.now() - janelaMs
    return lista.some((n) => {
        if (chaveNotificacaoContrato(n) !== chave) return false
        const at = new Date(n.at || 0).getTime()
        return !Number.isNaN(at) && at >= limite
    })
}

export function listarNotificacoesRecentes(limite = 8) {
    // Sync API: preferir versão async via listarNotificacoesContratosRecentes
    return carregarNotificacoes(null).slice(0, Math.max(1, limite))
}

export function contarNotificacoesArmazenadas() {
    return carregarNotificacoes(null).length
}

async function idsDismissedDoUtilizador() {
    try {
        const uid = await uidAtual()
        if (!uid) return new Set()
        const { data, error } = await supabase
            .from('clicksign_notificacoes_user_dismissed')
            .select('notificacao_id')
            .eq('user_id', uid)
            .limit(2000)
        if (error) return new Set()
        return new Set((data || []).map((r) => String(r.notificacao_id)))
    } catch {
        return new Set()
    }
}

/** Notificações do webhook ainda não dismissed pelo utilizador atual. */
export async function contarNotificacoesWebhookNaoLidas() {
    try {
        const uid = await uidAtual()
        const limpoEm = obterBellLimpoEmSync(uid)
        const dismissed = await idsDismissedDoUtilizador()
        let q = supabase
            .from('clicksign_notificacoes_webhook')
            .select('id')
            .order('criado_em', { ascending: false })
            .limit(MAX_WEBHOOK_FETCH)
        if (limpoEm) q = q.gt('criado_em', limpoEm)
        const { data, error } = await q
        if (error) return 0
        return (data || []).filter((r) => !dismissed.has(String(r.id))).length
    } catch {
        return 0
    }
}

export async function listarNotificacoesWebhookRecentes(limite = 8) {
    try {
        const uid = await uidAtual()
        const limpoEm = obterBellLimpoEmSync(uid)
        const dismissed = await idsDismissedDoUtilizador()
        let q = supabase
            .from('clicksign_notificacoes_webhook')
            .select('id, texto, envelope_id, envelope_name, criado_em, evento')
            .order('criado_em', { ascending: false })
            .limit(Math.max(MAX_WEBHOOK_FETCH, limite))
        if (limpoEm) q = q.gt('criado_em', limpoEm)
        const { data, error } = await q
        if (error) return []
        return (data || [])
            .filter((row) => !dismissed.has(String(row.id)))
            .slice(0, Math.max(1, limite))
            .map((row) => ({
                id: `wh-${row.id}`,
                at: row.criado_em,
                texto: row.texto,
                envelopeName: row.envelope_name || '',
                envelopeId: row.envelope_id || '',
                tipo: row.evento,
                webhookRowId: row.id,
            }))
    } catch {
        return []
    }
}

export function mesclarListasNotificacoesContratos(local, webhook, limite = 8) {
    const todas = [...webhook, ...local]
    todas.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    const vistos = new Set()
    const unicas = []
    for (const n of todas) {
        const chave = `${String(n.envelopeId || '').trim()}|${String(n.texto || '').trim()}`
        if (vistos.has(chave)) continue
        vistos.add(chave)
        unicas.push(n)
    }
    return unicas.slice(0, Math.max(1, limite))
}

function chaveNotificacaoContrato(n) {
    return `${String(n.envelopeId || '').trim()}|${String(n.texto || '').trim()}`
}

/** Contagem única (local + webhook sem duplicar o mesmo evento). */
export async function contarNotificacoesContratosTotal() {
    const [local, webhook] = await Promise.all([
        carregarNotificacoesDoUtilizador(),
        listarNotificacoesWebhookRecentes(80),
    ])
    const vistos = new Set()
    let total = 0
    for (const n of [...webhook, ...local]) {
        const chave = chaveNotificacaoContrato(n)
        if (!chave.replace(/\|/g, '').trim()) continue
        if (vistos.has(chave)) continue
        vistos.add(chave)
        total += 1
    }
    return total
}

export async function listarNotificacoesContratosRecentes(limite = 8) {
    const [local, webhook] = await Promise.all([
        carregarNotificacoesDoUtilizador().then((arr) => arr.slice(0, Math.max(1, limite))),
        listarNotificacoesWebhookRecentes(limite),
    ])
    return mesclarListasNotificacoesContratos(local, webhook, limite)
}

/** Frase curta do que aconteceu em um evento de envelope. */
export function resumirEventoEnvelope(n) {
    const texto = String(n?.texto || '').trim()
    const tipo = String(n?.tipo || '').toLowerCase()

    if (tipo.includes('assinatura') || /assinou/i.test(texto)) {
        const m = texto.match(/^(.*?)\s+assinou/i)
        const nome = m ? m[1].trim() : ''
        const parcial = texto.match(/\((\d+\/\d+)\)/)
        if (nome) {
            return parcial
                ? `Assinatura de ${nome} (${parcial[1]})`
                : `Assinatura de ${nome}`
        }
        return 'Nova assinatura'
    }
    if (tipo.includes('documento') || /documento finalizado/i.test(texto)) {
        const m = texto.match(/«([^»]+)»/)
        return m ? `Documento finalizado: ${m[1]}` : 'Documento finalizado'
    }
    if (
        tipo.includes('envelope_finalizado') ||
        tipo.includes('encerr') ||
        /conclu[íi]do|encerr/i.test(texto)
    ) {
        return 'Encerramento do envelope'
    }
    return texto || 'Atualização'
}

/**
 * Agrupa as notificações de contratos por envelope, unificando múltiplas
 * atualizações do mesmo envelope numa só entrada.
 * Retorna: [{ envelopeId, envelopeName, resumo, eventos, ultimaAt, total }]
 */
export function agruparNotificacoesPorEnvelope(lista) {
    const mapa = new Map()
    for (const n of lista || []) {
        const chave =
            String(n.envelopeId || '').trim() ||
            String(n.envelopeName || '').trim() ||
            `sem-envelope:${n.id}`
        if (!mapa.has(chave)) {
            mapa.set(chave, {
                envelopeId: n.envelopeId || '',
                envelopeName: String(n.envelopeName || '').trim() || 'Envelope',
                eventos: [],
                ultimaAt: n.at || null,
            })
        }
        const g = mapa.get(chave)
        const resumo = resumirEventoEnvelope(n)
        g.eventos.push({ texto: n.texto || '', resumo, at: n.at || null, tipo: n.tipo || '' })
        if (!g.ultimaAt || new Date(n.at || 0) > new Date(g.ultimaAt)) {
            g.ultimaAt = n.at || g.ultimaAt
        }
    }

    const grupos = [...mapa.values()].map((g) => {
        const resumosUnicos = []
        for (const ev of g.eventos) {
            if (!resumosUnicos.includes(ev.resumo)) resumosUnicos.push(ev.resumo)
        }
        return {
            ...g,
            total: g.eventos.length,
            resumo: resumosUnicos.join(', '),
            resumos: resumosUnicos,
        }
    })

    grupos.sort((a, b) => new Date(b.ultimaAt || 0) - new Date(a.ultimaAt || 0))
    return grupos
}

/** Notificações de contratos já agrupadas por envelope (para a Home). */
export async function listarEnvelopesComAtualizacoes(limite = 40) {
    const [local, webhook] = await Promise.all([
        carregarNotificacoesDoUtilizador(),
        listarNotificacoesWebhookRecentes(limite),
    ])
    const mescladas = mesclarListasNotificacoesContratos(local, webhook, limite)
    return agruparNotificacoesPorEnvelope(mescladas)
}

/** Chave usada no localStorage (para evento storage entre abas) — prefixo v2. */
export const CLICKSIGN_NOTIF_STORAGE_KEY = KEY_NOTIF_PREFIX
export const CLICKSIGN_BELL_LIMPO_STORAGE_PREFIX = KEY_BELL_LIMPO_PREFIX

function carregarSnapshotSync(uid) {
    try {
        const raw =
            (uid && localStorage.getItem(chaveSnap(uid))) ||
            localStorage.getItem(KEY_SNAP_LEGACY)
        return raw ? JSON.parse(raw) : { version: 1, seeded: false, envelopes: {} }
    } catch {
        return { version: 1, seeded: false, envelopes: {} }
    }
}

function gravarSnapshotSync(snap, uid) {
    if (uid) localStorage.setItem(chaveSnap(uid), JSON.stringify(snap))
    else localStorage.setItem(KEY_SNAP_LEGACY, JSON.stringify(snap))
}

function novoId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function nomeSignatarioPorId(signersJson, signerId) {
    const rows = extrairListaSignatarios(signersJson)
    const row = rows.find((s) => String(s.id) === String(signerId))
    return row?.name && row.name !== '—' ? String(row.name) : ''
}

/**
 * Compara estado atual com snapshot e gera notificações (assinatura / documento / envelope concluído).
 * Throttle global + menos pedidos por ciclo para evitar 429.
 * @param {(method: string, path: string, body?: object) => Promise<{ ok: boolean, status?: number, data?: object }>} clickReq
 * @param {{ forcar?: boolean, somenteSnapshot?: boolean }} [opts]
 */
export async function sincronizarNotificacoesClicksign(clickReq, opts = {}) {
    const forcar = Boolean(opts.forcar)
    const somenteSnapshot = Boolean(opts.somenteSnapshot)
    const agora = Date.now()

    async function listaAtual(uid) {
        return uid ? await carregarNotificacoesDoUtilizador(uid) : carregarNotificacoes(null)
    }

    if (!forcar && agora < syncBlockedUntil) {
        const uid = await uidAtual()
        return { novas: 0, lista: await listaAtual(uid), skipped: 'cooldown_429' }
    }
    if (!forcar && agora - lastSyncFinishedAt < SYNC_MIN_INTERVAL_MS) {
        const uid = await uidAtual()
        return { novas: 0, lista: await listaAtual(uid), skipped: 'throttle' }
    }
    if (syncInFlight) {
        return syncInFlight
    }

    syncInFlight = (async () => {
        const genInicio = clearGeneration
        const uid = await uidAtual()
        const dismissedLocal = carregarDismissedLocalSync(uid)
        const snap = carregarSnapshotSync(uid)
        const notifs = await listaAtual(uid)
        const novas = []
        const nextSnap = { version: 1, seeded: true, envelopes: { ...snap.envelopes } }
        let abort429 = false

        const clickPaced = async (method, path, body) => {
            if (abort429) {
                return { ok: false, status: 429, data: { error: 'sync_aborted' } }
            }
            const res = await clickReq(method, path, body)
            if (res.status === 429 || /429|rate.?limit|too many/i.test(String(res.data?.error || ''))) {
                abort429 = true
                syncBlockedUntil = Date.now() + SYNC_COOLDOWN_429_MS
            }
            if (SYNC_REQUEST_GAP_MS > 0) await delay(SYNC_REQUEST_GAP_MS)
            return res
        }

        const runningRows = []
        for (let page = 1; page <= SYNC_MAX_RUNNING_PAGES && !abort429; page += 1) {
            const path = montarPathListagemEnvelopes({
                pageNumber: page,
                pageSize: SYNC_PAGE_SIZE,
                filterStatus: 'running',
            })
            const res = await clickPaced('GET', path)
            if (!res.ok) break
            const { rows } = extrairListaEnvelopes(res.data)
            if (!rows.length) break
            runningRows.push(...rows)
            const rc = res.data?.meta?.record_count
            if (typeof rc === 'number' && runningRows.length >= rc) break
            if (rows.length < SYNC_PAGE_SIZE) break
        }

        const runningIds = new Set(runningRows.map((r) => r.id))
        const runningProcessar = runningRows.slice(0, SYNC_MAX_ENVELOPE_DETAIL)

        const pushNotif = (item) => {
            if (somenteSnapshot) return
            const candidato = {
                id: novoId(),
                at: new Date().toISOString(),
                ...item,
            }
            const chave = chaveNotificacaoContrato(candidato)
            if (dismissedLocal.has(chave)) return
            const base = [...novas, ...notifs]
            if (notificacaoJaExiste(base, candidato)) return
            novas.push(candidato)
        }

        for (const env of runningProcessar) {
            if (abort429) break
            const eid = String(env.id || '').trim()
            if (!eid) continue
            const nomeEnv = String(env.name || '').trim() || 'Envelope'
            const prev = snap.envelopes[eid] || { signers: {}, docs: {}, status: '' }

            const reqRes = await obterRequisitosEnvelope(clickPaced, eid)
            const docRes = await clickPaced(
                'GET',
                `/envelopes/${encodeURIComponent(eid)}/documents`,
            )
            const sigRes = await clickPaced('GET', `/envelopes/${encodeURIComponent(eid)}/signers`)

            const resumo = reqRes.ok ? extrairResumoAssinaturaPorSignatario(reqRes.data) : {}
            const docs = docRes.ok ? extrairListaDocumentos(docRes.data) : []
            const signersJson = sigRes.ok ? sigRes.data : null

            const signersNext = {}
            for (const [sid, r] of Object.entries(resumo)) {
                const done = r.done >= r.total && r.total > 0
                const prevS = prev.signers[sid] || { done: 0, total: 0, completed: false }
                const nomeSig = nomeSignatarioPorId(signersJson, sid) || 'Signatário'
                if (snap.seeded && done && !prevS.completed) {
                    pushNotif({
                        tipo: 'assinatura',
                        envelopeId: eid,
                        envelopeName: nomeEnv,
                        texto: `${nomeSig} assinou em «${nomeEnv}».`,
                    })
                } else if (snap.seeded && r.done > prevS.done && r.done < r.total) {
                    pushNotif({
                        tipo: 'assinatura',
                        envelopeId: eid,
                        envelopeName: nomeEnv,
                        texto: `${nomeSig} assinou (${r.done}/${r.total}) em «${nomeEnv}».`,
                    })
                }
                signersNext[sid] = { done: r.done, total: r.total, completed: done }
            }

            const docsNext = {}
            for (const d of docs) {
                const did = String(d.id || '').trim()
                if (!did) continue
                const st = String(d.status || '').toLowerCase()
                docsNext[did] = st
                const prevSt = prev.docs[did] || ''
                if (snap.seeded && st === 'closed' && prevSt !== 'closed') {
                    const fn = String(d.filename || d.name || 'Documento').trim()
                    pushNotif({
                        tipo: 'documento_finalizado',
                        envelopeId: eid,
                        envelopeName: nomeEnv,
                        texto: `Documento finalizado: «${fn}» (${nomeEnv}).`,
                    })
                }
            }

            nextSnap.envelopes[eid] = {
                status: String(env.status || 'running').toLowerCase(),
                signers: signersNext,
                docs: docsNext,
            }
        }

        if (!abort429) {
            for (const eid of Object.keys(snap.envelopes)) {
                if (runningIds.has(eid)) continue
                const prev = snap.envelopes[eid]
                if (!snap.seeded) continue
                const enc = await clickPaced('GET', `/envelopes/${encodeURIComponent(eid)}`)
                if (!enc.ok) {
                    delete nextSnap.envelopes[eid]
                    continue
                }
                const nomeEnv =
                    String(enc.data?.data?.attributes?.name || '').trim() || 'Envelope'
                const st = String(
                    enc.data?.data?.attributes?.status || enc.data?.data?.attributes?.state || '',
                )
                    .trim()
                    .toLowerCase()
                if (st === 'closed' && prev.status !== 'closed') {
                    pushNotif({
                        tipo: 'envelope_finalizado',
                        envelopeId: eid,
                        envelopeName: nomeEnv,
                        texto: `Envelope concluído: «${nomeEnv}».`,
                    })
                }
                if (st === 'closed' || st === 'canceled' || st === 'cancelled') {
                    delete nextSnap.envelopes[eid]
                } else {
                    nextSnap.envelopes[eid] = { ...prev, status: st }
                }
                if (abort429) break
            }
        }

        gravarSnapshotSync(nextSnap, uid)
        if (novas.length && genInicio === clearGeneration) {
            await gravarNotificacoesDoUtilizador([...novas, ...notifs], uid, { emitir: true })
        }
        const lista = await listaAtual(uid)
        return { novas: genInicio === clearGeneration ? novas.length : 0, lista, aborted429: abort429 }
    })()

    try {
        return await syncInFlight
    } finally {
        syncInFlight = null
        lastSyncFinishedAt = Date.now()
    }
}
