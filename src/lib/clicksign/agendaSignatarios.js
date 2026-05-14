/** Agenda local de signatários (localStorage). */

const STORAGE_KEY = 'emerdog_cs_agenda_signatarios'

function safeParse(json) {
    try {
        const v = JSON.parse(json || '[]')
        return Array.isArray(v) ? v : []
    } catch {
        return []
    }
}

export function carregarAgendaSignatarios() {
    try {
        return safeParse(localStorage.getItem(STORAGE_KEY))
    } catch {
        return []
    }
}

export function gravarAgendaSignatarios(lista) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lista))
    } catch {
        /* ignore */
    }
}

/** Gera id estável para itens da agenda (sem crypto em ambientes antigos). */
export function novoIdAgenda() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `ag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function alternarFavoritoAgenda(localId) {
    const lista = carregarAgendaSignatarios()
    const i = lista.findIndex((x) => x.localId === localId)
    if (i === -1) return lista
    const next = [...lista]
    next[i] = { ...next[i], favorite: !next[i].favorite }
    gravarAgendaSignatarios(next)
    return next
}

/** Insere ou atualiza por e-mail + nome; preserva favorite se já existir. */
export function upsertContatoAgenda(contato) {
    const nome = String(contato.name || '').trim()
    const email = String(contato.email || '').trim().toLowerCase()
    const phone = String(contato.phone || '').trim()
    const channel = contato.channel === 'whatsapp' ? 'whatsapp' : 'email'
    const papel = String(contato.papel || 'sign').trim() || 'sign'
    if (!nome) return carregarAgendaSignatarios()
    if (channel === 'email' && !email) return carregarAgendaSignatarios()
    if (channel === 'whatsapp') {
        const d = String(phone || '').replace(/\D/g, '')
        if (d.length < 10) return carregarAgendaSignatarios()
    }

    const lista = carregarAgendaSignatarios()
    const nomeKey = nome.toLowerCase()
    const key =
        channel === 'whatsapp' && !email
            ? `w:${String(phone || '').replace(/\D/g, '')}|${nomeKey}`
            : `${email}|${nomeKey}`
    const idx = lista.findIndex((x) => {
        const nk = String(x.name || '').trim().toLowerCase()
        if (x.channel === 'whatsapp' && !String(x.email || '').trim()) {
            return `w:${String(x.phone || '').replace(/\D/g, '')}|${nk}` === key
        }
        return `${String(x.email || '').toLowerCase()}|${nk}` === key
    })
    const base = {
        localId: idx === -1 ? novoIdAgenda() : lista[idx].localId,
        name: nome,
        email: email || '',
        phone,
        channel,
        papel,
        favorite: idx === -1 ? false : !!lista[idx].favorite,
        criadoEm: idx === -1 ? new Date().toISOString() : lista[idx].criadoEm,
    }
    if (idx === -1) lista.push(base)
    else lista[idx] = { ...lista[idx], ...base }
    gravarAgendaSignatarios(lista)
    return lista
}

/** Remove um contacto da agenda local por `localId`. */
export function removerContatoAgendaPorId(localId) {
    const id = String(localId || '').trim()
    if (!id) return carregarAgendaSignatarios()
    const lista = carregarAgendaSignatarios().filter((x) => String(x.localId || '') !== id)
    gravarAgendaSignatarios(lista)
    return lista
}

/** Atualiza um contacto existente (por `localId`). Mantém favorito e `criadoEm`. */
export function atualizarContatoAgendaPorId(localId, { name, email, phone, channel, papel }) {
    const lista = carregarAgendaSignatarios()
    const i = lista.findIndex((x) => x.localId === localId)
    if (i === -1) return lista
    const nome = String(name || '').trim()
    const em = String(email || '').trim().toLowerCase()
    const ph = String(phone || '').trim()
    const ch = channel === 'whatsapp' ? 'whatsapp' : 'email'
    const pap = String(papel || 'sign').trim() || 'sign'
    if (!nome) return carregarAgendaSignatarios()
    if (ch === 'email' && !em) return carregarAgendaSignatarios()
    if (ch === 'whatsapp') {
        const d = ph.replace(/\D/g, '')
        if (d.length < 10) return carregarAgendaSignatarios()
    }
    const prev = lista[i]
    const next = [...lista]
    next[i] = {
        ...prev,
        name: nome,
        email: em || '',
        phone: ph,
        channel: ch,
        papel: pap,
    }
    gravarAgendaSignatarios(next)
    return next
}
