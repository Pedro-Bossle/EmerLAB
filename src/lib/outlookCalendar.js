const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

function parseGraphDateTime(dateTime, timeZone) {
    if (!dateTime) return null
    const s = String(dateTime)
    const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
    const normalized = hasOffset ? s : `${s.replace(/\.\d+$/, '')}Z`
    const d = new Date(normalized)
    if (Number.isNaN(d.getTime())) {
        return { date: null, timeZone: timeZone || null }
    }
    return { date: d, timeZone: timeZone || null }
}

export function mapEventoOutlook(row) {
    if (!row) return null
    const start = parseGraphDateTime(row.start?.dateTime, row.start?.timeZone)
    const end = parseGraphDateTime(row.end?.dateTime, row.end?.timeZone)
    return {
        id: row.id,
        subject: row.subject || '(Sem título)',
        start: start?.date,
        end: end?.date,
        isAllDay: Boolean(row.isAllDay),
        location: row.location?.displayName || '',
        webLink: row.webLink || '',
    }
}

export function formatarHorarioEvento(ev) {
    if (!ev) return ''
    if (ev.isAllDay) return 'Dia inteiro'
    if (!ev.start) return '—'
    return ev.start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatarDataEvento(ev) {
    if (!ev?.start) return ''
    return ev.start.toLocaleDateString('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
    })
}

export async function listarEventosOutlook(accessToken, { dias = 7, limite = 20 } = {}) {
    if (!accessToken) throw new Error('Token Microsoft ausente.')

    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + Math.max(1, dias))
    end.setHours(23, 59, 59, 999)

    const url = new URL(`${GRAPH_ROOT}/me/calendarView`)
    url.searchParams.set('startDateTime', start.toISOString())
    url.searchParams.set('endDateTime', end.toISOString())
    url.searchParams.set('$orderby', 'start/dateTime')
    url.searchParams.set('$top', String(limite))
    url.searchParams.set('$select', 'subject,start,end,location,isAllDay,webLink')

    const res = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'outlook.timezone="E. South America Standard Time"',
        },
    })

    if (!res.ok) {
        let msg = `Microsoft Graph (${res.status})`
        try {
            const err = await res.json()
            msg = err?.error?.message || msg
        } catch {
            /* ignore */
        }
        throw new Error(msg)
    }

    const data = await res.json()
    return (data.value || []).map(mapEventoOutlook).filter(Boolean)
}
