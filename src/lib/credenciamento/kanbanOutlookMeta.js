/**
 * Metadados de reunião Outlook embutidos no corpo do card Kanban
 * (sem exigir nova coluna SQL).
 */

const MARKER_START = '<!-- outlook-reuniao:'
const MARKER_END = ' -->'

export function lerMetaOutlookReuniao(corpo) {
    const raw = String(corpo || '')
    const i = raw.indexOf(MARKER_START)
    if (i < 0) return null
    const j = raw.indexOf(MARKER_END, i)
    if (j < 0) return null
    try {
        const json = raw.slice(i + MARKER_START.length, j).trim()
        const meta = JSON.parse(json)
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
    const limpo = String(corpo || '')
        .replace(/<!--\s*outlook-reuniao:[\s\S]*?-->\s*/g, '')
        .trimEnd()
    if (!meta || !meta.eventId) return limpo
    const bloco = `${MARKER_START}${JSON.stringify({
        eventId: meta.eventId,
        webLink: meta.webLink || '',
        subject: meta.subject || '',
        start: meta.start || '',
        end: meta.end || '',
        attendees: meta.attendees || [],
    })}${MARKER_END}`
    return limpo ? `${limpo}\n\n${bloco}` : bloco
}

/** Remove o marcário oculto para edição humana do markdown. */
export function corpoVisivelSemMetaOutlook(corpo) {
    return String(corpo || '')
        .replace(/<!--\s*outlook-reuniao:[\s\S]*?-->\s*/g, '')
        .trimEnd()
}
