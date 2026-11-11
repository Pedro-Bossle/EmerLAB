/**
 * Regras puras das chaves da API /api/v1 (sem Node, sem React): usadas pelo servidor
 * (api/_lib/apiV1/chavesAdminRotas.js) e pelo formulário da tela Administrativo > API.
 */

export const ESCOPOS_POR_TIPO = Object.freeze({
    rede: Object.freeze(['rede:ler']),
    pagamentos: Object.freeze(['pagamentos:ler', 'pagamentos:escrever']),
})
export const LIMITE_PADRAO = Object.freeze({ rede: 120, pagamentos: 60 })
export const LIMITE_MIN = 1
export const LIMITE_MAX = 10000
export const NOME_MAX = 80
const MAX_LISTA = 20

const erro = (codigo, mensagem) => ({ ok: false, erro: { codigo, mensagem } })

export function tipoDosEscopos(escopos) {
    if (!Array.isArray(escopos) || escopos.length === 0) return null
    for (const tipo of Object.keys(ESCOPOS_POR_TIPO)) {
        if (escopos.every((e) => ESCOPOS_POR_TIPO[tipo].includes(e))) return tipo
    }
    return null
}

/** `https://host[:porta]` (http só para localhost), sem caminho, sem curinga. Devolve a origem normalizada ou null. */
export function normalizarOrigem(texto) {
    if (typeof texto !== 'string') return null
    const m = /^(https?):\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:(\d{1,5}))?$/i.exec(texto.trim())
    if (!m) return null
    const esquema = m[1].toLowerCase()
    const host = m[2].toLowerCase()
    if (esquema === 'http' && host !== 'localhost' && host !== '127.0.0.1') return null
    if (m[7] !== undefined && (Number(m[7]) < 1 || Number(m[7]) > 65535)) return null
    return `${esquema}://${host}${m[7] !== undefined ? `:${Number(m[7])}` : ''}`
}

function ipValido(ip) {
    if (typeof ip !== 'string') return false
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
    if (v4) return v4.slice(1).every((p) => Number(p) <= 255)
    return /^[0-9a-f:.]+$/i.test(ip) && (ip.match(/:/g) || []).length >= 2 && ip.length <= 45
}

function lerNome(valor) {
    const nome = typeof valor === 'string' ? valor.trim() : ''
    if (!nome || nome.length > NOME_MAX) return erro('nome_invalido', `Informe o nome (até ${NOME_MAX} caracteres).`)
    return { ok: true, valor: nome }
}

function lerLimite(valor) {
    if (!Number.isInteger(valor) || valor < LIMITE_MIN || valor > LIMITE_MAX) {
        return erro('limite_invalido', `O limite por minuto deve ser um inteiro de ${LIMITE_MIN} a ${LIMITE_MAX}.`)
    }
    return { ok: true, valor }
}

function lerExpiracao(valor, agora) {
    if (valor === null) return { ok: true, valor: null }
    const t = typeof valor === 'string' ? Date.parse(valor) : NaN
    if (!Number.isFinite(t)) return erro('expiracao_invalida', 'Data de expiração inválida.')
    if (t <= new Date(agora).getTime()) return erro('expiracao_invalida', 'A expiração deve estar no futuro.')
    return { ok: true, valor: new Date(t).toISOString() }
}

function lerIps(valor) {
    if (!Array.isArray(valor) || valor.length > MAX_LISTA) return erro('ips_invalidos', 'Lista de IPs inválida.')
    const ips = valor.map((i) => (typeof i === 'string' ? i.trim() : i))
    if (!ips.every(ipValido)) return erro('ips_invalidos', 'Há um IP inválido na lista.')
    return { ok: true, valor: [...new Set(ips)] }
}

function lerOrigens(valor, tipo) {
    if (!Array.isArray(valor) || valor.length > MAX_LISTA) return erro('origens_invalidas', 'Lista de origens inválida.')
    if (tipo === 'pagamentos') {
        if (valor.length) return erro('origens_nao_permitidas', 'Chave de pagamentos é de servidor: não pode ter origens permitidas.')
        return { ok: true, valor: [] }
    }
    if (valor.length === 0) return erro('origens_obrigatorias', 'Chave da rede exige ao menos uma origem permitida.')
    const origens = valor.map(normalizarOrigem)
    if (origens.some((o) => o === null)) {
        return erro('origens_invalidas', 'Origem inválida. Use https://dominio[:porta], sem caminho nem curinga.')
    }
    return { ok: true, valor: [...new Set(origens)] }
}

function lerEscopos(valor, tipo) {
    if (!Array.isArray(valor) || valor.length === 0) return erro('escopos_invalidos', 'Informe ao menos um escopo.')
    if (!valor.every((e) => ESCOPOS_POR_TIPO[tipo].includes(e))) {
        return erro('escopos_invalidos', 'Escopos inválidos para este tipo de chave.')
    }
    return { ok: true, valor: [...new Set(valor)] }
}

export function validarNovaChave(dados, { agora = new Date() } = {}) {
    const d = dados && typeof dados === 'object' ? dados : {}
    const nome = lerNome(d.nome)
    if (!nome.ok) return nome

    let tipo = d.tipo
    if (tipo === undefined || tipo === null || tipo === '') {
        tipo = d.escopos === undefined ? null : tipoDosEscopos(d.escopos)
        if (!tipo) return erro('tipo_invalido', 'Informe o tipo da chave (rede ou pagamentos).')
    } else if (!ESCOPOS_POR_TIPO[tipo]) {
        return erro('tipo_invalido', 'Tipo de chave inválido. Use rede ou pagamentos.')
    }

    const escopos = lerEscopos(d.escopos === undefined ? [ESCOPOS_POR_TIPO[tipo][0]] : d.escopos, tipo)
    if (!escopos.ok) return escopos
    const origens = lerOrigens(d.origens_permitidas === undefined ? [] : d.origens_permitidas, tipo)
    if (!origens.ok) return origens
    const limite = lerLimite(d.limite_por_minuto === undefined ? LIMITE_PADRAO[tipo] : d.limite_por_minuto)
    if (!limite.ok) return limite
    const ips = lerIps(d.ips_permitidos === undefined ? [] : d.ips_permitidos)
    if (!ips.ok) return ips
    const expira = lerExpiracao(d.expira_em === undefined ? null : d.expira_em, agora)
    if (!expira.ok) return expira

    return {
        ok: true,
        dados: {
            nome: nome.valor,
            tipo,
            escopos: escopos.valor,
            origens_permitidas: origens.valor,
            limite_por_minuto: limite.valor,
            ips_permitidos: ips.valor,
            expira_em: expira.valor,
        },
    }
}

/** Edição parcial. `existente` é a linha atual; o tipo (rede/pagamentos) não muda. */
export function validarEdicaoChave(dados, existente, { agora = new Date() } = {}) {
    const d = dados && typeof dados === 'object' ? dados : {}
    const tipo = tipoDosEscopos(existente?.escopos) || 'rede'
    const alteracoes = {}
    if (d.nome !== undefined) {
        const r = lerNome(d.nome)
        if (!r.ok) return r
        alteracoes.nome = r.valor
    }
    if (d.escopos !== undefined) {
        const r = lerEscopos(d.escopos, tipo)
        if (!r.ok) return r
        alteracoes.escopos = r.valor
    }
    if (d.origens_permitidas !== undefined) {
        const r = lerOrigens(d.origens_permitidas, tipo)
        if (!r.ok) return r
        alteracoes.origens_permitidas = r.valor
    }
    if (d.limite_por_minuto !== undefined) {
        const r = lerLimite(d.limite_por_minuto)
        if (!r.ok) return r
        alteracoes.limite_por_minuto = r.valor
    }
    if (d.ips_permitidos !== undefined) {
        const r = lerIps(d.ips_permitidos)
        if (!r.ok) return r
        alteracoes.ips_permitidos = r.valor
    }
    if (d.expira_em !== undefined) {
        const r = lerExpiracao(d.expira_em, agora)
        if (!r.ok) return r
        alteracoes.expira_em = r.valor
    }
    if (Object.keys(alteracoes).length === 0) return erro('nada_a_alterar', 'Nenhuma alteração informada.')
    return { ok: true, alteracoes }
}

export function estadoDaChave(linha, agora = new Date()) {
    if (linha?.revogada_em) return 'revogada'
    if (linha?.expira_em && new Date(linha.expira_em).getTime() <= new Date(agora).getTime()) return 'expirada'
    return 'ativa'
}
