import { supabase } from '../supabase.js'

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

/**
 * Mapeia resultado do worker → linha DB.
 * Nunca inclui `imagem` (fachada fica só na sessão da busca).
 */
export function mapearEstabelecimentoMapsParaRow(est, { cidadePadrao = '', ufPadrao = '' } = {}) {
    const mapsId = mapsIdDeEstabelecimento(est)
    const lat = parseCoord(est?.latitude ?? est?.lat)
    const lng = parseCoord(est?.longitude ?? est?.lng ?? est?.lon)
    const website = String(est?.website || est?.site || '').trim()
    return {
        maps_id: mapsId,
        nome: String(est?.nome || '').trim() || 'Sem nome',
        endereco: String(est?.endereco || '').trim(),
        cidade: String(est?.cidade || cidadePadrao || '').trim(),
        uf: String(est?.uf || ufPadrao || '')
            .trim()
            .toUpperCase()
            .slice(0, 2),
        telefone: String(est?.telefone || '').trim(),
        whatsapp: String(est?.whatsapp || '').trim(),
        horario: String(est?.horario || '').trim(),
        horario_detalhado: String(est?.horario_detalhado || '').trim(),
        nota: est?.nota != null ? String(est.nota).trim() : '',
        num_avaliacoes: est?.num_avaliacoes != null ? String(est.num_avaliacoes).trim() : '',
        categoria: String(est?.categoria || est?.tipo || est?.especialidade || '').trim(),
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
    return {
        id: row.maps_id || row.id,
        maps_db_id: row.id,
        maps_id: row.maps_id,
        nome: row.nome,
        endereco: row.endereco,
        cidade: row.cidade,
        uf: row.uf,
        telefone: row.telefone || row.whatsapp || '',
        whatsapp: row.whatsapp || '',
        horario: row.horario || '',
        horario_detalhado: row.horario_detalhado || '',
        nota: row.nota || '',
        num_avaliacoes: row.num_avaliacoes || '',
        categoria: row.categoria || '',
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
 * Upsert em lote dos resultados da coleta. Omite imagens.
 * @param {object[]} estabelecimentos
 * @param {{ cidade?: string, uf?: string }} [ctx]
 */
export async function upsertProspectosMapsDeColeta(estabelecimentos, ctx = {}) {
    const lista = Array.isArray(estabelecimentos) ? estabelecimentos : []
    if (!lista.length) return { ok: true, salvos: 0, itens: [] }

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
        return {
            ...est,
            id: mid,
            maps_id: mid,
            maps_db_id: row.id,
            status_prospeccao: row.status_prospeccao,
            _salvo: true,
            // fachada só se ainda vier do worker nesta sessão
            imagem: est.imagem || null,
        }
    })
}
