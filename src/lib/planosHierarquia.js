/**
 * Hierarquia de planos (mesma ordem usada na Super-Tabela).
 * IDs reais vêm de `mapearPlanos(listaDaTabelaPlanos)`.
 */

export const ORDEM_PLANOS = ['basico', 'classico', 'avancado', 'ultra']

export const ROTULO_PLANO = {
    basico: 'Básico',
    classico: 'Clássico',
    avancado: 'Avançado',
    ultra: 'Ultra',
}

export const normalizarNomePlano = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

/**
 * Mesma ideia que Supertabela Planos (`mapearPlanosPorChave`):
 * 1) tenta nome canônico exato (ex.: "Básico" → BASICO) para não trocar IDs entre planos;
 * 2) cai no match por substring como antes.
 */
export const mapearPlanos = (planos) => {
    const resultado = { basico: null, classico: null, avancado: null, ultra: null }
    const usados = new Set()
    const lista = planos || []

    const buscar = (chave, matcherIncludes) => {
        const alvoExato = normalizarNomePlano(ROTULO_PLANO[chave])

        let encontrado = lista.find((plano) => {
            if (usados.has(plano.id)) return false
            return normalizarNomePlano(plano.nome) === alvoExato
        })

        if (!encontrado) {
            encontrado = lista.find((plano) => {
                if (usados.has(plano.id)) return false
                return matcherIncludes(normalizarNomePlano(plano.nome))
            })
        }

        if (encontrado) {
            usados.add(encontrado.id)
            resultado[chave] = { id: Number(encontrado.id), nome: encontrado.nome }
        }
    }

    buscar('basico', (nome) => nome.includes('BASICO') || nome.includes('BASIC'))
    buscar('classico', (nome) => nome.includes('CLASSICO'))
    buscar('avancado', (nome) => nome.includes('AVANCADO'))
    buscar('ultra', (nome) => nome.includes('ULTRA'))

    return resultado
}

export const obterChavePlanoPorId = (planoId, mapaPlanosLocal) => {
    const idNumerico = Number(planoId)
    if (!idNumerico) return null
    return ORDEM_PLANOS.find((chave) => Number(mapaPlanosLocal[chave]?.id) === idNumerico) || null
}

/** Planos em que um procedimento (plano_base_id) pode aparecer — do nível base até o topo. */
export const obterPlanoIdsPermitidosDesdeBase = (planoBaseId, mapaPlanosLocal) => {
    const chaveBase = obterChavePlanoPorId(planoBaseId, mapaPlanosLocal) || 'basico'
    const indiceBase = ORDEM_PLANOS.indexOf(chaveBase)
    return ORDEM_PLANOS.slice(indiceBase < 0 ? 0 : indiceBase)
        .map((chave) => mapaPlanosLocal[chave]?.id)
        .filter(Boolean)
        .map((id) => Number(id))
}

export const procedimentoPertenceAoPlanoSelecionado = (planoBaseId, planoSelecionadoId, mapaPlanosLocal) => {
    const alvo = Number(planoSelecionadoId)
    if (!alvo) return false
    return obterPlanoIdsPermitidosDesdeBase(planoBaseId, mapaPlanosLocal).includes(alvo)
}

/**
 * Planos do nível do comprador até o topo da hierarquia (inclusive),
 * na ordem em que devem ser consultados em `planos_cidade`.
 * Sempre inclui o plano selecionado em 1º (mesmo que não caia em Básico/Clássico/Avançado/Ultra no mapa).
 */
export const listarPlanoIdsDoSelecionadoParaCima = (planoAlvoId, mapaPlanosLocal) => {
    const idNumerico = Number(planoAlvoId)
    if (!idNumerico) {
        return ORDEM_PLANOS.map((chave) => mapaPlanosLocal[chave]?.id).filter(Boolean).map(Number)
    }

    const chaveAlvo = obterChavePlanoPorId(idNumerico, mapaPlanosLocal)
    const indice = chaveAlvo ? ORDEM_PLANOS.indexOf(chaveAlvo) : 0
    const inicio = indice >= 0 ? indice : 0

    const porHierarquia = ORDEM_PLANOS.slice(inicio)
        .map((chave) => mapaPlanosLocal[chave]?.id)
        .filter(Boolean)
        .map(Number)

    const ordem = [idNumerico, ...porHierarquia.filter((id) => id !== idNumerico)]
    return [...new Set(ordem)]
}

export const nomePlanoPorId = (planoId, planosLista, mapaPlanosLocal) => {
    const idn = Number(planoId)
    const direto = (planosLista || []).find((p) => Number(p.id) === idn)
    if (direto?.nome) return direto.nome
    const chave = obterChavePlanoPorId(idn, mapaPlanosLocal)
    return chave ? ROTULO_PLANO[chave] || `Plano ${idn}` : `Plano ${idn}`
}
