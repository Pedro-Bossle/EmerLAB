import { normalizarTextoBusca } from '../../prestadorCadastroHelpers.js'

export function normalizeExam(texto) {
    return normalizarTextoBusca(texto)
}

/** Score 0–1000. */
export function calculateExamSimilarity(a, b) {
    const termo = normalizeExam(a)
    const n = normalizeExam(b)
    if (!termo || !n) return 0
    if (n === termo) return 1000
    if (n.startsWith(termo) || termo.startsWith(n)) return 850

    const palavrasTermo = termo.split(/\s+/).filter(Boolean)
    const palavrasN = n.split(/\s+/).filter(Boolean)
    const substringFraca =
        (termo.includes(n) || n.includes(termo)) &&
        Math.min(palavrasTermo.length, palavrasN.length) === 1 &&
        Math.max(palavrasTermo.length, palavrasN.length) >= 2
    if ((n.includes(termo) || termo.includes(n)) && !substringFraca) return 650

    const palavras = palavrasTermo.filter((w) => w.length >= 2)
    const palavrasCurtas = palavrasTermo.filter((w) => w.length === 1)
    let hits = 0
    for (const w of palavras) {
        if (palavrasN.some((pn) => pn.startsWith(w) || pn.includes(w))) hits += 1
    }
    for (const w of palavrasCurtas) {
        if (palavrasN.some((pn) => pn.startsWith(w))) hits += 0.5
    }
    if (hits > 0 && (palavras.length || palavrasCurtas.length)) {
        const total = Math.max(palavras.length + palavrasCurtas.length * 0.5, 1)
        return 180 + Math.round((120 * hits) / total)
    }
    return 0
}

export const EQUIVALENCIAS_PADRAO = [
    {
        a: 'UROCULTURA',
        b: 'CULTURA BACTERIANA + ANTIBIOGRAMA',
    },
    {
        a: 'CITOLOGIA 1 NODULO',
        b: 'CITOPATOLOGICO - 1 SITIO DE COLETA',
    },
    {
        a: 'HEMOGRAMA + PLAQUETAS',
        b: 'HEMOGRAMA COMPLETO MELLISLAB - CITOMETRIA DE FLUXO',
    },
]

export function parEquivalencia(a, b) {
    return {
        a: String(a || '').trim(),
        b: String(b || '').trim(),
        aNorm: normalizeExam(a),
        bNorm: normalizeExam(b),
    }
}

export function indexarEquivalencias(lista) {
    const pares = (lista || []).map((p) => parEquivalencia(p.a || p.nome_a, p.b || p.nome_b))
    return pares.filter((p) => p.aNorm && p.bNorm)
}

function casaComLado(exameNorm, ladoNorm) {
    if (!exameNorm || !ladoNorm) return false
    if (exameNorm === ladoNorm) return true
    return calculateExamSimilarity(exameNorm, ladoNorm) >= 850
}

export function applyExamEquivalence(exameA, exameB, equivalencias = []) {
    const na = normalizeExam(exameA)
    const nb = normalizeExam(exameB)
    if (!na || !nb) return { exact: false, equivalent: false, score: 0 }
    const score = calculateExamSimilarity(na, nb)
    if (na === nb) return { exact: true, equivalent: true, score: 1000 }
    for (const par of equivalencias) {
        const aNorm = par.aNorm || normalizeExam(par.a)
        const bNorm = par.bNorm || normalizeExam(par.b)
        if (
            (casaComLado(na, aNorm) && casaComLado(nb, bNorm)) ||
            (casaComLado(na, bNorm) && casaComLado(nb, aNorm))
        ) {
            return { exact: false, equivalent: true, score: Math.max(score, 900) }
        }
    }
    return { exact: false, equivalent: false, score }
}
