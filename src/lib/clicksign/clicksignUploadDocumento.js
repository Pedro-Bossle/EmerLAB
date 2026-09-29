/**
 * Staging de PDF no Storage + anexação via /api/clicksign-upload-document.
 * Evita 413 na Vercel (limite ~4,5 MB no body do proxy JSON/base64).
 */

import { nomeArquivoPdfSeguro } from './clicksignClient.js'

export const CLICKSIGN_UPLOADS_BUCKET = 'clicksign-uploads'
/** Limite prático via proxy direto (base64 + JSON < ~4,5 MB na Vercel). */
export const CLICKSIGN_PDF_PROXY_MAX_BYTES = Math.floor(2.8 * 1024 * 1024)
/** Limite via Storage → API dedicada. */
export const CLICKSIGN_PDF_STORAGE_MAX_BYTES = 12 * 1024 * 1024

/**
 * Garante JWT fresco antes de upload (evita «Sessão ausente» a meio do anexo).
 */
export async function garantirSessaoClicksign() {
    const { supabase } = await import('../supabase.js')
    if (!supabase) return { ok: false, error: 'Supabase indisponível.' }
    const { data: cur } = await supabase.auth.getSession()
    const session = cur?.session
    if (!session?.access_token) {
        const refreshed = await supabase.auth.refreshSession()
        if (!refreshed?.data?.session?.access_token) {
            return { ok: false, error: 'Sessão ausente. Saia e entre de novo.' }
        }
        return { ok: true, session: refreshed.data.session }
    }
    const expiresAtMs = session.expires_at ? Number(session.expires_at) * 1000 : 0
    if (expiresAtMs > 0 && expiresAtMs < Date.now() + 120_000) {
        const refreshed = await supabase.auth.refreshSession()
        if (refreshed?.data?.session?.access_token) {
            return { ok: true, session: refreshed.data.session }
        }
    }
    return { ok: true, session }
}

/**
 * @param {string} envelopeId
 * @param {File|Blob} file
 * @param {{ nomeArquivo?: string }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: object, mode?: string }>}
 */
export async function anexarPdfEnvelopeViaStorage(envelopeId, file, opts = {}) {
    const eid = String(envelopeId || '').trim()
    if (!eid) {
        return { ok: false, status: 400, data: { error: 'ID do envelope ausente.' } }
    }
    if (!file) {
        return { ok: false, status: 400, data: { error: 'Ficheiro ausente.' } }
    }
    const size = Number(file.size) || 0
    if (size > CLICKSIGN_PDF_STORAGE_MAX_BYTES) {
        return {
            ok: false,
            status: 413,
            data: {
                error: `O PDF ultrapassa ${CLICKSIGN_PDF_STORAGE_MAX_BYTES / (1024 * 1024)} MB.`,
            },
        }
    }

    const sess = await garantirSessaoClicksign()
    if (!sess.ok) {
        return { ok: false, status: 401, data: { error: sess.error } }
    }
    const uid = String(sess.session?.user?.id || '').trim()
    if (!uid) {
        return { ok: false, status: 401, data: { error: 'Sessão sem utilizador.' } }
    }

    const { supabase } = await import('../supabase.js')
    const filename = nomeArquivoPdfSeguro(opts.nomeArquivo || file.name || 'documento.pdf')
    const stamp = Date.now()
    const storagePath = `${uid}/${eid}/${stamp}_${filename}`

    const { error: upErr } = await supabase.storage
        .from(CLICKSIGN_UPLOADS_BUCKET)
        .upload(storagePath, file, {
            contentType: 'application/pdf',
            upsert: false,
        })
    if (upErr) {
        const msg = String(upErr.message || upErr.error || '')
        const semBucket =
            /bucket|not found|does not exist|row-level security|policy|403|404/i.test(msg)
        return {
            ok: false,
            status: semBucket ? 503 : 400,
            data: {
                error: semBucket
                    ? 'Bucket clicksign-uploads em falta ou sem permissão. Crie o bucket no Supabase (ver supabase/clicksign_uploads_bucket.sql) e tente de novo.'
                    : msg || 'Falha no upload temporário do PDF.',
            },
        }
    }

    const { userAccessTokenHeaders } = await import('../api/serverBackend.js')
    let auth = await userAccessTokenHeaders()
    if (!auth.Authorization) {
        await garantirSessaoClicksign()
        auth = await userAccessTokenHeaders()
    }
    if (!auth.Authorization) {
        try {
            await supabase.storage.from(CLICKSIGN_UPLOADS_BUCKET).remove([storagePath])
        } catch {
            /* ignore */
        }
        return { ok: false, status: 401, data: { error: 'Sessão ausente. Saia e entre de novo.' } }
    }

    const res = await fetch('/api/clicksign-upload-document', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...auth,
        },
        body: JSON.stringify({ envelopeId: eid, filename, storagePath }),
    })

    let data = {}
    const text = await res.text()
    if (text.trim()) {
        try {
            data = JSON.parse(text)
        } catch {
            data = { error: 'Resposta não JSON', raw: text.slice(0, 300) }
        }
    }
    if (!res.ok && (res.status === 401 || res.status === 403) && !data.error) {
        data.error = 'Sessão ausente ou sem permissão para anexar documentos.'
    }
    return { ok: res.ok, status: res.status, data, mode: 'storage' }
}
