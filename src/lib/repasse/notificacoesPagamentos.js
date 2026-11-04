/**
 * Notificações de Pagamentos (sino): o que os prestadores responderam ao e-mail de repasse.
 * Fonte: eventos do relatório gravados pela página pública (autor «prestador»):
 *   - aprovado         → o prestador RPA aprovou o relatório (RPA não anexa documento);
 *   - documento_enviado → nota fiscal ou boleto anexado (vai para a Caixa de entrada revisar);
 *   - reprovado        → o prestador reprovou o relatório (observação na Caixa de entrada).
 * «Limpar» no sino guarda um horário neste navegador (como o sino do formulário); só o que veio depois aparece.
 */
import { supabase } from '../supabase.js'
import { formatarValorMonetarioBr } from '../pagamentosValor.js'

const CHAVE_LIMPO = 'emerdog_pag_notif_limpo_v1'
export const EVENTO_MUDANCA_NOTIF_PAGAMENTOS = 'emerdog-pag-notif-change'
const JANELA_DIAS = 14
const TIPOS = ['aprovado', 'reprovado', 'documento_enviado']

function lerLimpoEm() {
    try {
        return localStorage.getItem(CHAVE_LIMPO) || null
    } catch {
        return null
    }
}

export function limparNotificacoesPagamentos() {
    try {
        localStorage.setItem(CHAVE_LIMPO, new Date().toISOString())
    } catch {
        /* sem armazenamento: o aviso some só até recarregar */
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_MUDANCA_NOTIF_PAGAMENTOS))
}

/** Só entra o que veio depois do último «Limpar» e nos últimos 14 dias. */
export function desdeNotificacoesPagamentos(agora = Date.now(), limpoEm = lerLimpoEm()) {
    const janela = agora - JANELA_DIAS * 86_400_000
    const limpo = limpoEm ? new Date(limpoEm).getTime() : 0
    return new Date(Math.max(janela, Number.isFinite(limpo) ? limpo : 0)).toISOString()
}

/** Texto curto da notificação. Puro (testável). */
export function textoNotificacaoPagamento({ tipo, prestador, competencia, dados }) {
    const quem = prestador || 'Um prestador'
    const comp = competencia ? ` de ${competencia}` : ''
    if (tipo === 'aprovado') return `${quem} aprovou o relatório${comp} (RPA)`
    if (tipo === 'reprovado') return `${quem} reprovou o relatório${comp}`
    if (tipo === 'documento_enviado') {
        const doc = dados?.tipo === 'boleto' ? 'o boleto' : 'a nota fiscal'
        const valor = dados?.valor != null ? ` de ${formatarValorMonetarioBr(dados.valor)}` : ''
        return `${quem} enviou ${doc}${valor}${comp}`
    }
    return `${quem} respondeu o relatório${comp}`
}

function consultaBase(colunas, opcoes) {
    return supabase
        .from('repasse_eventos')
        .select(colunas, opcoes)
        .eq('autor', 'prestador')
        .in('tipo', TIPOS)
        .gt('criado_em', desdeNotificacoesPagamentos())
}

export async function contarNotificacoesPagamentos() {
    const { count, error } = await consultaBase('id', { count: 'exact', head: true })
    if (error) throw new Error(error.message)
    return count || 0
}

export async function listarNotificacoesPagamentos(limite = 8) {
    const { data: eventos, error } = await consultaBase('id, relatorio_id, tipo, dados, criado_em').order('criado_em', { ascending: false }).limit(limite)
    if (error) throw new Error(error.message)
    const lista = eventos || []
    if (!lista.length) return []
    const relIds = [...new Set(lista.map((e) => e.relatorio_id))]
    const { data: rels } = await supabase.from('repasse_relatorios').select('id, registro_id, mes, ano, nome_a1').in('id', relIds)
    const relPorId = new Map((rels || []).map((r) => [r.id, r]))
    const { data: regs } = await supabase.from('pagamentos_registros').select('id, prestador_nome').in('id', [...new Set((rels || []).map((r) => r.registro_id))])
    const regPorId = new Map((regs || []).map((r) => [r.id, r]))
    return lista.map((e) => {
        const rel = relPorId.get(e.relatorio_id)
        const prestador = regPorId.get(rel?.registro_id)?.prestador_nome || rel?.nome_a1 || ''
        const competencia = rel ? `${String(rel.mes).padStart(2, '0')}/${rel.ano}` : ''
        return { id: e.id, tipo: e.tipo, criadoEm: e.criado_em, texto: textoNotificacaoPagamento({ tipo: e.tipo, prestador, competencia, dados: e.dados }) }
    })
}
