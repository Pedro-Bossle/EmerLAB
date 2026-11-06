/**
 * Resumo do credenciamento para o gráfico do Início: credenciados, cancelados e processos em andamento
 * (formulário, OK da minuta, assinatura) nos últimos dias.
 *
 * Fontes (sem tabela nova):
 * - Credenciados: `prestadores.credenciado_em` (preenchido por trigger quando a situação vira «Credenciado»).
 * - Cancelados: prestadores hoje em «Cancelado», no dia de `data_atualizacao` (aproximação: não há data própria do cancelamento).
 * - Em processo: cards do funil (`cred_kanban_cards`) nas colunas de cadastro. O total de cada dia é estimado a partir de
 *   `criado_em` (+ quem saiu do funil depois), pois o banco não guarda o histórico de movimentação.
 */
import { supabase } from './supabase.js'
import { acharSituacaoCanceladoId } from './prestadorCadastroHelpers.js'

export const ETAPAS_EM_PROCESSO = [
    { id: 'preenchendo_form', label: 'Formulário' },
    { id: 'aguardando_ok_minuta', label: 'OK minuta' },
    { id: 'aguardando_assinatura', label: 'Assinatura' },
]

const LIMITE_LINHAS = 5000

/** Chave local AAAA-MM-DD (o dia que a pessoa vê, não o do UTC). */
export function chaveDia(valor) {
    const d = valor instanceof Date ? valor : new Date(valor)
    if (Number.isNaN(d.getTime())) return null
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
}

/** Lista dos últimos `dias` dias terminando em `hoje`, do mais antigo ao mais novo. */
export function ultimosDias(dias, hoje = new Date()) {
    const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12)
    const lista = []
    for (let i = dias - 1; i >= 0; i -= 1) {
        const d = new Date(base)
        d.setDate(base.getDate() - i)
        lista.push({
            chave: chaveDia(d),
            rotulo: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        })
    }
    return lista
}

/** Conta quantos instantes caem em cada dia da lista. */
export function contarPorDia(instantes, dias) {
    const contagem = new Map(dias.map((d) => [d.chave, 0]))
    for (const v of instantes || []) {
        const k = v ? chaveDia(v) : null
        if (k && contagem.has(k)) contagem.set(k, contagem.get(k) + 1)
    }
    return dias.map((d) => contagem.get(d.chave))
}

/**
 * Monta o resumo a partir de linhas já lidas (função pura, fácil de testar).
 * @param {{credenciadoEm?: string[], canceladoEm?: string[], cards?: {coluna: string, atualizado_em: string}[]}} dados
 */
export function montarResumo(dados, { dias = 14, hoje = new Date() } = {}) {
    const lista = ultimosDias(dias, hoje)
    const cards = (dados?.cards || []).filter((c) => ETAPAS_EM_PROCESSO.some((e) => e.id === c.coluna))
    const credenciados = contarPorDia(dados?.credenciadoEm, lista)
    const cancelados = contarPorDia(dados?.canceladoEm, lista)
    const soma = (arr) => arr.reduce((a, b) => a + b, 0)
    // Total em processo em cada dia (estimativa): cards que hoje estão nas etapas de cadastro e já existiam no dia,
    // mais quem saiu do funil depois (credenciados e cancelados), que ainda estava em processo naquele dia.
    const saidas = credenciados.map((v, i) => v + cancelados[i])
    const emProcesso = lista.map((d, i) => {
        const fimDoDia = new Date(`${d.chave}T23:59:59.999`).getTime()
        const presentes = cards.filter((c) => !c.criado_em || new Date(c.criado_em).getTime() <= fimDoDia).length
        return presentes + soma(saidas.slice(i + 1))
    })
    return {
        dias: lista,
        series: { credenciados, cancelados, emProcesso },
        totais: { credenciados: soma(credenciados), cancelados: soma(cancelados) },
        emProcesso: {
            total: cards.length,
            etapas: ETAPAS_EM_PROCESSO.map((e) => ({
                ...e,
                quantidade: cards.filter((c) => c.coluna === e.id).length,
            })),
        },
    }
}

/** Lê o necessário no Supabase e devolve o resumo. Quem não tem acesso recebe erro (a tela esconde o gráfico). */
export async function carregarResumoCredenciamento({ dias = 14 } = {}) {
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    desde.setHours(0, 0, 0, 0)
    const desdeIso = desde.toISOString()

    const [rCred, rSit, rCards] = await Promise.all([
        supabase.from('prestadores').select('credenciado_em').gte('credenciado_em', desdeIso).limit(LIMITE_LINHAS),
        supabase.from('situacoes').select('id, descricao'),
        supabase
            .from('cred_kanban_cards')
            .select('coluna, atualizado_em, criado_em')
            .in(
                'coluna',
                ETAPAS_EM_PROCESSO.map((e) => e.id),
            )
            .limit(LIMITE_LINHAS),
    ])
    if (rCred.error) throw new Error(rCred.error.message)
    if (rCards.error) throw new Error(rCards.error.message)

    let canceladoEm = []
    const idCancelado = acharSituacaoCanceladoId(rSit.data || [])
    if (idCancelado) {
        const rCanc = await supabase
            .from('prestadores')
            .select('data_atualizacao')
            .eq('situacao_id', Number(idCancelado))
            .gte('data_atualizacao', desdeIso)
            .limit(LIMITE_LINHAS)
        if (!rCanc.error) canceladoEm = (rCanc.data || []).map((r) => r.data_atualizacao)
    }

    return montarResumo(
        {
            credenciadoEm: (rCred.data || []).map((r) => r.credenciado_em),
            canceladoEm,
            cards: rCards.data || [],
        },
        { dias },
    )
}
