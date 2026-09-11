import { mapsIdDeEstabelecimento } from './prospectosMapsRepo.js'

/**
 * Soft-delete local dos cards do Prospect Maps (Emer-Radar).
 * Complementa o soft delete no banco (`status_prospeccao = descartado`).
 */

const STORAGE_KEY = 'emerlab-emer-radar-prospectos-dismissed-v1'

/** Chave estável do estabelecimento (sem índice da lista). */
export function chaveEstavelProspectoMaps(est) {
    try {
        return mapsIdDeEstabelecimento(est)
    } catch {
        /* fall through */
    }
    if (est?.maps_id != null && String(est.maps_id).trim()) return String(est.maps_id).trim()
    if (est?.id != null && String(est.id).trim()) return String(est.id).trim()
    return [est?.nome, est?.endereco, est?.cidade, est?.uf, est?.link_maps, est?.telefone]
        .map((s) => String(s || '').trim().toLowerCase())
        .join('|')
}

/** @returns {Set<string>} */
export function lerProspectosMapsDismissed() {
    if (typeof window === 'undefined') return new Set()
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        const arr = raw ? JSON.parse(raw) : []
        return new Set((Array.isArray(arr) ? arr : []).map(String))
    } catch {
        return new Set()
    }
}

/** @param {Iterable<string>|Set<string>} ids */
export function salvarProspectosMapsDismissed(ids) {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].map(String)))
    } catch {
        /* ignore quota */
    }
}

/** @param {string} chave */
export function marcarProspectoMapsDismissed(chave) {
    const k = String(chave || '').trim()
    if (!k) return lerProspectosMapsDismissed()
    const next = lerProspectosMapsDismissed()
    next.add(k)
    salvarProspectosMapsDismissed(next)
    return next
}
