import { supabase } from './supabase'

const normalizarCodigo = (cod) =>
    String(cod || '')
        .trim()
        .toUpperCase()

function normalizarPorteNome(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
}

/** P / M / G a partir do campo `nome` em `portes` (não existe coluna `letra`). */
export function resolverLetraPortePorNome(nome) {
    const n = normalizarPorteNome(nome)
    if (!n) return ''
    if (n === 'P' || n.startsWith('P ') || n.includes('PEQUENO') || n.includes('PEQ')) return 'P'
    if (n === 'M' || n.startsWith('M ') || n.includes('MEDIO')) return 'M'
    if (n === 'G' || n.startsWith('G ') || n.includes('GRANDE')) return 'G'
    if (n.length === 1 && 'PMG'.includes(n)) return n
    return ''
}

export async function carregarPortesDb() {
    const { data, error } = await supabase.from('portes').select('id, nome').order('id', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

export function mapaLetraPorPorteId(portes) {
    const mapa = new Map()
    for (const p of portes || []) {
        const letra = resolverLetraPortePorNome(p.nome)
        if (letra && p.id != null) mapa.set(Number(p.id), letra)
    }
    return mapa
}

export function normalizarPrestadorIdParaQuery(prestadorId) {
    const n = Number(prestadorId)
    if (Number.isFinite(n) && n > 0) return n
    const s = String(prestadorId ?? '').trim()
    return s || null
}

async function buscarVinculosPrestadorProcedimentos(prestadorId) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return []

    const tentar = async (selectCols) => {
        let q = supabase.from('prestador_procedimentos').select(selectCols).eq('prestador_id', pid)
        const { data, error } = await q
        return { data: data || [], error }
    }

    let res = await tentar('id, prestador_id, procedimento_cod, procedimento_id')
    if (res.error) {
        res = await tentar('*')
    }
    if (res.error) {
        throw new Error(res.error.message)
    }
    return res.data
}

/** Mapa codigo (upper) → id numérico em `procedimentos`. */
export async function mapaProcedimentoIdPorCodigo(codigos) {
    const unicos = [...new Set((codigos || []).map(normalizarCodigo).filter(Boolean))]
    const mapa = new Map()
    if (!unicos.length) return mapa

    const chunk = 80
    for (let i = 0; i < unicos.length; i += chunk) {
        const lote = unicos.slice(i, i + chunk)
        const { data, error } = await supabase.from('procedimentos').select('id, codigo').in('codigo', lote)
        if (error) throw new Error(error.message)
        ;(data || []).forEach((row) => {
            const cod = normalizarCodigo(row.codigo)
            const idNum = Number(row.id)
            if (cod && Number.isFinite(idNum)) mapa.set(cod, idNum)
        })
    }
    return mapa
}

async function buscarProcedimentosPorIds(ids) {
    const unicos = [...new Set(ids.map(Number).filter(Number.isFinite))]
    const out = []
    const chunk = 80
    for (let i = 0; i < unicos.length; i += chunk) {
        const lote = unicos.slice(i, i + chunk)
        const { data, error } = await supabase
            .from('procedimentos')
            .select('id, codigo, nome, categoria_id')
            .in('id', lote)
        if (error) throw new Error(error.message)
        out.push(...(data || []))
    }
    return out
}

async function buscarProcedimentosPorCodigos(codigos) {
    const unicos = [...new Set(codigos.map(normalizarCodigo).filter(Boolean))]
    const out = []
    const chunk = 80
    for (let i = 0; i < unicos.length; i += chunk) {
        const lote = unicos.slice(i, i + chunk)
        const { data, error } = await supabase
            .from('procedimentos')
            .select('id, codigo, nome, categoria_id')
            .in('codigo', lote)
        if (error) throw new Error(error.message)
        out.push(...(data || []))
    }
    return out
}

function resolverProcedimentoCatalogo(row, porId, porCod) {
    const idNum = Number(row.procedimento_id)
    if (Number.isFinite(idNum)) {
        const porIdHit = porId.get(idNum)
        if (porIdHit) return porIdHit
    }
    const codFk = String(row.procedimento_cod || '').trim()
    if (codFk) {
        const hit = porCod.get(normalizarCodigo(codFk))
        if (hit) return hit
    }
    const idComoCod = String(row.procedimento_id ?? '').trim()
    if (idComoCod) {
        const hit = porCod.get(normalizarCodigo(idComoCod))
        if (hit) return hit
    }
    return null
}

/**
 * Linhas de `prestador_procedimentos` do prestador, enriquecidas com nome/código canónico de `procedimentos`.
 */
export async function listarProcedimentosPrestadorPerfil(prestadorId) {
    const rows = await buscarVinculosPrestadorProcedimentos(prestadorId)
    if (!rows.length) return []

    const ids = []
    const cods = []
    for (const r of rows) {
        const idNum = Number(r.procedimento_id)
        if (Number.isFinite(idNum)) ids.push(idNum)
        const cod = String(r.procedimento_cod || '').trim()
        if (cod) cods.push(cod)
        const idStr = String(r.procedimento_id ?? '').trim()
        if (idStr && !Number.isFinite(idNum)) cods.push(idStr)
    }

    const [porIdList, porCodList] = await Promise.all([
        buscarProcedimentosPorIds(ids),
        buscarProcedimentosPorCodigos(cods),
    ])

    const porId = new Map(porIdList.map((p) => [Number(p.id), p]))
    const porCod = new Map(porCodList.map((p) => [normalizarCodigo(p.codigo), p]))

    const itens = []
    for (const r of rows) {
        const proc = resolverProcedimentoCatalogo(r, porId, porCod)
        const codigo =
            (proc?.codigo ? String(proc.codigo).trim() : '') ||
            String(r.procedimento_cod || '').trim() ||
            String(r.procedimento_id ?? '').trim()
        itens.push({
            vinculoId: r.id,
            prestador_id: r.prestador_id,
            procedimento_cod: r.procedimento_cod ?? null,
            procedimento_id: r.procedimento_id ?? proc?.id ?? null,
            codigo: codigo || '—',
            nome: proc?.nome ? String(proc.nome) : '—',
            categoria_id: proc?.categoria_id ?? null,
        })
    }
    return itens.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'))
}

export function montarLinhasPrestadorProcedimentos(prestadorId, codigos, mapaIdPorCodigo) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return []
    const rows = []
    for (const codRaw of codigos || []) {
        const procedimento_cod = String(codRaw || '').trim()
        if (!procedimento_cod) continue
        const procedimento_id = mapaIdPorCodigo.get(normalizarCodigo(procedimento_cod)) ?? null
        rows.push({
            prestador_id: pid,
            procedimento_cod,
            procedimento_id,
        })
    }
    return rows
}

/**
 * Substitui vínculos em `prestador_procedimentos` (cod + id).
 */
export async function sincronizarPrestadorProcedimentos(prestadorId, codigos) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return
    const mapa = await mapaProcedimentoIdPorCodigo(codigos)
    const faltando = (codigos || []).filter((c) => String(c || '').trim() && !mapa.has(normalizarCodigo(c)))
    if (faltando.length) {
        throw new Error(
            `Procedimento(s) sem id na tabela procedimentos: ${faltando.slice(0, 5).join(', ')}${faltando.length > 5 ? '…' : ''}`,
        )
    }
    const { error: errDel } = await supabase.from('prestador_procedimentos').delete().eq('prestador_id', pid)
    if (errDel) throw new Error(errDel.message)
    const rows = montarLinhasPrestadorProcedimentos(pid, codigos, mapa)
    if (!rows.length) return
    const { error: errIns } = await supabase.from('prestador_procedimentos').insert(rows)
    if (errIns) throw new Error(errIns.message)
}

/** Códigos para marcar checkboxes (resolvidos via `prestador_procedimentos` + FK `procedimento_id`). */
export async function carregarCodigosPrestadorProcedimentos(prestadorId) {
    const lista = await listarProcedimentosPrestadorPerfil(prestadorId)
    return [
        ...new Set(
            lista.map((x) => String(x.codigo).trim()).filter((c) => c && c !== '—'),
        ),
    ]
}
