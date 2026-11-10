/**
 * Regras puras da API de pagamentos (/api/v1/pagamentos/*, docs/api/especificacao-design.md seção 7). Sem I/O.
 * Erros de entrada saem como ErroValidacao(codigo); a rota converte em HTTP (413 arquivo_grande, 422 arquivo_invalido,
 * 400 nos demais).
 */
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { ErroValidacao } from './redeRegras.js'

export { ErroValidacao }

/** Teto do comprovante decodificado (3 MB). */
export const MAX_COMPROVANTE_BYTES = 3 * 1024 * 1024
export const POR_PAGINA_PADRAO = 18
export const POR_PAGINA_MAX = 100

const TIPOS = [
    { ext: 'pdf', contentType: 'application/pdf', assinatura: [0x25, 0x50, 0x44, 0x46] }, // %PDF
    { ext: 'png', contentType: 'image/png', assinatura: [0x89, 0x50, 0x4e, 0x47] },
    { ext: 'jpg', contentType: 'image/jpeg', assinatura: [0xff, 0xd8, 0xff] },
]

/**
 * Tipo do arquivo pelos primeiros bytes (o nome e o tipo informado não contam).
 * @param {{ nome?: string, tipoMime?: string, bytes: Buffer }} arquivo
 * @returns {{ ext: 'pdf'|'png'|'jpg', contentType: string }}
 */
export function validarComprovante({ bytes } = {}) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw new ErroValidacao('arquivo_invalido', 'Envie um arquivo PDF, PNG ou JPG.')
    }
    if (bytes.length > MAX_COMPROVANTE_BYTES) {
        throw new ErroValidacao('arquivo_grande', 'O comprovante pode ter no máximo 3 MB.')
    }
    const tipo = TIPOS.find((t) => t.assinatura.every((b, i) => bytes[i] === b))
    if (!tipo) throw new ErroValidacao('arquivo_invalido', 'O arquivo precisa ser PDF, PNG ou JPG.')
    return { ext: tipo.ext, contentType: tipo.contentType }
}

export const hashArquivo = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** `arquivo_base64` (aceita o prefixo `data:...;base64,`) para Buffer. */
export function decodificarBase64(texto) {
    if (typeof texto !== 'string' || !texto.trim()) {
        throw new ErroValidacao('arquivo_obrigatorio', 'Informe o arquivo em arquivo_base64.')
    }
    const limpo = texto.trim().replace(/^data:[\w.+-]+\/[\w.+-]+;base64,/i, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo) || limpo.length % 4 === 1) {
        throw new ErroValidacao('arquivo_invalido', 'arquivo_base64 não é base64 válido.')
    }
    return Buffer.from(limpo, 'base64')
}

/** `AAAA-MM-DD` de uma data que existe no calendário. */
export function validarDataPagamento(v, { obrigatoria = true } = {}) {
    if (v === undefined || v === null || v === '') {
        if (!obrigatoria) return null
        throw new ErroValidacao('data_pagamento_invalida', 'Informe data_pagamento no formato AAAA-MM-DD.')
    }
    const s = String(v)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
    if (!d || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
        throw new ErroValidacao('data_pagamento_invalida', 'Informe data_pagamento no formato AAAA-MM-DD.')
    }
    return s
}

/** Valor positivo em reais, arredondado a centavos. */
export function validarValor(v, { obrigatorio = true } = {}) {
    if (v === undefined || ((v === null || v === '') && !obrigatorio)) {
        if (!obrigatorio) return null
        throw new ErroValidacao('valor_invalido', 'Informe valor (número maior que zero).')
    }
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    if (!Number.isFinite(n) || n <= 0) throw new ErroValidacao('valor_invalido', 'Informe valor (número maior que zero).')
    return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Mesma regra de `desfazer-pagamento` do painel: mínimo 5 caracteres, guarda até 500. */
export function validarMotivo(v) {
    const texto = String(v ?? '').trim()
    if (texto.length < 5) throw new ErroValidacao('motivo_obrigatorio', 'Informe o motivo (mínimo 5 caracteres).')
    return texto.slice(0, 500)
}

/** Booleano opcional do corpo (true/false ou 'true'/'false'); ausente usa o padrão. */
export function booleanoOpcional(v, nome, padrao = false) {
    if (v === undefined || v === null) return padrao
    if (v === true || v === 'true') return true
    if (v === false || v === 'false') return false
    throw new ErroValidacao('parametro_invalido', `${nome} deve ser true ou false.`)
}

const textoQuery = (v) => {
    const s = Array.isArray(v) ? v[0] : v
    return s === undefined || s === null ? '' : String(s).trim()
}

function inteiroPositivo(v, padrao) {
    const s = textoQuery(v)
    if (!/^\d+$/.test(s)) return padrao
    const n = Number(s)
    return n >= 1 ? n : padrao
}

/** Filtros e paginação de GET /pagamentos/registros. Filtro malformado é 400 parametro_invalido. */
export function lerFiltrosRegistros(query = {}) {
    const invalido = (nome, regra) => new ErroValidacao('parametro_invalido', `${nome} inválido: ${regra}.`)
    const mesTxt = textoQuery(query.mes)
    const anoTxt = textoQuery(query.ano)
    const pagoTxt = textoQuery(query.pago)
    const prestTxt = textoQuery(query.prestador_id)
    let mes = null
    if (mesTxt) {
        if (!/^\d{1,2}$/.test(mesTxt) || Number(mesTxt) < 1 || Number(mesTxt) > 12) throw invalido('mes', 'use 1 a 12')
        mes = Number(mesTxt)
    }
    let ano = null
    if (anoTxt) {
        if (!/^\d{4}$/.test(anoTxt)) throw invalido('ano', 'use AAAA')
        ano = Number(anoTxt)
    }
    let pago = null
    if (pagoTxt) {
        if (pagoTxt !== 'true' && pagoTxt !== 'false') throw invalido('pago', 'use true ou false')
        pago = pagoTxt === 'true'
    }
    let prestadorId = null
    if (prestTxt) {
        if (!/^\d{1,15}$/.test(prestTxt)) throw invalido('prestador_id', 'use o id numérico')
        prestadorId = Number(prestTxt)
    }
    return {
        mes, ano, pago, prestadorId,
        pagina: inteiroPositivo(query.pagina, 1),
        porPagina: Math.min(inteiroPositivo(query.por_pagina, POR_PAGINA_PADRAO), POR_PAGINA_MAX),
    }
}

const numeroOuNulo = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Objeto público do registro (lista fixa: nunca PIX, e-mail, obs ou caminho de arquivo). */
export function registroPublico(r, { temRelatorio, temComprovante }) {
    return {
        id: r.id,
        competencia: { mes: Number(r.mes), ano: Number(r.ano) },
        prestador_id: r.prestador_id ?? null,
        prestador_nome: r.prestador_nome || null,
        tipo_repasse: r.tipo_repasse || null,
        valor: numeroOuNulo(r.valor),
        pago: !!r.pago,
        tem_relatorio: !!temRelatorio,
        tem_comprovante: !!temComprovante,
    }
}

export const comprovantePublico = (c) => ({
    id: c.id,
    data_pagamento: c.data_pagamento ? String(c.data_pagamento).slice(0, 10) : null,
    valor: numeroOuNulo(c.valor),
    forma: c.forma || null,
    enviado_em: c.enviado_em || null,
})

/** Origem do evento sem revelar quem (o autor do painel é o e-mail do usuário). */
export function origemDoAutor(autor) {
    const a = String(autor || '')
    if (a.startsWith('api:')) return 'api'
    if (a === 'prestador' || a === 'sistema') return a
    return 'painel'
}

/** Caminho no bucket: o mesmo prefixo do painel com relatório; sem relatório, `AAAA-MM/registro-<id>/comprovante/`. */
export function caminhoComprovante({ registro, relatorio, hash, ext }) {
    const base = relatorio || registro
    const pasta = relatorio ? relatorio.id : `registro-${registro.id}`
    return `${base.ano}-${String(base.mes).padStart(2, '0')}/${pasta}/comprovante/${hash}.${ext}`
}
