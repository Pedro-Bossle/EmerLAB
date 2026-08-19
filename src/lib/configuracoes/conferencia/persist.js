import { supabase } from '../../supabase.js'
import { normalizarTextoBusca } from '../../prestadorCadastroHelpers.js'
import {
    carregarAliasesPessoaLaboratorio,
    salvarAliasPessoa,
    carregarMapeamentosLaboratorio,
    salvarMapeamentoExame,
    carregarSessaoConferencia,
    salvarSessaoConferencia,
} from '../conferenciaLaboratorio.js'

function tabelaAusente(error) {
    return /does not exist|schema cache|42P01|PGRST/i.test(String(error?.message || error || ''))
}

async function uidAtual() {
    try {
        const { data } = await supabase.auth.getUser()
        return data?.user?.id || null
    } catch {
        return null
    }
}

export {
    carregarAliasesPessoaLaboratorio,
    salvarAliasPessoa,
    carregarMapeamentosLaboratorio,
    salvarMapeamentoExame,
    carregarSessaoConferencia,
    salvarSessaoConferencia,
}

export async function carregarEquivalenciasLaboratorio(laboratorioId) {
    const id = Number(laboratorioId)
    if (!id) return []
    try {
        const { data, error } = await supabase
            .from('lab_exame_equivalencia')
            .select(
                'id, laboratorio_id, nome_a, nome_a_normalizado, nome_b, nome_b_normalizado, ativo',
            )
            .eq('laboratorio_id', id)
            .eq('ativo', true)
            .order('nome_a', { ascending: true })
        if (error) {
            if (tabelaAusente(error)) return []
            console.warn('[conferencia] equivalencias:', error.message)
            return []
        }
        return (data || []).map((r) => ({
            id: r.id,
            a: r.nome_a,
            b: r.nome_b,
            ativo: r.ativo !== false,
        }))
    } catch (e) {
        console.warn('[conferencia] equivalencias:', e?.message || e)
        return []
    }
}

export async function salvarEquivalenciaExame({ laboratorioId, nomeA, nomeB, userId }) {
    const id = Number(laboratorioId)
    const a = String(nomeA || '').trim()
    const b = String(nomeB || '').trim()
    if (!id || !a || !b) return { ok: false, motivo: 'Dados incompletos.' }
    const payload = {
        laboratorio_id: id,
        nome_a: a,
        nome_a_normalizado: normalizarTextoBusca(a),
        nome_b: b,
        nome_b_normalizado: normalizarTextoBusca(b),
        ativo: true,
        criado_por: userId || (await uidAtual()),
        atualizado_em: new Date().toISOString(),
    }
    try {
        const { error } = await supabase
            .from('lab_exame_equivalencia')
            .upsert(payload, {
                onConflict: 'laboratorio_id,nome_a_normalizado,nome_b_normalizado',
            })
        if (error) {
            if (tabelaAusente(error)) {
                return {
                    ok: false,
                    motivo:
                        'Tabela de equivalências não configurada. Execute scripts/sql/conferencia_laboratorio.sql.',
                }
            }
            return { ok: false, motivo: error.message }
        }
        return { ok: true }
    } catch (e) {
        return { ok: false, motivo: e?.message || String(e) }
    }
}

export async function carregarPerfisLaboratorio(laboratorioId) {
    const id = Number(laboratorioId)
    if (!id) return []
    try {
        const { data, error } = await supabase
            .from('lab_exame_perfil')
            .select(
                'id, laboratorio_id, nome, descricao, valor, vigencia_inicio, vigencia_fim, ativo, lab_exame_perfil_item(id, nome_exame, nome_exame_normalizado)',
            )
            .eq('laboratorio_id', id)
            .eq('ativo', true)
            .order('nome', { ascending: true })
        if (error) {
            if (tabelaAusente(error)) return []
            console.warn('[conferencia] perfis:', error.message)
            return []
        }
        return (data || []).map((p) => ({
            id: p.id,
            nome: p.nome,
            descricao: p.descricao,
            valor: p.valor,
            vigencia_inicio: p.vigencia_inicio,
            vigencia_fim: p.vigencia_fim,
            ativo: p.ativo !== false,
            exames: (p.lab_exame_perfil_item || []).map((i) => i.nome_exame),
            itens: p.lab_exame_perfil_item || [],
        }))
    } catch (e) {
        console.warn('[conferencia] perfis:', e?.message || e)
        return []
    }
}

export async function salvarPerfilExame({
    laboratorioId,
    nome,
    descricao,
    valor,
    vigenciaInicio,
    vigenciaFim,
    exames,
    userId,
}) {
    const id = Number(laboratorioId)
    const titulo = String(nome || '').trim()
    if (!id || !titulo) return { ok: false, motivo: 'Informe o nome do perfil.' }
    try {
        const { data, error } = await supabase
            .from('lab_exame_perfil')
            .insert({
                laboratorio_id: id,
                nome: titulo,
                descricao: String(descricao || '').trim() || null,
                valor: valor == null || valor === '' ? null : Number(valor),
                vigencia_inicio: vigenciaInicio || null,
                vigencia_fim: vigenciaFim || null,
                ativo: true,
                criado_por: userId || (await uidAtual()),
            })
            .select('id')
            .single()
        if (error) {
            if (tabelaAusente(error)) {
                return {
                    ok: false,
                    motivo:
                        'Tabela de perfis não configurada. Execute scripts/sql/conferencia_laboratorio.sql.',
                }
            }
            return { ok: false, motivo: error.message }
        }
        const perfilId = data?.id
        const lista = (exames || []).map((e) => String(e || '').trim()).filter(Boolean)
        if (perfilId && lista.length) {
            const { error: errItens } = await supabase.from('lab_exame_perfil_item').insert(
                lista.map((nomeExame) => ({
                    perfil_id: perfilId,
                    nome_exame: nomeExame,
                    nome_exame_normalizado: normalizarTextoBusca(nomeExame),
                })),
            )
            if (errItens) return { ok: false, motivo: errItens.message }
        }
        return { ok: true, id: perfilId }
    } catch (e) {
        return { ok: false, motivo: e?.message || String(e) }
    }
}

export async function salvarRevisaoConferencia({
    laboratorioId,
    sessaoId,
    acao,
    registroIds,
    justificativa,
    resultadoId,
    userId,
}) {
    const id = Number(laboratorioId)
    if (!id || !acao) return { ok: false }
    try {
        const { error } = await supabase.from('lab_conferencia_revisao').insert({
            laboratorio_id: id,
            sessao_id: sessaoId || null,
            usuario_id: userId || (await uidAtual()),
            acao,
            registro_ids: registroIds || [],
            justificativa: justificativa || null,
            resultado_id: resultadoId || null,
        })
        if (error) {
            if (tabelaAusente(error)) return { ok: false, motivo: error.message }
            return { ok: false, motivo: error.message }
        }
        return { ok: true }
    } catch (e) {
        return { ok: false, motivo: e?.message || String(e) }
    }
}

export function estadoSessaoV2({
    passo,
    laboratorioId,
    periodoYm,
    mapColsHonorarios,
    mapColsMellis,
    mapColsBase,
    linhasHonorarios,
    linhasMellis,
    linhasBase,
    vinculosBase,
    resultados,
    resumo,
    revisoes,
    aliasesPessoa,
} = {}) {
    return {
        versao: 2,
        passo: passo || 'setup',
        laboratorioId: laboratorioId ? Number(laboratorioId) : null,
        periodoYm: periodoYm || '',
        mapColsHonorarios: mapColsHonorarios || {},
        mapColsMellis: mapColsMellis || {},
        mapColsBase: mapColsBase || {},
        linhasHonorarios: linhasHonorarios || [],
        linhasMellis: linhasMellis || [],
        linhasBase: linhasBase || [],
        vinculosBase: vinculosBase || {},
        resultados: resultados || [],
        resumo: resumo || null,
        revisoes: revisoes || [],
        aliasesPessoa: aliasesPessoa || [],
        atualizadoEm: new Date().toISOString(),
    }
}
