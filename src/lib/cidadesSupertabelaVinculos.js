import { normalizarTextoBusca } from './prestadorCadastroHelpers.js'

export const normalizarMunicipioChave = (nome) => normalizarTextoBusca(nome)

export const isMissingVinculosTableError = (error) => {
    const msg = String(error?.message || '').toLowerCase()
    return (
        msg.includes('cidades_municipios_vinculo') &&
        (msg.includes('does not exist') || msg.includes('schema cache'))
    )
}

export async function carregarVinculosMunicipios(supabase) {
    const { data, error } = await supabase
        .from('cidades_municipios_vinculo')
        .select('id, cidade_id, uf, municipio_nome')
        .order('municipio_nome', { ascending: true })
    if (error) {
        if (isMissingVinculosTableError(error)) return []
        throw error
    }
    return data || []
}

export function mapaCidadeIdPorUfMunicipio(vinculos) {
    const mapa = new Map()
    ;(vinculos || []).forEach((v) => {
        const uf = String(v.uf || '').trim().toUpperCase()
        const chave = normalizarMunicipioChave(v.municipio_nome)
        if (uf && chave) mapa.set(`${uf}|${chave}`, Number(v.cidade_id))
    })
    return mapa
}

/** Nome da cidade para listagem (endereço do prestador, não a tabela-mestre). */
export function cidadeExibicaoNegociacaoPrestador(prestador, mapaCred) {
    if (!prestador) return null
    const endereco = String(prestador.endereco_cidade || '').trim()
    if (endereco) return endereco
    const cred = mapaCred?.get?.(Number(prestador.cidade_id))
    return cred ? String(cred).trim() : null
}

/**
 * Id da tabela de planos/repasses: vínculo IBGE → tabela-mestre; senão `cidades` por nome/UF.
 */
export function resolverCidadeIdTabelaNegociacao({
    prestador,
    veterinarioCidadeId,
    cidades,
    vinculos,
    mapaCred,
}) {
    if (prestador) {
        const mun = String(prestador.endereco_cidade || '').trim()
        const uf = prestador.endereco_uf
        if (mun) {
            const viaVinculo = resolverCidadeTabelaId({ uf, municipioNome: mun, vinculos, cidades })
            if (viaVinculo) return viaVinculo
        }
        const cred = mapaCred?.get?.(Number(prestador.cidade_id))
        if (cred) {
            const viaCred = resolverCidadeTabelaId({
                uf,
                municipioNome: cred,
                vinculos,
                cidades,
            })
            if (viaCred) return viaCred
        }
    }

    const cid = veterinarioCidadeId != null && veterinarioCidadeId !== '' ? Number(veterinarioCidadeId) : null
    const row = Number.isFinite(cid) ? (cidades || []).find((c) => Number(c.id) === cid) : null
    if (row) {
        const viaRow = resolverCidadeTabelaId({
            uf: row.uf,
            municipioNome: row.nome,
            vinculos,
            cidades,
        })
        if (viaRow) return viaRow
        return cid
    }

    return Number.isFinite(cid) ? cid : null
}

/** Resolve id da tabela-mestre; fallback legado por nome em `cidades`. */
export function resolverCidadeTabelaId({ uf, municipioNome, vinculos, cidades }) {
    const ufNorm = String(uf || '').trim().toUpperCase()
    const chave = normalizarMunicipioChave(municipioNome)
    if (ufNorm && chave) {
        const hit = mapaCidadeIdPorUfMunicipio(vinculos).get(`${ufNorm}|${chave}`)
        if (hit) return hit
    }
    const alvo = chave
    const legado = (cidades || []).find((c) => normalizarMunicipioChave(c.nome) === alvo)
    return legado ? Number(legado.id) : null
}

export function municipiosPorCidadeId(vinculos) {
    const mapa = new Map()
    ;(vinculos || []).forEach((v) => {
        const cid = Number(v.cidade_id)
        if (!cid) return
        if (!mapa.has(cid)) mapa.set(cid, [])
        mapa.get(cid).push(v)
    })
    return mapa
}

/** Uma opção por tabela (`cidades`), rótulo = nome da tabela. */
export function buildOpcoesFiltroSupertabela(cidades, _vinculos, cidadeIdsPermitidos = null) {
    const permitir =
        cidadeIdsPermitidos instanceof Set && cidadeIdsPermitidos.size > 0 ? cidadeIdsPermitidos : null
    return (cidades || [])
        .filter((c) => {
            if (!permitir) return true
            return permitir.has(Number(c.id))
        })
        .map((c) => {
            const nome = String(c.nome || '').trim() || '—'
            const uf = String(c.uf || '').trim().toUpperCase()
            const label = uf ? `${nome} (${uf})` : nome
            return {
                value: `c-${c.id}`,
                cidadeId: Number(c.id),
                uf,
                label,
                sort: nome,
            }
        })
        .sort((a, b) => a.sort.localeCompare(b.sort, 'pt-BR', { sensitivity: 'base' }))
}

/** Cidades da tabela-mestre com repasse (credenciamento na supertabela). */
export async function buscarCidadeIdsTabelaComRepasses(supabase, buscarTodosPaginado) {
    const fn = buscarTodosPaginado || ((q) => q())
    const { data, error } = await fn(() => supabase.from('repasses').select('cidade_id'))
    if (error) throw error
    const ids = new Set()
    ;(data || []).forEach((r) => {
        const id = Number(r.cidade_id)
        if (id) ids.add(id)
    })
    return ids
}

/** Cidades com vínculo em `planos_cidade` para o plano. */
export async function buscarCidadeIdsTabelaPorPlano(supabase, planoId, buscarTodosPaginado) {
    const pid = Number(planoId)
    if (!pid) return new Set()
    const fn = buscarTodosPaginado || ((q) => q())
    const { data, error } = await fn(() =>
        supabase.from('planos_cidade').select('cidade_id').eq('plano_id', pid),
    )
    if (error) throw error
    const ids = new Set()
    ;(data || []).forEach((r) => {
        const id = Number(r.cidade_id)
        if (id) ids.add(id)
    })
    return ids
}

export function filtrarCidadesTabelaPorIds(cidades, cidadeIdsPermitidos) {
    if (cidadeIdsPermitidos == null) return []
    const permitir =
        cidadeIdsPermitidos instanceof Set && cidadeIdsPermitidos.size > 0 ? cidadeIdsPermitidos : null
    return (cidades || []).filter((c) => !permitir || permitir.has(Number(c.id)))
}

/** UFs presentes nas linhas da tabela-mestre após o filtro de credenciamento. */
export function ufsDisponiveisFiltroCredenciamento(cidades, cidadeIdsPermitidos) {
    if (cidadeIdsPermitidos == null) return new Set()
    const ufs = new Set()
    filtrarCidadesTabelaPorIds(cidades, cidadeIdsPermitidos).forEach((c) => {
        const u = String(c.uf || '').trim().toUpperCase()
        if (u) ufs.add(u)
    })
    return ufs
}

/** Nomes de município (chave normalizada) permitidos por UF — tabela `cidades` + vínculos IBGE. */
export function buildNomesMunicipioPermitidosPorUf(cidades, vinculos, cidadeIdsPermitidos) {
    if (cidadeIdsPermitidos == null) return new Map()
    const permitir =
        cidadeIdsPermitidos instanceof Set && cidadeIdsPermitidos.size > 0 ? cidadeIdsPermitidos : null
    const porUf = new Map()
    const add = (uf, nome) => {
        const u = String(uf || '').trim().toUpperCase()
        const chave = normalizarMunicipioChave(nome)
        if (!u || !chave) return
        if (!porUf.has(u)) porUf.set(u, new Set())
        porUf.get(u).add(chave)
    }
    for (const c of cidades || []) {
        if (permitir && !permitir.has(Number(c.id))) continue
        add(c.uf, c.nome)
    }
    for (const v of vinculos || []) {
        if (permitir && !permitir.has(Number(v.cidade_id))) continue
        add(v.uf, v.municipio_nome)
    }
    return porUf
}

export function filtrarMunicipiosIbgePorCredenciamento(municipios, uf, nomesPorUf) {
    if (!uf || !nomesPorUf) return []
    const permitidos = nomesPorUf.get(String(uf).trim().toUpperCase())
    if (!permitidos?.size) return []
    return (municipios || []).filter((m) => permitidos.has(normalizarMunicipioChave(m.nome)))
}

/**
 * Municípios selecionáveis na impressão de planos (tabela-mestre + secundários via vínculo).
 * @returns {Array<{ municipioNome: string, cidadeTabelaId: number, label: string, ehPointer: boolean, tabelaNome: string }>}
 */
export function listarOpcoesMunicipioImpressaoPlanos(cidades, vinculos, municipiosIbge, uf, cidadeIdsPermitidos) {
    const ufNorm = String(uf || '').trim().toUpperCase()
    if (!ufNorm) return []
    const nomesPorUf = buildNomesMunicipioPermitidosPorUf(cidades, vinculos, cidadeIdsPermitidos)
    const listaIbge = filtrarMunicipiosIbgePorCredenciamento(municipiosIbge, ufNorm, nomesPorUf)
    const mapaTabelaNome = new Map(
        (cidades || []).map((c) => [Number(c.id), String(c.nome || '').trim()]),
    )

    const opcoes = []
    const vistos = new Set()

    for (const m of listaIbge) {
        const municipioNome = String(m.nome || '').trim()
        if (!municipioNome) continue
        const chave = normalizarMunicipioChave(municipioNome)
        if (vistos.has(chave)) continue
        vistos.add(chave)

        const cidadeTabelaId = resolverCidadeTabelaId({
            uf: ufNorm,
            municipioNome,
            vinculos,
            cidades,
        })
        if (!cidadeTabelaId) continue

        const tabelaNome = mapaTabelaNome.get(Number(cidadeTabelaId)) || ''
        const ehPointer =
            Boolean(tabelaNome) &&
            normalizarMunicipioChave(tabelaNome) !== normalizarMunicipioChave(municipioNome)

        opcoes.push({
            municipioNome,
            cidadeTabelaId: Number(cidadeTabelaId),
            label: municipioNome,
            ehPointer,
            tabelaNome,
        })
    }

    return opcoes.sort((a, b) =>
        a.municipioNome.localeCompare(b.municipioNome, 'pt-BR', { sensitivity: 'base' }),
    )
}

/** Cidades com repasse na supertabela ∩ cidades do plano (quando há plano). */
export async function buscarCidadeIdsFiltroPlanoCredenciados(supabase, planoId, buscarTodosPaginado) {
    const comRepasse = await buscarCidadeIdsTabelaComRepasses(supabase, buscarTodosPaginado)
    const doPlano = await buscarCidadeIdsTabelaPorPlano(supabase, planoId, buscarTodosPaginado)
    if (!doPlano.size) return comRepasse
    const out = new Set()
    doPlano.forEach((id) => {
        if (comRepasse.has(id)) out.add(id)
    })
    return out.size ? out : doPlano
}

export function parseValorFiltroCidade(value) {
    const raw = String(value || '')
    if (raw.startsWith('v-') || raw.startsWith('c-')) {
        const idPart = raw.slice(2)
        return { tipo: raw.startsWith('v-') ? 'vinculo' : 'cidade', refId: idPart, cidadeId: null }
    }
    const n = Number(raw)
    return { tipo: 'cidade', refId: raw, cidadeId: Number.isFinite(n) ? n : null }
}

export async function salvarVinculosDaCidade(supabase, cidadeId, uf, municipioPrincipal, municipiosExtras) {
    const cid = Number(cidadeId)
    const ufNorm = String(uf || '').trim().toUpperCase()
    const principal = String(municipioPrincipal || '').trim()
    if (!cid || !ufNorm || !principal) {
        throw new Error('UF e município principal são obrigatórios.')
    }

    const nomesUnicos = new Set()
    nomesUnicos.add(principal)
    ;(municipiosExtras || []).forEach((nome) => {
        const n = String(nome || '').trim()
        if (n) nomesUnicos.add(n)
    })

    const rows = [...nomesUnicos].map((municipio_nome) => ({
        cidade_id: cid,
        uf: ufNorm,
        municipio_nome,
    }))

    const { error: errDel } = await supabase.from('cidades_municipios_vinculo').delete().eq('cidade_id', cid)
    if (errDel) throw errDel

    if (!rows.length) return

    const { error: errIns } = await supabase.from('cidades_municipios_vinculo').insert(rows)
    if (errIns) throw errIns
}
