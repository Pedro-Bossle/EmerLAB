/**
 * Leitura de endereços brasileiros em texto livre e montagem das consultas de geocodificação.
 * Funções puras (sem rede): a geocodificação em si fica em geocodePrestadorServer.js.
 */

export const UFS_BRASIL = new Set([
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
    'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
])

export const semAcentoMinusculo = (t) =>
    String(t ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

/** Primeiro CEP (8 dígitos) encontrado no texto, só dígitos. */
export function extrairCep(texto) {
    const m = String(texto ?? '').match(/\b(\d{2}\.?\d{3})-?(\d{3})\b/)
    return m ? `${m[1].replace('.', '')}${m[2]}` : ''
}

/** Expande abreviações comuns de logradouro para o Nominatim reconhecer. */
export function expandirAbreviacoesLogradouro(texto) {
    return String(texto ?? '')
        .replace(/\b(?:Av|Avd)\.?(?=\s)/gi, 'Avenida')
        .replace(/\bR\.(?=\s)/g, 'Rua')
        .replace(/\bRod\.?(?=\s)/gi, 'Rodovia')
        .replace(/\bTrav\.?(?=\s)/gi, 'Travessa')
        .replace(/\bEst\.(?=\s)/gi, 'Estrada')
        .replace(/\bPç\.?(?=\s)|\bPca\.?(?=\s)/gi, 'Praça')
        .replace(/\bPres\.?(?=\s)/gi, 'Presidente')
        .replace(/\bDr\.?(?=\s)/gi, 'Doutor')
        .replace(/\bDra\.?(?=\s)/gi, 'Doutora')
        .replace(/\bProf\.?(?=\s)/gi, 'Professor')
        .replace(/\bGen\.?(?=\s)/gi, 'General')
        .replace(/\bCel\.?(?=\s)/gi, 'Coronel')
        .replace(/\bSta\.?(?=\s)/gi, 'Santa')
        .replace(/\bSto\.?(?=\s)/gi, 'Santo')
        .replace(/\bNossa Sra\.?(?=\s|,|$)|\bN\. ?Sra\.?(?=\s|,|$)|\bNsa\.?(?=\s)/gi, 'Nossa Senhora')
        .replace(/\bNossa Sr\.?(?=\s|,|$)/gi, 'Nossa Senhora')
}

/** Número do imóvel: só os dígitos iniciais («1388 sala 7» → «1388»; «s/n» → ''). */
export function numeroPrincipal(numero) {
    const m = String(numero ?? '').trim().match(/^(\d+)/)
    return m ? m[1] : ''
}

/**
 * Lê um endereço em texto livre. Formatos que aparecem no cadastro:
 *  - «Rua X, 123 — complemento — Bairro — Cidade/UF — CEP 99999999»
 *  - «Av. Y, 1470 - Bairro Cidade/RS 91770-010»
 *  - «R. Z, 460, Bairro, Cidade»
 * @returns {{ logradouro: string, numero: string, bairro: string, cidade: string, uf: string, cep: string }}
 */
export function parsearEnderecoLivre(texto) {
    const original = String(texto ?? '').trim()
    const vazio = { logradouro: '', numero: '', bairro: '', cidade: '', uf: '', cep: '' }
    if (!original || original === '-') return vazio

    const cep = extrairCep(original)
    let resto = original
        .replace(/\bCEP\s*:?\s*/gi, '')
        .replace(/\b\d{2}\.?\d{3}-?\d{3}\b/g, ' ')
        .replace(/\b\d{5}-(?=\s|$)/g, ' ') // CEP truncado («91900-»)
        .replace(/\s+/g, ' ')
        .trim()

    // UF: último token em maiúsculas que seja sigla válida.
    let uf = ''
    for (const m of resto.matchAll(/(?<![A-Za-zÀ-ú])([A-Z]{2})(?![A-Za-zÀ-ú])/g)) {
        if (UFS_BRASIL.has(m[1])) uf = m[1]
    }

    // Cidade/UF colados por barra: «Porto Alegre/RS».
    let cidade = ''
    const barra = resto.match(/([A-Za-zÀ-ú'.][A-Za-zÀ-ú'. ]*?)\s*\/\s*([A-Z]{2})\b/)
    if (barra && UFS_BRASIL.has(barra[2])) {
        cidade = barra[1].trim()
        uf = barra[2]
        resto = resto.replace(barra[0], ` ${cidade} `)
    } else if (uf) {
        resto = resto.replace(new RegExp(`(?:[-,—–/]\\s*)?\\b${uf}\\b`), ' ')
    }

    const partes = resto
        .split(/\s*[,—–]\s*|\s+-\s+/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)

    let logradouro = partes[0] || ''
    let numero = ''
    const numNoFim = logradouro.match(/^(.*?[A-Za-zÀ-ú.])\s+(\d+[A-Za-z]?)$/)
    if (numNoFim) {
        logradouro = numNoFim[1].trim()
        numero = numNoFim[2]
    }
    const demais = partes.slice(1)
    if (!numero) {
        const i = demais.findIndex((p) => /^\d+[A-Za-z]?(\s|$)/.test(p))
        if (i >= 0) {
            numero = demais[i].match(/^\d+/)[0]
            demais.splice(i, 1)
        }
    }

    // Se a cidade veio colada ao bairro («Espírito Santo Porto Alegre»), usa o último segmento como cidade.
    let bairro = ''
    if (cidade) {
        const idx = demais.findIndex((p) => semAcentoMinusculo(p).endsWith(semAcentoMinusculo(cidade)))
        if (idx >= 0) {
            const seg = demais[idx]
            const prefixo = seg.slice(0, seg.length - cidade.length).trim()
            if (prefixo) bairro = prefixo
            demais.splice(idx, 1)
        }
        if (!bairro) {
            const sobra = demais.filter((p) => semAcentoMinusculo(p) !== semAcentoMinusculo(cidade))
            // O «complemento» (sala, loja, nome fantasia) costuma vir antes do bairro; fica o último trecho curto.
            bairro = sobra.length ? sobra[sobra.length - 1] : ''
        }
    } else if (demais.length) {
        cidade = demais[demais.length - 1]
        bairro = demais.length > 1 ? demais[demais.length - 2] : ''
    }

    return {
        logradouro: expandirAbreviacoesLogradouro(logradouro).replace(/\bs\/?n\b/gi, '').trim(),
        numero: numeroPrincipal(numero),
        bairro: bairro.replace(/\b(sala|loja|apto|casa|bloco|cj|conjunto)\b.*$/i, '').trim(),
        cidade: cidade.trim(),
        uf,
        cep,
    }
}

/** Funde campos estruturados do cadastro com o que foi lido do texto legado; o estruturado vence. */
export function enderecoCanonicoDoPrestador(prestador, via = null) {
    const p = prestador || {}
    const legado = parsearEnderecoLivre(p.endereco)
    // Há cadastros com a linha inteira dentro do campo «logradouro».
    const doLogr = String(p.endereco_logradouro || '').match(/[/,-]\s*[A-Z]{2}\b|\d{5}-?\d{3}/)
        ? parsearEnderecoLivre(p.endereco_logradouro)
        : null
    const escolher = (...v) => v.map((x) => String(x ?? '').trim()).find(Boolean) || ''

    // Ordem de confiança: campos do cadastro → ViaCEP (oficial, pelo CEP) → texto interpretado.
    // O texto livre é o menos confiável («Bairro Cidade/UF» colados), então só preenche o que sobrar.
    const uf = escolher(p.endereco_uf, via?.uf, doLogr?.uf, legado.uf).toUpperCase()
    return {
        logradouro: expandirAbreviacoesLogradouro(
            escolher(doLogr ? '' : p.endereco_logradouro, via?.logradouro, doLogr?.logradouro, legado.logradouro),
        ),
        numero: numeroPrincipal(escolher(p.endereco_numero, doLogr?.numero, legado.numero)),
        bairro: escolher(p.endereco_bairro, via?.bairro, doLogr?.bairro, legado.bairro),
        cidade: escolher(p.endereco_cidade, via?.cidade, doLogr?.cidade, legado.cidade),
        uf: UFS_BRASIL.has(uf) ? uf : '',
        cep: extrairCep(escolher(p.cep, doLogr?.cep, legado.cep, via?.cep)),
        viaLogradouro: String(via?.logradouro || '').trim(),
    }
}

const TIPOS_VIA = new Set([
    'rua', 'avenida', 'av', 'alameda', 'travessa', 'estrada', 'rodovia', 'praca', 'largo', 'beco', 'via', 'servidao',
    'doutor', 'dr', 'doutora', 'dra', 'professor', 'prof', 'professora', 'general', 'coronel', 'presidente',
    'de', 'da', 'do', 'das', 'dos', 'e',
])

function editDistanciaAte1(a, b) {
    if (a === b) return true
    if (Math.abs(a.length - b.length) > 1) return false
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) // 1 troca
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1) // 1 inserção
}

const NUMEROS_POR_EXTENSO = {
    um: 1, primeiro: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11,
    doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
    dezenove: 19, vinte: 20, trinta: 30,
}

/** «Rua Vinte e Cinco de Julho» → «rua 25 de julho» (o OpenStreetMap usa algarismos). */
export function numerosPorExtensoParaAlgarismos(texto) {
    const t = semAcentoMinusculo(texto).replace(
        /\b(vinte|trinta) e (um|dois|tres|quatro|cinco|seis|sete|oito|nove)\b/g,
        (_, dezena, unidade) => String(NUMEROS_POR_EXTENSO[dezena] + NUMEROS_POR_EXTENSO[unidade]),
    )
    return t.replace(/\b[a-z]+\b/g, (w) => (NUMEROS_POR_EXTENSO[w] ? String(NUMEROS_POR_EXTENSO[w]) : w))
}

/** O logradouro do resultado é o do cadastro? Tolera tipo de via diferente e erro de digitação de 1 letra. */
export function ruaConfere(logradouroEsperado, ruaHit) {
    const palavras = (t) => numerosPorExtensoParaAlgarismos(t).split(/[^a-z0-9]+/).filter(Boolean)
    const esperado = palavras(logradouroEsperado).filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !TIPOS_VIA.has(t))
    if (!esperado.length) return true
    const obtido = palavras(ruaHit)
    if (!obtido.length) return false
    const achou = esperado.filter((t) => obtido.some((o) => o === t || (t.length >= 5 && editDistanciaAte1(o, t)))).length
    return achou >= Math.ceil(esperado.length * 0.6)
}

/** Bairro do resultado compatível com o do cadastro? Sem um dos dois, não há como contestar. */
export function bairroConfere(bairroEsperado, bairroHit) {
    const a = semAcentoMinusculo(bairroEsperado)
    const b = semAcentoMinusculo(bairroHit)
    if (!a || !b) return true
    return a === b || a.includes(b) || b.includes(a)
}

const juntar = (...partes) => partes.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ')

/**
 * Consultas por ordem de precisão. Cada item informa o que tenta achar (`alvo`):
 *  - «endereco»: imóvel/rua;  - «cep»: centro do CEP;  - «nome»: o estabelecimento pelo nome (POI).
 * @returns {{ query: string, alvo: 'endereco'|'cep'|'nome', rotulo: string }[]}
 */
export function montarConsultasGeocode(prestador, via = null, { max = 9 } = {}) {
    const e = enderecoCanonicoDoPrestador(prestador, via)
    const nome = String(prestador?.nome || '').trim()
    const regiao = [e.cidade, e.uf].filter(Boolean)
    const out = []
    const vistos = new Set()
    const add = (alvo, rotulo, ...partes) => {
        const query = juntar(...partes, 'Brasil')
        const chave = semAcentoMinusculo(query)
        if (!query || vistos.has(chave)) return
        vistos.add(chave)
        out.push({ query, alvo, rotulo })
    }

    if (e.logradouro) {
        if (e.numero) {
            add('endereco', 'rua+número+bairro', e.logradouro, e.numero, e.bairro, ...regiao)
            add('endereco', 'rua+número', e.logradouro, e.numero, ...regiao)
            if (e.viaLogradouro && semAcentoMinusculo(e.viaLogradouro) !== semAcentoMinusculo(e.logradouro)) {
                add('endereco', 'rua (ViaCEP)+número', e.viaLogradouro, e.numero, ...regiao)
            }
        }
        add('endereco', 'rua+bairro', e.logradouro, e.bairro, ...regiao)
        add('endereco', 'rua', e.logradouro, ...regiao)
    }
    if (e.cep) {
        add('cep', 'CEP', `${e.cep.slice(0, 5)}-${e.cep.slice(5)}`, ...regiao)
    }
    if (nome && e.cidade) {
        add('nome', 'nome+bairro', nome, e.bairro, ...regiao)
        add('nome', 'nome', nome, ...regiao)
    }
    // Sem logradouro nem cidade: tenta o texto bruto como último recurso.
    if (!out.length) {
        const bruto = expandirAbreviacoesLogradouro(String(prestador?.endereco || '').replace(/\s+[—–-]\s+/g, ', '))
        if (bruto && bruto !== '-') add('endereco', 'texto original', bruto)
    }
    return out.slice(0, max)
}

/** Motivo humano quando não há como geocodificar (nenhuma consulta possível). */
export function motivoSemEndereco(prestador) {
    const e = enderecoCanonicoDoPrestador(prestador)
    if (!e.logradouro && !e.cep && !e.cidade) return 'Sem endereço cadastrado'
    if (!e.logradouro && !e.cep) return 'Só tem a cidade — falta o endereço'
    return ''
}
