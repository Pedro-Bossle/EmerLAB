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

/**
 * Filtro de linha: números puros batem em valores exatos (inclui zero).
 * Zero (`0` / `0,00` / `0.00`) só usa igualdade numérica — evita falso positivo no texto.
 */
export function filtrarLinhaSupertabelaPorBusca(linha, blobNormalizado, termoBruto, buscaNotAtiva = false, chavesExtra = []) {
    const num = interpretarTermoComoNumeroExato(termoBruto)
    if (num != null && !buscaNotAtiva) {
        const temValor = linhaTemValorNumericoExato(linha, num, chavesExtra)
        if (Math.abs(num) < 1e-9) return temValor
        if (temValor) return true
    }
    return filtrarPorTermoBusca(blobNormalizado, termoBruto, buscaNotAtiva)
}
