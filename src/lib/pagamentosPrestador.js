import {
    formatarChavePixEntrada,
    inferirTipoPixDaChave,
    normalizarTextoBusca,
} from './prestadorCadastroHelpers.js'

export function rotuloTipoRepasse(valor) {
    const v = String(valor || '').toLowerCase()
    if (v === 'rpa') return 'RPA'
    if (v === 'nota') return 'Nota'
    if (v === 'boleto') return 'Boleto'
    return valor ? String(valor) : '—'
}

export function exibirPixPrestador(prestador) {
    if (!prestador) return ''
    const tipo = String(prestador.tipo_repasse || '').toLowerCase()
    if (tipo === 'boleto') return 'Boleto'
    const chave = prestador.chave_pix
    if (!chave) return ''
    const tipoPix = prestador.tipo_pix || inferirTipoPixDaChave(chave)
    return formatarChavePixEntrada(chave, tipoPix)
}

export function dadosRepasseDoPrestador(prestador) {
    if (!prestador) {
        return { tipo_repasse: null, chave_pix: '' }
    }
    const tipo_repasse = prestador.tipo_repasse || null
    return {
        tipo_repasse,
        chave_pix: exibirPixPrestador(prestador),
    }
}

/** Atualiza tipo/PIX do registro com o cadastro atual do prestador vinculado. */
export function registroComRepasseDoPrestador(row, prestadores) {
    if (!row?.prestadorId) return row
    const p = (prestadores || []).find((pr) => String(pr.id) === String(row.prestadorId))
    if (!p) return row
    const repasse = dadosRepasseDoPrestador(p)
    const tipoRepasse = repasse.tipo_repasse || ''
    const chavePix = repasse.chave_pix || ''
    if (tipoRepasse === (row.tipoRepasse || '') && chavePix === (row.chavePix || '')) return row
    return { ...row, tipoRepasse, chavePix }
}

export function sincronizarRepasseRegistrosComPrestadores(registros, prestadores) {
    const alterados = []
    const lista = (registros || []).map((r) => {
        const next = registroComRepasseDoPrestador(r, prestadores)
        if (next !== r) alterados.push(next)
        return next
    })
    return { lista, alterados }
}

/** Melhor correspondência por nome (exato, depois includes, depois palavras). */
export function resolverPrestadorPorNome(prestadores, nomeBruto) {
    const termo = normalizarTextoBusca(nomeBruto)
    if (!termo) return null
    const lista = prestadores || []

    const exato = lista.find((p) => normalizarTextoBusca(p.nome) === termo)
    if (exato) return exato

    const contem = lista.filter((p) => normalizarTextoBusca(p.nome).includes(termo))
    if (contem.length === 1) return contem[0]
    if (contem.length > 1) {
        const melhor = contem.find((p) => normalizarTextoBusca(p.nome).startsWith(termo))
        return melhor || contem[0]
    }

    const palavras = termo.split(/\s+/).filter(Boolean)
    if (palavras.length < 2) return null
    const candidatos = lista.filter((p) => {
        const n = normalizarTextoBusca(p.nome)
        return palavras.every((w) => n.includes(w))
    })
    if (candidatos.length === 1) return candidatos[0]
    return null
}

/**
 * Candidatos parecidos quando não há match automático (inclusão em massa, revisão).
 * Ordena por proximidade do nome colado.
 */
export function sugerirPrestadoresPorNome(prestadores, nomeBruto, { limite = 8 } = {}) {
    const termo = normalizarTextoBusca(nomeBruto)
    if (!termo) return []
    const lista = prestadores || []
    const palavras = termo.split(/\s+/).filter((w) => w.length >= 2)
    const palavrasCurtas = termo.split(/\s+/).filter((w) => w.length === 1)

    const scored = []
    for (const p of lista) {
        const n = normalizarTextoBusca(p.nome)
        if (!n) continue

        let score = 0
        if (n === termo) score = 1000
        else if (n.startsWith(termo) || termo.startsWith(n)) score = 850
        else if (n.includes(termo) || termo.includes(n)) score = 650
        else {
            const palavrasNome = n.split(/\s+/).filter(Boolean)
            let hits = 0
            for (const w of palavras) {
                if (palavrasNome.some((pn) => pn.startsWith(w) || pn.includes(w))) hits += 1
            }
            for (const w of palavrasCurtas) {
                if (palavrasNome.some((pn) => pn.startsWith(w))) hits += 0.5
            }
            if (hits > 0 && (palavras.length || palavrasCurtas.length)) {
                const total = Math.max(palavras.length + palavrasCurtas.length * 0.5, 1)
                score = 180 + Math.round((120 * hits) / total)
            }
        }

        if (score > 0) scored.push({ p, score })
    }

    scored.sort(
        (a, b) => b.score - a.score || String(a.p.nome).localeCompare(String(b.p.nome), 'pt-BR'),
    )

    const out = []
    const seen = new Set()
    for (const { p, score } of scored) {
        if (score < 120) continue
        const id = String(p.id)
        if (seen.has(id)) continue
        seen.add(id)
        out.push(p)
        if (out.length >= limite) break
    }
    return out
}

export const MESES_ROTULO_CURTO = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
]

export function rotuloMesAnoCurto(mes, ano) {
    const m = Number(mes)
    const a = Number(ano)
    if (!m || m < 1 || m > 12 || !a) return '—'
    const abrev = MESES_ROTULO_CURTO[m - 1] || String(m)
    return `${abrev}/${String(a).slice(-2)}`
}
