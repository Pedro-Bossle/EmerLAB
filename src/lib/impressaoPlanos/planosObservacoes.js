import { supabase } from '../supabase.js'
import {
    listarProcedimentosParaObservacoes,
    normalizarCodigoProcedimento,
} from '../impressaoHonorarios/honorariosObservacoes.js'

export { listarProcedimentosParaObservacoes, normalizarCodigoProcedimento }

function isMissingTableError(error) {
    const msg = String(error?.message || error?.details || '').toLowerCase()
    const code = String(error?.code || '')
    return (
        code === '42P01' ||
        code === 'PGRST205' ||
        (msg.includes('planos_observacoes') &&
            (msg.includes('does not exist') ||
                msg.includes('schema cache') ||
                msg.includes('could not find')))
    )
}

function isMissingTituloColumnError(error) {
    const msg = String(error?.message || error?.details || '').toLowerCase()
    return msg.includes('titulo') && (msg.includes('column') || msg.includes('schema cache'))
}

/**
 * Códigos marcados na impressão de planos (respeita checked / apenasLoja / selecionavel).
 * @param {Array<{ linhas?: object[] }>} categorias
 */
export function coletarCodigosCategoriasPlanos(categorias) {
    const set = new Set()
    for (const cat of categorias || []) {
        for (const linha of cat.linhas || []) {
            if (linha.checked === false) continue
            if (linha.apenasLoja) continue
            if (linha.selecionavel === false) continue
            const codigo = normalizarCodigoProcedimento(linha.codigo)
            if (codigo) set.add(codigo)
        }
    }
    return [...set]
}

function mapearObservacao(row) {
    const vinculos = Array.isArray(row?.planos_observacoes_procedimentos)
        ? row.planos_observacoes_procedimentos
        : []
    const codigos = [
        ...new Set(
            vinculos
                .map((v) => normalizarCodigoProcedimento(v.procedimento_codigo))
                .filter(Boolean),
        ),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return {
        id: Number(row.id),
        titulo: String(row.titulo || '').trim(),
        mensagem: String(row.mensagem || '').trim(),
        ativa: row.ativa !== false,
        ordem: Number(row.ordem) || 0,
        codigosProcedimentos: codigos,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    }
}

/**
 * @returns {Promise<{ ok: true, itens: object[] } | { ok: false, erro: string, missingTable?: boolean }>}
 */
export async function listarPlanosObservacoes() {
    const selectComTitulo =
        'id, titulo, mensagem, ativa, ordem, created_at, updated_at, planos_observacoes_procedimentos(procedimento_codigo)'
    const selectSemTitulo =
        'id, mensagem, ativa, ordem, created_at, updated_at, planos_observacoes_procedimentos(procedimento_codigo)'

    let { data, error } = await supabase
        .from('planos_observacoes')
        .select(selectComTitulo)
        .order('ordem', { ascending: true })
        .order('id', { ascending: true })

    if (error && isMissingTituloColumnError(error)) {
        ;({ data, error } = await supabase
            .from('planos_observacoes')
            .select(selectSemTitulo)
            .order('ordem', { ascending: true })
            .order('id', { ascending: true }))
    }

    if (error) {
        if (isMissingTableError(error)) {
            return {
                ok: false,
                missingTable: true,
                erro:
                    'Tabelas de observações ainda não existem. Execute scripts/sql/planos_observacoes.sql no Supabase.',
            }
        }
        return { ok: false, erro: error.message || 'Erro ao carregar observações.' }
    }

    return { ok: true, itens: (data || []).map(mapearObservacao) }
}

/**
 * @param {{
 *   id?: number | null,
 *   titulo?: string,
 *   mensagem: string,
 *   ativa?: boolean,
 *   ordem?: number,
 *   codigosProcedimentos: string[],
 * }} payload
 */
export async function salvarPlanosObservacao(payload) {
    const titulo = String(payload?.titulo || '').trim()
    const mensagem = String(payload?.mensagem || '').trim()
    if (!titulo) return { ok: false, erro: 'Informe o título da observação (ex.: Atendimentos Domiciliares).' }
    if (!mensagem) return { ok: false, erro: 'Informe o texto da observação.' }

    const codigos = [
        ...new Set(
            (payload?.codigosProcedimentos || [])
                .map(normalizarCodigoProcedimento)
                .filter(Boolean),
        ),
    ]
    if (!codigos.length) {
        return { ok: false, erro: 'Vincule ao menos um procedimento que dispara a observação.' }
    }

    const idExistente = payload?.id != null && Number(payload.id) > 0 ? Number(payload.id) : null
    const ativa = payload?.ativa !== false
    const ordem = Number.isFinite(Number(payload?.ordem)) ? Number(payload.ordem) : 0
    const agora = new Date().toISOString()

    let observacaoId = idExistente
    const rowBase = { mensagem, ativa, ordem, updated_at: agora, titulo }

    if (idExistente) {
        let { data: updated, error } = await supabase
            .from('planos_observacoes')
            .update(rowBase)
            .eq('id', idExistente)
            .select('id')
        if (error && isMissingTituloColumnError(error)) {
            ;({ data: updated, error } = await supabase
                .from('planos_observacoes')
                .update({ mensagem, ativa, ordem, updated_at: agora })
                .eq('id', idExistente)
                .select('id'))
        }
        if (error) {
            if (isMissingTableError(error)) {
                return {
                    ok: false,
                    missingTable: true,
                    erro:
                        'Tabelas de observações ainda não existem. Execute scripts/sql/planos_observacoes.sql no Supabase.',
                }
            }
            return { ok: false, erro: error.message || 'Erro ao atualizar observação.' }
        }
        if (!updated?.length) {
            return {
                ok: false,
                erro: 'Não foi possível atualizar a observação (registro não encontrado ou sem permissão).',
            }
        }
    } else {
        let { data, error } = await supabase
            .from('planos_observacoes')
            .insert(rowBase)
            .select('id')
            .single()
        if (error && isMissingTituloColumnError(error)) {
            ;({ data, error } = await supabase
                .from('planos_observacoes')
                .insert({ mensagem, ativa, ordem, updated_at: agora })
                .select('id')
                .single())
        }
        if (error) {
            if (isMissingTableError(error)) {
                return {
                    ok: false,
                    missingTable: true,
                    erro:
                        'Tabelas de observações ainda não existem. Execute scripts/sql/planos_observacoes.sql no Supabase.',
                }
            }
            return { ok: false, erro: error.message || 'Erro ao criar observação.' }
        }
        observacaoId = Number(data.id)
    }

    const { error: errDel } = await supabase
        .from('planos_observacoes_procedimentos')
        .delete()
        .eq('observacao_id', observacaoId)
    if (errDel) {
        return { ok: false, erro: errDel.message || 'Erro ao atualizar vínculos.' }
    }

    const rows = codigos.map((procedimento_codigo) => ({
        observacao_id: observacaoId,
        procedimento_codigo,
    }))
    const { error: errIns } = await supabase.from('planos_observacoes_procedimentos').insert(rows)
    if (errIns) {
        return { ok: false, erro: errIns.message || 'Erro ao vincular procedimentos.' }
    }

    return { ok: true, id: observacaoId }
}

export async function excluirPlanosObservacao(id) {
    const observacaoId = Number(id)
    if (!Number.isFinite(observacaoId) || observacaoId <= 0) {
        return { ok: false, erro: 'Observação inválida.' }
    }
    const { error } = await supabase.from('planos_observacoes').delete().eq('id', observacaoId)
    if (error) {
        if (isMissingTableError(error)) {
            return {
                ok: false,
                missingTable: true,
                erro:
                    'Tabelas de observações ainda não existem. Execute scripts/sql/planos_observacoes.sql no Supabase.',
            }
        }
        return { ok: false, erro: error.message || 'Erro ao excluir observação.' }
    }
    return { ok: true }
}

/**
 * @param {string[]} codigos
 * @returns {Promise<Array<{ titulo: string, mensagem: string }>>}
 */
export async function resolverMensagensObservacoesPlanosPorCodigos(codigos) {
    const setCodigos = new Set(
        (codigos || []).map(normalizarCodigoProcedimento).filter(Boolean),
    )
    if (!setCodigos.size) return []

    const lista = await listarPlanosObservacoes()
    if (!lista.ok) return []

    return lista.itens
        .filter((item) => item.ativa)
        .filter((item) =>
            (item.codigosProcedimentos || []).some((c) =>
                setCodigos.has(normalizarCodigoProcedimento(c)),
            ),
        )
        .map((item) => ({
            titulo: item.titulo || '',
            mensagem: item.mensagem || '',
        }))
        .filter((item) => item.mensagem)
}

/**
 * @param {Array<{ linhas?: object[] }>} categorias
 */
export async function resolverMensagensObservacoesPorCategorias(categorias) {
    return resolverMensagensObservacoesPlanosPorCodigos(coletarCodigosCategoriasPlanos(categorias))
}
