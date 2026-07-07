/**
 * Limites de grupo por categoria e plano (substituem limite individual na UI de planos_config).
 */

export const TABELA_CATEGORIA_LIMITES_GRUPO = 'categoria_limites_grupo'

/** Procedimento que sempre usa limite individual em planos_config (mesmo com limite de grupo na categoria). */
export const PROCEDIMENTO_ID_EXCECAO_LIMITE_INDIVIDUAL = 23

export const procedimentoIsentoLimiteGrupo = (linha) =>
    Number(linha?.procedimentoId ?? linha?.procedimento_id) === PROCEDIMENTO_ID_EXCECAO_LIMITE_INDIVIDUAL

export const montarMapaLimiteGrupoPorCategoria = (rows, planoId) => {
    const planoNum = Number(planoId)
    const mapa = new Map()
    ;(rows || []).forEach((row) => {
        if (Number(row.plano_id) !== planoNum) return
        const catId = Number(row.categoria_id)
        if (!catId) return
        mapa.set(catId, row.limite != null ? String(row.limite) : '')
    })
    return mapa
}

export const montarLimitesGrupoPorCategoriaEChavePlano = (rows, mapaPlanosPorChave) => {
    const porCategoria = new Map()
    ;(rows || []).forEach((row) => {
        const catId = Number(row.categoria_id)
        if (!catId) return
        const chavePlano = Object.entries(mapaPlanosPorChave || {}).find(
            ([, meta]) => meta && Number(meta.id) === Number(row.plano_id)
        )?.[0]
        if (!chavePlano) return
        if (!porCategoria.has(catId)) {
            porCategoria.set(catId, { basico: '', classico: '', avancado: '', ultra: '' })
        }
        const bucket = porCategoria.get(catId)
        bucket[chavePlano] = row.limite != null ? String(row.limite) : ''
    })
    return porCategoria
}

export const obterLimiteGrupoAtivo = (mapaPorCategoriaId, categoriaId) => {
    const bruto = mapaPorCategoriaId.get(Number(categoriaId))
    const texto = String(bruto ?? '').trim()
    return texto || null
}

export const categoriaUsaLimiteGrupo = (categorias, categoriaId) => {
    const cat = (categorias || []).find((item) => Number(item.id) === Number(categoriaId))
    return Boolean(cat?.usa_limite_grupo)
}

/**
 * Planos (chaves) em que a categoria pode ter limite de grupo: união da hierarquia
 * a partir do plano base de cada procedimento da categoria.
 */
export const montarPlanosChaveDisponiveisPorCategoria = (
    itens,
    mapaPlanosPorChave,
    ordemPlanos,
    resolverChavePlanoBase
) => {
    const mapa = new Map()
    ;(itens || []).forEach((item) => {
        const catId = Number(item.categoriaId ?? item.categoria_id)
        if (!catId) return

        let chaveBase = item.planoBaseChave
        if (!chaveBase && resolverChavePlanoBase) {
            chaveBase = resolverChavePlanoBase(item.plano_base_id ?? item.planoBaseId, mapaPlanosPorChave)
        }
        if (!chaveBase) return

        const indiceBase = ordemPlanos.indexOf(chaveBase)
        if (indiceBase < 0) return

        if (!mapa.has(catId)) mapa.set(catId, new Set())
        const chaves = mapa.get(catId)
        ordemPlanos.slice(indiceBase).forEach((chave) => {
            if (mapaPlanosPorChave[chave]?.id) chaves.add(chave)
        })
    })
    return mapa
}

export const categoriaPermiteLimiteGrupoNaChavePlano = (
    planosChaveDisponiveisPorCategoria,
    categoriaId,
    chavePlano,
    mapaPlanosPorChave
) => {
    const chaves = planosChaveDisponiveisPorCategoria?.get(Number(categoriaId))
    return Boolean(chaves?.has(chavePlano) && mapaPlanosPorChave?.[chavePlano]?.id)
}

export const resolverLimiteGrupoExibicao = (categorias, mapaPorCategoriaId, categoriaId, contexto = {}) => {
    if (!categoriaUsaLimiteGrupo(categorias, categoriaId)) return null

    const { planosChaveDisponiveisPorCategoria, chavePlano, mapaPlanosPorChave } = contexto
    if (
        chavePlano &&
        planosChaveDisponiveisPorCategoria &&
        !categoriaPermiteLimiteGrupoNaChavePlano(
            planosChaveDisponiveisPorCategoria,
            categoriaId,
            chavePlano,
            mapaPlanosPorChave
        )
    ) {
        return null
    }

    return obterLimiteGrupoAtivo(mapaPorCategoriaId, categoriaId)
}

export const textoCelulaLimiteGrupo = (limite, categoriaNome) =>
    `Limite ${limite} no grupo de ${categoriaNome}`

export const buscarCategoriaLimitesGrupo = async (supabase, opcoes = {}) => {
    let consulta = supabase
        .from(TABELA_CATEGORIA_LIMITES_GRUPO)
        .select('id, categoria_id, plano_id, limite')

    if (opcoes.planoId != null && opcoes.planoId !== '') {
        consulta = consulta.eq('plano_id', Number(opcoes.planoId))
    }

    const { data, error } = await consulta
    return { data: data || [], error }
}

export const salvarLimiteGrupoCategoria = async (supabase, { categoriaId, planoId, limite }) => {
    const catNum = Number(categoriaId)
    const planoNum = Number(planoId)
    const valor = String(limite ?? '').trim()

    if (!catNum || !planoNum) {
        return { error: new Error('Categoria ou plano inválido.') }
    }

    if (!valor) {
        const { error } = await supabase
            .from(TABELA_CATEGORIA_LIMITES_GRUPO)
            .delete()
            .eq('categoria_id', catNum)
            .eq('plano_id', planoNum)
        return { error }
    }

    const { error } = await supabase.from(TABELA_CATEGORIA_LIMITES_GRUPO).upsert(
        {
            categoria_id: catNum,
            plano_id: planoNum,
            limite: valor,
        },
        { onConflict: 'categoria_id,plano_id' }
    )

    return { error }
}

export const isMissingCategoriaLimitesGrupoTable = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return (
        msg.includes('categoria_limites_grupo') &&
        (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('relation'))
    )
}
