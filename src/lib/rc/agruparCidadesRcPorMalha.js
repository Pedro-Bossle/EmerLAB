import {
    carregarVinculosMunicipios,
    normalizarMunicipioChave,
} from '../cidadesSupertabelaVinculos.js'
import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { supabase } from '../supabase.js'

const REGIAO_SEM_MALHA = 'Sem região na malha'

/**
 * Carrega a malha da Super-Tabela (cidades-mestre + municípios vinculados).
 * @returns {Promise<{ cidadesTabela: Array<{id:number,nome:string,uf:string}>, vinculos: Array }>}
 */
export async function carregarMalhaRc(client = supabase) {
    const [{ data: cidadesTabela, error: errCidades }, vinculos] = await Promise.all([
        client.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
        carregarVinculosMunicipios(client),
    ])
    if (errCidades) throw new Error(errCidades.message)
    return {
        cidadesTabela: cidadesTabela || [],
        vinculos: vinculos || [],
    }
}

/**
 * Resolve a região (cidade-tabela) e UF de um município pelo nome, com UF opcional.
 * @param {string} nomeMunicipio
 * @param {string} [ufHint]
 * @param {Array} cidadesTabela
 * @param {Array} vinculos
 */
export function resolverRegiaoMalhaPorMunicipio(nomeMunicipio, ufHint, cidadesTabela, vinculos) {
    const chave = normalizarMunicipioChave(nomeMunicipio)
    if (!chave) {
        return { cidadeId: null, regiaoNome: REGIAO_SEM_MALHA, uf: '' }
    }

    const ufNorm = String(ufHint || '').trim().toUpperCase()
    const mapaCidade = new Map((cidadesTabela || []).map((c) => [Number(c.id), c]))

    const vinculosChave = (vinculos || []).filter(
        (v) => normalizarMunicipioChave(v.municipio_nome) === chave,
    )
    const vinculosUf = ufNorm
        ? vinculosChave.filter((v) => String(v.uf || '').trim().toUpperCase() === ufNorm)
        : vinculosChave

    const escolherPorVinculos = (lista) => {
        if (!lista.length) return null
        const ids = [...new Set(lista.map((v) => Number(v.cidade_id)).filter(Boolean))]
        if (!ids.length) return null
        const cidadeId = ids[0]
        const cidade = mapaCidade.get(cidadeId)
        const uf =
            String(lista[0]?.uf || '').trim().toUpperCase() ||
            String(cidade?.uf || '').trim().toUpperCase() ||
            ufNorm
        return {
            cidadeId,
            regiaoNome: String(cidade?.nome || '').trim() || REGIAO_SEM_MALHA,
            uf,
        }
    }

    const viaVinculo = escolherPorVinculos(vinculosUf) || (!ufNorm ? escolherPorVinculos(vinculosChave) : null)
    if (viaVinculo) return viaVinculo

    const cidadesNome = (cidadesTabela || []).filter(
        (c) => normalizarMunicipioChave(c.nome) === chave,
    )
    const cidadeHit = ufNorm
        ? cidadesNome.find((c) => String(c.uf || '').trim().toUpperCase() === ufNorm) || cidadesNome[0]
        : cidadesNome[0]
    if (cidadeHit) {
        return {
            cidadeId: Number(cidadeHit.id),
            regiaoNome: String(cidadeHit.nome || '').trim() || REGIAO_SEM_MALHA,
            uf: String(cidadeHit.uf || '').trim().toUpperCase() || ufNorm,
        }
    }

    return {
        cidadeId: null,
        regiaoNome: REGIAO_SEM_MALHA,
        uf: ufNorm,
    }
}

/**
 * @param {string[]} nomesCidades — municípios com credenciados (nomes usados na RC)
 * @param {Map<string, string>} [ufPorNomeCidade] — UF sugerida por nome de município
 * @param {Array} cidadesTabela
 * @param {Array} vinculos
 * @param {{ uf?: string, termo?: string }} [filtros]
 * @returns {Array<{ regiaoKey: string, regiaoNome: string, uf: string, cidadeId: number|null, cidades: string[] }>}
 */
export function agruparCidadesRcPorMalha(
    nomesCidades,
    ufPorNomeCidade,
    cidadesTabela,
    vinculos,
    filtros = {},
) {
    const ufFiltro = String(filtros.uf || '').trim().toUpperCase()
    const termo = normalizarTextoBusca(filtros.termo)

    /** @type {Map<string, { regiaoKey: string, regiaoNome: string, uf: string, cidadeId: number|null, cidades: Set<string> }>} */
    const grupos = new Map()

    for (const nomeRaw of nomesCidades || []) {
        const nome = String(nomeRaw || '').trim()
        if (!nome) continue
        const ufHint = ufPorNomeCidade?.get?.(normalizarMunicipioChave(nome)) || ''
        const regiao = resolverRegiaoMalhaPorMunicipio(nome, ufHint, cidadesTabela, vinculos)

        if (ufFiltro && String(regiao.uf || '').trim().toUpperCase() !== ufFiltro) continue

        if (termo) {
            const hitCidade = normalizarTextoBusca(nome).includes(termo)
            const hitRegiao = normalizarTextoBusca(regiao.regiaoNome).includes(termo)
            const hitUf = normalizarTextoBusca(regiao.uf).includes(termo)
            if (!hitCidade && !hitRegiao && !hitUf) continue
        }

        const regiaoKey = regiao.cidadeId
            ? `r-${regiao.cidadeId}`
            : `sem-${regiao.uf || 'xx'}`
        if (!grupos.has(regiaoKey)) {
            grupos.set(regiaoKey, {
                regiaoKey,
                regiaoNome: regiao.regiaoNome,
                uf: regiao.uf || '',
                cidadeId: regiao.cidadeId,
                cidades: new Set(),
            })
        }
        grupos.get(regiaoKey).cidades.add(nome)
    }

    return [...grupos.values()]
        .map((g) => ({
            regiaoKey: g.regiaoKey,
            regiaoNome: g.regiaoNome,
            uf: g.uf,
            cidadeId: g.cidadeId,
            cidades: [...g.cidades].sort((a, b) =>
                a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
            ),
        }))
        .sort((a, b) => {
            const semA = a.cidadeId == null
            const semB = b.cidadeId == null
            if (semA !== semB) return semA ? 1 : -1
            const ufCmp = String(a.uf || '').localeCompare(String(b.uf || ''), 'pt-BR')
            if (ufCmp) return ufCmp
            return a.regiaoNome.localeCompare(b.regiaoNome, 'pt-BR', { sensitivity: 'base' })
        })
}

/** UFs presentes nas regiões/cidades da lista RC (antes do filtro de UF). */
export function listarUfsRcDisponiveis(nomesCidades, ufPorNomeCidade, cidadesTabela, vinculos) {
    const ufs = new Set()
    for (const nomeRaw of nomesCidades || []) {
        const nome = String(nomeRaw || '').trim()
        if (!nome) continue
        const ufHint = ufPorNomeCidade?.get?.(normalizarMunicipioChave(nome)) || ''
        const regiao = resolverRegiaoMalhaPorMunicipio(nome, ufHint, cidadesTabela, vinculos)
        const uf = String(regiao.uf || '').trim().toUpperCase()
        if (uf) ufs.add(uf)
    }
    return [...ufs].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export { REGIAO_SEM_MALHA }
