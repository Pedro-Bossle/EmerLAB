import { filtrarPorTermoBusca } from './prestadorCadastroHelpers.js'

/**
 * Fragmentos textuais de valores numéricos para blob de busca na Supertabela.
 * Compatível com normalizarTextoBusca (pontuação vira espaço).
 */
export function partesTextoValoresParaBusca(...valores) {
    const partes = []
    const visto = new Set()

    const adicionar = (s) => {
        const t = String(s ?? '').trim()
        if (!t || visto.has(t)) return
        visto.add(t)
        partes.push(t)
    }

    const processar = (v) => {
        if (v == null || v === '') return
        if (typeof v === 'object') {
            if ('valor' in v) processar(v.valor)
            return
        }
        if (typeof v === 'number') {
            if (!Number.isFinite(v)) return
            adicionar(String(v))
            adicionar(v.toFixed(2))
            adicionar(v.toFixed(2).replace('.', ','))
            const arred = Math.round(v)
            if (Math.abs(v - arred) < 1e-9) adicionar(String(arred))
            return
        }
        const bruto = String(v).trim()
        if (!bruto) return
        adicionar(bruto)
        const n = Number(bruto.replace(/\s/g, '').replace(',', '.'))
        if (Number.isFinite(n)) {
            adicionar(String(n))
            adicionar(n.toFixed(2))
            adicionar(n.toFixed(2).replace('.', ','))
        }
    }

    for (const v of valores) processar(v)
    return partes
}

function candidatosValoresLinha(linha, chavesExtra = []) {
    if (!linha || typeof linha !== 'object') return []
    const candidatos = [
        linha.porteP,
        linha.porteM,
        linha.porteG,
        linha.diferenca,
        linha.custo,
        ...chavesExtra.map((k) => linha[k]),
    ]
    for (const [chave, valor] of Object.entries(linha)) {
        if (valor && typeof valor === 'object' && 'valor' in valor && !chave.toLowerCase().includes('id')) {
            candidatos.push(valor)
        }
    }
    return candidatos
}

function numeroDeCandidato(v) {
    if (v == null || v === '') return null
    if (typeof v === 'object') {
        if ('valor' in v) return numeroDeCandidato(v.valor)
        return null
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const n = Number(String(v).trim().replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

/** Coleta valores numéricos típicos de uma linha de tabela (P/M/G, diferença, custo, células { valor }). */
export function partesValoresLinhaSupertabela(linha, chavesExtra = []) {
    return partesTextoValoresParaBusca(...candidatosValoresLinha(linha, chavesExtra))
}

/** Termo puro numérico (`0`, `0,00`, `89.9`) → número; caso contrário null. */
export function interpretarTermoComoNumeroExato(termoBruto) {
    const t = String(termoBruto || '').trim()
    if (!t || !/^-?\d+([.,]\d+)?$/.test(t)) return null
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

export function linhaTemValorNumericoExato(linha, alvo, chavesExtra = []) {
    if (!Number.isFinite(alvo)) return false
    return candidatosValoresLinha(linha, chavesExtra).some((v) => {
        const n = numeroDeCandidato(v)
        return n != null && Math.abs(n - alvo) < 1e-9
    })
}

function compararNumeros(a, op, b) {
    switch (op) {
        case '<':
            return a < b
        case '>':
            return a > b
        case '<=':
            return a <= b
        case '>=':
            return a >= b
        default:
            return false
    }
}

/**
 * Comparação numérica na Supertabela:
 * - `> 50`, `<= 0`, `< 100`
 * - `100 >`, `50 <` (constante à esquerda)
 * - `Y < 100`, `100 > Y` (letra = valor da célula)
 * - `80 < 100` → alguma célula V com V < 100 (limite à direita)
 */
export function interpretarComparacaoNumericaBusca(termoBruto) {
    const t = String(termoBruto || '').trim()
    if (!t || !/[<>]/.test(t)) return null
    const m = t.match(/^(.*?)\s*(<=|>=|<|>)\s*(.*?)$/)
    if (!m) return null
    const left = String(m[1] || '').trim()
    const op = m[2]
    const right = String(m[3] || '').trim()
    if (left.includes('(') || right.includes('(') || left.includes('!') || right.includes('!')) {
        return null
    }
    const leftNum = left ? interpretarTermoComoNumeroExato(left) : null
    const rightNum = right ? interpretarTermoComoNumeroExato(right) : null
    const leftOk = !left || leftNum != null || /^[a-zA-Z_]\w*$/.test(left)
    const rightOk = !right || rightNum != null || /^[a-zA-Z_]\w*$/.test(right)
    if (!leftOk || !rightOk) return null
    if (leftNum == null && rightNum == null) return null

    if (rightNum != null && leftNum == null) {
        return { modo: 'cell_op_const', op, valor: rightNum }
    }
    if (leftNum != null && rightNum == null) {
        return { modo: 'const_op_cell', op, valor: leftNum }
    }
    // Ambos números: usa o da direita como limiar (Y < X → células < X)
    return { modo: 'cell_op_const', op, valor: rightNum }
}

export function linhaSatisfazComparacaoNumerica(linha, comp, chavesExtra = []) {
    if (!comp) return false
    const nums = candidatosValoresLinha(linha, chavesExtra)
        .map(numeroDeCandidato)
        .filter((n) => n != null)
    if (!nums.length) return false
    if (comp.modo === 'cell_op_const') {
        return nums.some((v) => compararNumeros(v, comp.op, comp.valor))
    }
    if (comp.modo === 'const_op_cell') {
        return nums.some((v) => compararNumeros(comp.valor, comp.op, v))
    }
    return false
}

/**
 * Filtro de linha: comparadores e números exatos; depois sintaxe de texto avançada.
 */
export function filtrarLinhaSupertabelaPorBusca(
    linha,
    blobNormalizado,
    termoBruto,
    _buscaNotAtiva = false,
    chavesExtra = [],
) {
    const bruto = String(termoBruto || '').trim()
    if (!bruto) return true

    const comp = interpretarComparacaoNumericaBusca(bruto)
    if (comp) {
        return linhaSatisfazComparacaoNumerica(linha, comp, chavesExtra)
    }

    const num = interpretarTermoComoNumeroExato(bruto)
    if (num != null) {
        const temValor = linhaTemValorNumericoExato(linha, num, chavesExtra)
        if (Math.abs(num) < 1e-9) return temValor
        if (temValor) return true
    }

    return filtrarPorTermoBusca(blobNormalizado, bruto)
}
