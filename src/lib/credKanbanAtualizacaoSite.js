/**
 * Diffs de perfil → card Kanban «Adicionar em SITE».
 */

import { supabase } from './supabase.js'
import {
    situacaoDescricaoEhCancelado,
    situacaoDescricaoEhCredenciado,
} from './prestadorCadastroHelpers.js'
import {
    atualizarCardKanban,
    criarCardKanban,
    especialidadeVisivelKanban,
    mapearCardRow,
    normalizarColunaKanban,
} from './credKanban.js'

const COLS =
    'id, coluna, ordem, nome, uf, cidade, telefone, tipo, prestador_id, prospecto_osm_id, atribuido_a, corpo, checklist, criado_em, atualizado_em, criado_por'

const CAMPOS_DADOS_SITE = [
    { key: 'telefone', rotulo: 'Telefone' },
    { key: 'celular', rotulo: 'Celular' },
    { key: 'email', rotulo: 'E-mail' },
    { key: 'cep', rotulo: 'CEP' },
    { key: 'endereco_logradouro', rotulo: 'Logradouro' },
    { key: 'endereco_numero', rotulo: 'Número' },
    { key: 'endereco_complemento', rotulo: 'Complemento' },
    { key: 'endereco_bairro', rotulo: 'Bairro' },
    { key: 'endereco_cidade', rotulo: 'Cidade' },
    { key: 'endereco_uf', rotulo: 'UF' },
]

function normTxt(v) {
    return String(v ?? '').trim()
}

function normCodigo(c) {
    return String(c || '')
        .trim()
        .toUpperCase()
}

function dataHoraCurta(iso = new Date().toISOString()) {
    try {
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return iso
    }
}

function rotuloProc(codigo, mapaNome) {
    const cod = normCodigo(codigo)
    const nome = mapaNome?.get?.(cod)
    if (nome) return `${cod} — ${nome}`
    return cod || '—'
}

/**
 * @param {string[]} antesCodigos
 * @param {string[]} depoisCodigos
 * @param {Map<string, string>} [mapaNomePorCodigo]
 * @returns {string|null}
 */
export function montarBlocoAtualizacaoProcedimentos(antesCodigos, depoisCodigos, mapaNomePorCodigo) {
    const antes = new Set((antesCodigos || []).map(normCodigo).filter(Boolean))
    const depois = new Set((depoisCodigos || []).map(normCodigo).filter(Boolean))
    const entrou = [...depois].filter((c) => !antes.has(c)).sort()
    const saiu = [...antes].filter((c) => !depois.has(c)).sort()
    if (!entrou.length && !saiu.length) return null

    const linhas = ['**Atualização de procedimentos**']
    if (entrou.length) {
        linhas.push(`Entrou: ${entrou.map((c) => rotuloProc(c, mapaNomePorCodigo)).join('; ')}`)
    }
    if (saiu.length) {
        linhas.push(`Saiu: ${saiu.map((c) => rotuloProc(c, mapaNomePorCodigo)).join('; ')}`)
    }
    return linhas.join('\n')
}

/**
 * Contato + endereço relevantes para o site.
 * @returns {string|null}
 */
export function montarBlocoAtualizacaoDados(antes = {}, depois = {}) {
    const mudancas = []
    for (const { key, rotulo } of CAMPOS_DADOS_SITE) {
        const a = normTxt(antes[key])
        const b = normTxt(depois[key])
        if (a === b) continue
        mudancas.push(`${rotulo}: «${a || '—'}» → «${b || '—'}»`)
    }
    if (!mudancas.length) return null
    return ['**Atualização de dados**', ...mudancas].join('\n')
}

/**
 * Só Credenciado / Cancelado (fila do site).
 * @returns {string|null}
 */
export function montarBlocoAtualizacaoSituacao(situacaoIdAntes, situacaoIdDepois, situacoes = []) {
    const a = Number(situacaoIdAntes)
    const b = Number(situacaoIdDepois)
    if (!Number.isFinite(b) || b <= 0 || a === b) return null

    const descAntes =
        (situacoes || []).find((s) => Number(s.id) === a)?.descricao || (a ? `#${a}` : '—')
    const descDepois =
        (situacoes || []).find((s) => Number(s.id) === b)?.descricao || (b ? `#${b}` : '—')

    const alvoSite =
        situacaoDescricaoEhCredenciado(descDepois) || situacaoDescricaoEhCancelado(descDepois)
    if (!alvoSite) return null

    return `**Atualização de situação**\n${descAntes} → ${descDepois}`
}

/** Carrega nomes de procedimentos pelos códigos (para o texto do card). */
export async function mapaNomeProcedimentoPorCodigo(codigos) {
    const unicos = [...new Set((codigos || []).map(normCodigo).filter(Boolean))]
    const mapa = new Map()
    if (!unicos.length) return mapa
    const { data, error } = await supabase.from('procedimentos').select('codigo, nome').in('codigo', unicos)
    if (error) return mapa
    for (const row of data || []) {
        const cod = normCodigo(row.codigo)
        const nome = normTxt(row.nome)
        if (cod && nome) mapa.set(cod, nome)
    }
    return mapa
}

function prependCorpo(existente, blocoNovo) {
    const novo = normTxt(blocoNovo)
    if (!novo) return String(existente || '')
    const cabecalho = `— ${dataHoraCurta()} —\n${novo}`
    const velho = normTxt(existente)
    if (!velho) return cabecalho
    return `${cabecalho}\n\n${velho}`
}

async function buscarCardPorPrestador(prestadorId) {
    const pid = Number(prestadorId)
    if (!Number.isFinite(pid) || pid <= 0) return null
    const { data: rows, error } = await supabase
        .from('cred_kanban_cards')
        .select(COLS)
        .eq('prestador_id', pid)
        .order('id', { ascending: true })
        .limit(1)
    if (error) {
        if (/cred_kanban_cards|schema cache|does not exist/i.test(String(error.message || ''))) {
            return null
        }
        throw new Error(error.message)
    }
    return rows?.[0] ? mapearCardRow(rows[0]) : null
}

/**
 * Garante card em «Adicionar em SITE» com descrição do que mudou.
 * Não aplica side-effects de funil (ex.: forçar no_site / situação Credenciado).
 *
 * @param {{
 *   prestadorId: number|string,
 *   nome?: string,
 *   uf?: string,
 *   cidade?: string,
 *   telefone?: string,
 *   tipo?: string,
 *   blocosDescricao?: string[],
 *   situacoes?: object[],
 *   marcarForaDoSite?: boolean,
 *   marcarNoSite?: boolean,
 * }} opts
 */
export async function garantirCardKanbanAtualizacaoSite(opts = {}) {
    const blocos = (opts.blocosDescricao || []).map(normTxt).filter(Boolean)
    if (!blocos.length) return null

    const pid = Number(opts.prestadorId)
    if (!Number.isFinite(pid) || pid <= 0) return null

    const blocoUnido = blocos.join('\n\n')
    let card = await buscarCardPorPrestador(pid)

    if (!card) {
        card = await criarCardKanban({
            coluna: 'adicionar_site',
            nome: opts.nome || 'Sem nome',
            uf: opts.uf || '',
            cidade: opts.cidade || '',
            telefone: opts.telefone || '',
            tipo: especialidadeVisivelKanban(opts.tipo) || '',
            prestadorId: pid,
            corpo: prependCorpo('', blocoUnido),
        })
    } else {
        const patch = {
            corpo: prependCorpo(card.corpo, blocoUnido),
            nome: opts.nome || card.nome,
        }
        if (opts.telefone != null && normTxt(opts.telefone)) patch.telefone = opts.telefone
        if (opts.cidade != null && normTxt(opts.cidade)) patch.cidade = opts.cidade
        if (opts.uf != null && normTxt(opts.uf)) patch.uf = opts.uf
        if (opts.tipo != null) patch.tipo = especialidadeVisivelKanban(opts.tipo) || card.tipo

        if (normalizarColunaKanban(card.coluna) !== 'adicionar_site') {
            const { data: maxRows } = await supabase
                .from('cred_kanban_cards')
                .select('ordem')
                .eq('coluna', 'adicionar_site')
                .order('ordem', { ascending: false })
                .limit(1)
            patch.coluna = 'adicionar_site'
            patch.ordem = (Number(maxRows?.[0]?.ordem) || 0) + 1
        }
        card = await atualizarCardKanban(card.id, patch)
    }

    if (opts.marcarForaDoSite) {
        await supabase
            .from('prestadores')
            .update({ no_site: false, data_atualizacao: new Date().toISOString() })
            .eq('id', pid)
    } else if (opts.marcarNoSite) {
        await supabase
            .from('prestadores')
            .update({ no_site: true, data_atualizacao: new Date().toISOString() })
            .eq('id', pid)
    }

    return card
}

/**
 * Monta blocos a partir do antes/depois do save e garante o card SITE.
 */
export async function notificarKanbanAtualizacaoPerfil({
    prestadorId,
    nome,
    uf,
    cidade,
    telefone,
    tipo,
    situacoes = [],
    antes = {},
    depois = {},
    procsAntes = [],
    procsDepois = [],
} = {}) {
    const mapaNomes = await mapaNomeProcedimentoPorCodigo([...(procsAntes || []), ...(procsDepois || [])])
    const blocos = [
        montarBlocoAtualizacaoProcedimentos(procsAntes, procsDepois, mapaNomes),
        montarBlocoAtualizacaoDados(antes, depois),
        montarBlocoAtualizacaoSituacao(antes.situacao_id, depois.situacao_id, situacoes),
    ].filter(Boolean)

    if (!blocos.length) return null

    const descAntes = (situacoes || []).find((s) => Number(s.id) === Number(antes.situacao_id))?.descricao
    const descNova = (situacoes || []).find((s) => Number(s.id) === Number(depois.situacao_id))?.descricao
    const marcarForaDoSite = situacaoDescricaoEhCancelado(descNova)
    const marcarNoSite =
        situacaoDescricaoEhCredenciado(descNova) && !situacaoDescricaoEhCredenciado(descAntes)

    return garantirCardKanbanAtualizacaoSite({
        prestadorId,
        nome,
        uf,
        cidade,
        telefone,
        tipo,
        blocosDescricao: blocos,
        situacoes,
        marcarForaDoSite,
        marcarNoSite,
    })
}
