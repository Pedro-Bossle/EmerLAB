// Formatação e helpers de interface

export const CANAIS = {
    whatsapp: { rotulo: 'WhatsApp', cor: '#25D366', semNome: 'Contato do WhatsApp' },
    instagram: { rotulo: 'Instagram', cor: '#E1306C', semNome: 'Contato do Instagram' },
    messenger: { rotulo: 'Messenger', cor: '#0866FF', semNome: 'Contato do Messenger' },
}

export function canalDoId(id) {
    const p = String(id || '').split(':')[0]
    return p === 'ig' ? 'instagram' : p === 'ms' ? 'messenger' : 'whatsapp'
}

export function formatarTelefone(waId) {
    if (canalDoId(waId) !== 'whatsapp') return ''
    const d = String(waId || '').replace(/\D/g, '')
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        const ddd = d.slice(2, 4)
        const resto = d.slice(4)
        const meio = resto.length === 9 ? `${resto.slice(0, 5)}-${resto.slice(5)}` : `${resto.slice(0, 4)}-${resto.slice(4)}`
        return `+55 ${ddd} ${meio}`
    }
    return d ? `+${d}` : ''
}

export function nomeExibicao(c) {
    return c?.nome || formatarTelefone(c?.waId) || CANAIS[canalDoId(c?.waId)].semNome
}

export function iniciais(nome) {
    const partes = String(nome || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean)
    if (!partes.length) return '#'
    return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

const CORES_AVATAR = ['#00a884', '#53bdeb', '#ff7eb6', '#ffbc38', '#a791ff', '#06cf9c', '#fc9775', '#7f66ff', '#e26ab6', '#25d366']
export function corAvatar(semente) {
    let h = 0
    for (const ch of String(semente || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return CORES_AVATAR[h % CORES_AVATAR.length]
}

const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function horaCurta(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Como na lista do WhatsApp: hora (hoje), "Ontem", dia da semana, ou data
export function dataLista(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const hoje = new Date()
    if (mesmoDia(d, hoje)) return horaCurta(iso)
    const ontem = new Date(hoje)
    ontem.setDate(hoje.getDate() - 1)
    if (mesmoDia(d, ontem)) return 'Ontem'
    if (hoje - d < 6 * 864e5) return d.toLocaleDateString('pt-BR', { weekday: 'long' })
    return d.toLocaleDateString('pt-BR')
}

export function rotuloDia(iso) {
    const d = new Date(iso)
    const hoje = new Date()
    if (mesmoDia(d, hoje)) return 'Hoje'
    const ontem = new Date(hoje)
    ontem.setDate(hoje.getDate() - 1)
    if (mesmoDia(d, ontem)) return 'Ontem'
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function chaveDia(iso) {
    const d = new Date(iso)
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Janela de 24h do WhatsApp: só dá para mandar mensagem livre se o cliente escreveu nas últimas 24h
export function janelaAberta(mensagens) {
    const ultimaDoCliente = [...mensagens].reverse().find((m) => !m.minha && m.evento === 'message')
    if (!ultimaDoCliente?.em) return false
    return Date.now() - new Date(ultimaDoCliente.em).getTime() < 24 * 3600 * 1000
}

// Negrito/itálico/tachado/mono no estilo WhatsApp (sobre texto já escapado pelo React via partes)
export function formatarWhatsapp(texto) {
    const tokens = []
    const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|https?:\/\/[^\s]+)/g
    let ultimo = 0
    let m
    while ((m = re.exec(texto))) {
        if (m.index > ultimo) tokens.push({ t: 'txt', v: texto.slice(ultimo, m.index) })
        const s = m[0]
        if (s.startsWith('http')) tokens.push({ t: 'link', v: s })
        else if (s.startsWith('```')) tokens.push({ t: 'mono', v: s.slice(3, -3) })
        else tokens.push({ t: { '*': 'b', _: 'i', '~': 's' }[s[0]], v: s.slice(1, -1) })
        ultimo = m.index + s.length
    }
    if (ultimo < texto.length) tokens.push({ t: 'txt', v: texto.slice(ultimo) })
    return tokens
}

export function ler(chave, padrao) {
    try {
        const v = localStorage.getItem(chave)
        return v == null ? padrao : JSON.parse(v)
    } catch {
        return padrao
    }
}

export function gravar(chave, valor) {
    try {
        localStorage.setItem(chave, JSON.stringify(valor))
    } catch {
        /* armazenamento indisponível — só não persiste */
    }
}
