/**
 * Menções @utilizador na descrição do Kanban → notificações na Home.
 * Token persistido: @[Nome](uuid)
 */
import { supabase } from '../supabase.js'

const TOKEN_RE = /@\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi

/** Extrai userIds únicos mencionados no texto. */
export function extrairIdsMencoesKanban(texto) {
    const ids = new Set()
    const s = String(texto || '')
    let m
    TOKEN_RE.lastIndex = 0
    while ((m = TOKEN_RE.exec(s)) !== null) {
        if (m[2]) ids.add(String(m[2]).toLowerCase())
    }
    return [...ids]
}

/**
 * Detecta `@query` no cursor (ainda sem token completo).
 * @returns {{ query: string, start: number, end: number } | null}
 */
export function queryMencaoUsuarioNoCorpo(texto, cursor) {
    const val = String(texto || '')
    const pos = Math.max(0, Math.min(Number(cursor) || 0, val.length))
    const antes = val.slice(0, pos)
    // Já dentro de um token @[...] — não reabrir autocomplete
    if (/@\[[^\]]*$/.test(antes)) return null
    const m = antes.match(/(^|[\s\n(])@([^\s@[\]()]*)$/)
    if (!m) return null
    const query = m[2] || ''
    const start = pos - query.length - 1
    return { query, start, end: pos }
}

export function tokenMencaoUsuario(user) {
    const nome = String(user?.nome || user?.name || 'Utilizador')
        .replace(/[[\]]/g, '')
        .trim() || 'Utilizador'
    const id = String(user?.id || '').trim()
    if (!id) return `@${nome}`
    return `@[${nome}](${id})`
}

function previewCorpo(texto) {
    return String(texto || '')
        .replace(TOKEN_RE, '@$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140)
}

/**
 * Cria notificações só para utilizadores recém-mencionados (não o autor).
 */
export async function notificarMencoesKanban({
    cardId,
    cardNome,
    corpoNovo,
    corpoAnterior = '',
    autorId,
} = {}) {
    const idCard = Number(cardId)
    if (!Number.isFinite(idCard) || idCard <= 0) return { criados: 0 }

    let uid = autorId
    if (!uid) {
        const { data } = await supabase.auth.getUser()
        uid = data?.user?.id
    }
    if (!uid) return { criados: 0 }

    const novos = new Set(extrairIdsMencoesKanban(corpoNovo))
    const antigos = new Set(extrairIdsMencoesKanban(corpoAnterior))
    const destinatarios = [...novos].filter((id) => id !== String(uid).toLowerCase() && !antigos.has(id))
    if (!destinatarios.length) return { criados: 0 }

    const preview = previewCorpo(corpoNovo)
    const nomeCard = String(cardNome || '').trim() || `Card #${idCard}`
    let criados = 0
    for (const mencionadoId of destinatarios) {
        const { error } = await supabase.from('cred_kanban_mencoes').insert({
            card_id: idCard,
            mencionado_id: mencionadoId,
            autor_id: uid,
            card_nome: nomeCard,
            preview,
        })
        if (!error) {
            criados += 1
            continue
        }
        if (/cred_kanban_mencoes|does not exist|schema cache/i.test(error.message)) {
            return { criados: 0, aviso: 'Tabela cred_kanban_mencoes ausente. Execute scripts/sql/cred_kanban_mencoes.sql.' }
        }
        // Já existe menção não lida (índice único) — ok
        if (/duplicate|unique/i.test(error.message || '')) continue
    }
    return { criados }
}

/**
 * @returns {Promise<Array<{ id, cardId, cardNome, deUserId, deNome, preview, criadoEm }>>}
 */
export async function listarNotificacoesMencoesKanban({ userId } = {}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) return []

    const { data, error } = await supabase
        .from('cred_kanban_mencoes')
        .select('id, card_id, autor_id, card_nome, preview, criado_em')
        .eq('mencionado_id', uid)
        .is('lida_em', null)
        .order('criado_em', { ascending: false })
        .limit(40)

    if (error) {
        if (/cred_kanban_mencoes|does not exist|schema cache/i.test(error.message)) {
            return []
        }
        throw new Error(error.message)
    }
    if (!data?.length) return []

    const autorIds = [...new Set(data.map((r) => r.autor_id).filter(Boolean))]
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', autorIds)
    const nomes = new Map((perfis || []).map((p) => [p.id, p.name || 'Utilizador']))

    return data.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        cardNome: String(r.card_nome || '').trim() || `Card #${r.card_id}`,
        deUserId: r.autor_id,
        deNome: nomes.get(r.autor_id) || 'Utilizador',
        preview: String(r.preview || '').trim() || 'Mencionou você num card do Kanban',
        criadoEm: r.criado_em,
    }))
}

export async function marcarMencoesKanbanCardLidas(cardId, { userId } = {}) {
    const idCard = Number(cardId)
    if (!Number.isFinite(idCard) || idCard <= 0) return

    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) return

    const { error } = await supabase
        .from('cred_kanban_mencoes')
        .update({ lida_em: new Date().toISOString() })
        .eq('card_id', idCard)
        .eq('mencionado_id', uid)
        .is('lida_em', null)

    if (error && !/cred_kanban_mencoes|does not exist|schema cache/i.test(error.message)) {
        throw new Error(error.message)
    }
}

export async function marcarMencaoKanbanLida(mencaoId) {
    if (!mencaoId) return
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return

    const { error } = await supabase
        .from('cred_kanban_mencoes')
        .update({ lida_em: new Date().toISOString() })
        .eq('id', mencaoId)
        .eq('mencionado_id', uid)
        .is('lida_em', null)

    if (error && !/cred_kanban_mencoes|does not exist|schema cache/i.test(error.message)) {
        throw new Error(error.message)
    }
}
