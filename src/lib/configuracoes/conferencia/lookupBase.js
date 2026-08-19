import { normalizeExam, applyExamEquivalence } from './examSimilarity.js'

export function normalizarItemBase(linha, indice = 0) {
    const nome = String(linha.nome || linha.exame || '').trim()
    const codigo = String(linha.codigo || '').trim()
    return {
        id: linha.id || linha.idLocal || `base-${indice}`,
        codigo,
        nome,
        exame: nome,
        valor: linha.valor ?? linha.valorRelatorio ?? null,
        nomeNorm: normalizeExam(nome),
        codigoNorm: normalizeExam(codigo),
        linha_original: linha.linha_original ?? linha.linhaExcel ?? indice + 1,
    }
}

function chaveVinculo(exame) {
    return normalizeExam(exame)
}

/**
 * Conservador: nome (ou código) único na lista de Valores de Base.
 * 0 ou 2+ candidatos → o usuário vincula nesta conferência.
 */
export function buscarValorBase(exameOuCodigo, valoresBase = [], { vinculos = {}, equivalencias = [] } = {}) {
    const itens = (valoresBase || []).map((l, i) => normalizarItemBase(l, i))
    const termo = String(exameOuCodigo || '').trim()
    const termoNorm = normalizeExam(termo)
    if (!termoNorm || !itens.length) {
        return { tipo: 'nenhum', item: null, candidatos: [] }
    }

    const vinculoId = vinculos[termoNorm] || vinculos[termo]
    if (vinculoId) {
        const item = itens.find((x) => String(x.id) === String(vinculoId))
        if (item) return { tipo: 'unico', item, candidatos: [item], via: 'vinculo' }
    }

    const exatos = itens.filter(
        (x) =>
            (x.nomeNorm && x.nomeNorm === termoNorm) ||
            (x.codigoNorm && x.codigoNorm === termoNorm) ||
            String(x.codigo).trim() === termo,
    )
    if (exatos.length === 1) return { tipo: 'unico', item: exatos[0], candidatos: exatos, via: 'exato' }
    if (exatos.length > 1) return { tipo: 'ambiguo', item: null, candidatos: exatos, via: 'exato' }

    const equivalentes = itens.filter((x) => {
        const ev = applyExamEquivalence(termo, x.nome, equivalencias)
        return ev.equivalent || ev.exact
    })
    if (equivalentes.length === 1) {
        return { tipo: 'unico', item: equivalentes[0], candidatos: equivalentes, via: 'equivalencia' }
    }
    if (equivalentes.length > 1) {
        return { tipo: 'ambiguo', item: null, candidatos: equivalentes, via: 'equivalencia' }
    }

    return { tipo: 'nenhum', item: null, candidatos: [], via: null }
}

export function aplicarValoresBase(linhasPlano = [], valoresBase = [], vinculos = {}, equivalencias = []) {
    const itens = (valoresBase || []).map((l, i) => normalizarItemBase(l, i))
    return (linhasPlano || []).map((linha, i) => {
        const found = buscarValorBase(linha.exame || linha.codigo, itens, { vinculos, equivalencias })
        const item = found.item
        const valorOficial = found.tipo === 'unico' ? item?.valor ?? null : null
        return {
            ...linha,
            id: linha.id || linha.idLocal || `plano-${i}`,
            valor: valorOficial,
            valorRelatorio: valorOficial,
            valor_base: valorOficial,
            codigo_base: item?.codigo || '',
            nome_base: item?.nome || '',
            lookup_base: found,
        }
    })
}

export function examesPendentesVinculo(linhasComLookup = []) {
    const mapa = new Map()
    for (const linha of linhasComLookup) {
        const tipo = linha.lookup_base?.tipo
        if (tipo === 'unico') continue
        const nome = String(linha.exame || '').trim()
        const chave = chaveVinculo(nome)
        if (!chave) continue
        if (!mapa.has(chave)) {
            mapa.set(chave, {
                chave,
                exame: nome,
                qtd: 0,
                tipo: tipo || 'nenhum',
                candidatos: linha.lookup_base?.candidatos || [],
                valores: [],
            })
        }
        const row = mapa.get(chave)
        row.qtd += 1
        for (const c of linha.lookup_base?.candidatos || []) {
            const v = c.valor ?? c.valorRelatorio
            if (v == null || !Number.isFinite(Number(v))) continue
            const n = Math.round(Number(v) * 100) / 100
            if (!row.valores.includes(n)) row.valores.push(n)
            if (!row.candidatos.some((x) => String(x.id) === String(c.id))) {
                row.candidatos.push(c)
            }
        }
    }
    return [...mapa.values()]
}
