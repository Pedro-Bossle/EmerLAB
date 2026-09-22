import { supabase } from '../supabase.js'
import {
    categoriaMapsIrrelevante,
    formatarNotaMaps,
    resolverCidadeProspectoMaps,
    ufFromEndereco,
    unifyContato,
} from './emerRadarUi.js'

const TABELA = 'cred_prospectos_maps'

export const STATUS_PROSPECCAO_MAPS_OPCOES = [
    { id: 'novo', label: 'Novo' },
    { id: 'contactado', label: 'Contactado' },
    { id: 'descartado', label: 'Descartado' },
    { id: 'credenciado', label: 'Credenciado' },
]

/** Hash estável quando o worker não manda `id`. */
export function mapsIdDeEstabelecimento(est) {
    const direto = String(est?.id || est?.maps_id || '').trim()
    if (direto) return direto
    const base = [est?.nome, est?.endereco, est?.cidade, est?.uf, est?.link_maps, est?.telefone]
        .map((s) => String(s || '').trim().toLowerCase())
        .join('|')
    let h = 0
    for (let i = 0; i < base.length; i += 1) {
        h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
    }
    return `gen_${(h >>> 0).toString(16)}`
}

function parseCoord(v) {
    if (v == null || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

/** Rua/Av. com número costuma ser scrape completo; "Bairro, Cidade - UF" é parcial. */
function enderecoMapsMaisEspecifico(candidato, atual) {
    const a = String(candidato || '').trim()
    const b = String(atual || '').trim()
    if (!a) return false
    if (!b) return true
    if (a === b) return false
    const temVia = (s) =>
        /\b(rua|r\.|av\.|avenida|travessa|alameda|estrada|rodovia|praça|praca)\b/i.test(s) ||
        /\d{1,5}\b/.test(s)
    const score = (s) => (temVia(s) ? 2 : 0) + Math.min(s.length, 120) / 120
    return score(a) > score(b) + 0.15
}

/**
 * Mapeia resultado do worker → linha DB.
 * Nunca inclui `imagem` (fachada fica só na sessão da busca).
 */
export function mapearEstabelecimentoMapsParaRow(est, { cidadePadrao = '', ufPadrao = '' } = {}) {
    const mapsId = mapsIdDeEstabelecimento(est)
    const lat = parseCoord(est?.latitude ?? est?.lat)
    const lng = parseCoord(est?.longitude ?? est?.lng ?? est?.lon)
    const website = String(est?.website || est?.site || '').trim()
    const telRaw = String(est?.telefone || '').trim()
    const waRaw = String(est?.whatsapp || '').trim()
    const telefoneUnificado = unifyContato(telRaw, waRaw) || telRaw || waRaw || ''
    const endereco = String(est?.endereco || '').trim()
    const cidade = resolverCidadeProspectoMaps(est, { cidadePadrao })
    const ufWorker = String(est?.uf || '')
        .trim()
        .toUpperCase()
        .slice(0, 2)
    const uf = ufWorker || ufFromEndereco(endereco, ufPadrao)
    let categoria = String(est?.categoria || est?.tipo || est?.especialidade || '').trim()
    if (categoriaMapsIrrelevante(categoria)) categoria = ''
    const notaBruta = est?.nota != null ? String(est.nota).trim() : ''
    return {
        maps_id: mapsId,
        nome: String(est?.nome || '').trim() || 'Sem nome',
        endereco,
        cidade,
        uf,
        telefone: telefoneUnificado,
        whatsapp: waRaw || (telefoneUnificado && telefoneUnificado !== telRaw ? telefoneUnificado : ''),
        horario: String(est?.horario || '').trim(),
        horario_detalhado: String(est?.horario_detalhado || '').trim(),
        nota: formatarNotaMaps(notaBruta) || notaBruta,
        num_avaliacoes: est?.num_avaliacoes != null ? String(est.num_avaliacoes).trim() : '',
        categoria,
        lat,
        lng,
        link_maps: String(est?.link_maps || '').trim(),
        website,
        termo_busca: String(est?.termo_busca || '').trim(),
        tags: (() => {
            const tags = { fonte: 'emer_radar_maps' }
            if (Array.isArray(est?.planos) && est.planos.length) tags.planos = est.planos
            if (Array.isArray(est?.origens) && est.origens.length) tags.origens = est.origens
            return tags
        })(),
        atualizado_em: new Date().toISOString(),
    }
}

/**
 * Shape de card da UI a partir da linha salva (sem imagem).
 */
export function rowMapsParaCardUi(row) {
    if (!row) return null
    const telefone = unifyContato(row.telefone, row.whatsapp) || row.telefone || row.whatsapp || ''
    const categoria = categoriaMapsIrrelevante(row.categoria) ? '' : row.categoria || ''
    return {
        id: row.maps_id || row.id,
        maps_db_id: row.id,
        maps_id: row.maps_id,
        nome: row.nome,
        endereco: row.endereco,
        cidade: row.cidade,
        uf: row.uf,
        telefone,
        whatsapp: row.whatsapp || '',
        horario: row.horario || '',
        horario_detalhado: row.horario_detalhado || '',
        nota: formatarNotaMaps(row.nota) || row.nota || '',
        num_avaliacoes: row.num_avaliacoes || '',
        categoria,
        latitude: row.lat != null ? String(row.lat) : '',
        longitude: row.lng != null ? String(row.lng) : '',
        link_maps: row.link_maps || '',
        website: row.website || '',
        site: row.website || '',
        termo_busca: row.termo_busca || '',
        status_prospeccao: row.status_prospeccao || 'novo',
        observacao: row.observacao || '',
        imagem: null,
        _salvo: true,
    }
}

/**
 * @param {{ uf?: string, cidade?: string, status?: string, busca?: string, limite?: number, incluirDescartados?: boolean }} filtros
 */
export async function listarProspectosMaps(filtros = {}) {
    let q = supabase.from(TABELA).select('*').order('nome', { ascending: true })
    const limite = Math.min(Math.max(Number(filtros.limite) || 500, 1), 2000)
    q = q.limit(limite)

    const uf = String(filtros.uf || '').trim()
    const cidade = String(filtros.cidade || '').trim()
    const status = String(filtros.status || '').trim()
    const busca = String(filtros.busca || '').trim()

    if (uf) q = q.ilike('uf', uf)
    if (cidade) q = q.ilike('cidade', `%${cidade}%`)
    if (status) q = q.eq('status_prospeccao', status)
    else if (!filtros.incluirDescartados) q = q.neq('status_prospeccao', 'descartado')
    if (busca) {
        const t = busca.replace(/%/g, '').replace(/,/g, ' ')
        q = q.or(`nome.ilike.%${t}%,endereco.ilike.%${t}%,telefone.ilike.%${t}%,categoria.ilike.%${t}%`)
    }

    const { data, error } = await q
    if (error) return { ok: false, erro: error.message, itens: [] }
    return { ok: true, itens: data || [] }
}

export async function listarCidadesUfProspectosMaps() {
    const { data, error } = await supabase.from(TABELA).select('cidade, uf')
    if (error) return { ok: false, erro: error.message, pares: [] }
    const set = new Map()
    for (const row of data || []) {
        const c = String(row.cidade || '').trim()
        const u = String(row.uf || '').trim()
        if (!c) continue
        set.set(`${c}|${u}`, { cidade: c, uf: u })
    }
    return {
        ok: true,
        pares: [...set.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR')),
    }
}

/**
 * Agrupa prospectos filtrados em jobs de re-busca por cidade/UF.
 * @param {object[]} itens
 * @param {{ termosPadrao?: string[], maxResultsPadrao?: number }} [opts]
 * @returns {{ ok: boolean, erro?: string, jobs: Array<{ cidade: string, uf: string, termos: string[], max_results: number, prospectos: number }>, totalProspectos: number }}
 */
export function montarFilaAtualizacaoCatalogo(itens, opts = {}) {
    const termosPadrao = Array.isArray(opts.termosPadrao) && opts.termosPadrao.length
        ? opts.termosPadrao
        : ['veterinário']
    const maxPadrao = Math.min(Math.max(Number(opts.maxResultsPadrao) || 80, 20), 150)
    const lista = Array.isArray(itens) ? itens : []
    const byCity = new Map()

    for (const est of lista) {
        const cidade = String(est?.cidade || '').trim()
        const uf = String(est?.uf || '')
            .trim()
            .toUpperCase()
            .slice(0, 2)
        if (!cidade || !uf) continue
        const key = `${uf}|${cidade.toLowerCase()}`
        if (!byCity.has(key)) {
            byCity.set(key, { cidade, uf, termos: new Set(), count: 0 })
        }
        const g = byCity.get(key)
        g.count += 1
        const termo = String(est?.termo_busca || '').trim()
        if (termo) g.termos.add(termo)
    }

    if (!byCity.size) {
        return {
            ok: false,
            erro: 'Nenhum filtrado com cidade e UF. Ajuste os filtros ou complete cidade/UF nos registros.',
            jobs: [],
            totalProspectos: 0,
        }
    }

    const jobs = [...byCity.values()]
        .sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR') || a.uf.localeCompare(b.uf))
        .map((g) => ({
            cidade: g.cidade,
            uf: g.uf,
            termos: g.termos.size ? [...g.termos] : [...termosPadrao],
            max_results: Math.min(Math.max(g.count + 25, 40, maxPadrao), 150),
            prospectos: g.count,
        }))

    return {
        ok: true,
        jobs,
        totalProspectos: jobs.reduce((acc, j) => acc + j.prospectos, 0),
    }
}

/**
 * Upsert em lote dos resultados da coleta. Omite imagens.
 * @param {object[]} estabelecimentos
 * @param {{ cidade?: string, uf?: string, preferirNovos?: boolean }} [ctx]
 */
export async function upsertProspectosMapsDeColeta(estabelecimentos, ctx = {}) {
    const lista = Array.isArray(estabelecimentos) ? estabelecimentos : []
    if (!lista.length) return { ok: true, salvos: 0, itens: [] }
    const preferirNovos = Boolean(ctx.preferirNovos)

    const rows = []
    const visto = new Set()
    for (const est of lista) {
        const row = mapearEstabelecimentoMapsParaRow(est, {
            cidadePadrao: ctx.cidade,
            ufPadrao: ctx.uf,
        })
        if (!row.maps_id || visto.has(row.maps_id)) continue
        visto.add(row.maps_id)
        rows.push(row)
    }
    if (!rows.length) return { ok: true, salvos: 0, itens: [] }

    // Não sobrescrever campos já salvos com vazio em re-coleta
    const ids = rows.map((r) => r.maps_id)
    const { data: existentes } = await supabase
        .from(TABELA)
        .select(
            'maps_id, telefone, whatsapp, horario, horario_detalhado, endereco, nota, num_avaliacoes, categoria, link_maps, website, lat, lng, cidade, uf, status_prospeccao',
        )
        .in('maps_id', ids)
    const porId = new Map((existentes || []).map((r) => [String(r.maps_id), r]))
    const camposPreservar = [
        'telefone',
        'whatsapp',
        'horario',
        'horario_detalhado',
        'endereco',
        'nota',
        'num_avaliacoes',
        'categoria',
        'link_maps',
        'website',
        'cidade',
        'uf',
    ]
    for (const row of rows) {
        const ant = porId.get(String(row.maps_id))
        if (!ant) continue
        for (const campo of camposPreservar) {
            const novo = row[campo]
            const velho = ant[campo]
            const novoVazio =
                novo == null ||
                (typeof novo === 'string' && !String(novo).trim()) ||
                (typeof novo === 'number' && !Number.isFinite(novo))
            const velhoTem =
                velho != null &&
                !(typeof velho === 'string' && !String(velho).trim()) &&
                !(typeof velho === 'number' && !Number.isFinite(velho))
            // Não reaproveitar categoria absurda (ex.: escritório do governo) de scrape antigo
            if (campo === 'categoria' && novoVazio && categoriaMapsIrrelevante(velho)) {
                row.categoria = ''
                continue
            }
            // Atualização intencional: valor novo não-vazio sempre vence
            if (preferirNovos && !novoVazio) continue
            if (novoVazio && velhoTem) row[campo] = velho
        }
        // Endereço novo mais específico (rua/av.) substitui vago "Bairro, Cidade - UF"
        const endNovo = String(row.endereco || '').trim()
        const endVelho = String(ant.endereco || '').trim()
        if (endNovo && (preferirNovos || enderecoMapsMaisEspecifico(endNovo, endVelho))) {
            row.endereco = endNovo
            if (preferirNovos || !String(row.cidade || '').trim() || String(row.cidade) === String(ant.cidade)) {
                row.cidade = resolverCidadeProspectoMaps(
                    { endereco: endNovo, cidade: row.cidade },
                    { cidadePadrao: ant.cidade },
                )
            }
        }
        if (row.lat == null && ant.lat != null) row.lat = ant.lat
        if (row.lng == null && ant.lng != null) row.lng = ant.lng
        if (!String(row.telefone || '').trim()) {
            row.telefone = unifyContato(ant.telefone, ant.whatsapp) || ant.telefone || ant.whatsapp || ''
        }
        // Nunca rebaixar contactado/credenciado para o default do insert
        if (ant.status_prospeccao && ant.status_prospeccao !== 'novo') {
            row.status_prospeccao = ant.status_prospeccao
        }
    }

    const { data, error } = await supabase
        .from(TABELA)
        .upsert(rows, { onConflict: 'maps_id' })
        .select('*')

    if (error) {
        const msg = String(error.message || '')
        if (/cred_prospectos_maps|schema cache|does not exist|relation.*does not exist/i.test(msg)) {
            return {
                ok: false,
                erro: 'Tabela cred_prospectos_maps ausente. Execute scripts/sql/cred_prospectos_maps.sql no Supabase.',
                salvos: 0,
                itens: [],
            }
        }
        return { ok: false, erro: msg, salvos: 0, itens: [] }
    }

    return { ok: true, salvos: (data || []).length, itens: data || [] }
}

const CAMPOS_EDITAVEIS = new Set(['status_prospeccao', 'observacao', 'nome', 'telefone', 'endereco', 'cidade', 'uf'])

export async function atualizarProspectoMaps(id, campos = {}) {
    const payload = { atualizado_em: new Date().toISOString() }
    for (const [k, v] of Object.entries(campos || {})) {
        if (!CAMPOS_EDITAVEIS.has(k)) continue
        if (typeof v === 'string') payload[k] = v.trim()
        else if (v !== undefined) payload[k] = v
    }
    if (Object.keys(payload).length <= 1) return { ok: false, erro: 'Nenhum campo para atualizar.' }

    const { data, error } = await supabase
        .from(TABELA)
        .update(payload)
        .eq('id', id)
        .select('*')
        .maybeSingle()

    if (error) return { ok: false, erro: error.message }
    return { ok: true, item: data }
}

/** Soft delete: status descartado (some da listagem padrão). */
export async function descartarProspectoMaps(idOuMapsId) {
    const chave = String(idOuMapsId || '').trim()
    if (!chave) return { ok: false, erro: 'ID inválido.' }

    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        chave,
    )

    let q = supabase
        .from(TABELA)
        .update({ status_prospeccao: 'descartado', atualizado_em: new Date().toISOString() })
        .select('*')

    q = uuidLike ? q.eq('id', chave) : q.eq('maps_id', chave)

    const { data, error } = await q.maybeSingle()
    if (error) return { ok: false, erro: error.message }
    if (!data) return { ok: false, erro: 'Prospecto não encontrado no catálogo.' }
    return { ok: true, item: data }
}

/**
 * Cruza resultados da sessão com linhas salvas (para Remover/Kanban usarem db id).
 * Mantém `imagem` só na sessão.
 */
export function enriquecerResultadosComSalvos(resultados, salvos) {
    const byMapsId = new Map()
    for (const row of salvos || []) {
        byMapsId.set(String(row.maps_id || ''), row)
    }
    return (resultados || []).map((est) => {
        const mid = mapsIdDeEstabelecimento(est)
        const row = byMapsId.get(mid)
        if (!row) return { ...est, id: mid, maps_id: mid }
        const telefone =
            unifyContato(est.telefone || row.telefone, est.whatsapp || row.whatsapp) ||
            est.telefone ||
            row.telefone ||
            row.whatsapp ||
            ''
        return {
            ...est,
            id: mid,
            maps_id: mid,
            maps_db_id: row.id,
            telefone,
            whatsapp: est.whatsapp || row.whatsapp || '',
            endereco: est.endereco || row.endereco || '',
            cidade: est.cidade || row.cidade || '',
            uf: est.uf || row.uf || '',
            status_prospeccao: row.status_prospeccao,
            _salvo: true,
            // fachada só se ainda vier do worker nesta sessão
            imagem: est.imagem || null,
        }
    })
}
