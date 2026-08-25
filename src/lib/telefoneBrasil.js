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

/**
 * Separa o 1.º telefone (máscara BR) dos restantes — para Kanban / campos únicos.
 * Aceita colagem com `/`, `|`, `;`, `,`, quebras de linha ou vários números colados.
 * Digitação normal (≤11 dígitos / máscara) não parte o número.
 * @returns {{ principal: string, extras: string[] }}
 */
export function separarTelefonePrincipalEExtras(valor) {
    const bruto = String(valor || '').trim()
    if (!bruto) return { principal: '', extras: [] }

    const digitosTotais = normalizarTelefoneBr(bruto)
    // Entrada única (máscara ou digitação): não partir pelo espaço da máscara
    if (
        digitosTotais.length <= 11 &&
        !/[|/;,]+/.test(bruto) &&
        !/\n/.test(bruto) &&
        !/\s+e\s+/i.test(bruto)
    ) {
        return { principal: maskTelefoneBr(digitosTotais), extras: [] }
    }

    const chunks = bruto
        .split(/[/|;,]+|\n+|\s{2,}|\s+e\s+/i)
        .map((s) => s.trim())
        .filter(Boolean)

    const phones = []

    const empurrarDigitos = (digitos) => {
        let rest = String(digitos || '')
        while (rest.length >= 10) {
            if (rest.length === 10 || rest.length === 11) {
                phones.push(maskTelefoneBr(rest))
                return
            }
            const after11 = rest.slice(11)
            if (after11.length === 0 || after11.length >= 10) {
                phones.push(maskTelefoneBr(rest.slice(0, 11)))
                rest = after11
            } else {
                phones.push(maskTelefoneBr(rest.slice(0, 10)))
                rest = rest.slice(10)
            }
        }
        if (rest.length > 0 && phones.length === 0) {
            phones.push(maskTelefoneBr(rest))
        }
    }

    if (chunks.length <= 1) {
        empurrarDigitos(digitosTotais)
    } else {
        for (const c of chunks) {
            const d = normalizarTelefoneBr(c)
            if (d.length >= 10 && d.length <= 11) phones.push(maskTelefoneBr(d))
            else if (d.length > 11) empurrarDigitos(d)
            else if (d.length > 0 && phones.length === 0) phones.push(maskTelefoneBr(d))
        }
    }

    const vistos = new Set()
    const unicos = []
    for (const p of phones) {
        const key = normalizarTelefoneBr(p)
        if (!key || vistos.has(key)) continue
        vistos.add(key)
        unicos.push(p)
    }

    return { principal: unicos[0] || '', extras: unicos.slice(1) }
}

const MARCADOR_CONTATOS_ADICIONAIS = 'Contatos adicionais'

/**
 * Acrescenta telefones extras à descrição sob «Contatos adicionais» (sem duplicar).
 */
export function anexarContatosAdicionaisNaDescricao(corpo, extras = []) {
    const lista = (extras || []).map((t) => String(t || '').trim()).filter(Boolean)
    if (!lista.length) return String(corpo || '')

    let texto = String(corpo || '')
    const novos = lista.filter((t) => {
        const d = normalizarTelefoneBr(t)
        if (!d) return false
        if (texto.includes(t)) return false
        const soDigitosCorpo = texto.replace(/\D/g, '')
        return !soDigitosCorpo.includes(d)
    })
    if (!novos.length) return texto

    const blocoLinhas = novos.map((t) => `- ${t}`).join('\n')
    const reSecao = /(^|\n)Contatos adicionais:?\s*\n((?:[ \t]*-[^\n]*\n?)*)/i
    const m = reSecao.exec(texto)
    if (m) {
        const prefixLen = m[1] ? m[1].length : 0
        const inicio = m.index + prefixLen
        const fim = m.index + m[0].length
        const existentes = String(m[2] || '').replace(/\s*$/, '')
        const corpoSecao = existentes
            ? `${MARCADOR_CONTATOS_ADICIONAIS}:\n${existentes}\n${blocoLinhas}`
            : `${MARCADOR_CONTATOS_ADICIONAIS}:\n${blocoLinhas}`
        return `${texto.slice(0, inicio)}${corpoSecao}${texto.slice(fim)}`.replace(/\n{3,}/g, '\n\n').trimEnd()
    }

    const sep = texto.trim() ? '\n\n' : ''
    return `${texto.trimEnd()}${sep}${MARCADOR_CONTATOS_ADICIONAIS}:\n${blocoLinhas}`
}

