/**
 * Exportação de calendário (.ics) — iPhone, Google, Outlook, etc.
 */

function pad2(n) {
    return String(n).padStart(2, '0')
}

/** YYYYMMDDTHHMMSSZ (UTC) */
export function formatIcsDateTimeUtc(date) {
    const d = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(d.getTime())) return null
    return (
        `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
        `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
    )
}

/** YYYYMMDD (data local, dia inteiro) */
export function formatIcsDateLocal(date) {
    const d = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function addDaysYmd(ymd, days) {
    const y = Number(ymd.slice(0, 4))
    const m = Number(ymd.slice(4, 6)) - 1
    const day = Number(ymd.slice(6, 8))
    const d = new Date(y, m, day + days)
    return formatIcsDateLocal(d)
}

function foldIcsLine(line) {
    const s = String(line)
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
    const byteLen = (str) => (encoder ? encoder.encode(str).length : str.length)

    if (byteLen(s) <= 75) return s

    const parts = []
    let rest = s
    let first = ''
    for (const ch of rest) {
        const next = first + ch
        if (byteLen(next) > 75) break
        first = next
    }
    parts.push(first)
    rest = rest.slice(first.length)

    while (rest.length) {
        let chunk = ''
        for (const ch of rest) {
            const next = chunk + ch
            if (byteLen(next) > 74) break
            chunk = next
        }
        if (!chunk) {
            // Fallback se um code point sozinho exceder 74 bytes (improvável)
            chunk = rest[0] || ''
        }
        parts.push(` ${chunk}`)
        rest = rest.slice(chunk.length)
    }
    return parts.join('\r\n')
}

function escapeIcsText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
}

/**
 * @param {{ uid: string, summary: string, description?: string, location?: string, start: Date, end?: Date, allDay?: boolean }} ev
 */
export function buildIcsEvent(ev) {
    const now = formatIcsDateTimeUtc(new Date())
    const uid = String(ev.uid || `emerlab-${Date.now()}@emerlab.local`)
    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${now}`,
    ]

    if (ev.allDay) {
        const start = formatIcsDateLocal(ev.start)
        if (!start) return null
        const end = ev.end ? formatIcsDateLocal(ev.end) : addDaysYmd(start, 1)
        lines.push(`DTSTART;VALUE=DATE:${start}`)
        lines.push(`DTEND;VALUE=DATE:${end || addDaysYmd(start, 1)}`)
    } else {
        const start = formatIcsDateTimeUtc(ev.start)
        if (!start) return null
        const endDate = ev.end || new Date(ev.start.getTime() + 60 * 60 * 1000)
        const end = formatIcsDateTimeUtc(endDate)
        lines.push(`DTSTART:${start}`)
        lines.push(`DTEND:${end}`)
    }

    lines.push(`SUMMARY:${escapeIcsText(ev.summary || '(Sem título)')}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`)
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`)
    lines.push('END:VEVENT')
    return lines.map(foldIcsLine).join('\r\n')
}

/**
 * @param {Array<Parameters<typeof buildIcsEvent>[0]>} events
 * @param {{ calendarName?: string }} [opts]
 */
export function buildIcsCalendar(events, opts = {}) {
    const name = opts.calendarName || 'EmerLAB'
    const body = (events || []).map(buildIcsEvent).filter(Boolean).join('\r\n')
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//EmerLAB//Calendar Export//PT',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeIcsText(name)}`,
        body,
        'END:VCALENDAR',
    ]
    return `${lines.filter(Boolean).join('\r\n')}\r\n`
}

export function downloadTextFile(filename, content, mime = 'text/calendar;charset=utf-8') {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

/**
 * Partilha nativa (iPhone/Android) ou download .ics.
 * @returns {'shared' | 'downloaded'}
 */
export async function saveOrShareIcs(filename, icsContent) {
    const file = new File([icsContent], filename, { type: 'text/calendar' })
    try {
        if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: filename.replace(/\.ics$/i, ''),
                text: 'Calendário EmerLAB — abra em Calendário / Apple Calendar / Google.',
            })
            return 'shared'
        }
    } catch (e) {
        if (e?.name === 'AbortError') return 'shared'
        /* cai no download */
    }
    downloadTextFile(filename, icsContent)
    return 'downloaded'
}

/** Afazeres Home → eventos dia inteiro no prazo (ou hoje se sem prazo). */
export function tarefasParaIcsEvents(tarefas) {
    const hoje = new Date()
    hoje.setHours(12, 0, 0, 0)
    return (tarefas || [])
        .filter((t) => t && t.status !== 'cancelada')
        .map((t) => {
            let start = hoje
            if (t.prazo) {
                const d = new Date(`${t.prazo}T12:00:00`)
                if (!Number.isNaN(d.getTime())) start = d
            }
            const partes = [
                t.observacoes ? String(t.observacoes).trim() : '',
                t.atribuidoNome ? `Atribuído: ${t.atribuidoNome}` : '',
                t.status ? `Status: ${t.status}` : '',
                !t.prazo ? 'Sem prazo definido (data = hoje na exportação).' : '',
            ].filter(Boolean)
            return {
                uid: `emerlab-tarefa-${t.id}@emerlab`,
                summary: t.titulo || 'Afazer',
                description: partes.join('\n'),
                start,
                allDay: true,
            }
        })
}

/** Eventos Outlook já mapeados → ICS */
export function outlookEventosParaIcsEvents(eventos) {
    return (eventos || [])
        .filter((ev) => ev?.start)
        .map((ev) => ({
            uid: `emerlab-outlook-${String(ev.id || '').replace(/[^a-zA-Z0-9_-]/g, '') || Date.now()}@emerlab`,
            summary: ev.subject || '(Sem título)',
            description: ev.webLink ? `Outlook: ${ev.webLink}` : '',
            location: ev.location || '',
            start: ev.start,
            end: ev.end || undefined,
            allDay: Boolean(ev.isAllDay),
        }))
}

export async function exportarTarefasIcs(tarefas, { filename } = {}) {
    const events = tarefasParaIcsEvents(tarefas)
    if (!events.length) throw new Error('Nenhum afazer para exportar.')
    const ics = buildIcsCalendar(events, { calendarName: 'EmerLAB Afazeres' })
    const name = filename || `emerlab-afazeres-${formatIcsDateLocal(new Date())}.ics`
    return saveOrShareIcs(name, ics)
}

export async function exportarAgendaIcs(eventos, { filename } = {}) {
    const events = outlookEventosParaIcsEvents(eventos)
    if (!events.length) throw new Error('Nenhum evento na agenda para exportar.')
    const ics = buildIcsCalendar(events, { calendarName: 'EmerLAB Agenda' })
    const name = filename || `emerlab-agenda-${formatIcsDateLocal(new Date())}.ics`
    return saveOrShareIcs(name, ics)
}
