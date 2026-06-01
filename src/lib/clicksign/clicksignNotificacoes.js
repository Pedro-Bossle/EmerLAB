import { supabase } from '../supabase'
import {
    extrairListaDocumentos,
    extrairListaEnvelopes,
    extrairListaSignatarios,
    extrairResumoAssinaturaPorSignatario,
    montarPathListagemEnvelopes,
    obterRequisitosEnvelope,
} from './clicksignClient.js'

const KEY_NOTIF = 'emerdog_clicksign_notificacoes_v1'
const KEY_SNAP = 'emerdog_clicksign_notif_snapshot_v1'
const MAX_NOTIF = 80

export function carregarNotificacoes() {
    try {
        const raw = localStorage.getItem(KEY_NOTIF)
        const arr = raw ? JSON.parse(raw) : []
        return Array.isArray(arr) ? arr : []
    } catch {
        return []
    }
}

function emitirMudancaNotificacoes() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('emerdog-clicksign-notif-change'))
}

export function gravarNotificacoes(lista) {
    const arr = Array.isArray(lista) ? lista.slice(0, MAX_NOTIF) : []
    localStorage.setItem(KEY_NOTIF, JSON.stringify(arr))
    emitirMudancaNotificacoes()
    return arr
}

export function limparNotificacoes() {
    return gravarNotificacoes([])
}

export function listarNotificacoesRecentes(limite = 8) {
    return carregarNotificacoes().slice(0, Math.max(1, limite))
}

export function contarNotificacoesArmazenadas() {
    return carregarNotificacoes().length
}

/** Notificações persistidas pelo webhook (Supabase). Falha silenciosa se a tabela não existir. */
export async function contarNotificacoesWebhookNaoLidas() {
    try {
        const { count, error } = await supabase
            .from('clicksign_notificacoes_webhook')
            .select('id', { count: 'exact', head: true })
            .eq('lido', false)
        if (error) return 0
        return count || 0
    } catch {
        return 0
    }
}

export async function listarNotificacoesWebhookRecentes(limite = 8) {
    try {
        const { data, error } = await supabase
            .from('clicksign_notificacoes_webhook')
            .select('id, texto, envelope_id, envelope_name, criado_em, evento')
            .eq('lido', false)
            .order('criado_em', { ascending: false })
            .limit(Math.max(1, limite))
        if (error) return []
        return (data || []).map((row) => ({
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
    return todas.slice(0, Math.max(1, limite))
}

export async function contarNotificacoesContratosTotal() {
    const [local, wh] = await Promise.all([
        Promise.resolve(contarNotificacoesArmazenadas()),
        contarNotificacoesWebhookNaoLidas(),
    ])
    return local + wh
}

export async function listarNotificacoesContratosRecentes(limite = 8) {
    const [local, webhook] = await Promise.all([
        Promise.resolve(listarNotificacoesRecentes(limite)),
        listarNotificacoesWebhookRecentes(limite),
    ])
    return mesclarListasNotificacoesContratos(local, webhook, limite)
}

/** Chave usada no localStorage (para evento storage entre abas). */
export const CLICKSIGN_NOTIF_STORAGE_KEY = KEY_NOTIF

function carregarSnapshot() {
    try {
        const raw = localStorage.getItem(KEY_SNAP)
        return raw ? JSON.parse(raw) : { version: 1, seeded: false, envelopes: {} }
    } catch {
        return { version: 1, seeded: false, envelopes: {} }
    }
}

function gravarSnapshot(snap) {
    localStorage.setItem(KEY_SNAP, JSON.stringify(snap))
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
    const snap = carregarSnapshot()
    const notifs = carregarNotificacoes()
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
        novas.push({
            id: novoId(),
            at: new Date().toISOString(),
            ...item,
        })
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

    gravarSnapshot(nextSnap)
    if (novas.length) {
        gravarNotificacoes([...novas, ...notifs])
    }
    return { novas: novas.length, lista: carregarNotificacoes() }
}
