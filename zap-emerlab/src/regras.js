// Regras das respostas rápidas: texto no formato `chave {valor, valor}` que decide quais respostas
// aparecem primeiro para o contato aberto. Usado no navegador (cadastro e ordenação) e no servidor (validação).
//
//   locais {RS+Porto Alegre, RS+Canoas, SC}     UF, ou UF+cidade
//   departamentos {Comercial, Credenciamento}   departamento da conversa no painel
//   clientes {sim}                              atalho para o atributo tipo = cliente ("não" = qualquer outro)
//   services {CONS-001, US-010}                 não filtra: só diz de quais procedimentos o {services.content} do
//                                               texto lista quem realiza (busca do Credenciamento > Quem realiza)
//   situacao {ativo, credenciada}               qualquer outro nome = atributo do contato na WATI
//
// Valores da mesma chave: basta um (OU). Chaves diferentes: todas precisam bater (E).
// "!" na frente exclui: locais {RS, !RS+Porto Alegre} = RS inteiro menos Porto Alegre.
// Maiúsculas, acentos e espaços extras não importam.

import { UFS_BRASIL, normalizarTextoBusca } from './util.js'

const norm = (t) => normalizarTextoBusca(t)

// apelidos aceitos para as chaves especiais
const CHAVES = {
    local: 'locais',
    locais: 'locais',
    uf: 'locais',
    cidade: 'locais',
    cidades: 'locais',
    departamento: 'departamentos',
    departamentos: 'departamentos',
    depto: 'departamentos',
    cliente: 'clientes',
    clientes: 'clientes',
    services: 'servicos',
    service: 'servicos',
    servicos: 'servicos',
    servico: 'servicos',
}
const SIM = ['sim', 's', 'yes', 'true']
const NAO = ['nao', 'n', 'no', 'false']

// códigos de procedimento comparados como no projeto principal (sem espaços nas pontas, maiúsculos)
export const normCodigo = (c) => String(c || '').trim().toUpperCase()

// Códigos usados em regras services {…}, sem repetir; soIncluidos deixa de fora os {!código}
export function codigosServicos(texto, { soIncluidos = false } = {}) {
    const codigos = new Set()
    for (const r of lerRegras(texto).regras) {
        if (r.chave !== 'servicos') continue
        for (const c of soIncluidos ? r.incluir : [...r.incluir, ...r.excluir]) codigos.add(normCodigo(c))
    }
    return [...codigos]
}

// {services.content} no texto da resposta: um prestador por linha, dos que realizam os códigos da regra
// services {…} daquela resposta na cidade do contato
export const MARCA_SERVICOS = '{services.content}'
const RE_MARCA_SERVICOS = /\{\s*services\.content\s*\}/gi
export const temMarcaServicos = (texto) => new RegExp(RE_MARCA_SERVICOS.source, 'i').test(String(texto || ''))

/**
 * Nomes de quem realiza, na ordem do Quem realiza: quem faz mais dos procedimentos primeiro, depois A–Z.
 * @param {string[]} codigos
 * @param {Array<{ nome: string, codigos: string[] }>} prestadores da cidade do contato
 */
export function listaQuemRealiza(codigos, prestadores) {
    const pedidos = new Set(codigos.map(normCodigo))
    return (prestadores || [])
        .map((p) => ({ nome: String(p.nome || '').trim(), n: p.codigos.filter((c) => pedidos.has(c)).length }))
        .filter((p) => p.nome && p.n)
        .sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
        .map((p) => p.nome)
        .join('\n')
}

// texto com {services.content} precisa de services {código} nas regras (senão não há o que listar)
export function erroMarcaServicos(texto, regras) {
    if (!temMarcaServicos(texto) || codigosServicos(regras, { soIncluidos: true }).length) return null
    return `O texto usa ${MARCA_SERVICOS}: inclua nas regras services {código} com os procedimentos a listar.`
}

export function preencherServicos(texto, codigos, prestadores) {
    return String(texto).replace(RE_MARCA_SERVICOS, () => listaQuemRealiza(codigos, prestadores))
}

/**
 * Lê o texto das regras. `procedimentos` (Map código → nome) confere os códigos de services {…};
 * sem ele, os códigos não são conferidos.
 * @returns {{ regras: Array<{ chave: string, nome: string, incluir: string[], excluir: string[] }>, erros: string[] }}
 */
export function lerRegras(texto, { departamentos, procedimentos } = {}) {
    const fonte = String(texto || '').trim()
    const regras = []
    const erros = []
    if (!fonte) return { regras, erros }

    const re = /([^\s{}]+)\s*\{([^{}]*)\}/g
    let fim = 0
    let m
    while ((m = re.exec(fonte))) {
        const sobra = fonte.slice(fim, m.index).trim()
        if (sobra) erros.push(`Não entendi "${sobra}". Use o formato chave {valor, valor}.`)
        fim = re.lastIndex
        const nome = m[1]
        const chave = CHAVES[norm(nome)] || `atributo:${norm(nome).replace(/ /g, '_')}`
        const valores = m[2].split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)
        if (!valores.length) {
            erros.push(`"${nome}" está sem valores entre as chaves.`)
            continue
        }
        const incluir = []
        const excluir = []
        for (const bruto of valores) {
            const negado = bruto.startsWith('!')
            const valor = negado ? bruto.slice(1).trim() : bruto
            const erro = validarValor(chave, valor, departamentos, procedimentos)
            if (erro) erros.push(erro)
            else (negado ? excluir : incluir).push(valor)
        }
        if (chave === 'clientes' && excluir.length) erros.push('Em clientes use só {sim} ou {não}.')
        if (chave === 'servicos' && excluir.length) erros.push('Em services não use "!": liste só os códigos dos procedimentos.')
        regras.push({ chave, nome, incluir, excluir })
    }
    const resto = fonte.slice(fim).trim()
    if (resto) erros.push(`Não entendi "${resto}". Confira se as chaves { } estão fechadas.`)
    return { regras, erros }
}

function validarValor(chave, valor, departamentos, procedimentos) {
    if (!valor) return 'Há um "!" sem valor depois.'
    if (chave === 'locais') {
        const [uf, ...cidade] = valor.split('+')
        const sigla = uf.trim().toUpperCase()
        // aceita só a cidade (sem UF) também
        if (cidade.length && !UFS_BRASIL.includes(sigla)) return `"${uf.trim()}" não é uma UF válida (em "${valor}").`
        if (cidade.length && !cidade.join('+').trim()) return `Falta a cidade depois do + em "${valor}".`
        return null
    }
    if (chave === 'departamentos' && departamentos) {
        if (!departamentos.some((d) => norm(d.nome) === norm(valor))) return `Departamento "${valor}" não existe no painel.`
        return null
    }
    if (chave === 'servicos') {
        if (procedimentos && !procedimentos.has(normCodigo(valor))) return `Procedimento "${valor}" não existe no cadastro de procedimentos.`
        return null
    }
    if (chave === 'clientes' && ![...SIM, ...NAO].includes(norm(valor))) return `Em clientes use {sim} ou {não} (veio "${valor}").`
    return null
}

// Um valor de "locais" bate com o contato? "RS" = a UF inteira; "RS+Canoas" = só a cidade; "Canoas" = cidade em qualquer UF
function localBate(valor, ctx) {
    const partes = valor.split('+')
    const uf = ctx.uf ? ctx.uf.toUpperCase() : ''
    const cidade = norm(ctx.cidade)
    if (partes.length > 1) return partes[0].trim().toUpperCase() === uf && norm(partes.slice(1).join('+')) === cidade
    const v = valor.trim()
    if (v.length === 2 && UFS_BRASIL.includes(v.toUpperCase())) return v.toUpperCase() === uf
    return norm(v) === cidade
}

function valorBate(regra, valor, ctx) {
    if (regra.chave === 'locais') return localBate(valor, ctx)
    if (regra.chave === 'departamentos') return Boolean(ctx.departamento) && norm(valor) === norm(ctx.departamento)
    if (regra.chave === 'clientes') {
        const ehCliente = norm(ctx.atributos?.tipo) === 'cliente'
        return SIM.includes(norm(valor)) ? ehCliente : !ehCliente
    }
    const atributo = regra.chave.slice('atributo:'.length)
    return norm(ctx.atributos?.[atributo]) === norm(valor)
}

function regraBate(regra, ctx) {
    if (regra.excluir.some((v) => valorBate(regra, v, ctx))) return false
    // só exclusões ("tudo menos…"): passa quem não foi excluído
    if (!regra.incluir.length) return true
    return regra.incluir.some((v) => valorBate(regra, v, ctx))
}

// services {…} não é condição: só alimenta o {services.content}
const filtraContato = (r) => r.chave !== 'servicos'

/**
 * Situação de uma resposta para o contato: 'bate' (tem regras e todas batem), 'livre' (sem regras) ou 'fora'.
 * @param {{ uf?: string, cidade?: string, departamento?: string, atributos?: Record<string, string> }} ctx
 */
export function avaliarRegras(texto, ctx) {
    const regras = lerRegras(texto).regras.filter(filtraContato)
    if (!regras.length) return 'livre'
    return regras.every((r) => regraBate(r, ctx)) ? 'bate' : 'fora'
}

// Resumo em português para o cadastro ("Aparece primeiro para: …")
export function resumirRegras(regras) {
    return regras
        .filter(filtraContato)
        .map((r) => {
            const rotulo = { locais: 'locais', departamentos: 'departamento', clientes: 'clientes' }[r.chave] || r.nome
            const partes = []
            if (r.incluir.length) partes.push(r.incluir.join(' ou '))
            if (r.excluir.length) partes.push(`exceto ${r.excluir.join(', ')}`)
            if (!r.incluir.length) partes.unshift('todos')
            return `${rotulo}: ${partes.join(', ')}`
        })
        .join(' · e · ')
}
