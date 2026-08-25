const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const GRAPH_FETCH_TIMEOUT_MS = 30000

/** Timezones IANA → Windows (Microsoft Graph Prefer: outlook.timezone). */
const IANA_TO_GRAPH_TZ = {
    'America/Sao_Paulo': 'E. South America Standard Time',
    'America/Bahia': 'E. South America Standard Time',
    'America/Fortaleza': 'SA Eastern Standard Time',
    'America/Recife': 'SA Eastern Standard Time',
    'America/Maceio': 'SA Eastern Standard Time',
    'America/Belem': 'SA Eastern Standard Time',
    'America/Santarem': 'SA Eastern Standard Time',
    'America/Araguaina': 'Tocantins Standard Time',
    'America/Manaus': 'SA Western Standard Time',
    'America/Boa_Vista': 'SA Western Standard Time',
    'America/Porto_Velho': 'SA Western Standard Time',
    'America/Campo_Grande': 'Central Brazilian Standard Time',
    'America/Cuiaba': 'Central Brazilian Standard Time',
    'America/Rio_Branco': 'SA Pacific Standard Time',
    'America/Eirunepe': 'SA Pacific Standard Time',
    'America/Noronha': 'UTC-02',
    'America/New_York': 'Eastern Standard Time',
    'America/Chicago': 'Central Standard Time',
    'America/Denver': 'Mountain Standard Time',
    'America/Los_Angeles': 'Pacific Standard Time',
    'America/Argentina/Buenos_Aires': 'Argentina Standard Time',
    'America/Asuncion': 'Paraguay Standard Time',
    'Europe/Lisbon': 'GMT Standard Time',
    'Europe/London': 'GMT Standard Time',
    'UTC': 'UTC',
    'Etc/UTC': 'UTC',
}

const GRAPH_WINDOWS_TZ = new Set(Object.values(IANA_TO_GRAPH_TZ))

async function fetchGraph(url, options = {}, timeoutMs = GRAPH_FETCH_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

/** Resolve timezone Windows válida p/ Graph; não faz fallback silencioso para IANA não mapeada. */
function resolverTimeZoneGraph(optsTimeZone) {
    const explicito = String(optsTimeZone || '').trim()
    if (explicito) {
        if (IANA_TO_GRAPH_TZ[explicito]) return IANA_TO_GRAPH_TZ[explicito]
        if (explicito.includes('/')) {
            throw new Error(
                `Timezone IANA «${explicito}» sem mapeamento Windows no Graph. Informe um timeZone Windows válido.`,
            )
        }
        if (GRAPH_WINDOWS_TZ.has(explicito) || /standard time|^UTC([+-]\d+)?$/i.test(explicito)) {
            return explicito
        }
        throw new Error(`Timezone Graph inválida: «${explicito}». Use um ID Windows (ex.: E. South America Standard Time).`)
    }
    let browserTz = ''
    try {
        browserTz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim()
    } catch {
        browserTz = ''
    }
    if (browserTz && IANA_TO_GRAPH_TZ[browserTz]) return IANA_TO_GRAPH_TZ[browserTz]
    throw new Error(
        browserTz
            ? `Timezone do browser «${browserTz}» sem mapeamento Windows no Graph. Passe opts.timeZone explícito.`
            : 'Informe opts.timeZone (Windows Graph, ex.: E. South America Standard Time).',
    )
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
    const s = String(dateTime).trim()
    if (!s) return null

    const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
    // Com Prefer outlook.timezone, o Graph devolve data/hora local SEM offset.
    // Não anexar "Z" (isso trataria o horário local como UTC e desloca o dia).
    if (!hasOffset) {
        const m = s.match(
            /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?/,
        )
        if (m) {
            const date = new Date(
                Number(m[1]),
                Number(m[2]) - 1,
                Number(m[3]),
                Number(m[4] || 0),
                Number(m[5] || 0),
                Number(m[6] || 0),
            )
            if (!Number.isNaN(date.getTime())) {
                return { date, timeZone: timeZone || null }
            }
        }
    }

    const d = new Date(s)
    if (Number.isNaN(d.getTime())) {
        return { date: null, timeZone: timeZone || null }
    }
    return { date: d, timeZone: timeZone || null }
}

/** Segunda 00:00 → domingo 23:59:59 da semana que contém `ref` (locale pt-BR). */
export function intervaloSemanaAtual(ref = new Date()) {
    const base = ref instanceof Date ? new Date(ref) : new Date(ref)
    if (Number.isNaN(base.getTime())) {
        return intervaloSemanaAtual(new Date())
    }
    const start = new Date(base)
    start.setHours(0, 0, 0, 0)
    const dow = start.getDay() // 0=dom … 6=sáb
    const diffToMon = dow === 0 ? -6 : 1 - dow
    start.setDate(start.getDate() + diffToMon)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return { start, end }
}

export function chaveDiaLocal(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Dias da semana (seg→dom) com eventos agrupados. */
export function montarDiasSemanaAgenda(eventos, { start, end } = intervaloSemanaAtual()) {
    const dias = []
    const cursor = new Date(start)
    cursor.setHours(0, 0, 0, 0)
    const fim = new Date(end)
    fim.setHours(0, 0, 0, 0)

    while (cursor.getTime() <= fim.getTime()) {
        dias.push({
            key: chaveDiaLocal(cursor),
            date: new Date(cursor),
            labelCurto: cursor.toLocaleDateString('pt-BR', { weekday: 'short' }),
            labelDia: cursor.toLocaleDateString('pt-BR', { day: '2-digit' }),
            labelMes: cursor.toLocaleDateString('pt-BR', { month: 'short' }),
            isHoje: chaveDiaLocal(cursor) === chaveDiaLocal(new Date()),
            eventos: [],
        })
        cursor.setDate(cursor.getDate() + 1)
    }

    const porDia = new Map(dias.map((d) => [d.key, d]))
    for (const ev of eventos || []) {
        if (!ev?.start) continue
        const key = chaveDiaLocal(ev.start)
        const bucket = porDia.get(key)
        if (bucket) bucket.eventos.push(ev)
    }
    for (const d of dias) {
        d.eventos.sort((a, b) => {
            if (a.isAllDay && !b.isAllDay) return -1
            if (!a.isAllDay && b.isAllDay) return 1
            return (a.start?.getTime() || 0) - (b.start?.getTime() || 0)
        })
    }
    return dias
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

export async function listarEventosOutlook(accessToken, opts = {}) {
    if (!accessToken) throw new Error('Token Microsoft ausente.')

    const dias = Math.max(1, Number(opts.dias) || 7)
    const limite = Math.min(Math.max(Number(opts.limite) || 50, 1), 100)
    const timeZone = resolverTimeZoneGraph(opts.timeZone)

    let start
    let end
    if (opts.start && opts.end) {
        start = opts.start instanceof Date ? opts.start : new Date(opts.start)
        end = opts.end instanceof Date ? opts.end : new Date(opts.end)
    } else if (opts.semanaAtual) {
        ;({ start, end } = intervaloSemanaAtual(opts.refDate))
    } else {
        start = new Date()
        start.setHours(0, 0, 0, 0)
        end = new Date(start)
        end.setDate(end.getDate() + dias - 1)
        end.setHours(23, 59, 59, 999)
    }

    const url = new URL(`${GRAPH_ROOT}/me/calendarView`)
    url.searchParams.set('startDateTime', start.toISOString())
    url.searchParams.set('endDateTime', end.toISOString())
    url.searchParams.set('$orderby', 'start/dateTime')
    url.searchParams.set('$top', String(limite))
    url.searchParams.set('$select', 'subject,start,end,location,isAllDay,webLink,onlineMeeting')

    const res = await fetchGraph(url.toString(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: `outlook.timezone="${timeZone}"`,
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

    const isAllDay = Boolean(opts.isAllDay)
    const start = opts.start instanceof Date ? opts.start : new Date(opts.start)
    let end = opts.end instanceof Date ? opts.end : opts.end != null ? new Date(opts.end) : null

    if (!Number.isFinite(start.getTime())) {
        throw new Error('Datas da reunião inválidas.')
    }

    if (isAllDay) {
        const diaInicio = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0)
        const diaFim = end && Number.isFinite(end.getTime())
            ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0)
            : new Date(diaInicio.getFullYear(), diaInicio.getMonth(), diaInicio.getDate() + 1)
        if (diaFim.getTime() <= diaInicio.getTime()) {
            diaFim.setDate(diaInicio.getDate() + 1)
        }
        start.setTime(diaInicio.getTime())
        end = diaFim
    } else {
        if (!end || !Number.isFinite(end.getTime())) {
            end = new Date(start.getTime() + 60 * 60 * 1000)
        }
        if (end.getTime() <= start.getTime()) {
            throw new Error('A data/hora de fim deve ser depois do início.')
        }
    }

    const timeZone = resolverTimeZoneGraph(opts.timeZone)
    const attendees = normalizarConvidadosOutlook(opts.attendees)

    const payload = {
        subject,
        isAllDay,
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

/**
 * Cria eventos Outlook a partir de afazeres da Home
 * (dia inteiro, ou com horário se a tarefa tiver horário).
 * @returns {{ criados: number, falhas: Array<{ titulo: string, erro: string }> }}
 */
export async function adicionarTarefasAoOutlook(accessToken, tarefas = []) {
    if (!accessToken) throw new Error('Token Microsoft ausente.')
    const lista = (tarefas || []).filter(
        (t) => t && t.status !== 'cancelada' && t.status !== 'concluida',
    )
    if (!lista.length) throw new Error('Nenhum afazer para adicionar ao calendário.')

    const hoje = new Date()
    hoje.setHours(12, 0, 0, 0)

    let criados = 0
    const falhas = []

    for (const t of lista) {
        let start = new Date(hoje)
        let isAllDay = true
        if (t.prazo) {
            const dataStr = String(t.prazo).slice(0, 10)
            const hora = String(t.horario || '').trim()
            if (/^\d{2}:\d{2}/.test(hora)) {
                const d = new Date(`${dataStr}T${hora.slice(0, 5)}:00`)
                if (!Number.isNaN(d.getTime())) {
                    start = d
                    isAllDay = false
                }
            } else {
                const d = new Date(`${dataStr}T12:00:00`)
                if (!Number.isNaN(d.getTime())) start = d
            }
        }
        const partes = [
            t.observacoes ? escapeHtmlBasico(String(t.observacoes).trim()) : '',
            t.atribuidoNome ? `Atribuído: ${escapeHtmlBasico(t.atribuidoNome)}` : '',
            t.status ? `Status: ${escapeHtmlBasico(t.status)}` : '',
            'Origem: EmerLAB Afazeres',
        ].filter(Boolean)

        try {
            await criarEventoOutlook(accessToken, {
                subject: String(t.titulo || 'Afazer').trim() || 'Afazer',
                start,
                isAllDay,
                body: `<p>${partes.join('</p><p>')}</p>`,
            })
            criados += 1
        } catch (e) {
            falhas.push({
                titulo: t.titulo || 'Afazer',
                erro: e?.message || String(e),
            })
        }
    }

    if (!criados && falhas.length) {
        throw new Error(falhas[0].erro || 'Falha ao criar eventos no Outlook.')
    }

    return { criados, falhas }
}

/** Dispara refresh da agenda na Home após criar eventos. */
export const OUTLOOK_AGENDA_REFRESH_EVENT = 'emerlab-outlook-agenda-refresh'

export function solicitarRefreshAgendaOutlook() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(OUTLOOK_AGENDA_REFRESH_EVENT))
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

