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

/**
 * Forma canônica do waId WhatsApp BR: celular com o 9º dígito.
 * Sem isso a WATI e o painel criam dois cards do mesmo contato (12 vs 13 dígitos).
 * Instagram/Messenger (`ig:` / `ms:`) passam intactos.
 */
export function normalizarWaId(id) {
    const s = String(id || '').trim()
    if (/^(ig|ms):/i.test(s)) return s
    const d = s.replace(/\D/g, '')
    if (!d) return ''
    // 55 + DDD + 8 dígitos começando em 6–9 = celular sem o 9
    if (d.startsWith('55') && d.length === 12) {
        const local = d.slice(4)
        if (local[0] >= '6' && local[0] <= '9') return `${d.slice(0, 4)}9${local}`
    }
    return d
}

/**
 * Variantes do mesmo celular BR para falar com a WATI.
 * A WATI pode ter o contato gravado com ou sem o 9º dígito — getMessages no formato
 * “errado” volta 400/vazio e o chat parece novo (só template), mesmo com prévia na lista.
 * Ordem: formato recebido primeiro, depois canônico, depois o alternativo.
 */
export function variantesWaId(id) {
    const s = String(id || '').trim()
    if (/^(ig|ms):/i.test(s)) return [s]
    const bruto = s.replace(/\D/g, '')
    if (!bruto) return []
    const canon = normalizarWaId(bruto)
    const out = []
    const add = (x) => {
        if (x && !out.includes(x)) out.push(x)
    }
    add(bruto)
    add(canon)
    if (canon.startsWith('55') && canon.length === 13 && canon[4] === '9') {
        add(`${canon.slice(0, 4)}${canon.slice(5)}`)
    }
    return out
}

export function formatarTelefone(waId) {
    if (canalDoId(waId) !== 'whatsapp') return ''
    const d = normalizarWaId(waId)
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        const ddd = d.slice(2, 4)
        const resto = d.slice(4)
        const meio = resto.length === 9 ? `${resto.slice(0, 5)}-${resto.slice(5)}` : `${resto.slice(0, 4)}-${resto.slice(4)}`
        return `+55 ${ddd} ${meio}`
    }
    return d ? `+${d}` : ''
}

export function nomeExibicao(c) {
    return c?.nome || c?.atributos?.name || formatarTelefone(c?.waId) || CANAIS[canalDoId(c?.waId)].semNome
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

// "há 12 min", "há 3 h", "há 2 dias" — tempo de espera em palavras
export function tempoDesde(iso, agora = Date.now()) {
    if (!iso) return '—'
    const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000))
    if (min < 1) return 'agora'
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    if (h < 48) return `há ${h} h`
    return `há ${Math.floor(h / 24)} dias`
}

// Janela de 24h contada a partir da última mensagem do cliente
export const JANELA_MS = 24 * 3600 * 1000
export function janela24h(iso, agora = Date.now()) {
    if (!iso) return null
    const passou = Math.max(0, agora - new Date(iso).getTime())
    const restante = JANELA_MS - passou
    return { fracao: Math.min(1, passou / JANELA_MS), restanteMs: restante, fechada: restante <= 0 }
}

// Janela de uma conversa da lista: só conta mensagem do cliente.
// Sem ultimaClienteEm, se a última for do cliente (ultimaMinha === false) usa ultimaEm; senão null (abertura nossa → template).
export function janelaDaConversa(c, agora = Date.now()) {
    const iso = c.ultimaClienteEm || (c.ultimaMinha === false ? c.ultimaEm : null)
    return janela24h(iso, agora)
}

export function restanteEmPalavras(ms) {
    if (ms <= 0) return 'janela fechada'
    const min = Math.max(1, Math.floor(ms / 60000))
    if (min < 60) return `fecha em ${min} min`
    return `fecha em ${Math.floor(min / 60)} h`
}

// Quem espera resposta: conversas abertas cuja última mensagem é do cliente, da mais antiga para a mais nova
// com a janela de 24h fechada só dá para retomar por template, então a conversa sai da espera
export function calcularEspera(conversas, agora = Date.now()) {
    return conversas
        .filter((c) => c.status !== 'resolvida' && c.ultimaMinha === false && c.ultimaEm && !janelaDaConversa(c, agora)?.fechada)
        .sort((a, b) => new Date(a.ultimaEm) - new Date(b.ultimaEm))
}

// Lê CSV/TSV (colado de planilha ou arquivo): separador detectado na 1ª linha, aspas com quebra de linha dentro
export function lerPlanilha(texto) {
    // \s também cobre o BOM que o Excel põe no início do CSV
    const s = String(texto || '').replace(/^\s+/, '').replace(/\r\n?/g, '\n')
    const primeira = s.split('\n', 1)[0]
    const sep = ['\t', ';', ','].map((c) => [c, primeira.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]
    const linhas = []
    let linha = []
    let campo = ''
    let aspas = false
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (aspas) {
            if (c === '"' && s[i + 1] === '"') {
                campo += '"'
                i++
            } else if (c === '"') aspas = false
            else campo += c
        } else if (c === '"' && campo === '') aspas = true
        else if (c === sep) {
            linha.push(campo)
            campo = ''
        } else if (c === '\n') {
            linha.push(campo)
            linhas.push(linha)
            linha = []
            campo = ''
        } else campo += c
    }
    linha.push(campo)
    linhas.push(linha)
    return linhas.filter((l) => l.some((c) => c.trim()))
}

// Nomes de coluna aceitos no cabeçalho (português e o que a WATI/planilhas costumam usar)
const COLUNAS_RESPOSTA = {
    atalho: ['atalho', 'shortcut', 'shortcode', 'comando', 'codigo', 'código', 'key', 'chave'],
    titulo: ['titulo', 'título', 'title', 'nome', 'name'],
    texto: ['texto', 'mensagem', 'message', 'text', 'content', 'conteudo', 'conteúdo', 'resposta', 'reply', 'body'],
    regras: ['regras', 'regra', 'condicoes', 'condições', 'rules'],
}

// Planilha → respostas rápidas. Sem cabeçalho: 2 colunas = atalho, texto; 3+ = atalho, título, texto
export function respostasDaPlanilha(texto) {
    const linhas = lerPlanilha(texto)
    if (!linhas.length) return { itens: [], erros: [], colunas: null }
    const cab = linhas[0].map((c) => c.trim().toLowerCase())
    const achar = (nomes) => cab.findIndex((c) => nomes.includes(c))
    let col = { atalho: achar(COLUNAS_RESPOSTA.atalho), titulo: achar(COLUNAS_RESPOSTA.titulo), texto: achar(COLUNAS_RESPOSTA.texto), regras: achar(COLUNAS_RESPOSTA.regras) }
    let corpo = linhas.slice(1)
    if (col.texto < 0 || (col.atalho < 0 && col.titulo < 0)) {
        corpo = linhas
        col = linhas[0].length >= 3 ? { atalho: 0, titulo: 1, texto: 2, regras: -1 } : { atalho: 0, titulo: -1, texto: 1, regras: -1 }
    }
    const itens = []
    const erros = []
    corpo.forEach((l, i) => {
        const pegar = (k) => (col[k] >= 0 ? String(l[col[k]] || '').trim() : '')
        const titulo = pegar('titulo')
        // sem coluna de atalho, o título vira atalho (como "/bom-dia")
        const atalho = (pegar('atalho') || titulo).replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-')
        const t = pegar('texto')
        const n = i + (corpo === linhas ? 1 : 2)
        if (!atalho || !t) erros.push(`Linha ${n}: falta ${!atalho ? 'o atalho' : 'o texto'}.`)
        else itens.push({ atalho: atalho.slice(0, 40), titulo: titulo.slice(0, 80), texto: t.slice(0, 4096), regras: pegar('regras') })
    })
    // de onde veio cada campo, para a prévia mostrar (cabeçalho reconhecido ou posição da coluna)
    const nomeColuna = (i) => (i < 0 ? null : corpo === linhas ? `coluna ${i + 1}` : `"${linhas[0][i].trim()}"`)
    const colunas = { atalho: nomeColuna(col.atalho) || (col.titulo >= 0 ? `${nomeColuna(col.titulo)} (título)` : null), texto: nomeColuna(col.texto), semCabecalho: corpo === linhas }
    return { itens, erros, colunas }
}

// ---- UF e municípios (mesmo comportamento de src/lib/ibgeLocalidades.js do projeto principal) ----

export const UFS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

/** Tipos padrão do atributo "tipo" na ficha do contato (WATI). */
export const TIPOS_CONTATO = ['Cliente', 'Não-Cliente', 'Credenciado', 'Não-Credenciado', 'Outros']

// sem acento, minúsculo, só letras/números — para buscar "sao" e achar "São Paulo"
export const normalizarTextoBusca = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

/** Compara e-mails de atendente sem cair em diferença de maiúsculas. */
export function mesmoEmail(a, b) {
    return Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/** Frases típicas da WATI em inglês (pills de atribuição / chatbot / status). */
export function pareceEventoSistemaWati(texto) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim()
    if (!t) return false
    return /^(the\s+)?chat\s+(has\s+been|was|is\s+now)\s+(assigned|unassigned|opened|closed)\b/i.test(t)
        || /^(the\s+)?ticket\s+(has\s+been|was|is\s+now)\s+(assigned|unassigned|opened|closed)\b/i.test(t)
        || /^(the\s+)?chat\s+has\s+been\s+(opened|closed)\b/i.test(t)
        || /\b(ticket|chat)\s+status\s+has\s+been\s+set\b/i.test(t)
        || /\bstatus\s+has\s+been\s+set\s+as\b/i.test(t)
        || /^(ended|opened|closed|started|resolved|expired)\s*:/i.test(t)
        || /\bvia\s+round[-\s]?robin\b/i.test(t)
        || /\bby\s+(bot|rule|operator|team|agent)\b/i.test(t)
        || /\bby\s+an?\s+operator\b/i.test(t)
        || /\bby\s+a\s+system\s+event\b/i.test(t)
        || /\bmarked as (resolved|pending|open|solved)\b/i.test(t)
        || /\bstatus (was )?changed to\b/i.test(t)
        || /\bsession\s+is\s+in\s+['"]?ask['"]?\s+mode\b/i.test(t)
        || /you\s+can'?t\s+send\s+messages\s+now/i.test(t)
}

/**
 * Traduz pills de evento da WATI (eventDescription / texto) para PT-BR.
 * Nomes de chatbot, regra e e-mail do operador são preservados.
 */
export function traduzirEventoSistema(texto) {
    let t = String(texto || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!t) return ''

    t = t
        .replace(/^(?:the\s+)?chat\s+has\s+been\s+assigned\s+to\s+/i, 'Conversa atribuída a ')
        .replace(/^(?:the\s+)?chat\s+was\s+assigned\s+to\s+/i, 'Conversa atribuída a ')
        .replace(/^(?:the\s+)?chat\s+is\s+now\s+assigned\s+to\s+/i, 'Conversa atribuída a ')
        .replace(/^chat\s+assigned\s+to\s+/i, 'Conversa atribuída a ')
        .replace(/^(?:the\s+)?ticket\s+has\s+been\s+assigned\s+to\s+/i, 'Ticket atribuído a ')
        .replace(/^(?:the\s+)?ticket\s+was\s+assigned\s+to\s+/i, 'Ticket atribuído a ')
        .replace(/^(?:the\s+)?ticket\s+is\s+now\s+assigned\s+to\s+/i, 'Ticket atribuído a ')
        .replace(/^(?:the\s+)?ticket\s+status\s+has\s+been\s+set\s+as\s+/i, 'Status do ticket definido como ')
        .replace(/^(?:the\s+)?chat\s+status\s+has\s+been\s+set\s+as\s+/i, 'Status da conversa definido como ')
        .replace(/^(?:the\s+)?ticket\s+status\s+(?:was\s+)?(?:set|changed)\s+to\s+/i, 'Status do ticket alterado para ')
        .replace(/^(?:the\s+)?chat\s+status\s+(?:was\s+)?(?:set|changed)\s+to\s+/i, 'Status da conversa alterado para ')
        .replace(/^(?:the\s+)?chat\s+has\s+been\s+closed\b/i, 'Conversa fechada')
        .replace(/^(?:the\s+)?chat\s+has\s+been\s+opened\b/i, 'Conversa reaberta')
        .replace(/^(?:the\s+)?chat\s+was\s+closed\b/i, 'Conversa fechada')
        .replace(/^(?:the\s+)?chat\s+was\s+opened\b/i, 'Conversa reaberta')
        .replace(/^(?:the\s+)?chat\s+has\s+been\s+unassigned(?:\s+from\s+(.+))?$/i, (_, de) =>
            de ? `Conversa desatribuída de ${de}` : 'Conversa desatribuída',
        )
        .replace(/^(?:the\s+)?chat\s+was\s+unassigned(?:\s+from\s+(.+))?$/i, (_, de) =>
            de ? `Conversa desatribuída de ${de}` : 'Conversa desatribuída',
        )
        // "by agent Bot" (nome do bot) → "pelo Bot"; demais agentes ficam "pelo atendente X"
        .replace(/\bby\s+agent\s+Bot\b/gi, 'pelo Bot')
        .replace(/\bby\s+Bot\b/gi, 'pelo Bot')
        .replace(/\bby\s+an?\s+operator\s+via\s+WhatsApp\b/gi, 'por um operador via WhatsApp')
        .replace(/\bby\s+a\s+system\s+event\s+via\s+backend\b/gi, 'por um evento do sistema')
        .replace(/\bby\s+a\s+system\s+event\b/gi, 'por um evento do sistema')
        .replace(/\bby\s+an?\s+operator\b/gi, 'por um operador')
        .replace(/\bby\s+Operator\b/gi, 'pelo operador')
        .replace(/\bby\s+agent\b/gi, 'pelo atendente')
        .replace(/\bby\s+Rule\b/gi, 'pela regra')
        .replace(/\bby\s+Team\b/gi, 'pela equipe')
        .replace(/\bvia\s+WhatsApp\b/gi, 'via WhatsApp')
        .replace(/\bvia\s+backend\b/gi, 'via sistema')
        .replace(/\bvia\s+round[-\s]?robin(?:\s+assignment)?\b/gi, 'via distribuição em rodízio')
        .replace(/\bvia\s+load[-\s]?based(?:\s+assignment)?\b/gi, 'via distribuição por carga')
        .replace(/\bvia\s+last\s+assignee\b/gi, 'via último atendente')
        .replace(/^Ended\s*:\s*/i, 'Encerrado: ')
        .replace(/^Opened\s*:\s*/i, 'Aberto: ')
        .replace(/^Closed\s*:\s*/i, 'Fechado: ')
        .replace(/^Started\s*:\s*/i, 'Iniciado: ')
        .replace(/^Resolved\s*:\s*/i, 'Resolvido: ')
        .replace(/^Expired\s*:\s*/i, 'Expirado: ')
        .replace(/\bstatus\s+(?:was\s+)?changed\s+to\b/gi, 'status alterado para')
        .replace(/^(?:the\s+)?(?:chat|ticket)\s+marked\s+as\s+resolved\b/gi, 'Conversa marcada como resolvida')
        .replace(/^(?:the\s+)?(?:chat|ticket)\s+marked\s+as\s+solved\b/gi, 'Conversa marcada como resolvida')
        .replace(/^(?:the\s+)?(?:chat|ticket)\s+marked\s+as\s+pending\b/gi, 'Conversa marcada como pendente')
        .replace(/^(?:the\s+)?(?:chat|ticket)\s+marked\s+as\s+open\b/gi, 'Conversa marcada como aberta')
        .replace(/\bmarked\s+as\s+resolved\b/gi, 'marcada como resolvida')
        .replace(/\bmarked\s+as\s+solved\b/gi, 'marcada como resolvida')
        .replace(/\bmarked\s+as\s+pending\b/gi, 'marcada como pendente')
        .replace(/\bmarked\s+as\s+open\b/gi, 'marcada como aberta')
        .replace(/^This\s+session\s+is\s+in\s+['"]?Ask['"]?\s+mode\.?\s*/i, 'Esta sessão está no modo Pergunta (Ask). ')
        .replace(/You\s+can'?t\s+send\s+messages\s+now\.?/gi, 'Não é possível enviar mensagens agora.')
        // valores de status que sobram após o prefixo ("… definido como Pending pelo Bot")
        .replace(/\bPending\/Open\b/gi, 'Pendente/Aberto')
        .replace(/\bOpen\/Pending\b/gi, 'Aberto/Pendente')
        .replace(/\bPending\b/g, 'Pendente')
        .replace(/\bSolved\b/g, 'Resolvido')
        .replace(/\bResolved\b/g, 'Resolvido')
        .replace(/\bOpen\b/g, 'Aberto')
        .replace(/\bClosed\b/g, 'Fechado')
        .replace(/\bat\s+(\d{1,2}:\d{2})\b/gi, 'às $1')

    return t.replace(/\s{2,}/g, ' ').trim()
}
