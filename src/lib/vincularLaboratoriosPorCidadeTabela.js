import {
    carregarVinculosMunicipios,
    resolverCidadeTabelaId,
} from './cidadesSupertabelaVinculos.js'
import { idsEspecialidadeLaboratorio, prestadorEhLaboratorio } from './prestadorCadastroHelpers.js'
import { buscarTodosPaginado, supabase as supabaseDefault } from './supabase.js'

const CHUNK_INSERT = 400

/**
 * Ids da tabela-mestre `cidades` (repasses/planos) inferidos do endereço
 * e, se houver, das cidades de credenciamento (`prestador_cidades` / `cidade_id`),
 * usando `cidades_municipios_vinculo` + fallback por nome em `cidades`.
 */
export function coletarCidadeTabelaIdsPrestador(prestador, ctx) {
    const ids = new Set()
    if (!prestador) return ids

    const { vinculos, cidadesTabela, mapaCidadesCred, prestadorCidades } = ctx
    const ufEnd = String(prestador.endereco_uf || '').trim().toUpperCase()

    const registrar = (uf, municipio) => {
        const mun = String(municipio || '').trim()
        if (!mun) return
        const id = resolverCidadeTabelaId({
            uf: uf || ufEnd,
            municipioNome: mun,
            vinculos,
            cidades: cidadesTabela,
        })
        if (id) ids.add(Number(id))
    }

    registrar(ufEnd, prestador.endereco_cidade)

    const credPrincipal = mapaCidadesCred?.get(Number(prestador.cidade_id))
    if (credPrincipal) registrar(ufEnd, credPrincipal)

    ;(prestadorCidades || [])
        .filter((r) => Number(r.prestador_id) === Number(prestador.id))
        .forEach((r) => {
            const nome = mapaCidadesCred?.get(Number(r.cidade_id))
            if (nome) registrar(ufEnd, nome)
        })

    return ids
}

function mapaLaboratoriosPorCidadeTabela(prestadores, ctx, idsEspLab) {
    const mapa = new Map()
    ;(prestadores || []).forEach((p) => {
        if (!prestadorEhLaboratorio(p.especialidade_id, ctx.especialidades)) return
        if (!p.ativo) return
        const tabelas = coletarCidadeTabelaIdsPrestador(p, ctx)
        tabelas.forEach((cid) => {
            if (!mapa.has(cid)) mapa.set(cid, [])
            mapa.get(cid).push(Number(p.id))
        })
    })
    return mapa
}

function laboratoriosIdsParaPrestador(prestador, mapaLabsPorCidade, ctx) {
    if (prestadorEhLaboratorio(prestador.especialidade_id, ctx.especialidades)) {
        return []
    }
    const tabelas = coletarCidadeTabelaIdsPrestador(prestador, ctx)
    const out = new Set()
    tabelas.forEach((cid) => {
        ;(mapaLabsPorCidade.get(cid) || []).forEach((lid) => {
            if (lid && lid !== Number(prestador.id)) out.add(lid)
        })
    })
    return [...out]
}

export async function carregarContextoVinculoLaboratoriosCidade(client = supabaseDefault) {
    const [prestRes, { data: cidadesTabela, error: errC }, pcRes, ccRes, { data: especialidades, error: errE }, vinculos] =
        await Promise.all([
            buscarTodosPaginado(() =>
                client
                    .from('prestadores')
                    .select(
                        'id, nome, ativo, especialidade_id, endereco_uf, endereco_cidade, cidade_id',
                    )
                    .order('id', { ascending: true }),
            ),
            client.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
            buscarTodosPaginado(() =>
                client
                    .from('prestador_cidades')
                    .select('prestador_id, cidade_id')
                    .order('prestador_id', { ascending: true })
                    .order('cidade_id', { ascending: true }),
            ),
            buscarTodosPaginado(() =>
                client.from('cidades_credenciamento').select('id, nome').order('id', { ascending: true }),
            ),
            client.from('especialidades').select('id, nome'),
            carregarVinculosMunicipios(client),
        ])

    if (prestRes.error) throw new Error(prestRes.error.message)
    if (errC) throw new Error(errC.message)
    if (pcRes.error) throw new Error(pcRes.error.message)
    if (ccRes.error) throw new Error(ccRes.error.message)
    if (errE) throw new Error(errE.message)

    return {
        prestadores: prestRes.data || [],
        cidadesTabela: cidadesTabela || [],
        prestadorCidades: pcRes.data || [],
        mapaCidadesCred: new Map((ccRes.data || []).map((c) => [Number(c.id), c.nome])),
        especialidades: especialidades || [],
        vinculos,
        idsEspLab: idsEspecialidadeLaboratorio(especialidades || []),
    }
}

/**
 * Gera pares prestador_id × laboratorio_id (mesma cidade-tabela).
 */
export function gerarParesVinculoLaboratoriosPorCidade(ctx, { apenasAtivos = true } = {}) {
    const fullCtx = {
        ...ctx,
        vinculos: ctx.vinculos,
        cidadesTabela: ctx.cidadesTabela,
        mapaCidadesCred: ctx.mapaCidadesCred,
        prestadorCidades: ctx.prestadorCidades,
        especialidades: ctx.especialidades,
    }

    const mapaLabs = mapaLaboratoriosPorCidadeTabela(ctx.prestadores, fullCtx, ctx.idsEspLab)
    const rows = []
    let semCidade = 0
    let semLab = 0
    let comVinculo = 0

    ;(ctx.prestadores || []).forEach((p) => {
        if (apenasAtivos && !p.ativo) return
        if (prestadorEhLaboratorio(p.especialidade_id, ctx.especialidades)) return

        const tabelas = coletarCidadeTabelaIdsPrestador(p, fullCtx)
        if (!tabelas.size) {
            semCidade += 1
            return
        }

        const labs = laboratoriosIdsParaPrestador(p, mapaLabs, fullCtx)
        if (!labs.length) {
            semLab += 1
            return
        }

        comVinculo += 1
        labs.forEach((lid) => {
            rows.push({ prestador_id: Number(p.id), laboratorio_id: lid })
        })
    })

    return {
        rows,
        stats: {
            prestadoresComVinculo: comVinculo,
            prestadoresSemCidadeTabela: semCidade,
            prestadoresSemLabNaRegiao: semLab,
            totalPares: rows.length,
            cidadesTabelaComLab: mapaLabs.size,
        },
    }
}

export async function listarLaboratoriosIdsPorCidadeDoPrestador(prestadorId, client = supabaseDefault) {
    const ctx = await carregarContextoVinculoLaboratoriosCidade(client)
    const p = ctx.prestadores.find((x) => Number(x.id) === Number(prestadorId))
    if (!p) return { labIds: [], stats: { motivo: 'prestador_nao_encontrado' } }

    const mapaLabs = mapaLaboratoriosPorCidadeTabela(ctx.prestadores, ctx, ctx.idsEspLab)
    const labIds = laboratoriosIdsParaPrestador(p, mapaLabs, ctx)
    const tabelas = coletarCidadeTabelaIdsPrestador(p, ctx)

    return {
        labIds,
        stats: {
            cidadeTabelaIds: [...tabelas],
            qtdLabs: labIds.length,
        },
    }
}

export async function aplicarVinculosLaboratoriosPorCidadeEmMassa(
    client = supabaseDefault,
    { apenasAtivos = true, substituir = false } = {},
) {
    const ctx = await carregarContextoVinculoLaboratoriosCidade(client)
    const { rows, stats } = gerarParesVinculoLaboratoriosPorCidade(ctx, { apenasAtivos })

    if (substituir) {
        const idsAlvo = [
            ...new Set(
                (ctx.prestadores || [])
                    .filter((p) => p.ativo && !prestadorEhLaboratorio(p.especialidade_id, ctx.especialidades))
                    .map((p) => Number(p.id)),
            ),
        ]
        for (let i = 0; i < idsAlvo.length; i += CHUNK_INSERT) {
            const lote = idsAlvo.slice(i, i + CHUNK_INSERT)
            const { error } = await client
                .from('prestador_laboratorios_solicitacao')
                .delete()
                .in('prestador_id', lote)
            if (error) throw new Error(error.message)
        }
    }

    let inseridos = 0
    for (let i = 0; i < rows.length; i += CHUNK_INSERT) {
        const lote = rows.slice(i, i + CHUNK_INSERT)
        const { error } = await client.from('prestador_laboratorios_solicitacao').upsert(lote, {
            onConflict: 'prestador_id,laboratorio_id',
            ignoreDuplicates: true,
        })
        if (error) {
            const msg = String(error.message || '')
            if (msg.toLowerCase().includes('row-level security')) {
                throw new Error(
                    'Sem permissão RLS em prestador_laboratorios_solicitacao. Execute scripts/sql/prestador_laboratorios_solicitacao_rls.sql.',
                )
            }
            throw new Error(msg)
        }
        inseridos += lote.length
    }

    return { ...stats, linhasGravadas: inseridos, substituir }
}
