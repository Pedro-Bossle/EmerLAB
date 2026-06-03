import { erroApiTexto, normalizarTelefoneBr } from './clicksignClient.js'



/** PATCH `/envelopes/:eid/signers/:sid` — atualizar nome, e-mail e telefone. */

export function payloadAtualizarSignatario({ signerId, name, email, phone, channel = 'email' }) {
    const attrs = {
        name: String(name || '').trim(),
        email: String(email || '').trim().toLowerCase(),
    }
    if (String(channel || '').toLowerCase() === 'whatsapp') {
        const tel = normalizarTelefoneBr(phone)
        if (tel) attrs.phone_number = tel
    }
    const data = {
        type: 'signers',
        attributes: attrs,
    }
    const id = String(signerId || '').trim()
    if (id) data.id = id
    return { data }
}



/** Limite oficial Clicksign: 1 notificação por minuto por endpoint de signatário. */

export const LEMBRETE_SIGNATARIO_INTERVALO_MS = 60_000



/** POST notificar um signatário (API v3 — solicitação de assinatura). */

export const pathLembreteSignatario = (envelopeId, signerId) =>

    `/envelopes/${encodeURIComponent(envelopeId)}/signers/${encodeURIComponent(signerId)}/notifications`



/** @deprecated Use pathLembreteSignatario — não dispare vários endpoints (aumenta 429). */

export const PATHS_LEMBRETE_SIGNATARIO = (eid, sid) => [pathLembreteSignatario(eid, sid)]



export function payloadNotificacaoLembrete() {

    return {

        data: {

            type: 'notifications',

            attributes: {},

        },

    }

}



/**

 * Envia lembrete (solicitação de assinatura) a um signatário.

 * @param {(method: string, path: string, body?: object) => Promise<{ok: boolean, status: number, data: unknown}>} csRequest

 * @param {Map<string, number>} [cacheUltimoEnvio] chave `${envelopeId}:${signerId}` → timestamp

 */

export async function enviarLembreteSignatario(csRequest, envelopeId, signerId, cacheUltimoEnvio) {

    const eid = String(envelopeId || '').trim()

    const sid = String(signerId || '').trim()

    if (!eid || !sid) {

        return { ok: false, message: 'Envelope ou signatário inválido.' }

    }



    const cacheKey = `${eid}:${sid}`

    if (cacheUltimoEnvio) {

        const last = cacheUltimoEnvio.get(cacheKey)

        if (last && Date.now() - last < LEMBRETE_SIGNATARIO_INTERVALO_MS) {

            const seg = Math.ceil((LEMBRETE_SIGNATARIO_INTERVALO_MS - (Date.now() - last)) / 1000)

            return {

                ok: false,

                rateLimited: true,

                message: `Aguarde cerca de ${seg}s. A Clicksign permite no máximo 1 lembrete por minuto para cada signatário.`,

            }

        }

    }



    const r = await csRequest('POST', pathLembreteSignatario(eid, sid), payloadNotificacaoLembrete())



    if (r.ok) {

        if (cacheUltimoEnvio) cacheUltimoEnvio.set(cacheKey, Date.now())

        return { ok: true }

    }



    if (r.status === 429) {

        if (cacheUltimoEnvio) cacheUltimoEnvio.set(cacheKey, Date.now())

        return {

            ok: false,

            rateLimited: true,

            message:

                'Limite da Clicksign (429): no máximo 1 lembrete por minuto para este signatário. Aguarde 1 minuto e tente de novo, ou envie pelo painel da Clicksign.',

        }

    }



    return {

        ok: false,

        message:

            erroApiTexto(r.data) ||

            'Não foi possível enviar o lembrete. Confirme que o envelope está «em processo» (running) e que o signatário ainda não assinou.',

    }

}


