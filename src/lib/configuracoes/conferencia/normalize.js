import { normalizarTextoBusca } from '../../prestadorCadastroHelpers.js'

/** Remove iniciais de uma letra (ex.: «F.») após normalizar. */
export function normalizeName(texto) {
    const base = normalizarTextoBusca(texto)
    if (!base) return ''
    return base
        .split(' ')
        .filter((tok) => tok.length > 1)
        .join(' ')
        .trim()
}

export function normalizePet(texto) {
    return normalizeName(texto)
}

export function tokensNome(texto) {
    return normalizeName(texto).split(' ').filter(Boolean)
}

/**
 * Tutores equivalentes: iguais após normalizar, ou o menor (2+ tokens)
 * está contido no maior (abreviações / nome do meio).
 */
export function nomesPessoaEquivalentes(a, b) {
    const na = normalizeName(a)
    const nb = normalizeName(b)
    if (!na || !nb) return false
    if (na === nb) return true
    const ta = tokensNome(a)
    const tb = tokensNome(b)
    if (ta.length < 2 || tb.length < 2) return false
    const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
    return menor.every((t) => maior.includes(t))
}

export function petsEquivalentes(a, b) {
    const na = normalizePet(a)
    const nb = normalizePet(b)
    return Boolean(na && nb && na === nb)
}
