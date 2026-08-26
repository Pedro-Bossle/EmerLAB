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

let uidCache = { id: null, at: 0 }

async function uidAtual() {
    const agora = Date.now()
    if (uidCache.id && agora - uidCache.at < 30_000) return uidCache.id
    const { data } = await supabase.auth.getUser()
    const id = data?.user?.id || null
    uidCache = { id, at: agora }
    return id
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

async function carregarNotificacoesDoUtilizador() {
    const uid = await uidAtual()
    if (!uid) return carregarNotificacoes(null)
    try {
        const raw = localStorage.getItem(chaveNotif(uid))
        if (raw) {
            const arr = JSON.parse(raw)
            return Array.isArray(arr) ? arr : []
        }
        // Migração one-shot do legado partilhado → chave do user
        const legado = localStorage.getItem(KEY_NOTIF_LEGACY)
        if (legado) {
            localStorage.setItem(chaveNotif(uid), legado)
            localStorage.removeItem(KEY_NOTIF_LEGACY)
            const arr = JSON.parse(legado)
            return Array.isArray(arr) ? arr : []
        }
        return []
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

async function gravarNotificacoesDoUtilizador(lista) {
    const uid = await uidAtual()
    if (!uid) return gravarNotificacoes(lista, null)
    const arr = Array.isArray(lista) ? lista.slice(0, MAX_NOTIF) : []
    localStorage.setItem(chaveNotif(uid), JSON.stringify(arr))
    emitirMudancaNotificacoes()
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
 * Mantém o snapshot de polling para não «repescarem» eventos antigos no próximo sync.
 */
export async function limparTodasNotificacoesContratos() {
    const uid = await uidAtual()
    if (uid) {
        localStorage.setItem(chaveNotif(uid), '[]')
    } else {
        localStorage.setItem(KEY_NOTIF_LEGACY, '[]')
    }
    await marcarNotificacoesWebhookDismissedParaMim()
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
        const dismissed = await idsDismissedDoUtilizador()
        const { data, error } = await supabase
            .from('clicksign_notificacoes_webhook')
            .select('id')
            .order('criado_em', { ascending: false })
            .limit(MAX_WEBHOOK_FETCH)
        if (error) return 0
        return (data || []).filter((r) => !dismissed.has(String(r.id))).length
    } catch {
        return 0
    }
}

export async function listarNotificacoesWebhookRecentes(limite = 8) {
    try {
        const dismissed = await idsDismissedDoUtilizador()
        const { data, error } = await supabase
            .from('clicksign_notificacoes_webhook')
            .select('id, texto, envelope_id, envelope_name, criado_em, evento')
            .order('criado_em', { ascending: false })
            .limit(Math.max(MAX_WEBHOOK_FETCH, limite))
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
 * @param {(method: string, path: string, body?: object) => Promise<{ ok: boolean, data?: object }>} clickReq
 */
export async function sincronizarNotificacoesClicksign(clickReq) {
    const uid = await uidAtual()
    const snap = carregarSnapshotSync(uid)
    const notifs = uid
        ? await carregarNotificacoesDoUtilizador()
        : carregarNotificacoes(null)
    const novas = []
    const nextSnap = { version: 1, seeded: true, envelopes: { ...snap.envelopes } }

    const runningRows = []
    for (let page = 1; page <= 8; page += 1) {
        const path = montarPathListagemEnvelopes({ pageNumber: page, pageSize: 25, filterStatus: 'running' })
        const res = await clickReq('GET', path)
        if (!res.ok) break
        const { rows } = extrairListaEnvelopes(res.data)
        if (!rows.length) break
        runningRows.push(...rows)
        const rc = res.data?.meta?.record_count
        if (typeof rc === 'number' && runningRows.length >= rc) break
        if (rows.length < 25) break
    }

    const runningIds = new Set(runningRows.map((r) => r.id))

    const pushNotif = (item) => {
        const candidato = {
            id: novoId(),
            at: new Date().toISOString(),
            ...item,
        }
        const base = [...novas, ...notifs]
        if (notificacaoJaExiste(base, candidato)) return
        novas.push(candidato)
    }

    for (const env of runningRows) {
        const eid = String(env.id || '').trim()
        if (!eid) continue
        const nomeEnv = String(env.name || '').trim() || 'Envelope'
        const prev = snap.envelopes[eid] || { signers: {}, docs: {}, status: '' }

        const [reqRes, docRes, sigRes] = await Promise.all([
            obterRequisitosEnvelope(clickReq, eid),
            clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents`),
            clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/signers`),
        ])

        const resumo = reqRes.ok ? extrairResumoAssinaturaPorSignatario(reqRes.data) : {}
        const docs = docRes.ok ? extrairListaDocumentos(docRes.data) : []
        const signersJson = sigRes.ok ? sigRes.data : null

        const signersNext = {}
        for (const [sid, r] of Object.entries(resumo)) {
            const done = r.done >= r.total && r.total > 0
            const prevS = prev.signers[sid] || { done: 0, total: 0, completed: false }
            const nomeSig =
                nomeSignatarioPorId(signersJson, sid) || 'Signatário'
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

    for (const eid of Object.keys(snap.envelopes)) {
        if (runningIds.has(eid)) continue
        const prev = snap.envelopes[eid]
        if (!snap.seeded) continue
        const enc = await clickReq('GET', `/envelopes/${encodeURIComponent(eid)}`)
        if (!enc.ok) {
            delete nextSnap.envelopes[eid]
            continue
        }
        const nomeEnv =
            String(enc.data?.data?.attributes?.name || '').trim() || 'Envelope'
        const st = String(enc.data?.data?.attributes?.status || enc.data?.data?.attributes?.state || '')
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
    }

    gravarSnapshotSync(nextSnap, uid)
    if (novas.length) {
        await gravarNotificacoesDoUtilizador([...novas, ...notifs])
    }
    const lista = await carregarNotificacoesDoUtilizador()
    return { novas: novas.length, lista }
}
