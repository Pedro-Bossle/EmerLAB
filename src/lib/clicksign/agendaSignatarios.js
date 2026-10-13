/**
 * Agenda partilhada de signatários Clicksign (Supabase).
 * Visível a todos os utilizadores com acesso ao módulo Clicksign.
 * Migra uma vez a lista antiga do localStorage (por browser).
 */

import { supabase } from '../supabase.js'
import { maskTelefoneBr } from '../telefoneBrasil.js'

const STORAGE_KEY_LEGADO = 'emerdog_cs_agenda_signatarios'
const STORAGE_MIGRADO = 'emerdog_cs_agenda_migrada_v1'
const TABELA = 'clicksign_agenda_signatarios'

function rowParaContato(row) {
    if (!row) return null
    return {
        localId: String(row.id),
        name: String(row.name || '').trim(),
        email: String(row.email || '').trim().toLowerCase(),
        phone: row.phone ? maskTelefoneBr(row.phone) : '',
        channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email',
        papel: String(row.papel || 'sign').trim() || 'sign',
        favorite: Boolean(row.favorite),
        criadoEm: row.criado_em || null,
    }
}

function validarContato({ name, email, phone, channel }) {
    const nome = String(name || '').trim()
    const em = String(email || '').trim().toLowerCase()
    const ph = maskTelefoneBr(phone || '')
    const ch = channel === 'whatsapp' ? 'whatsapp' : 'email'
    if (!nome) return { ok: false, erro: 'Nome obrigatório.' }
    if (!em) return { ok: false, erro: 'E-mail obrigatório.' }
    if (ch === 'whatsapp') {
        const d = ph.replace(/\D/g, '')
        if (d.length < 10) return { ok: false, erro: 'Telefone WhatsApp inválido.' }
    }
    return { ok: true, nome, em, ph, ch }
}

/** Lista completa ordenada (favoritos primeiro, depois nome). */
export async function carregarAgendaSignatarios() {
    const { data, error } = await supabase
        .from(TABELA)
        .select('id, name, email, phone, channel, papel, favorite, criado_em')
        .order('favorite', { ascending: false })
        .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data || []).map(rowParaContato).filter(Boolean)
}

/**
 * Migra contactos do localStorage (legado) para o Supabase uma vez por browser.
 * Não apaga a chave local até a migração concluir com sucesso.
 */
export async function migrarAgendaLocalSeNecessario() {
    if (typeof window === 'undefined') return { migrados: 0 }
    try {
        if (window.localStorage.getItem(STORAGE_MIGRADO) === '1') return { migrados: 0 }
    } catch {
        return { migrados: 0 }
    }

    let legado = []
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_LEGADO)
        const parsed = JSON.parse(raw || '[]')
        legado = Array.isArray(parsed) ? parsed : []
    } catch {
        legado = []
    }

    if (!legado.length) {
        try {
            window.localStorage.setItem(STORAGE_MIGRADO, '1')
        } catch {
            /* ignore */
        }
        return { migrados: 0 }
    }

    let n = 0
    for (const c of legado) {
        try {
            await upsertContatoAgenda({
                name: c.name,
                email: c.email,
                phone: c.phone,
                channel: c.channel,
                papel: c.papel,
                favorite: Boolean(c.favorite),
            })
            n += 1
        } catch {
            /* continua os restantes */
        }
    }

    try {
        window.localStorage.setItem(STORAGE_MIGRADO, '1')
        window.localStorage.removeItem(STORAGE_KEY_LEGADO)
    } catch {
        /* ignore */
    }
    return { migrados: n }
}

/** Insere ou atualiza por e-mail + nome; preserva favorite se já existir (salvo se passado). */
export async function upsertContatoAgenda(contato) {
    const v = validarContato(contato)
    if (!v.ok) return carregarAgendaSignatarios()

    const papel = String(contato.papel || 'sign').trim() || 'sign'
    const favoritoExplicit = contato.favorite

    const { data: existentes, error: errSel } = await supabase
        .from(TABELA)
        .select('id, favorite, criado_em, name, email')
        .ilike('email', v.em)
        .ilike('name', v.nome)
        .limit(20)
    if (errSel) throw new Error(errSel.message)

    const hit = (existentes || []).find(
        (r) =>
            String(r.email || '').trim().toLowerCase() === v.em &&
            String(r.name || '').trim().toLowerCase() === v.nome.toLowerCase(),
    )

    const { data: sess } = await supabase.auth.getSession()
    const uid = sess?.session?.user?.id || null

    if (hit?.id) {
        const patch = {
            name: v.nome,
            email: v.em,
            phone: v.ph,
            channel: v.ch,
            papel,
            atualizado_em: new Date().toISOString(),
        }
        if (typeof favoritoExplicit === 'boolean') patch.favorite = favoritoExplicit
        const { error } = await supabase.from(TABELA).update(patch).eq('id', hit.id)
        if (error) throw new Error(error.message)
    } else {
        const { error } = await supabase.from(TABELA).insert({
            name: v.nome,
            email: v.em,
            phone: v.ph,
            channel: v.ch,
            papel,
            favorite: typeof favoritoExplicit === 'boolean' ? favoritoExplicit : false,
            criado_por: uid,
        })
        if (error) {
            // Corrida / unique: tenta update
            if (/duplicate|unique/i.test(error.message || '')) {
                const { data: again } = await supabase
                    .from(TABELA)
                    .select('id')
                    .ilike('email', v.em)
                    .ilike('name', v.nome)
                    .limit(1)
                    .maybeSingle()
                if (again?.id) {
                    const { error: errUp } = await supabase
                        .from(TABELA)
                        .update({
                            phone: v.ph,
                            channel: v.ch,
                            papel,
                            atualizado_em: new Date().toISOString(),
                        })
                        .eq('id', again.id)
                    if (errUp) throw new Error(errUp.message)
                } else {
                    throw new Error(error.message)
                }
            } else {
                throw new Error(error.message)
            }
        }
    }

    return carregarAgendaSignatarios()
}

export async function removerContatoAgendaPorId(localId) {
    const id = String(localId || '').trim()
    if (!id) return carregarAgendaSignatarios()
    const { error } = await supabase.from(TABELA).delete().eq('id', id)
    if (error) throw new Error(error.message)
    return carregarAgendaSignatarios()
}

export async function atualizarContatoAgendaPorId(localId, { name, email, phone, channel, papel }) {
    const id = String(localId || '').trim()
    if (!id) return carregarAgendaSignatarios()
    const v = validarContato({ name, email, phone, channel })
    if (!v.ok) return carregarAgendaSignatarios()
    const pap = String(papel || 'sign').trim() || 'sign'
    const { error } = await supabase
        .from(TABELA)
        .update({
            name: v.nome,
            email: v.em,
            phone: v.ph,
            channel: v.ch,
            papel: pap,
            atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
    if (error) throw new Error(error.message)
    return carregarAgendaSignatarios()
}

export async function alternarFavoritoAgenda(localId) {
    const id = String(localId || '').trim()
    if (!id) return carregarAgendaSignatarios()
    const { data: row, error: errSel } = await supabase
        .from(TABELA)
        .select('id, favorite')
        .eq('id', id)
        .maybeSingle()
    if (errSel) throw new Error(errSel.message)
    if (!row?.id) return carregarAgendaSignatarios()
    const { error } = await supabase
        .from(TABELA)
        .update({
            favorite: !row.favorite,
            atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
    if (error) throw new Error(error.message)
    return carregarAgendaSignatarios()
}

/** @deprecated use ids do Supabase; mantido para compat. */
export function novoIdAgenda() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `ag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
