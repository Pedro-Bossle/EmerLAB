/**
 * Cliente do repasse mensal: chamadas a /api/repasse-mensal (rotas públicas por token e internas por JWT)
 * e leituras diretas das tabelas repasse_* (RLS por permissão de Pagamentos).
 */
import { supabase } from '../supabase.js'

export const BUCKET_REPASSE = 'repasse-documentos'

async function authHeaders() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return { Authorization: `Bearer ${token}` }
}

async function chamar(rota, corpo, { publico = false } = {}) {
    const headers = { 'Content-Type': 'application/json', ...(publico ? {} : await authHeaders()) }
    const resp = await fetch(`/api/repasse-mensal?_route=${encodeURIComponent(rota)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(corpo || {}),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok || json?.ok === false) {
        const err = new Error(json?.error || `Falha na API do repasse (${resp.status}).`)
        err.status = resp.status
        throw err
    }
    return json
}

// ---- públicas (token) ----
export const publicoLer = (token) => chamar('publico-ler', { token }, { publico: true })
export const publicoAprovar = (token) => chamar('publico-aprovar', { token }, { publico: true })
export const publicoReprovar = (token, observacao, canal) =>
    chamar('publico-reprovar', { token, observacao, canal }, { publico: true })
export const publicoComprovante = (token) => chamar('publico-comprovante', { token }, { publico: true })

/** Sobe NF/boleto (URL assinada) e registra o documento. */
export async function publicoEnviarDocumento(token, arquivo, { numero, vencimento, valor }) {
    const prep = await chamar('publico-upload-url', { token, nome: arquivo.name, tamanho: arquivo.size }, { publico: true })
    const { error } = await supabase.storage.from(BUCKET_REPASSE).uploadToSignedUrl(prep.path, prep.uploadToken, arquivo)
    if (error) throw new Error('Não foi possível enviar o arquivo. Tente novamente.')
    return chamar('publico-documento', { token, path: prep.path, numero, vencimento, valor }, { publico: true })
}

// ---- internas (JWT) ----
export const criarRelatorios = (itens) => chamar('criar-relatorios', { itens })
export const linkDoRelatorio = (relatorio_id) => chamar('link', { relatorio_id })
export const planejarEnvio = (dados) => chamar('planejar-envio', dados)
export const enviarLote = (envio_id, itens) => chamar('enviar-lote', { envio_id, itens })
export const cancelarAgendamento = (relatorio_ids) => chamar('cancelar-agendamento', { relatorio_ids })
export const revisarDocumento = (documento_id, acao, motivo) =>
    chamar('revisar-documento', { documento_id, acao, motivo })
export const marcarTratado = (relatorio_id) => chamar('marcar-tratado', { relatorio_id })
export const revogarLink = (relatorio_id) => chamar('revogar-link', { relatorio_id })
export const novoLink = (relatorio_id) => chamar('novo-link', { relatorio_id })
export const urlArquivo = (ids) => chamar('url-arquivo', ids)

export async function enviarComprovante(relatorio_id, arquivo, { data_pagamento, valor }) {
    const prep = await chamar('upload-url', { relatorio_id, nome: arquivo.name, tamanho: arquivo.size })
    const { error } = await supabase.storage.from(BUCKET_REPASSE).uploadToSignedUrl(prep.path, prep.uploadToken, arquivo)
    if (error) throw new Error('Não foi possível enviar o arquivo do comprovante.')
    return chamar('enviar-comprovante', { relatorio_id, path: prep.path, data_pagamento, valor })
}

/** Um comprovante para vários relatórios do mesmo prestador (o arquivo sobe pelo primeiro relatório). */
export async function enviarComprovanteLote(relatorio_ids, arquivo, { data_pagamento, valor }) {
    const prep = await chamar('upload-url', { relatorio_id: relatorio_ids[0], nome: arquivo.name, tamanho: arquivo.size })
    const { error } = await supabase.storage.from(BUCKET_REPASSE).uploadToSignedUrl(prep.path, prep.uploadToken, arquivo)
    if (error) throw new Error('Não foi possível enviar o arquivo do comprovante.')
    return chamar('enviar-comprovante-lote', { relatorio_ids, path: prep.path, data_pagamento, valor })
}

export const desfazerPagamento = (relatorio_id, motivo) => chamar('desfazer-pagamento', { relatorio_id, motivo })

// ---- leituras diretas (RLS) ----
const COLUNAS_LISTA =
    'id, registro_id, prestador_id, mes, ano, aba_nome, nome_a1, total_repasse, total_tutor, soma_linhas_repasse, divergente, fluxo, status, agendado_para, enviado_em, visualizado_em, respondido_em, token_revogado_em, token_expira_em, criado_em'

/** Relatórios (sem o JSON pesado) dos registros informados, indexados por registro_id. */
export async function listarRelatoriosPorRegistros(registroIds) {
    const ids = [...new Set(registroIds)].filter(Boolean)
    const mapa = new Map()
    for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase
            .from('repasse_relatorios')
            .select(COLUNAS_LISTA)
            .in('registro_id', ids.slice(i, i + 150))
        if (error) throw new Error(error.message)
        for (const r of data || []) mapa.set(r.registro_id, r)
    }
    const relIds = [...mapa.values()].map((r) => r.id)
    for (let i = 0; i < relIds.length; i += 150) {
        const { data: comps } = await supabase
            .from('repasse_comprovantes')
            .select('id, relatorio_id, data_pagamento, enviado_em')
            .in('relatorio_id', relIds.slice(i, i + 150))
            .order('enviado_em', { ascending: false })
        for (const c of comps || []) {
            const rel = [...mapa.values()].find((r) => r.id === c.relatorio_id)
            if (rel && !rel.comprovante) rel.comprovante = c
        }
    }
    return mapa
}

export async function lerConfigRepasse() {
    const { data } = await supabase.from('repasse_config').select('*').eq('id', 1).maybeSingle()
    return {
        email_reprovacoes: 'pedro@emerdog.com.br',
        whatsapp_financeiro: '555499041695',
        validade_link_dias: 60,
        remetente_nome: 'Emerdog Financeiro',
        competencia_inicial: '2026-10',
        ...(data || {}),
    }
}

export async function salvarConfigRepasse(cfg) {
    const { error } = await supabase
        .from('repasse_config')
        .upsert({ id: 1, ...cfg, atualizado_em: new Date().toISOString() })
    if (error) throw new Error(error.message)
}

/** Dados da Caixa de entrada. */
export async function carregarCaixa() {
    const { data: docs, error: e1 } = await supabase
        .from('repasse_documentos')
        .select('id, relatorio_id, tipo, numero, vencimento, valor, status, motivo_devolucao, criado_em')
        .in('status', ['em_revisao', 'devolvido'])
        .order('criado_em', { ascending: true })
    if (e1) throw new Error(e1.message)
    const { data: reprov, error: e2 } = await supabase
        .from('repasse_relatorios')
        .select(COLUNAS_LISTA)
        .eq('status', 'reprovado')
        .order('respondido_em', { ascending: true })
    if (e2) throw new Error(e2.message)
    const relIds = [...new Set([...(docs || []).map((d) => d.relatorio_id), ...(reprov || []).map((r) => r.id)])]
    const rels = new Map()
    const regs = new Map()
    const obs = new Map()
    if (relIds.length) {
        const { data: rl } = await supabase.from('repasse_relatorios').select(COLUNAS_LISTA).in('id', relIds)
        for (const r of rl || []) rels.set(r.id, r)
        const regIds = [...new Set((rl || []).map((r) => r.registro_id))]
        const { data: rg } = await supabase.from('pagamentos_registros').select('id, prestador_nome, tipo_repasse').in('id', regIds)
        for (const r of rg || []) regs.set(r.id, r)
        const { data: ev } = await supabase
            .from('repasse_eventos')
            .select('relatorio_id, dados, criado_em')
            .eq('tipo', 'reprovado')
            .in('relatorio_id', relIds)
            .order('criado_em', { ascending: false })
        for (const e of ev || []) if (!obs.has(e.relatorio_id)) obs.set(e.relatorio_id, e)
    }
    return { docs: docs || [], reprovados: reprov || [], rels, regs, obs }
}

/** Contagem de pendências da Caixa (para o menu). */
export async function contarPendenciasCaixa() {
    const [{ count: a }, { count: b }] = await Promise.all([
        supabase.from('repasse_documentos').select('id', { count: 'exact', head: true }).eq('status', 'em_revisao'),
        supabase.from('repasse_relatorios').select('id', { count: 'exact', head: true }).eq('status', 'reprovado'),
    ])
    return (a || 0) + (b || 0)
}

export async function lerRelatorioCompleto(relatorioId) {
    const { data, error } = await supabase.from('repasse_relatorios').select('*').eq('id', relatorioId).maybeSingle()
    if (error) throw new Error(error.message)
    return data
}

/** Registros (todas as competências) de um prestador, do mais antigo ao mais novo. */
export async function listarRegistrosDoPrestador(prestadorId) {
    const { data, error } = await supabase
        .from('pagamentos_registros')
        .select('*')
        .eq('prestador_id', prestadorId)
        .order('ano', { ascending: true })
        .order('mes', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

/** Documentos (NF/boleto) em revisão, indexados por relatorio_id. */
export async function listarDocumentosEmRevisao(relatorioIds) {
    const ids = [...new Set(relatorioIds)].filter(Boolean)
    const mapa = new Map()
    for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase
            .from('repasse_documentos')
            .select('id, relatorio_id, tipo, numero, vencimento, valor, status, criado_em')
            .eq('status', 'em_revisao')
            .in('relatorio_id', ids.slice(i, i + 150))
        if (error) throw new Error(error.message)
        for (const d of data || []) mapa.set(d.relatorio_id, d)
    }
    return mapa
}

let cacheAbertos = { em: 0, mapa: null, promessa: null }

/**
 * Quantidade de meses não pagos por prestador (todas as competências), indexada por prestador_id (string).
 * Reaproveita o resultado por 20 s e junta chamadas simultâneas, para não repetir a consulta a cada render.
 */
export function contarMesesEmAbertoPorPrestador({ forcar = false } = {}) {
    const agora = Date.now()
    if (!forcar && cacheAbertos.mapa && agora - cacheAbertos.em < 20000) return Promise.resolve(cacheAbertos.mapa)
    if (!forcar && cacheAbertos.promessa) return cacheAbertos.promessa
    const promessa = (async () => {
        const mapa = new Map()
        for (let de = 0; ; de += 1000) {
            const { data, error } = await supabase
                .from('pagamentos_registros')
                .select('prestador_id')
                .eq('pago', false)
                .not('prestador_id', 'is', null)
                .range(de, de + 999)
            if (error) throw new Error(error.message)
            for (const r of data || []) {
                const k = String(r.prestador_id)
                mapa.set(k, (mapa.get(k) || 0) + 1)
            }
            if (!data || data.length < 1000) break
        }
        cacheAbertos = { em: Date.now(), mapa, promessa: null }
        return mapa
    })()
    cacheAbertos.promessa = promessa
    promessa.catch(() => {
        cacheAbertos.promessa = null
    })
    return promessa
}
