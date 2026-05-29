import { normalizarTelefoneBr } from './clicksignClient.js'

/** PATCH `/envelopes/:eid/signers/:sid` — atualizar nome, e-mail e telefone. */
export function payloadAtualizarSignatario({ name, email, phone, channel = 'email' }) {
    const attrs = {
        name: String(name || '').trim(),
        email: String(email || '').trim().toLowerCase(),
    }
    if (String(channel || '').toLowerCase() === 'whatsapp') {
        const tel = normalizarTelefoneBr(phone)
        if (tel) attrs.phone_number = tel
    }
    return {
        data: {
            type: 'signers',
            attributes: attrs,
        },
    }
}

/** Caminhos usados para reenviar convite / lembrete ao signatário (API v3). */
export const PATHS_LEMBRETE_SIGNATARIO = (eid, sid) => [
    `/envelopes/${encodeURIComponent(eid)}/signers/${encodeURIComponent(sid)}/notifications`,
    `/envelopes/${encodeURIComponent(eid)}/notifications`,
]
