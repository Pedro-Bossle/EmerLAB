import { supabase } from './supabase.js'

function mapMsg(row, nomesPorId = new Map()) {
    if (!row) return null
    return {
        id: row.id,
        remetenteId: row.remetente_id,
        destinatarioId: row.destinatario_id,
        corpo: String(row.corpo || '').trim(),
        criadoEm: row.criado_em,
        lidaEm: row.lida_em || null,
        remetenteNome: nomesPorId.get(row.remetente_id) || 'Usuário',
    }
}

export function previewBatePapo(texto, max = 80) {
    const limpo = String(texto || '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!limpo) return ''
    if (limpo.length <= max) return limpo
    return `${limpo.slice(0, max - 1)}…`
}

export async function listarUsuariosBatePapo({ excluirUserId } = {}) {
    const { data, error } = await supabase.from('profiles').select('id, name').order('name', { ascending: true })
    if (error) throw new Error(error.message)
    const excluir = String(excluirUserId || '')
    return (data || [])
        .filter((u) => u?.id && String(u.id) !== excluir)
        .map((u) => ({ id: u.id, nome: u.name || u.id }))
}

export async function listarMensagensBatePapoCom(outroUserId) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')
    const outro = String(outroUserId || '').trim()
    if (!outro) return []

    const { data, error } = await supabase
        .from('home_bate_papo_mensagens')
        .select('id, remetente_id, destinatario_id, corpo, criado_em, lida_em')
        .or(
            `and(remetente_id.eq.${uid},destinatario_id.eq.${outro}),and(remetente_id.eq.${outro},destinatario_id.eq.${uid})`,
        )
        .order('criado_em', { ascending: true })
        .limit(300)

    if (error) {
        if (/home_bate_papo_mensagens|does not exist|schema cache/i.test(error.message)) {
            return []
        }
        throw new Error(error.message)
    }

    const ids = new Set((data || []).flatMap((r) => [r.remetente_id, r.destinatario_id]).filter(Boolean))
    let nomes = new Map()
    if (ids.size) {
        const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', [...ids])
        nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
    }
    return (data || []).map((r) => mapMsg(r, nomes)).filter(Boolean)
}

export async function enviarMensagemBatePapo(destinatarioId, texto) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')
    const dest = String(destinatarioId || '').trim()
    const corpo = String(texto || '').trim()
    if (!dest) throw new Error('Selecione um destinatário.')
    if (dest === uid) throw new Error('Não é possível enviar mensagem para si mesmo.')
    if (!corpo) throw new Error('Digite uma mensagem.')

    const { data, error } = await supabase
        .from('home_bate_papo_mensagens')
        .insert({
            remetente_id: uid,
            destinatario_id: dest,
            corpo,
        })
        .select('id, remetente_id, destinatario_id, corpo, criado_em, lida_em')
        .single()

    if (error) {
        if (/home_bate_papo_mensagens|does not exist|schema cache/i.test(error.message)) {
            throw new Error('Tabela de bate-papo ausente. Execute scripts/sql/home_bate_papo.sql no Supabase.')
        }
        throw new Error(error.message)
    }

    const { data: perfil } = await supabase.from('profiles').select('id, name').eq('id', uid).maybeSingle()
    return mapMsg(data, new Map([[uid, perfil?.name || 'Você']]))
}

export async function marcarMensagensBatePapoComoLidas(outroUserId) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return
    const outro = String(outroUserId || '').trim()
    if (!outro) return

    const { error } = await supabase
        .from('home_bate_papo_mensagens')
        .update({ lida_em: new Date().toISOString() })
        .eq('destinatario_id', uid)
        .eq('remetente_id', outro)
        .is('lida_em', null)

    if (error && !/home_bate_papo_mensagens|does not exist|schema cache/i.test(error.message)) {
        throw new Error(error.message)
    }
}

/**
 * Resumo por contato: última mensagem + não lidas recebidas.
 */
export async function listarConversasBatePapo({ userId } = {}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) return []

    const { data, error } = await supabase
        .from('home_bate_papo_mensagens')
        .select('id, remetente_id, destinatario_id, corpo, criado_em, lida_em')
        .or(`remetente_id.eq.${uid},destinatario_id.eq.${uid}`)
        .order('criado_em', { ascending: false })
        .limit(400)

    if (error) {
        if (/home_bate_papo_mensagens|does not exist|schema cache/i.test(error.message)) {
            return []
        }
        throw new Error(error.message)
    }

    const porContato = new Map()
    for (const row of data || []) {
        const outro = row.remetente_id === uid ? row.destinatario_id : row.remetente_id
        if (!outro || outro === uid) continue
        if (!porContato.has(outro)) {
            porContato.set(outro, {
                userId: outro,
                ultimaMensagem: previewBatePapo(row.corpo),
                ultimaEm: row.criado_em,
                naoLidas: 0,
            })
        }
        const c = porContato.get(outro)
        if (row.destinatario_id === uid && !row.lida_em) c.naoLidas += 1
    }

    const ids = [...porContato.keys()]
    let nomes = new Map()
    if (ids.length) {
        const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', ids)
        nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
    }

    return [...porContato.values()]
        .map((c) => ({
            ...c,
            nome: nomes.get(c.userId) || 'Usuário',
        }))
        .sort((a, b) => {
            if ((b.naoLidas || 0) !== (a.naoLidas || 0)) return (b.naoLidas || 0) - (a.naoLidas || 0)
            const ta = a.ultimaEm ? new Date(a.ultimaEm).getTime() : 0
            const tb = b.ultimaEm ? new Date(b.ultimaEm).getTime() : 0
            return tb - ta
        })
}

export async function contarNaoLidasBatePapo({ userId } = {}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) return 0

    const { count, error } = await supabase
        .from('home_bate_papo_mensagens')
        .select('id', { count: 'exact', head: true })
        .eq('destinatario_id', uid)
        .is('lida_em', null)

    if (error) {
        if (/home_bate_papo_mensagens|does not exist|schema cache/i.test(error.message)) return 0
        throw new Error(error.message)
    }
    return count || 0
}
