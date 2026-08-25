import { supabase } from '../supabase.js'
import { PROSPECTOS_OSM_CATEGORIAS_EXCLUIDAS } from './prospectosOsmCategorias.js'

const TABELA = 'cred_prospectos_osm'

export const STATUS_PROSPECCAO_OPCOES = [
    { id: 'novo', label: 'Novo' },
    { id: 'contactado', label: 'Contactado' },
    { id: 'descartado', label: 'Descartado' },
    { id: 'credenciado', label: 'Credenciado' },
]

/**
 * @param {{ uf?: string, cidade?: string, categoriaId?: string, categoriaIds?: string[], status?: string, busca?: string, limite?: number }} filtros
 */
export async function listarProspectosOsm(filtros = {}) {
    let q = supabase.from(TABELA).select('*').order('nome', { ascending: true })
    const limite = Math.min(Math.max(Number(filtros.limite) || 500, 1), 2000)
    q = q.limit(limite)

    const uf = String(filtros.uf || '').trim()
    const cidade = String(filtros.cidade || '').trim()
    const categoriaId = String(filtros.categoriaId || '').trim()
    const categoriaIds = Array.isArray(filtros.categoriaIds)
        ? filtros.categoriaIds.map((id) => String(id || '').trim()).filter(Boolean)
        : []
    const status = String(filtros.status || '').trim()
    const busca = String(filtros.busca || '').trim()

    if (uf) q = q.ilike('uf', uf)
    if (cidade) q = q.ilike('cidade', cidade)
    if (categoriaIds.length) q = q.in('categoria_id', categoriaIds)
    else if (categoriaId) q = q.eq('categoria_id', categoriaId)
    if (status) q = q.eq('status_prospeccao', status)
    if (busca) {
        const t = busca.replace(/%/g, '')
        q = q.or(`nome.ilike.%${t}%,endereco.ilike.%${t}%`)
    }

    const { data, error } = await q
    if (error) return { ok: false, erro: error.message, itens: [] }
    const brutos = data || []
    const excluir = new Set(
        (filtros.incluirCategoriasLegadas ? [] : PROSPECTOS_OSM_CATEGORIAS_EXCLUIDAS).map(String),
    )
    const itens = excluir.size
        ? brutos.filter((row) => !excluir.has(String(row.categoria_id || '')))
        : brutos
    return { ok: true, itens }
}

const CAMPOS_EDITAVEIS = new Set([
    'nome',
    'categoria_id',
    'categoria_label',
    'endereco',
    'cidade',
    'uf',
    'telefone',
    'website',
    'horario_atendimento',
    'status_prospeccao',
    'observacao',
    'lat',
    'lng',
])

/**
 * Atualiza campos editáveis do prospecto (nome, contacto, endereço, status, etc.).
 * @param {string} id
 * @param {Record<string, unknown>} campos
 */
export async function atualizarProspectoOsm(id, campos = {}) {
    const payload = { atualizado_em: new Date().toISOString() }
    for (const [k, v] of Object.entries(campos || {})) {
        if (!CAMPOS_EDITAVEIS.has(k)) continue
        if (k === 'lat' || k === 'lng') {
            if (v === '' || v === null || v === undefined) {
                payload[k] = null
            } else {
                const n = Number(v)
                payload[k] = Number.isFinite(n) ? n : null
            }
            continue
        }
        if (typeof v === 'string') payload[k] = v.trim()
        else if (v !== undefined) payload[k] = v
    }

    if (Object.keys(payload).length <= 1) {
        return { ok: false, erro: 'Nenhum campo para atualizar.' }
    }

    const { data, error } = await supabase
        .from(TABELA)
        .update(payload)
        .eq('id', id)
        .select('*')
        .maybeSingle()

    if (error) return { ok: false, erro: error.message }

    if (String(payload.status_prospeccao || data?.status_prospeccao || '') === 'contactado' && data) {
        try {
            const { enviarProspectoOsmParaKanban } = await import('../credKanban.js')
            await enviarProspectoOsmParaKanban(data)
        } catch (e) {
            const msg = String(e?.message || e || '')
            if (/cred_kanban|schema cache|does not exist|relation.*does not exist/i.test(msg)) {
                /* kanban opcional se tabela ainda não existir */
            } else {
                throw e
            }
        }
    }

    return { ok: true, item: data }
}

export async function atualizarStatusProspectoOsm(id, { status_prospeccao, observacao }) {
    return atualizarProspectoOsm(id, { status_prospeccao, observacao })
}

export async function listarCidadesUfProspectosOsm() {
    const { data, error } = await supabase.from(TABELA).select('cidade, uf')
    if (error) return { ok: false, erro: error.message, pares: [] }
    const set = new Map()
    for (const row of data || []) {
        const c = String(row.cidade || '').trim()
        const u = String(row.uf || '').trim()
        if (!c) continue
        set.set(`${c}|${u}`, { cidade: c, uf: u })
    }
    return { ok: true, pares: [...set.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR')) }
}
