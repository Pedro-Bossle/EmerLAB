/**
 * Sugestões de signatário Clicksign a partir do Kanban
 * (coluna Aguardando Assinatura + prestador vinculado).
 */

import { supabase } from '../supabase.js'
import { maskTelefoneBr } from '../telefoneBrasil.js'

/**
 * @typedef {{
 *   cardId: number,
 *   prestadorId: number,
 *   nome: string,
 *   email: string,
 *   telefone: string,
 *   cidade: string,
 *   uf: string,
 * }} SugestaoSignatarioKanban
 */

/**
 * Cards em «Aguardando Assinatura» com prestador vinculado → nome (razão social) / e-mail / telefone.
 * @returns {Promise<SugestaoSignatarioKanban[]>}
 */
export async function listarSugestoesSignatarioKanbanAssinatura() {
    const { data: cards, error: errCards } = await supabase
        .from('cred_kanban_cards')
        .select('id, nome, uf, cidade, telefone, prestador_id')
        .eq('coluna', 'aguardando_assinatura')
        .not('prestador_id', 'is', null)
        .order('atualizado_em', { ascending: false })

    if (errCards) {
        if (/cred_kanban_cards|schema cache|does not exist/i.test(String(errCards.message || ''))) {
            return []
        }
        throw new Error(errCards.message)
    }

    const listaCards = cards || []
    if (!listaCards.length) return []

    const ids = [
        ...new Set(
            listaCards
                .map((c) => Number(c.prestador_id))
                .filter((id) => Number.isFinite(id) && id > 0),
        ),
    ]
    if (!ids.length) return []

    const { data: prestadores, error: errP } = await supabase
        .from('prestadores')
        .select('id, nome, email, telefone, celular, endereco_cidade, endereco_uf')
        .in('id', ids)

    if (errP) throw new Error(errP.message)

    const mapa = new Map((prestadores || []).map((p) => [Number(p.id), p]))
    const out = []
    const vistoPrestador = new Set()

    for (const card of listaCards) {
        const pid = Number(card.prestador_id)
        if (!Number.isFinite(pid) || vistoPrestador.has(pid)) continue
        const p = mapa.get(pid)
        if (!p) continue
        vistoPrestador.add(pid)

        const nome = String(p.nome || card.nome || '').trim()
        const email = String(p.email || '').trim().toLowerCase()
        const telBruto = String(p.celular || p.telefone || card.telefone || '').trim()
        const telefone = telBruto ? maskTelefoneBr(telBruto) : ''

        out.push({
            cardId: Number(card.id),
            prestadorId: pid,
            nome,
            email,
            telefone,
            cidade: String(p.endereco_cidade || card.cidade || '').trim(),
            uf: String(p.endereco_uf || card.uf || '').trim().toUpperCase(),
        })
    }

    return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
}

/** Filtra sugestões por texto (nome, e-mail, cidade). */
export function filtrarSugestoesSignatarioKanban(lista, termo) {
    const t = String(termo || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .trim()
    if (!t) return lista || []
    return (lista || []).filter((s) => {
        const tel = String(s.telefone || '').replace(/\D/g, '')
        const qDigits = t.replace(/\D/g, '')
        const blob = `${s.nome} ${s.email} ${s.cidade} ${s.uf} ${s.telefone}`
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
        return (
            blob.includes(t) ||
            (qDigits.length > 0 && tel.includes(qDigits))
        )
    })
}
