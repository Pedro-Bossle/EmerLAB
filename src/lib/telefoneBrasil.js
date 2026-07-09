/**
 * Telefone BR: (XX) XXXX-XXXX (fixo) ou (XX) XXXXX-XXXX (celular).
 */

export function normalizarTelefoneBr(valor) {
    let d = String(valor || '').replace(/\D/g, '')
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
    return d
}

/** Máscara de entrada e exibição. */
export function maskTelefoneBr(valor) {
    const digitos = normalizarTelefoneBr(valor).slice(0, 11)
    if (digitos.length === 0) return ''
    if (digitos.length <= 2) return `(${digitos}`
    if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`
    if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`
}

/** Formata para listas/PDF; se não tiver 10+ dígitos, devolve o texto original. */
export function formatarTelefoneBrExibicao(valor) {
    const bruto = String(valor ?? '').trim()
    if (!bruto || bruto === '—') return bruto || '—'
    const d = normalizarTelefoneBr(bruto)
    if (d.length < 10) return bruto
    return maskTelefoneBr(d)
}

/** Se o texto for só telefone (≥10 dígitos), formata; senão mantém (ex.: nome + ramal). */
export function formatarContatoSeTelefone(texto) {
    const t = String(texto || '').trim()
    if (!t) return t
    const d = t.replace(/\D/g, '')
    if (d.length < 10) return t
    if (d.length > 11) return t
    return formatarTelefoneBrExibicao(t)
}

/** Celular e telefone fixo para popup/listas (evita duplicar se iguais). */
export function formatarLinhaTelefonesContato(celular, telefone) {
    const c = String(celular || '').trim()
    const t = String(telefone || '').trim()
    if (!c && !t) return ''
    if (c && t) {
        const fc = formatarContatoSeTelefone(c)
        const ft = formatarContatoSeTelefone(t)
        if (fc === ft) return fc
        return [fc, ft].filter(Boolean).join(' · ')
    }
    return formatarContatoSeTelefone(c || t)
}
