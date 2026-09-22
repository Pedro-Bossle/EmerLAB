/**
 * Negociações (tabela `veterinarios`) vinculadas a um prestador.
 * Ao cancelar o perfil, inativa a(s) tabela(s) e some da lista principal.
 */

import { supabase } from './supabase.js'
import { situacaoDescricaoEhCancelado } from './prestadorCadastroHelpers.js'

/**
 * Marca como inativas todas as negociações com `prestador_id` = prestadorId.
 * @returns {Promise<{ ok: boolean, atualizados: number, erro?: string, colunaAusente?: boolean }>}
 */
export async function inativarNegociacoesDoPrestador(prestadorId) {
    const pid = Number(prestadorId)
    if (!Number.isFinite(pid) || pid <= 0) {
        return { ok: false, atualizados: 0, erro: 'prestador_id inválido' }
    }

    const agora = new Date().toISOString()
    const { data, error } = await supabase
        .from('veterinarios')
        .update({ ativo: false })
        .eq('prestador_id', pid)
        .eq('ativo', true)
        .select('id')

    if (error) {
        const msg = String(error.message || '')
        if (/ativo|column|schema cache|does not exist/i.test(msg)) {
            return {
                ok: false,
                atualizados: 0,
                colunaAusente: true,
                erro:
                    'Coluna veterinarios.ativo ausente. Execute scripts/sql/veterinarios_negociacao_ativo.sql no Supabase.',
            }
        }
        return { ok: false, atualizados: 0, erro: msg }
    }

    return { ok: true, atualizados: (data || []).length, em: agora }
}

/**
 * Se a situação nova for Cancelado (e a anterior não), inativa negociações do prestador.
 * @returns {Promise<{ aplicado: boolean, atualizados: number, erro?: string }>}
 */
export async function inativarNegociacoesSeCancelado(
    prestadorId,
    situacaoIdAnterior,
    situacaoIdNova,
    situacoes = [],
) {
    const descAnt =
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdAnterior))?.descricao || ''
    const descNova =
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdNova))?.descricao || ''

    if (!situacaoDescricaoEhCancelado(descNova) || situacaoDescricaoEhCancelado(descAnt)) {
        return { aplicado: false, atualizados: 0 }
    }

    const r = await inativarNegociacoesDoPrestador(prestadorId)
    return {
        aplicado: true,
        atualizados: r.atualizados || 0,
        erro: r.ok ? undefined : r.erro,
    }
}
