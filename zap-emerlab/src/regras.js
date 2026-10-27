// Regras das respostas rápidas: texto no formato `chave {valor, valor}` que decide quais respostas
// aparecem primeiro para o contato aberto. Usado no navegador (cadastro e ordenação) e no servidor (validação).
//
//   locais {RS+Porto Alegre, RS+Canoas, SC}     UF, ou UF+cidade
//   departamentos {Comercial, Credenciamento}   departamento da conversa no painel
//   clientes {sim}                              atalho para o atributo tipo = cliente ("não" = qualquer outro)
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
}
const SIM = ['sim', 's', 'yes', 'true']
const NAO = ['nao', 'n', 'no', 'false']

/**
 * Lê o texto das regras.
 * @returns {{ regras: Array<{ chave: string, nome: string, incluir: string[], excluir: string[] }>, erros: string[] }}
 */
export function lerRegras(texto, { departamentos } = {}) {
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
            const erro = validarValor(chave, valor, departamentos)
            if (erro) erros.push(erro)
            else (negado ? excluir : incluir).push(valor)
        }
        if (chave === 'clientes' && excluir.length) erros.push('Em clientes use só {sim} ou {não}.')
        regras.push({ chave, nome, incluir, excluir })
    }
    const resto = fonte.slice(fim).trim()
    if (resto) erros.push(`Não entendi "${resto}". Confira se as chaves { } estão fechadas.`)
    return { regras, erros }
}

function validarValor(chave, valor, departamentos) {
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

/**
 * Situação de uma resposta para o contato: 'bate' (tem regras e todas batem), 'livre' (sem regras) ou 'fora'.
 * @param {{ uf?: string, cidade?: string, departamento?: string, atributos?: Record<string, string> }} ctx
 */
export function avaliarRegras(texto, ctx) {
    const { regras } = lerRegras(texto)
    if (!regras.length) return 'livre'
    return regras.every((r) => regraBate(r, ctx)) ? 'bate' : 'fora'
}

// Resumo em português para o cadastro ("Aparece primeiro para: …")
export function resumirRegras(regras) {
    return regras
        .map((r) => {
            const rotulo = r.chave === 'locais' ? 'locais' : r.chave === 'departamentos' ? 'departamento' : r.chave === 'clientes' ? 'clientes' : r.nome
            const partes = []
            if (r.incluir.length) partes.push(r.incluir.join(' ou '))
            if (r.excluir.length) partes.push(`exceto ${r.excluir.join(', ')}`)
            if (!r.incluir.length) partes.unshift('todos')
            return `${rotulo}: ${partes.join(', ')}`
        })
        .join(' · e · ')
}
