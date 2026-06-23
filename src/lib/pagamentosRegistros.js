import { supabase } from './supabase.js'
import { normalizarTextoBusca } from './prestadorCadastroHelpers.js'

const TABELA = 'pagamentos_registros'

export function mapRowPagamento(row) {
    if (!row) return null
    return {
        id: row.id,
        mes: row.mes,
        ano: row.ano,
        prestadorId: row.prestador_id != null ? String(row.prestador_id) : '',
        prestadorNome: row.prestador_nome || '',
        tipoRepasse: row.tipo_repasse || '',
        chavePix: row.chave_pix || '',
        valor: row.valor != null ? Number(row.valor) : null,
        resposta: Boolean(row.resposta),
        pago: Boolean(row.pago),
        obs: row.obs || '',
        criadoEm: row.criado_em,
        atualizadoEm: row.atualizado_em,
    }
}

/** Chave estável para unicidade por competência (id do cadastro ou nome normalizado). */
export function chaveUnicaPrestadorCompetencia(row) {
    const id = row?.prestadorId != null ? String(row.prestadorId).trim() : ''
    if (id) return `id:${id}`
    const nome = normalizarTextoBusca(row?.prestadorNome)
    if (nome) return `nome:${nome}`
    return ''
}

export function registrosConflitamPrestadorCompetencia(a, b) {
    if (Number(a?.mes) !== Number(b?.mes) || Number(a?.ano) !== Number(b?.ano)) return false

    const idA = a?.prestadorId != null ? String(a.prestadorId).trim() : ''
    const idB = b?.prestadorId != null ? String(b.prestadorId).trim() : ''
    if (idA && idB && idA === idB) return true

    const nomeA = normalizarTextoBusca(a?.prestadorNome)
    const nomeB = normalizarTextoBusca(b?.prestadorNome)
    if (nomeA && nomeB && nomeA === nomeB) return true

    return false
}

export function encontrarDuplicataPrestadorCompetencia(registros, candidato, ignorarId = '') {
    const temIdentidade =
        (candidato?.prestadorId != null && String(candidato.prestadorId).trim()) ||
        normalizarTextoBusca(candidato?.prestadorNome)
    if (!temIdentidade) return null

    for (const r of registros || []) {
        if (ignorarId && r.id === ignorarId) continue
        if (registrosConflitamPrestadorCompetencia(candidato, r)) return r
    }
    return null
}

export function mensagemDuplicataPrestadorCompetencia(candidato) {
    const nome = String(candidato?.prestadorNome || '').trim() || 'este prestador'
    return `Já existe um registro de pagamento para «${nome}» neste mês/ano.`
}

export function compararCompetencia(mesA, anoA, mesB, anoB) {
    const ya = Number(anoA)
    const yb = Number(anoB)
    const ma = Number(mesA)
    const mb = Number(mesB)
    if (ya !== yb) return ya - yb
    return ma - mb
}

export function normalizarIntervaloCompetencia(mesDe, anoDe, mesAte, anoAte) {
    const de = { mes: Number(mesDe), ano: Number(anoDe) }
    const ate = { mes: Number(mesAte), ano: Number(anoAte) }
    if (compararCompetencia(de.mes, de.ano, ate.mes, ate.ano) > 0) {
        return { de: ate, ate: de }
    }
    return { de, ate }
}

export function registroNoIntervaloCompetencia(row, intervalo) {
    if (!row || !intervalo?.de || !intervalo?.ate) return true
    const m = Number(row.mes)
    const y = Number(row.ano)
    return (
        compararCompetencia(m, y, intervalo.de.mes, intervalo.de.ano) >= 0 &&
        compararCompetencia(m, y, intervalo.ate.mes, intervalo.ate.ano) <= 0
    )
}

function erroGravacaoPagamento(error) {
    const code = error?.code || ''
    if (code === '23505') {
        return new Error('Já existe um registro deste prestador neste mês/ano.')
    }
    return new Error(error?.message || 'Erro ao gravar pagamento.')
}

function rowParaInsert(row) {
    return {
        mes: row.mes,
        ano: row.ano,
        prestador_id: row.prestadorId ? Number(row.prestadorId) : null,
        prestador_nome: String(row.prestadorNome || '').trim(),
        tipo_repasse: row.tipoRepasse || null,
        chave_pix: row.chavePix || null,
        valor: row.valor != null ? row.valor : null,
        resposta: Boolean(row.resposta),
        pago: Boolean(row.pago),
        obs: row.obs || null,
        atualizado_em: new Date().toISOString(),
    }
}

export async function listarPagamentosRegistros({ mes, ano } = {}) {
    let q = supabase.from(TABELA).select('*')
    if (mes != null) q = q.eq('mes', mes)
    if (ano != null) q = q.eq('ano', ano)
    if (mes == null && ano == null) {
        q = q.order('ano', { ascending: false }).order('mes', { ascending: false })
    }
    q = q.order('criado_em', { ascending: true })
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data || []).map(mapRowPagamento)
}

export async function listarPagamentosRegistrosIntervalo(mesDe, anoDe, mesAte, anoAte) {
    const intervalo = normalizarIntervaloCompetencia(mesDe, anoDe, mesAte, anoAte)
    const todos = await listarPagamentosRegistros()
    return todos.filter((r) => registroNoIntervaloCompetencia(r, intervalo))
}

export async function inserirPagamentoRegistro(row) {
    const payload = rowParaInsert(row)
    const { data, error } = await supabase.from(TABELA).insert(payload).select('*').single()
    if (error) throw erroGravacaoPagamento(error)
    return mapRowPagamento(data)
}

export async function inserirPagamentosRegistrosEmLote(rows) {
    if (!rows?.length) return []
    const payload = rows.map((r) => rowParaInsert(r))
    const { data, error } = await supabase.from(TABELA).insert(payload).select('*')
    if (error) throw erroGravacaoPagamento(error)
    return (data || []).map(mapRowPagamento)
}

export async function atualizarPagamentoRegistro(id, patch) {
    const base = rowParaInsert({
        mes: patch.mes,
        ano: patch.ano,
        prestadorId: patch.prestadorId,
        prestadorNome: patch.prestadorNome,
        tipoRepasse: patch.tipoRepasse,
        chavePix: patch.chavePix,
        valor: patch.valor,
        resposta: patch.resposta,
        pago: patch.pago,
        obs: patch.obs,
    })
    const { data, error } = await supabase.from(TABELA).update(base).eq('id', id).select('*').single()
    if (error) throw erroGravacaoPagamento(error)
    return mapRowPagamento(data)
}

export async function excluirPagamentoRegistro(id) {
    const { error } = await supabase.from(TABELA).delete().eq('id', id)
    if (error) throw new Error(error.message)
}
