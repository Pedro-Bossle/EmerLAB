import { supabase } from './supabase.js'
import {
    isErroColunaNomeAlternativo,
    mapaProcedimentoIdPorCodigo,
    normalizarPrestadorIdParaQuery,
    prestadorProcedimentosTemNomeAlternativo,
} from './prestadorProcedimentos.js'

const normalizarCodigo = (cod) =>
    String(cod || '')
        .trim()
        .toUpperCase()

/** `negociacoes_vet.veterinario_id` é `veterinarios.id`, não `prestadores.id`. */
export async function resolverVeterinarioIdsParaPrestador(prestadorId) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return []
    const ids = new Set([pid])

    const { data: porPrestador } = await supabase
        .from('veterinarios')
        .select('id')
        .eq('prestador_id', pid)
    ;(porPrestador || []).forEach((v) => {
        const id = Number(v.id)
        if (Number.isFinite(id)) ids.add(id)
    })

    const { data: porId } = await supabase.from('veterinarios').select('id').eq('id', pid).maybeSingle()
    if (porId?.id != null) {
        const id = Number(porId.id)
        if (Number.isFinite(id)) ids.add(id)
    }

    return [...ids]
}

async function mapaCodigoPorProcedimentoId(ids) {
    const codPorId = new Map()
    const unicos = [...new Set(ids.map((id) => Number(id)).filter(Number.isFinite))]
    const chunk = 80
    for (let i = 0; i < unicos.length; i += chunk) {
        const { data: procs, error } = await supabase
            .from('procedimentos')
            .select('id, codigo')
            .in('id', unicos.slice(i, i + chunk))
        if (error) throw new Error(error.message)
        ;(procs || []).forEach((p) => codPorId.set(Number(p.id), normalizarCodigo(p.codigo)))
    }
    return codPorId
}

/** Preenche mapa a partir de `negociacoes_vet` (valores já existentes na negociação). */
async function mesclarNomesAlternativosNegociacao(mapa, prestadorId) {
    const vetIds = await resolverVeterinarioIdsParaPrestador(prestadorId)
    if (!vetIds.length) return

    const { data: negRows, error: errNeg } = await supabase
        .from('negociacoes_vet')
        .select('procedimento_id, nome_alternativo')
        .in('veterinario_id', vetIds)
    if (errNeg || !negRows?.length) return

    const altPorProcId = new Map()
    for (const row of negRows) {
        const alt = String(row.nome_alternativo ?? '').trim()
        if (!alt) continue
        const raw = row.procedimento_id
        const procId = Number(raw)
        if (Number.isFinite(procId)) {
            if (!altPorProcId.has(procId)) altPorProcId.set(procId, alt)
            continue
        }
        const cod = normalizarCodigo(raw)
        if (cod) mapa.set(cod, alt)
    }
    if (!altPorProcId.size) return

    const codPorId = await mapaCodigoPorProcedimentoId([...altPorProcId.keys()])
    for (const [procId, alt] of altPorProcId) {
        const cod = codPorId.get(procId)
        if (cod) mapa.set(cod, alt)
    }
}

/** Cadastro (`prestador_procedimentos`) sobrescreve quando há texto (fonte da edição). */
async function mesclarNomesAlternativosCadastro(mapa, prestadorId) {
    const colsBase = 'procedimento_cod, procedimento_id'
    let res
    if (prestadorProcedimentosTemNomeAlternativo) {
        res = await supabase
            .from('prestador_procedimentos')
            .select(`${colsBase}, nome_alternativo`)
            .eq('prestador_id', prestadorId)
        if (res.error && isErroColunaNomeAlternativo(res.error)) {
            prestadorProcedimentosTemNomeAlternativo = false
            return
        }
    } else {
        return
    }
    if (res.error) return

    for (const row of res.data || []) {
        const alt = String(row.nome_alternativo ?? '').trim()
        if (!alt) continue
        const cod =
            normalizarCodigo(row.procedimento_cod) ||
            normalizarCodigo(row.procedimento_id)
        if (cod) mapa.set(cod, alt)
    }
}

/**
 * Mapa código (upper) → nome alternativo.
 * Negociação preenche legado; cadastro prevalece quando preenchido.
 */
export async function carregarMapaNomesAlternativosPrestador(prestadorId) {
    const mapa = new Map()
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return mapa

    try {
        await mesclarNomesAlternativosNegociacao(mapa, pid)
    } catch {
        /* negociação opcional para exibição */
    }
    try {
        await mesclarNomesAlternativosCadastro(mapa, pid)
    } catch {
        /* cadastro opcional se coluna ainda não existir */
    }

    return mapa
}

export async function salvarNomeAlternativoPrestadorProcedimento(prestadorId, procedimentoCodigo, textoBruto) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return
    const cod = normalizarCodigo(procedimentoCodigo)
    if (!cod) return
    if (!prestadorProcedimentosTemNomeAlternativo) return

    const valorDb = String(textoBruto ?? '').trim() || null
    const mapaId = await mapaProcedimentoIdPorCodigo([cod])
    const procedimento_id = mapaId.get(cod) ?? null

    const { data: exist, error: errSel } = await supabase
        .from('prestador_procedimentos')
        .select('id')
        .eq('prestador_id', pid)
        .eq('procedimento_cod', cod)
        .maybeSingle()
    if (errSel) throw new Error(errSel.message)

    if (exist?.id) {
        let { error } = await supabase
            .from('prestador_procedimentos')
            .update({ nome_alternativo: valorDb })
            .eq('id', exist.id)
        if (error && isErroColunaNomeAlternativo(error)) {
            prestadorProcedimentosTemNomeAlternativo = false
            return
        }
        if (error) throw new Error(error.message)
    } else {
        let { error } = await supabase.from('prestador_procedimentos').insert({
            prestador_id: pid,
            procedimento_cod: cod,
            procedimento_id,
            nome_alternativo: valorDb,
        })
        if (error && isErroColunaNomeAlternativo(error)) {
            prestadorProcedimentosTemNomeAlternativo = false
            return
        }
        if (error) throw new Error(error.message)
    }

    if (!procedimento_id) return

    const vetIds = await resolverVeterinarioIdsParaPrestador(pid)
    for (const vetId of vetIds) {
        const { count } = await supabase
            .from('negociacoes_vet')
            .select('id', { count: 'exact', head: true })
            .eq('veterinario_id', vetId)
        if ((count || 0) === 0) continue
        const { error: errNeg } = await supabase
            .from('negociacoes_vet')
            .update({ nome_alternativo: valorDb })
            .eq('veterinario_id', vetId)
            .eq('procedimento_id', procedimento_id)
        if (errNeg) throw new Error(errNeg.message)
    }
}

/** Nome exibido em honorários / PDF: alternativo se houver, senão catálogo. */
export function nomeParaHonorariosPdf(nomeCatalogo, nomeAlternativo) {
    const alt = String(nomeAlternativo ?? '').trim()
    if (alt) return alt
    return String(nomeCatalogo ?? '').trim() || '—'
}
