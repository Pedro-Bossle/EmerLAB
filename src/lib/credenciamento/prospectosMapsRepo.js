import { supabase } from '../supabase.js'
import { unifyContato } from './emerRadarUi.js'
import {
    linhasUnicasDeColeta,
    mapearEstabelecimentoMapsParaRow,
    mapsIdDeEstabelecimento,
    mesclarComExistentes,
    rowMapsParaCardUi,
} from './prospectosMapsCore.js'

export { mapearEstabelecimentoMapsParaRow, mapsIdDeEstabelecimento, rowMapsParaCardUi }

const TABELA = 'cred_prospectos_maps'

export const STATUS_PROSPECCAO_MAPS_OPCOES = [
    { id: 'novo', label: 'Novo' },
    { id: 'contactado', label: 'Contactado' },
    { id: 'descartado', label: 'Descartado' },
    { id: 'credenciado', label: 'Credenciado' },
]

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
 * Upsert em lote dos resultados da coleta (a fachada, quando vem do Maps, fica em `tags.imagem`).
 * @param {object[]} estabelecimentos
 * @param {{ cidade?: string, uf?: string, preferirNovos?: boolean }} [ctx]
 */
export async function upsertProspectosMapsDeColeta(estabelecimentos, ctx = {}) {
    const lista = Array.isArray(estabelecimentos) ? estabelecimentos : []
    if (!lista.length) return { ok: true, salvos: 0, itens: [] }
    const preferirNovos = Boolean(ctx.preferirNovos)

    const rows = linhasUnicasDeColeta(lista, ctx)
    if (!rows.length) return { ok: true, salvos: 0, itens: [] }

    // Não sobrescrever campos já salvos com vazio em re-coleta
    const ids = rows.map((r) => r.maps_id)
    const { data: existentes } = await supabase
        .from(TABELA)
        .select(
            'maps_id, telefone, whatsapp, horario, horario_detalhado, endereco, nota, num_avaliacoes, categoria, link_maps, website, lat, lng, cidade, uf, status_prospeccao, tags',
        )
        .in('maps_id', ids)
    mesclarComExistentes(rows, existentes, { preferirNovos })

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
 * Mantém a `imagem` da sessão; senão usa a salva em `tags.imagem`.
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
            planos: est.planos?.length ? est.planos : Array.isArray(row.tags?.planos) ? row.tags.planos : [],
            imagem: est.imagem || (typeof row.tags?.imagem === 'string' ? row.tags.imagem : null),
        }
    })
}
