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
export function buildOpcoesFiltroSupertabela(cidades, _vinculos) {
    return (cidades || [])
        .map((c) => {
            const nome = String(c.nome || '').trim() || '—'
            return {
                value: `c-${c.id}`,
                cidadeId: Number(c.id),
                label: nome,
                sort: nome,
            }
        })
        .sort((a, b) => a.sort.localeCompare(b.sort, 'pt-BR', { sensitivity: 'base' }))
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
