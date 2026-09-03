import { supabase } from '../supabase.js'
import { carregarPortesDb, mapaLetraPorPorteId } from '../prestadorProcedimentos.js'
import {
    buscarMapaRepassesPorCidadeId,
    mesclarMapasValoresPorte,
    normalizarCodigoRepasses,
} from '../repassesMapaCidade.js'
import { resolverCidadeTabelaRepassesHonorarios } from './resolverCidadeTabelaHonorarios.js'
import {
    carregarMapaNomesAlternativosPrestador,
    nomeParaHonorariosPdf,
    resolverVeterinarioIdsParaPrestador,
} from '../prestadorNomeAlternativo.js'

const CATEGORIA_SERVICO_MIN = 3
const CATEGORIA_SERVICO_MAX = 25

const normalizarCodigo = normalizarCodigoRepasses

function formatarValorCelula(valor) {
    if (valor == null || valor === '') return '—'
    const n = Number(valor)
    if (!Number.isFinite(n)) return String(valor)
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function carregarProcedimentosPorCodigos(codigos) {
    const unicos = [...new Set(codigos.map(normalizarCodigo).filter(Boolean))]
    const rows = []
    const chunk = 80
    for (let i = 0; i < unicos.length; i += chunk) {
        const lote = unicos.slice(i, i + chunk)
        const { data, error } = await supabase
            .from('procedimentos')
            .select('id, codigo, nome, categoria_id')
            .in('codigo', lote)
        if (error) throw new Error(error.message)
        rows.push(...(data || []))
    }
    return rows
}

/** Negociação só pelos veterinarios com prestador_id = cadastro (nunca pelo id do prestador). */
async function temNegociacaoVet(prestadorId) {
    if (!prestadorId) return false
    const vetIds = await resolverVeterinarioIdsParaPrestador(prestadorId)
    if (!vetIds.length) return false
    const { count, error } = await supabase
        .from('negociacoes_vet')
        .select('id', { count: 'exact', head: true })
        .in('veterinario_id', vetIds)
    if (error) throw new Error(error.message)
    return (count || 0) > 0
}

async function mapaValoresNegociacao(prestadorId, procedimentos) {
    const vetIds = await resolverVeterinarioIdsParaPrestador(prestadorId)
    if (!vetIds.length) return new Map()
    const { data, error } = await supabase
        .from('negociacoes_vet')
        .select('procedimento_id, porte_id, valor')
        .in('veterinario_id', vetIds)
    if (error) throw new Error(error.message)

    const porId = new Map(procedimentos.map((p) => [Number(p.id), p]))
    const porCodigo = new Map(procedimentos.map((p) => [normalizarCodigo(p.codigo), p]))
    const portes = await carregarPortesDb()
    const letraPorId = mapaLetraPorPorteId(portes)
    const mapa = new Map()

    for (const item of data || []) {
        const proc =
            porId.get(Number(item.procedimento_id)) ||
            porCodigo.get(normalizarCodigo(item.procedimento_id))
        if (!proc) continue
        const cod = normalizarCodigo(proc.codigo)
        if (!mapa.has(cod)) mapa.set(cod, { P: null, M: null, G: null })
        const letra = letraPorId.get(Number(item.porte_id))
        if (letra === 'P' || letra === 'M' || letra === 'G') {
            mapa.get(cod)[letra] = item.valor
        }
    }
    return mapa
}

/**
 * @returns {Promise<{ fonte: 'negociacao'|'repasses'|'vazio', cidadeTabelaLabel?: string, categorias: Array }>}
 */
export async function carregarLinhasHonorariosPrestador({
    prestadorId,
    codigosSelecionados,
    enderecoUf = '',
    enderecoMunicipio = '',
}) {
    const codigos = [...new Set((codigosSelecionados || []).map((c) => String(c).trim()).filter(Boolean))]
    if (!codigos.length) {
        return { fonte: 'vazio', categorias: [] }
    }

    const [{ data: cats, error: errCat }, procedimentos, usaNeg, mapaAlt] = await Promise.all([
        supabase
            .from('categorias')
            .select('id, nome')
            .gte('id', CATEGORIA_SERVICO_MIN)
            .lte('id', CATEGORIA_SERVICO_MAX)
            .order('id', { ascending: true }),
        carregarProcedimentosPorCodigos(codigos),
        temNegociacaoVet(prestadorId),
        prestadorId ? carregarMapaNomesAlternativosPrestador(prestadorId) : Promise.resolve(new Map()),
    ])
    if (errCat) throw new Error(errCat.message)

    const codigosSet = new Set(codigos.map(normalizarCodigo))
    const procsFiltrados = procedimentos.filter((p) => codigosSet.has(normalizarCodigo(p.codigo)))

    let fonte = 'repasses'
    let mapaValores = new Map()
    let cidadeTabelaLabel = ''

    const resolved = await resolverCidadeTabelaRepassesHonorarios({
        prestadorId,
        enderecoUf,
        enderecoMunicipio,
    })
    let mapaRepasses = new Map()
    if (resolved.cidadeTabelaId) {
        cidadeTabelaLabel = resolved.labelTabela || ''
        mapaRepasses = await buscarMapaRepassesPorCidadeId(resolved.cidadeTabelaId)
    }

    if (usaNeg) {
        fonte = 'negociacao'
        const mapaNeg = await mapaValoresNegociacao(prestadorId, procsFiltrados)
        mapaValores = mesclarMapasValoresPorte(mapaNeg, mapaRepasses)
    } else {
        fonte = 'repasses'
        mapaValores = mapaRepasses
    }

    const mapaCat = new Map((cats || []).map((c) => [Number(c.id), String(c.nome || '').trim() || `Categoria ${c.id}`]))
    const porCategoria = new Map()

    for (const p of procsFiltrados) {
        const cid = Number(p.categoria_id)
        if (!porCategoria.has(cid)) porCategoria.set(cid, [])
        const cod = normalizarCodigo(p.codigo)
        const vals = mapaValores.get(cod) || { P: null, M: null, G: null }
        const alt = mapaAlt.get(cod) || ''
        porCategoria.get(cid).push({
            checked: true,
            codigo: p.codigo,
            nomeCatalogo: p.nome,
            nomeAlternativo: alt,
            nome: nomeParaHonorariosPdf(p.nome, alt),
            P: formatarValorCelula(vals.P),
            M: formatarValorCelula(vals.M),
            G: formatarValorCelula(vals.G),
        })
    }

    const categorias = (cats || [])
        .filter((c) => porCategoria.has(Number(c.id)))
        .map((c) => {
            const linhas = porCategoria.get(Number(c.id)) || []
            linhas.sort((a, b) =>
                String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { sensitivity: 'base' }),
            )
            return { id: Number(c.id), nome: mapaCat.get(Number(c.id)) || c.nome, linhas }
        })

    return { fonte, cidadeTabelaLabel, categorias }
}
