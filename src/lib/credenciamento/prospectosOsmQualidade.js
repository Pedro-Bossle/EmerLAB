import { labelProspectoOsmCategoria } from './prospectosOsmCategorias.js'

export function normalizarTextoProspecto(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[/|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Nome igual à categoria ou rótulo genérico demais (dado padrão OSM/Gemini).
 * @param {string} nome
 * @param {string} [categoriaId]
 * @param {string} [categoriaLabel]
 */
export function nomeProspectoEhAmbiguo(nome, categoriaId, categoriaLabel) {
    const n = normalizarTextoProspecto(nome)
    if (!n || n.length < 3) return true
    const label = normalizarTextoProspecto(categoriaLabel || labelProspectoOsmCategoria(categoriaId))
    if (label && n === label) return true
    const genericos = new Set([
        'clinica veterinaria',
        'clinica vet',
        'veterinaria',
        'pet shop',
        'petshop',
        'banho e tosa',
        'hotel para animais',
        'hospedagem pet',
    ])
    if (genericos.has(n)) return true
    return false
}

/**
 * Evita repetir cidade/UF na coluna quando já estão em `endereco`.
 */
export function formatarEnderecoLinhaTabela(row) {
    const e = String(row?.endereco || '').trim()
    const c = String(row?.cidade || '').trim()
    const u = String(row?.uf || '').trim()
    if (!e) {
        return [c, u].filter(Boolean).join(' / ') || '—'
    }
    const en = normalizarTextoProspecto(e)
    if (c && en.includes(normalizarTextoProspecto(c))) {
        if (u && en.includes(normalizarTextoProspecto(u))) return e
        if (!u) return e
    }
    return [e, c, u].filter(Boolean).join(' · ')
}
