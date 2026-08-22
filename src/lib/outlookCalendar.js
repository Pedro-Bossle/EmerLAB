const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const GRAPH_FETCH_TIMEOUT_MS = 30000

/** Timezones IANA comuns → Windows (Microsoft Graph). */
const IANA_TO_GRAPH_TZ = {
    'America/Sao_Paulo': 'E. South America Standard Time',
    'America/Fortaleza': 'SA Eastern Standard Time',
    'America/Manaus': 'SA Western Standard Time',
}

async function fetchGraph(url, options = {}, timeoutMs = GRAPH_FETCH_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

function resolverTimeZoneGraph(optsTimeZone) {
    const explicito = String(optsTimeZone || '').trim()
    if (explicito) return explicito
    try {
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (browserTz && IANA_TO_GRAPH_TZ[browserTz]) return IANA_TO_GRAPH_TZ[browserTz]
    } catch {
        /* fallback abaixo */
    }
    return 'E. South America Standard Time'
}

export function escapeHtmlBasico(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

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
        onlineMeetingUrl: row.onlineMeeting?.joinUrl || '',
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
    url.searchParams.set('$select', 'subject,start,end,location,isAllDay,webLink,onlineMeeting')

    const res = await fetchGraph(url.toString(), {
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

/**
 * Cria evento no calendário Outlook e envia convites aos convidados.
 * @param {string} accessToken
 * @param {{
 *   subject: string,
 *   start: Date|string,
 *   end: Date|string,
 *   timeZone?: string,
 *   body?: string,
 *   location?: string,
 *   attendees?: Array<string|{ email: string, name?: string }>,
 *   isOnlineMeeting?: boolean,
 * }} opts
 */
export async function criarEventoOutlook(accessToken, opts = {}) {
    if (!accessToken) throw new Error('Token Microsoft ausente.')
    const subject = String(opts.subject || '').trim()
    if (!subject) throw new Error('Informe o assunto da reunião.')

    const start = opts.start instanceof Date ? opts.start : new Date(opts.start)
    const end = opts.end instanceof Date ? opts.end : new Date(opts.end)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
        throw new Error('Datas da reunião inválidas.')
    }
    if (end.getTime() <= start.getTime()) {
        throw new Error('A data/hora de fim deve ser depois do início.')
    }

    const timeZone = resolverTimeZoneGraph(opts.timeZone)
    const attendees = normalizarConvidadosOutlook(opts.attendees)

    const payload = {
        subject,
        body: {
            contentType: 'HTML',
            content: String(opts.body || '').trim() || `<p>${escapeHtmlBasico(subject)}</p>`,
        },
        start: {
            dateTime: formatGraphLocalDateTime(start),
            timeZone,
        },
        end: {
            dateTime: formatGraphLocalDateTime(end),
            timeZone,
        },
        location: opts.location
            ? { displayName: String(opts.location).trim() }
            : undefined,
        attendees: attendees.map((a) => ({
            emailAddress: {
                address: a.email,
                name: a.name || a.email,
            },
            type: 'required',
        })),
        isOnlineMeeting: Boolean(opts.isOnlineMeeting),
        onlineMeetingProvider: opts.isOnlineMeeting ? 'teamsForBusiness' : undefined,
        allowNewTimeProposals: true,
        responseRequested: attendees.length > 0,
    }

    if (!payload.location) delete payload.location
    if (!payload.isOnlineMeeting) delete payload.onlineMeetingProvider

    const res = await fetchGraph(`${GRAPH_ROOT}/me/events`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: `outlook.timezone="${timeZone}"`,
        },
        body: JSON.stringify(payload),
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

    const row = await res.json()
    return mapEventoOutlook(row)
}

function formatGraphLocalDateTime(d) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function normalizarConvidadosOutlook(lista) {
    const out = []
    const visto = new Set()
    for (const raw of lista || []) {
        let email = ''
        let name = ''
        if (typeof raw === 'string') {
            email = raw.trim().toLowerCase()
        } else if (raw && typeof raw === 'object') {
            email = String(raw.email || raw.address || '').trim().toLowerCase()
            name = String(raw.name || raw.nome || '').trim()
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
        if (visto.has(email)) continue
        visto.add(email)
        out.push({ email, name })
    }
    return out
}

/** Parseia e-mails de uma linha (vírgula / ; / espaço). */
export function parseEmailsConvidados(texto) {
    return normalizarConvidadosOutlook(
        String(texto || '')
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
    )
}

