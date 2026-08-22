/**
 * Metadados de reunião Outlook embutidos no corpo do card Kanban
 * (sem exigir nova coluna SQL).
 */

const MARKER_START = '<!-- outlook-reuniao:'
const MARKER_END = ' -->'

/** Regex compartilhado para remover blocos de metadados Outlook. */
export const OUTLOOK_META_BLOCK_RE = /<!--\s*outlook-reuniao:[\s\S]*?-->\s*/g

function encodeMetaPayload(obj) {
    const json = JSON.stringify(obj)
    const bytes = new TextEncoder().encode(json)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
}

function decodeMetaPayload(raw) {
    const s = String(raw || '').trim()
    if (!s) throw new Error('payload vazio')
    if (s.startsWith('{')) return JSON.parse(s)
    const bin = atob(s)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
}

export function lerMetaOutlookReuniao(corpo) {
    const raw = String(corpo || '')
    const i = raw.indexOf(MARKER_START)
    if (i < 0) return null
    const j = raw.indexOf(MARKER_END, i)
    if (j < 0) return null
    try {
        const payload = raw.slice(i + MARKER_START.length, j).trim()
        const meta = decodeMetaPayload(payload)
        if (!meta || typeof meta !== 'object') return null
        return {
            eventId: meta.eventId ? String(meta.eventId) : '',
            webLink: meta.webLink ? String(meta.webLink) : '',
            subject: meta.subject ? String(meta.subject) : '',
            start: meta.start ? String(meta.start) : '',
            end: meta.end ? String(meta.end) : '',
            attendees: Array.isArray(meta.attendees) ? meta.attendees.map(String) : [],
        }
    } catch {
        return null
    }
}

export function escreverMetaOutlookReuniao(corpo, meta) {
    const limpo = String(corpo || '').replace(OUTLOOK_META_BLOCK_RE, '').trimEnd()
    if (!meta || !meta.eventId) return limpo
    const encoded = encodeMetaPayload({
        eventId: meta.eventId,
        webLink: meta.webLink || '',
        subject: meta.subject || '',
        start: meta.start || '',
        end: meta.end || '',
        attendees: meta.attendees || [],
    })
    const bloco = `${MARKER_START}${encoded}${MARKER_END}`
    return limpo ? `${limpo}\n\n${bloco}` : bloco
}

/** Remove o marcador oculto para edição humana do markdown. */
export function corpoVisivelSemMetaOutlook(corpo) {
    return String(corpo || '').replace(OUTLOOK_META_BLOCK_RE, '').trimEnd()
}
