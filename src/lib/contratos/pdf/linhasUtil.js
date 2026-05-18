/** Linha de texto no PDF / pré-visualização. */
export const L = (text, opts = {}) => ({
    text: text ?? '',
    style: opts.style || 'normal',
    size: opts.size ?? 11,
    gap: opts.gap ?? 2,
    indent: opts.indent ?? 0,
    align: opts.align || 'left',
    segments: opts.segments || null,
})

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'])

/** Primeira letra de cada palavra (endereço no PDF); mantém CEP, UF e CEP numérico. */
export function formatarEnderecoExibicao(endereco) {
    const raw = String(endereco ?? '').trim()
    if (!raw) return '—'
    return raw.replace(/\b[\wÀ-ÿ]+\b/g, (word) => {
        const upper = word.toUpperCase()
        if (upper === 'CEP') return 'CEP'
        if (UFS.has(upper)) return upper
        if (/^\d{5}-\d{3}$/.test(word)) return word
        if (/^\d+$/.test(word)) return word
        return upper.charAt(0) + word.slice(1).toLowerCase()
    })
}

/** Campo «rótulo: valor» em linha própria (como na minuta PDF base). */
export function LCampo(rotulo, valor, opts = {}) {
    const size = opts.size ?? 11
    let v = String(valor ?? '').trim() || '—'
    if (/^endereço/i.test(String(rotulo).trim())) {
        v = formatarEnderecoExibicao(v)
    }
    return L(`${rotulo}: ${v}`, { gap: opts.gap ?? 1, indent: opts.indent ?? 0, size })
}

export function textoLinha(l) {
    if (l.segments?.length) return l.segments.map((s) => s.t).join('')
    return l.text
}
