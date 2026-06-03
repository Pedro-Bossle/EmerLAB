import { supabase } from './supabase'
import { classificarCategoriaExameLaboratorial } from './prestadorCadastroHelpers.js'

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

/** Coluna `nome_alternativo` ainda não migrada no Supabase — evita GET 400 repetidos. */
let prestadorProcedimentosTemNomeAlternativo = true

export function getPrestadorProcedimentosTemNomeAlternativo() {
    return prestadorProcedimentosTemNomeAlternativo
}

export function setPrestadorProcedimentosTemNomeAlternativo(valor) {
    prestadorProcedimentosTemNomeAlternativo = Boolean(valor)
}

export function isErroColunaNomeAlternativo(error) {
    if (!error) return false
    const msg = String(error.message || '').toLowerCase()
    const details = String(error.details || '').toLowerCase()
    const hint = String(error.hint || '').toLowerCase()
    const code = String(error.code || '')
    if (code === '42703' || code === 'PGRST204') return true
    const blob = `${msg} ${details} ${hint}`
    return (
        blob.includes('nome_alternativo') &&
        (blob.includes('does not exist') ||
            blob.includes('schema cache') ||
            blob.includes('could not find') ||
            blob.includes('column'))
    )
}

function desativarNomeAlternativoSeErro(error) {
    if (isErroColunaNomeAlternativo(error)) {
        prestadorProcedimentosTemNomeAlternativo = false
        return true
    }
    return false
}

async function buscarVinculosPrestadorProcedimentos(prestadorId) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return []

    const tentar = async (selectCols) => {
        const { data, error } = await supabase
            .from('prestador_procedimentos')
            .select(selectCols)
            .eq('prestador_id', pid)
        return { data: data || [], error }
    }

    const colsBase = 'id, prestador_id, procedimento_cod, procedimento_id'
    let res
    if (prestadorProcedimentosTemNomeAlternativo) {
        res = await tentar(`${colsBase}, nome_alternativo`)
        if (res.error && desativarNomeAlternativoSeErro(res.error)) {
            res = await tentar(colsBase)
        }
    } else {
        res = await tentar(colsBase)
    }
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

export function montarLinhasPrestadorProcedimentos(prestadorId, codigos, mapaIdPorCodigo, mapaNomeAlternativo = null) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return []
    const rows = []
    for (const codRaw of codigos || []) {
        const procedimento_cod = String(codRaw || '').trim()
        if (!procedimento_cod) continue
        const codNorm = normalizarCodigo(procedimento_cod)
        const procedimento_id = mapaIdPorCodigo.get(codNorm) ?? null
        const alt = mapaNomeAlternativo?.get?.(codNorm)
        const row = {
            prestador_id: pid,
            procedimento_cod,
            procedimento_id,
        }
        if (alt !== undefined && prestadorProcedimentosTemNomeAlternativo) {
            row.nome_alternativo = alt ? String(alt).trim() : null
        }
        rows.push(row)
    }
    return rows
}

/**
 * Substitui vínculos em `prestador_procedimentos` (cod + id).
 */
export async function sincronizarPrestadorProcedimentos(prestadorId, codigos, mapaNomeAlternativo = null) {
    const pid = normalizarPrestadorIdParaQuery(prestadorId)
    if (pid == null) return
    const mapa = await mapaProcedimentoIdPorCodigo(codigos)
    const faltando = (codigos || []).filter((c) => String(c || '').trim() && !mapa.has(normalizarCodigo(c)))
    if (faltando.length) {
        throw new Error(
            `Procedimento(s) sem id na tabela procedimentos: ${faltando.slice(0, 5).join(', ')}${faltando.length > 5 ? '…' : ''}`,
        )
    }
    const mapaAltPreservar = new Map()
    try {
        const vinculos = await buscarVinculosPrestadorProcedimentos(prestadorId)
        for (const v of vinculos) {
            const cod =
                normalizarCodigo(v.procedimento_cod) || normalizarCodigo(v.procedimento_id)
            const alt = String(v.nome_alternativo ?? '').trim()
            if (cod && alt) mapaAltPreservar.set(cod, alt)
        }
    } catch {
        /* coluna pode não existir ainda */
    }
    if (mapaNomeAlternativo) {
        for (const [cod, alt] of mapaNomeAlternativo) {
            mapaAltPreservar.set(cod, alt ? String(alt).trim() : '')
        }
    }
    const { error: errDel } = await supabase.from('prestador_procedimentos').delete().eq('prestador_id', pid)
    if (errDel) throw new Error(errDel.message)
    const rows = montarLinhasPrestadorProcedimentos(pid, codigos, mapa, mapaAltPreservar)
    if (!rows.length) return
    const semAlt = (list) => list.map(({ nome_alternativo: _n, ...r }) => r)
    let payload = prestadorProcedimentosTemNomeAlternativo ? rows : semAlt(rows)
    let { error: errIns } = await supabase.from('prestador_procedimentos').insert(payload)
    if (errIns && isErroColunaNomeAlternativo(errIns)) {
        prestadorProcedimentosTemNomeAlternativo = false
        ;({ error: errIns } = await supabase.from('prestador_procedimentos').insert(semAlt(rows)))
    }
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

/** Chave estável de procedimento numa linha de `prestador_procedimentos` (contagem = códigos distintos). */
export function chaveProcedimentoVinculo(row) {
    const cod = normalizarCodigo(row?.procedimento_cod)
    if (cod) return cod
    const idNum = Number(row?.procedimento_id)
    if (Number.isFinite(idNum) && idNum > 0) return `id:${idNum}`
    const idStr = String(row?.procedimento_id ?? '').trim()
    if (idStr) return normalizarCodigo(idStr)
    return ''
}

/**
 * Mapa prestador_id → Set de códigos de procedimento (resolve procedimento_id via catálogo).
 * @param {Map<number, string>} mapaCodigoPorProcedimentoId — id em `procedimentos` → código normalizado
 */
export function mapaCodigosPorPrestadorDeVinculos(vinculos, mapaCodigoPorProcedimentoId = new Map()) {
    const porPrestador = new Map()
    for (const v of vinculos || []) {
        const pid = Number(v.prestador_id)
        if (!pid) continue
        let cod = normalizarCodigo(v.procedimento_cod)
        if (!cod) {
            const idNum = Number(v.procedimento_id)
            if (Number.isFinite(idNum) && idNum > 0) {
                cod = mapaCodigoPorProcedimentoId.get(idNum) || ''
            }
            if (!cod) cod = normalizarCodigo(v.procedimento_id)
        }
        if (!cod) continue
        if (!porPrestador.has(pid)) porPrestador.set(pid, new Set())
        porPrestador.get(pid).add(cod)
    }
    return porPrestador
}

/**
 * Mapa prestador_id → quantidade de procedimentos distintos no perfil (não linhas duplicadas).
 */
export function contarProcedimentosDistintosPorPrestador(rows) {
    const sets = new Map()
    for (const row of rows || []) {
        const pid = Number(row.prestador_id)
        const chave = chaveProcedimentoVinculo(row)
        if (!pid || !chave) continue
        if (!sets.has(pid)) sets.set(pid, new Set())
        sets.get(pid).add(chave)
    }
    const mapa = new Map()
    sets.forEach((set, pid) => mapa.set(pid, set.size))
    return mapa
}

const CATEGORIA_SERVICO_MIN = 3
const CATEGORIA_SERVICO_MAX = 25

/** IDs das categorias «Exames simples» e «Exames especiais» (por nome). */
export async function resolverIdsCategoriasExamesLaboratoriais() {
    const { data, error } = await supabase
        .from('categorias')
        .select('id, nome')
        .gte('id', CATEGORIA_SERVICO_MIN)
        .lte('id', CATEGORIA_SERVICO_MAX)
    if (error) throw new Error(error.message)
    const idsSimples = []
    const idsEspeciais = []
    ;(data || []).forEach((c) => {
        const tipo = classificarCategoriaExameLaboratorial(c.nome)
        if (tipo === 'simples') idsSimples.push(Number(c.id))
        if (tipo === 'especiais') idsEspeciais.push(Number(c.id))
    })
    return { idsSimples, idsEspeciais }
}

/**
 * Remove vínculos do prestador nas categorias de exame indicadas.
 * @param {'simples' | 'especiais' | 'ambas'} escopo
 */
export async function limparProcedimentosPrestadorCategoriasExame(prestadorId, escopo) {
    const { idsSimples, idsEspeciais } = await resolverIdsCategoriasExamesLaboratoriais()
    const alvo =
        escopo === 'ambas'
            ? new Set([...idsSimples, ...idsEspeciais])
            : escopo === 'simples'
              ? new Set(idsSimples)
              : new Set(idsEspeciais)
    if (!alvo.size) {
        throw new Error('Categorias de exames não encontradas na base (Exames simples / Exames especiais).')
    }

    const codigosAtuais = await carregarCodigosPrestadorProcedimentos(prestadorId)
    if (!codigosAtuais.length) return { removidos: 0, restantes: [] }

    const unicos = [...new Set(codigosAtuais.map(normalizarCodigo).filter(Boolean))]
    const { data: procs, error: errP } = await supabase
        .from('procedimentos')
        .select('codigo, categoria_id')
        .in('codigo', unicos)
    if (errP) throw new Error(errP.message)

    const categoriaPorCod = new Map(
        (procs || []).map((p) => [normalizarCodigo(p.codigo), Number(p.categoria_id)]),
    )

    const manter = codigosAtuais.filter((cod) => {
        const catId = categoriaPorCod.get(normalizarCodigo(cod))
        if (!catId) return true
        return !alvo.has(catId)
    })

    await sincronizarPrestadorProcedimentos(prestadorId, manter)
    return { removidos: codigosAtuais.length - manter.length, restantes: manter }
}

/** Filtra códigos selecionados (UI) removendo os das categorias de exame. */
export async function filtrarCodigosRemovendoCategoriasExame(codigos, escopo) {
    const { idsSimples, idsEspeciais } = await resolverIdsCategoriasExamesLaboratoriais()
    const alvo =
        escopo === 'ambas'
            ? new Set([...idsSimples, ...idsEspeciais])
            : escopo === 'simples'
              ? new Set(idsSimples)
              : new Set(idsEspeciais)
    if (!alvo.size) return { codigos: codigos || [], removidos: 0 }

    const lista = (codigos || []).map((c) => String(c).trim()).filter(Boolean)
    if (!lista.length) return { codigos: [], removidos: 0 }

    const unicos = [...new Set(lista.map(normalizarCodigo))]
    const { data: procs, error } = await supabase
        .from('procedimentos')
        .select('codigo, categoria_id')
        .in('codigo', unicos)
    if (error) throw new Error(error.message)

    const categoriaPorCod = new Map(
        (procs || []).map((p) => [normalizarCodigo(p.codigo), Number(p.categoria_id)]),
    )

    const manter = lista.filter((cod) => {
        const catId = categoriaPorCod.get(normalizarCodigo(cod))
        if (!catId) return true
        return !alvo.has(catId)
    })
    return { codigos: manter, removidos: lista.length - manter.length }
}
