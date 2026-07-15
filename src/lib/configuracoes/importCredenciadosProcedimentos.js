import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { resolverPrestadorPorNome, sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'
import { mapaProcedimentoIdPorCodigo } from '../prestadorProcedimentos.js'
import { supabase } from '../supabase.js'

/** Tamanho das fatias de leitura no Supabase (evita teto 1000 e picos de memória). */
const TAMANHO_PAGINA_SUPABASE = 100

async function buscarPaginadoPequeno(montarQuery, tamanho = TAMANHO_PAGINA_SUPABASE) {
    const acumulado = []
    let pagina = 0
    while (true) {
        const inicio = pagina * tamanho
        const fim = inicio + tamanho - 1
        const resp = await montarQuery().range(inicio, fim)
        if (resp.error) return { data: acumulado, error: resp.error }
        const lote = resp.data || []
        acumulado.push(...lote)
        if (lote.length < tamanho) break
        pagina += 1
        if (pagina > 5000) break
    }
    return { data: acumulado, error: null }
}

const normalizarCodigo = (cod) =>
    String(cod || '')
        .trim()
        .toUpperCase()

function normalizarCabecalho(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

function celulaTexto(cell) {
    if (cell == null) return ''
    if (typeof cell === 'object' && cell.text != null) return String(cell.text).trim()
    if (typeof cell === 'object' && cell.result != null) return String(cell.result).trim()
    return String(cell).trim()
}

function mapearIndicesColunas(headerRow) {
    const idx = {
        nomeCredenciado: -1,
        procedimentoNome: -1,
        procedimentoCodigo: -1,
    }
    for (let i = 0; i < headerRow.length; i += 1) {
        const h = normalizarCabecalho(headerRow[i])
        if (!h) continue
        if (
            idx.nomeCredenciado < 0 &&
            (h.includes('nome do credenciado') ||
                h === 'credenciado' ||
                h === 'nome credenciado' ||
                (h.includes('nome') && h.includes('credenciado')) ||
                h === 'prestador' ||
                h === 'nome')
        ) {
            idx.nomeCredenciado = i
            continue
        }
        if (
            idx.procedimentoCodigo < 0 &&
            (h.includes('procedimento codigo') ||
                h.includes('codigo procedimento') ||
                h === 'codigo' ||
                h === 'cod' ||
                h === 'procedimento cod')
        ) {
            idx.procedimentoCodigo = i
            continue
        }
        if (
            idx.procedimentoNome < 0 &&
            (h === 'procedimento' ||
                h === 'procedimento nome' ||
                h === 'nome procedimento' ||
                h.includes('procedimento'))
        ) {
            idx.procedimentoNome = i
        }
    }
    return idx
}

/**
 * Resolve procedimento por código (exato) ou nome (mesma lógica fuzzy de pagamentos).
 * @param {{ codigo?: string, nome?: string, id?: number }[]} procedimentos
 */
export function resolverProcedimentoPorCodigoOuNome(procedimentos, codigoBruto, nomeBruto) {
    const lista = procedimentos || []
    const cod = normalizarCodigo(codigoBruto)
    if (cod) {
        const porCod = lista.find((p) => normalizarCodigo(p.codigo) === cod)
        if (porCod) return { procedimento: porCod, tipo: 'codigo' }
    }

    const termo = normalizarTextoBusca(nomeBruto)
    if (!termo) return { procedimento: null, tipo: null, sugestoes: [] }

    const itensNome = lista.map((p) => ({ ...p, nome: p.nome || p.codigo }))
    const exato = itensNome.find((p) => normalizarTextoBusca(p.nome) === termo)
    if (exato) return { procedimento: exato, tipo: 'nome_exato', sugestoes: [] }

    const resolver = resolverPrestadorPorNome(itensNome, nomeBruto)
    if (resolver) return { procedimento: resolver, tipo: 'nome_auto', sugestoes: [] }

    const sugestoes = sugerirPrestadoresPorNome(itensNome, nomeBruto, { limite: 8 })
    return { procedimento: null, tipo: null, sugestoes }
}

/**
 * Lê Excel (.xlsx) e devolve linhas brutas da planilha.
 * @param {ArrayBuffer} buffer
 */
export async function parsearExcelImportCredenciados(buffer) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const ws = workbook.worksheets[0]
    if (!ws) return { linhas: [], erro: 'Planilha vazia.' }

    const matrix = []
    ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = []
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            vals[colNumber - 1] = celulaTexto(cell.value)
        })
        matrix.push(vals)
    })
    if (matrix.length < 2) return { linhas: [], erro: 'Nenhuma linha de dados encontrada.' }

    const idx = mapearIndicesColunas(matrix[0].map((c) => String(c || '')))
    if (idx.nomeCredenciado < 0) {
        return {
            linhas: [],
            erro: 'Cabeçalho obrigatório não encontrado: Nome do Credenciado.',
        }
    }
    if (idx.procedimentoNome < 0 && idx.procedimentoCodigo < 0) {
        return {
            linhas: [],
            erro: 'Informe a coluna Procedimento e/ou Procedimento Código.',
        }
    }

    const linhas = []
    for (let r = 1; r < matrix.length; r += 1) {
        const row = matrix[r] || []
        const nomeCredenciado = String(row[idx.nomeCredenciado] || '').trim()
        const procedimentoNome =
            idx.procedimentoNome >= 0 ? String(row[idx.procedimentoNome] || '').trim() : ''
        const procedimentoCodigo =
            idx.procedimentoCodigo >= 0 ? String(row[idx.procedimentoCodigo] || '').trim() : ''
        if (!nomeCredenciado && !procedimentoNome && !procedimentoCodigo) continue
        linhas.push({
            idLocal: `r${r}`,
            linhaExcel: r + 1,
            nomeCredenciado,
            procedimentoNome,
            procedimentoCodigo,
        })
    }
    return { linhas, erro: null }
}

/**
 * Classifica linhas com match de prestador/procedimento e presença no perfil.
 */
export function classificarLinhasImportCredenciados({
    linhasBrutas,
    prestadores,
    procedimentos,
    codigosPorPrestadorId,
}) {
    return (linhasBrutas || []).map((raw) => {
        const prestadorAuto = resolverPrestadorPorNome(prestadores, raw.nomeCredenciado)
        const sugestoesPrestador = prestadorAuto
            ? []
            : sugerirPrestadoresPorNome(prestadores, raw.nomeCredenciado, { limite: 8 })

        const resolvidoProc = resolverProcedimentoPorCodigoOuNome(
            procedimentos,
            raw.procedimentoCodigo,
            raw.procedimentoNome,
        )

        const prestadorId = prestadorAuto?.id != null ? Number(prestadorAuto.id) : null
        const codigoProc = resolvidoProc.procedimento
            ? normalizarCodigo(resolvidoProc.procedimento.codigo)
            : normalizarCodigo(raw.procedimentoCodigo)

        const setPerfil = prestadorId != null ? codigosPorPrestadorId.get(prestadorId) : null
        const noPerfil = Boolean(codigoProc && setPerfil?.has(codigoProc))

        let status = 'ok'
        if (!prestadorAuto && sugestoesPrestador.length === 0) status = 'sem_credenciado'
        else if (!prestadorAuto) status = 'revisar_credenciado'
        else if (!resolvidoProc.procedimento && (resolvidoProc.sugestoes || []).length === 0) {
            status = 'sem_procedimento'
        } else if (!resolvidoProc.procedimento) status = 'revisar_procedimento'
        else if (noPerfil) status = 'ja_vinculado'
        else status = 'fora_perfil'

        return {
            ...raw,
            prestadorId,
            prestadorNome: prestadorAuto?.nome || '',
            sugestoesPrestador,
            procedimentoId: resolvidoProc.procedimento?.id ?? null,
            procedimentoCodigoResolvido: codigoProc || '',
            procedimentoNomeResolvido: resolvidoProc.procedimento?.nome || '',
            sugestoesProcedimento: resolvidoProc.sugestoes || [],
            noPerfil,
            status,
        }
    })
}

/**
 * Procedimentos no perfil do prestador que não aparecem nas linhas importadas (já resolvidas).
 */
export function listarOrfaosPerfilForaDaPlanilha({
    linhasClassificadas,
    codigosPorPrestadorId,
    procedimentosPorCodigo,
    prestadoresPorId,
}) {
    const naPlanilha = new Map()
    const prestadoresNaPlanilha = new Set()
    for (const l of linhasClassificadas || []) {
        if (!l.prestadorId) continue
        const pid = Number(l.prestadorId)
        prestadoresNaPlanilha.add(pid)
        if (!l.procedimentoCodigoResolvido) continue
        if (!naPlanilha.has(pid)) naPlanilha.set(pid, new Set())
        naPlanilha.get(pid).add(normalizarCodigo(l.procedimentoCodigoResolvido))
    }

    const orfaos = []
    for (const [prestadorId, setCodigos] of codigosPorPrestadorId || []) {
        if (!prestadoresNaPlanilha.has(Number(prestadorId))) continue
        const noExcel = naPlanilha.get(Number(prestadorId)) || new Set()
        const prestador = prestadoresPorId.get(Number(prestadorId))
        if (!prestador) continue
        for (const cod of setCodigos) {
            if (noExcel.has(cod)) continue
            const meta = procedimentosPorCodigo.get(cod)
            orfaos.push({
                idLocal: `orf-${prestadorId}-${cod}`,
                prestadorId: Number(prestadorId),
                prestadorNome: prestador.nome || '',
                procedimentoCodigo: cod,
                procedimentoNome: meta?.nome || cod,
                procedimentoId: meta?.id ?? null,
            })
        }
    }
    return orfaos.sort(
        (a, b) =>
            String(a.prestadorNome).localeCompare(String(b.prestadorNome), 'pt-BR') ||
            String(a.procedimentoCodigo).localeCompare(String(b.procedimentoCodigo), 'pt-BR'),
    )
}

export async function carregarCodigosPerfilPorPrestadores(prestadorIds) {
    const ids = [...new Set((prestadorIds || []).map(Number).filter(Boolean))]
    const mapa = new Map()
    for (const id of ids) mapa.set(id, new Set())
    if (!ids.length) return mapa

    const vinculos = []
    const TAM = TAMANHO_PAGINA_SUPABASE
    for (let i = 0; i < ids.length; i += TAM) {
        const fatia = ids.slice(i, i + TAM)
        const { data, error } = await buscarPaginadoPequeno(() =>
            supabase
                .from('prestador_procedimentos')
                .select('prestador_id, procedimento_cod, procedimento_id')
                .in('prestador_id', fatia)
                .order('id', { ascending: true }),
        )
        if (error) throw new Error(error.message)
        vinculos.push(...(data || []))
    }

    const idsProc = [
        ...new Set(
            vinculos
                .map((v) => Number(v.procedimento_id))
                .filter((n) => Number.isFinite(n) && n > 0),
        ),
    ]
    const codigoPorId = new Map()
    for (let i = 0; i < idsProc.length; i += TAM) {
        const fatia = idsProc.slice(i, i + TAM)
        const { data, error } = await buscarPaginadoPequeno(() =>
            supabase.from('procedimentos').select('id, codigo').in('id', fatia).order('id', { ascending: true }),
        )
        if (error) throw new Error(error.message)
        for (const p of data || []) {
            const idNum = Number(p.id)
            const cod = normalizarCodigo(p.codigo)
            if (Number.isFinite(idNum) && idNum > 0 && cod) codigoPorId.set(idNum, cod)
        }
    }

    for (const row of vinculos) {
        const pid = Number(row.prestador_id)
        if (!pid) continue
        if (!mapa.has(pid)) mapa.set(pid, new Set())
        const set = mapa.get(pid)

        const idNum = Number(row.procedimento_id)
        if (Number.isFinite(idNum) && idNum > 0) {
            const viaId = codigoPorId.get(idNum)
            if (viaId) set.add(viaId)
        }

        const viaCod = normalizarCodigo(row.procedimento_cod)
        // Não usar FK numérico como se fosse código de procedimento.
        if (viaCod && !/^\d+$/.test(viaCod)) set.add(viaCod)
    }
    return mapa
}

export async function vincularProcedimentoAoPerfil(prestadorId, codigo) {
    const pid = Number(prestadorId)
    const cod = normalizarCodigo(codigo)
    if (!pid || !cod) throw new Error('Prestador ou código inválido.')
    const mapa = await mapaProcedimentoIdPorCodigo([cod])
    const procedimento_id = mapa.get(cod)
    if (procedimento_id == null) {
        throw new Error(`Procedimento ${cod} não encontrado na tabela procedimentos.`)
    }
    const { data: existentes, error: errEx } = await supabase
        .from('prestador_procedimentos')
        .select('id')
        .eq('prestador_id', pid)
        .eq('procedimento_cod', cod)
        .limit(1)
    if (errEx) throw new Error(errEx.message)
    if ((existentes || []).length) return { status: 'ja_existia' }

    const { error } = await supabase.from('prestador_procedimentos').insert({
        prestador_id: pid,
        procedimento_cod: cod,
        procedimento_id,
    })
    if (error) throw new Error(error.message)
    return { status: 'ok' }
}

export async function removerProcedimentoDoPerfil(prestadorId, codigo) {
    const pid = Number(prestadorId)
    const cod = normalizarCodigo(codigo)
    if (!pid || !cod) throw new Error('Prestador ou código inválido.')
    const { error } = await supabase
        .from('prestador_procedimentos')
        .delete()
        .eq('prestador_id', pid)
        .eq('procedimento_cod', cod)
    if (error) throw new Error(error.message)
    return { status: 'ok' }
}
