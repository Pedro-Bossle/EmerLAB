import { prestadorEhEstabelecimento } from './prestadorCadastroHelpers.js'

/**
 * Mapa veterinario_id → prestador do estabelecimento (vínculo principal tem prioridade).
 */
export function montarEstabelecimentoPrincipalPorVeterinario(prestadorEstabelecimentos, prestadorPorId) {
    const porVet = new Map()
    for (const rel of prestadorEstabelecimentos || []) {
        const vid = Number(rel.veterinario_id)
        const eid = Number(rel.estabelecimento_id)
        if (!vid || !eid) continue
        const est = prestadorPorId.get(eid)
        if (!est) continue
        if (rel.principal) {
            porVet.set(vid, est)
            continue
        }
        if (!porVet.has(vid)) porVet.set(vid, est)
    }
    return porVet
}

export function montarEstabelecimentoPorVeterinarioDeListas(prestadores, prestadorEstabelecimentos) {
    const prestadorPorId = new Map((prestadores || []).map((p) => [Number(p.id), p]))
    return montarEstabelecimentoPrincipalPorVeterinario(prestadorEstabelecimentos, prestadorPorId)
}

/**
 * Veterinário vinculado a clínica/equipe herda cidade, UF e cidade_id do estabelecimento.
 * Cidades paralelas (`prestador_cidades`) usam o id do estabelecimento.
 */
export function resolverLocalidadeEfetivaPrestador(prestador, estabelecimentoPorVeterinario) {
    const p = prestador || {}
    const id = Number(p.id)
    if (!id || prestadorEhEstabelecimento(p.especialidade_id)) {
        return { prestador: p, prestadorIdCidades: id }
    }
    const est = estabelecimentoPorVeterinario?.get(id)
    if (!est) {
        return { prestador: p, prestadorIdCidades: id }
    }
    return {
        prestador: {
            ...p,
            endereco_cidade: est.endereco_cidade ?? p.endereco_cidade,
            endereco_uf: est.endereco_uf ?? p.endereco_uf,
            cidade_id: est.cidade_id ?? p.cidade_id,
        },
        prestadorIdCidades: Number(est.id),
    }
}

export function anexarLocalidadeVinculoAoCtx(ctx, prestadores, prestadorEstabelecimentos) {
    const estabelecimentoPorVeterinario = montarEstabelecimentoPorVeterinarioDeListas(
        prestadores,
        prestadorEstabelecimentos,
    )
    return { ...ctx, estabelecimentoPorVeterinario }
}
