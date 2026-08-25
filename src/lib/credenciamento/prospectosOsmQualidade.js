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
 * Indica estabelecimento fechado / inativo / inexistente (OSM tags, horário ou nome).
 * @param {Record<string, string>} [tags]
 * @param {string} [nome]
 * @param {string} [horario]
 */
export function estabelecimentoIndicaInativo(tags = {}, nome = '', horario = '') {
    const t = tags || {}
    if (
        t.disused === 'yes' ||
        t.abandoned === 'yes' ||
        t.ruins === 'yes' ||
        t.vacant === 'yes' ||
        t.shop === 'vacant' ||
        t.amenity === 'vacant' ||
        /^(yes|true|permanent|permanently)$/i.test(String(t.closed || '')) ||
        /^(yes|true|permanent|permanently)$/i.test(String(t.permanently_closed || ''))
    ) {
        return true
    }

    const oh = normalizarTextoProspecto(horario || t.opening_hours || '')
    if (
        oh === 'closed' ||
        oh === 'off' ||
        oh === 'permanently closed' ||
        oh === 'fechado' ||
        oh === 'fechada' ||
        /^closed\b/.test(oh) ||
        /^permanently closed/.test(oh)
    ) {
        return true
    }

    const n = normalizarTextoProspecto(nome || t.name || '')
    if (
        /\b(fechado|fechada|encerrado|encerrada|desativado|desativada|inexistente|abandonado|abandonada|demolido|demolida)\b/.test(
            n,
        ) ||
        /\bantig[oa]\b/.test(n) ||
        /\bem obras\b/.test(n) ||
        /\bfora de (operacao|atividade)\b/.test(n)
    ) {
        return true
    }

    const nota = normalizarTextoProspecto(t.nota || t.description || '')
    if (
        nota &&
        /\b(fechado|fechada|nao existe mais|nao funciona|desativado|permanently closed|out of business)\b/.test(
            nota,
        )
    ) {
        return true
    }

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
