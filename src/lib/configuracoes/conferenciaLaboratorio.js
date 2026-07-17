import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { resolverPrestadorPorNome, sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'
import { supabase } from '../supabase.js'

export const CAMPOS_CONFERENCIA = ['tutor', 'pet', 'data', 'exame']
export const CARDS_POR_PAGINA = 10

export function normalizarNomeExame(texto) {
    return normalizarTextoBusca(texto)
}

/** Chave de atendimento: tutor + animal + data. */
export function chaveGrupoAtendimento(tutor, pet, data) {
    return `${normalizarTextoBusca(tutor)}|${normalizarTextoBusca(pet)}|${data || ''}`
}

export function normalizarCabecalho(texto) {
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
    if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        return cell.toISOString().slice(0, 10)
    }
    return String(cell).trim()
}

/**
 * Detecta campo a partir do cabeçalho (Mellis / Emerdog).
 * Ignora "Animal-proprietario", Clinica, Veterinario, Prontuario, Repasse, Diferença.
 */
function detectarCampoCabecalho(h) {
    if (!h) return null

    // Coluna composta do Mellis — não é tutor nem animal
    if (h.includes('animal') && (h.includes('propriet') || h.includes('dono'))) {
        return null
    }

    if (
        h === 'tutor' ||
        h.startsWith('tutor ') ||
        h.includes('responsavel') ||
        (h.includes('cliente') && !h.includes('animal')) ||
        h === 'dono'
    ) {
        return 'tutor'
    }

    if (
        h === 'animal' ||
        h === 'pet' ||
        h === 'paciente' ||
        h === 'nome pet' ||
        h === 'nome do pet' ||
        h === 'nome animal' ||
        h === 'nome do animal' ||
        (h.includes('animal') && !h.includes('propriet')) ||
        (h.includes('pet') && !h.includes('propriet'))
    ) {
        return 'pet'
    }

    if (
        h === 'data' ||
        h.startsWith('data ') ||
        h.includes('dt atendimento') ||
        h.includes('data atendimento') ||
        h.includes('data exame') ||
        h === 'dt'
    ) {
        return 'data'
    }

    if (
        h === 'exame' ||
        h.startsWith('exame ') ||
        h.includes('procedimento') ||
        (h.includes('descricao') && !h.includes('clinica')) ||
        h === 'servico'
    ) {
        return 'exame'
    }

    if (
        h === 'valor' ||
        h.startsWith('valor ') ||
        h === 'vlr' ||
        h === 'preco' ||
        h === 'preço'
    ) {
        return 'valor'
    }

    return null
}

export function mapearIndicesColunasConferencia(headerRow, mapeamentoManual = {}) {
    const idx = { tutor: -1, pet: -1, data: -1, exame: -1, valor: -1 }
    const headers = (headerRow || []).map((c) => String(c || ''))

    for (const campo of [...CAMPOS_CONFERENCIA, 'valor']) {
        const manual = Number(mapeamentoManual[campo])
        if (Number.isFinite(manual) && manual >= 0 && manual < headers.length) {
            idx[campo] = manual
        }
    }

    headers.forEach((raw, i) => {
        const campo = detectarCampoCabecalho(normalizarCabecalho(raw))
        if (campo && idx[campo] < 0) idx[campo] = i
    })

    return { idx, headers }
}

export function camposFaltantesMapeamento(idx) {
    return CAMPOS_CONFERENCIA.filter((campo) => Number(idx?.[campo]) < 0)
}

export function parsearDataFlexivel(valor) {
    const raw = String(valor || '').trim()
    if (!raw) return null

    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

    const br = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (br) {
        const d = Number(br[1])
        const m = Number(br[2])
        let y = Number(br[3])
        if (y < 100) y += 2000
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
            return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        }
    }

    const excelSerial = Number(raw)
    if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 80000) {
        const epoch = new Date(Date.UTC(1899, 11, 30))
        epoch.setUTCDate(epoch.getUTCDate() + Math.floor(excelSerial))
        return epoch.toISOString().slice(0, 10)
    }

    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
    return null
}

export function parsearValorMonetario(valor) {
    if (valor == null || valor === '') return null
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor

    let raw = String(valor).trim()
    if (!raw) return null
    raw = raw.replace(/[R$\s]/gi, '')

    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(raw) || /^\d+,\d{1,2}$/.test(raw)) {
        raw = raw.replace(/\./g, '').replace(',', '.')
    } else if (raw.includes(',') && !raw.includes('.')) {
        raw = raw.replace(',', '.')
    } else {
        raw = raw.replace(/,/g, '')
    }

    const n = Number(raw)
    return Number.isFinite(n) ? n : null
}

/**
 * Lê Excel (.xlsx) e devolve linhas brutas + cabeçalhos detectados.
 * @param {ArrayBuffer} buffer
 * @param {{ mapeamentoManual?: Record<string, number>, origem?: 'lab' | 'emerdog' }} [opts]
 */
export async function parsearExcelConferenciaLaboratorio(buffer, opts = {}) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(buffer)
    } catch (e) {
        const msg = String(e?.message || e)
        if (/zip|central directory|invalid|corrupt|sheets/i.test(msg) || /undefined/.test(msg)) {
            throw new Error(
                'Não foi possível ler o Excel. Use arquivo .xlsx (não .xls antigo) e verifique se não está corrompido.',
            )
        }
        throw e
    }
    const ws = workbook.worksheets[0]
    if (!ws) return { linhas: [], headers: [], idx: null, erro: 'Planilha vazia.' }

    const matrix = []
    ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = []
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            vals[colNumber - 1] = celulaTexto(cell.value)
        })
        matrix.push(vals)
    })
    if (matrix.length < 2) {
        return { linhas: [], headers: [], idx: null, erro: 'Nenhuma linha de dados encontrada.' }
    }

    const { idx, headers } = mapearIndicesColunasConferencia(matrix[0], opts.mapeamentoManual || {})
    const faltantes = camposFaltantesMapeamento(idx)
    if (faltantes.length) {
        return {
            linhas: [],
            headers,
            idx,
            faltantes,
            erro: `Mapeie as colunas obrigatórias: ${faltantes.join(', ')}.`,
        }
    }

    const linhas = []
    for (let r = 1; r < matrix.length; r += 1) {
        const row = matrix[r] || []
        const tutor = String(row[idx.tutor] || '').trim()
        const pet = String(row[idx.pet] || '').trim()
        const dataRaw = String(row[idx.data] || '').trim()
        const exame = String(row[idx.exame] || '').trim()
        if (!tutor && !pet && !dataRaw && !exame) continue
        const data = parsearDataFlexivel(dataRaw)
        const valorRaw = idx.valor >= 0 ? row[idx.valor] : ''
        const valorRelatorio = parsearValorMonetario(valorRaw)
        linhas.push({
            idLocal: `${opts.origem || 'x'}-r${r}`,
            linhaExcel: r + 1,
            tutor,
            pet,
            data,
            dataRaw,
            exame,
            exameNorm: normalizarNomeExame(exame),
            valorRelatorio,
            origem: opts.origem || null,
        })
    }

    return { linhas, headers, idx, faltantes: [], erro: null }
}

export function listarNomesExameUnicos(linhas) {
    const map = new Map()
    for (const linha of linhas || []) {
        const nome = String(linha.exame || '').trim()
        const norm = linha.exameNorm || normalizarNomeExame(nome)
        if (!norm || map.has(norm)) continue
        map.set(norm, nome)
    }
    return [...map.entries()].map(([norm, nome]) => ({ nome, norm }))
}

/** Ordena linhas por data → tutor → pet (atendimento). */
export function ordenarLinhasPorAtendimento(linhas) {
    return [...(linhas || [])].sort((a, b) => {
        const d = String(a.data || '').localeCompare(String(b.data || ''))
        if (d !== 0) return d
        const t = normalizarTextoBusca(a.tutor).localeCompare(
            normalizarTextoBusca(b.tutor),
            'pt-BR',
        )
        if (t !== 0) return t
        const p = normalizarTextoBusca(a.pet).localeCompare(normalizarTextoBusca(b.pet), 'pt-BR')
        if (p !== 0) return p
        const ca = String(a.codigo || '')
        const cb = String(b.codigo || '')
        if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
        return String(a.exame || '').localeCompare(String(b.exame || ''), 'pt-BR')
    })
}

/**
 * Agrupa linhas no mesmo atendimento (tutor + animal + data).
 * Entrada deve preferencialmente já estar ordenada.
 */
export function agruparLinhasPorAtendimento(linhas) {
    const ordenadas = ordenarLinhasPorAtendimento(linhas)
    const map = new Map()
    for (const linha of ordenadas) {
        const chave = chaveGrupoAtendimento(linha.tutor, linha.pet, linha.data)
        if (!map.has(chave)) {
            map.set(chave, {
                chave,
                tutor: linha.tutor || '—',
                pet: linha.pet || '—',
                data: linha.data || '',
                linhas: [],
            })
        }
        map.get(chave).linhas.push(linha)
    }
    return [...map.values()]
}

/** Aliases (nomes lab) já vinculados a um exame-alvo (plano/negociação). */
export function listarAliasesDoExameAlvo(resolvidosOuSalvos, nomeAlvo) {
    const alvoNorm = normalizarNomeExame(nomeAlvo)
    if (!alvoNorm) return []
    const vistos = new Set()
    const lista = []

    const push = (nomeLab) => {
        const n = String(nomeLab || '').trim()
        if (!n) return
        const key = normalizarNomeExame(n)
        if (!key || vistos.has(key)) return
        vistos.add(key)
        lista.push(n)
    }

    if (resolvidosOuSalvos instanceof Map) {
        for (const m of resolvidosOuSalvos.values()) {
            if (!m?.nomeEmerdog) continue
            if (normalizarNomeExame(m.nomeEmerdog) !== alvoNorm) continue
            push(m.nomeLab)
        }
    } else {
        for (const m of resolvidosOuSalvos || []) {
            const alvo =
                m.nome_emerdog ||
                m.nomeEmerdog ||
                null
            if (!alvo || normalizarNomeExame(alvo) !== alvoNorm) continue
            push(m.nome_lab || m.nomeLab)
        }
    }
    return lista.sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Prepara linhas ordenadas/agrupadas e monta a fila de aliases
 * (exames lab sem correspondência). Vários aliases podem apontar
 * para o mesmo exame do plano/negociação.
 */
export function prepararOrdenacaoEFilaAliases({
    linhasLab,
    linhasEmerdog,
    mapeamentosSalvos = [],
    catalogoNegociacao = [],
}) {
    const labOrd = ordenarLinhasPorAtendimento(linhasLab)
    const emOrd = ordenarLinhasPorAtendimento(linhasEmerdog)
    const gruposLab = agruparLinhasPorAtendimento(labOrd)
    const gruposEm = agruparLinhasPorAtendimento(emOrd)

    const filaPack = montarFilaMapeamento({
        linhasLab: labOrd,
        linhasEmerdog: emOrd,
        mapeamentosSalvos,
        catalogoNegociacao,
        gruposLab,
        gruposEm,
    })

    return {
        linhasLab: labOrd,
        linhasEmerdog: emOrd,
        gruposLab,
        gruposEm,
        totalAtendimentosLab: gruposLab.length,
        totalAtendimentosEm: gruposEm.length,
        ...filaPack,
    }
}

export async function carregarMapeamentosLaboratorio(laboratorioId) {
    const id = Number(laboratorioId)
    if (!id) return []
    const { data, error } = await supabase
        .from('lab_exame_mapeamento')
        .select(
            'id, laboratorio_id, nome_lab, nome_lab_normalizado, nome_emerdog, nome_emerdog_normalizado, status, confirmado_por, confirmado_em',
        )
        .eq('laboratorio_id', id)
        .order('nome_lab', { ascending: true })
    if (error) {
        if (/lab_exame_mapeamento|does not exist|schema cache/i.test(error.message)) {
            throw new Error(
                'Tabelas de conferência não configuradas. Execute scripts/sql/conferencia_laboratorio.sql.',
            )
        }
        throw new Error(error.message)
    }
    return data || []
}

export async function salvarMapeamentoExame({
    laboratorioId,
    nomeLab,
    nomeEmerdog = null,
    status = 'confirmado',
    userId,
}) {
    let confirmadoPor = null
    try {
        const { data: userData } = await supabase.auth.getUser()
        confirmadoPor = userData?.user?.id || null
    } catch {
        confirmadoPor = null
    }
    // Fallback só se o id do perfil parecer o mesmo da sessão
    if (!confirmadoPor && userId) confirmadoPor = userId

    const payload = {
        laboratorio_id: Number(laboratorioId),
        nome_lab: String(nomeLab || '').trim(),
        nome_lab_normalizado: normalizarNomeExame(nomeLab),
        nome_emerdog: nomeEmerdog ? String(nomeEmerdog).trim() : null,
        nome_emerdog_normalizado: nomeEmerdog ? normalizarNomeExame(nomeEmerdog) : null,
        status,
        confirmado_por: confirmadoPor,
        confirmado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
    }
    if (!payload.laboratorio_id || !payload.nome_lab_normalizado) {
        throw new Error('Mapeamento inválido.')
    }

    let { data, error } = await supabase
        .from('lab_exame_mapeamento')
        .upsert(payload, { onConflict: 'laboratorio_id,nome_lab_normalizado' })
        .select(
            'id, laboratorio_id, nome_lab, nome_lab_normalizado, nome_emerdog, nome_emerdog_normalizado, status',
        )
        .single()

    // Se FK de confirmado_por falhar, tenta de novo sem o usuário
    if (error && /confirmado_por|foreign key|users/i.test(error.message || '')) {
        const retry = await supabase
            .from('lab_exame_mapeamento')
            .upsert(
                { ...payload, confirmado_por: null },
                { onConflict: 'laboratorio_id,nome_lab_normalizado' },
            )
            .select(
                'id, laboratorio_id, nome_lab, nome_lab_normalizado, nome_emerdog, nome_emerdog_normalizado, status',
            )
            .single()
        data = retry.data
        error = retry.error
    }

    if (error) {
        if (/row-level security|rls/i.test(error.message || '')) {
            throw new Error(
                'Sem permissão para salvar alias (RLS). Execute novamente scripts/sql/conferencia_laboratorio.sql no Supabase.',
            )
        }
        throw new Error(error.message)
    }
    return data
}

export function sugerirNomeEmerdogParaExame(nomeLab, nomesEmerdog) {
    const itens = (nomesEmerdog || []).map((n) => ({ id: n.norm, nome: n.nome, norm: n.norm }))
    const auto = resolverPrestadorPorNome(itens, nomeLab)
    if (auto) return { sugestao: auto, sugestoes: [] }
    const sugestoes = sugerirPrestadoresPorNome(itens, nomeLab, { limite: 6 })
    return { sugestao: null, sugestoes }
}

/**
 * Monta fila de aliases para exames do laboratório sem correspondência.
 * Só deve rodar após ordenar/agrupar atendimentos (data → tutor → pet).
 * Vários nomes lab (aliases) podem mapear para o mesmo exame do plano/negociação.
 * @param {{ linhasLab, linhasEmerdog, mapeamentosSalvos?, catalogoNegociacao?, gruposLab?, gruposEm? }} args
 */
export function montarFilaMapeamento({
    linhasLab,
    linhasEmerdog,
    mapeamentosSalvos = [],
    catalogoNegociacao = [],
    gruposLab = null,
    gruposEm = null,
}) {
    const labOrd = ordenarLinhasPorAtendimento(linhasLab)
    const emOrd = ordenarLinhasPorAtendimento(linhasEmerdog)
    const nomesLab = listarNomesExameUnicos(labOrd)
    const nomesEmerdogRelatorio = listarNomesExameUnicos(emOrd)

    // Valores típicos do lab por exame (primeiro valor finito encontrado)
    const valorLabPorNorm = new Map()
    for (const linha of labOrd) {
        const norm = linha.exameNorm || normalizarNomeExame(linha.exame)
        if (!norm || valorLabPorNorm.has(norm)) continue
        const v = Number(linha.valorRelatorio)
        if (Number.isFinite(v)) valorLabPorNorm.set(norm, v)
    }

    // Catálogo completo da negociação — rótulo: Cod - Nome alt (ou sistema) - Valor
    const itensCatalogo = [...(catalogoNegociacao || [])]
        .map((item) => {
            const nome = String(item.nome || '').trim()
            const codigo = String(item.codigo || '').trim()
            const nomeAlternativo = String(item.nomeAlternativo || '').trim()
            const norm = item.nomeNorm || normalizarNomeExame(nome)
            const valor = Number.isFinite(Number(item.valor)) ? Number(item.valor) : null
            if (!nome || !norm) return null
            const nomeExibicao = nomeAlternativo || item.nomeExibicao || nome
            const partes = [codigo || null, nomeExibicao || null]
            if (valor != null) {
                partes.push(
                    valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                )
            }
            return {
                nome, // sempre nome de sistema (value do select / persistência)
                norm,
                codigo,
                valor,
                nomeAlternativo: nomeAlternativo || null,
                nomeExibicao,
                rotulo: item.rotulo || partes.filter(Boolean).join(' - '),
            }
        })
        .filter(Boolean)
        .sort((a, b) => {
            const ca = String(a.codigo || '')
            const cb = String(b.codigo || '')
            if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
            if (ca) return -1
            if (cb) return 1
            return String(a.nomeExibicao || a.nome).localeCompare(
                String(b.nomeExibicao || b.nome),
                'pt-BR',
            )
        })

    const nomesCatalogo = itensCatalogo.map((i) => i.nome)
    const catalogoNormSet = new Set(itensCatalogo.map((i) => i.norm))
    // Para match automático: relatório + catálogo
    const nomesEmerdog = [
        ...nomesEmerdogRelatorio,
        ...itensCatalogo
            .filter((i) => !nomesEmerdogRelatorio.some((r) => r.norm === i.norm))
            .map((i) => ({ nome: i.nome, norm: i.norm })),
    ]
    const salvosPorNorm = new Map(
        (mapeamentosSalvos || []).map((m) => [String(m.nome_lab_normalizado), m]),
    )
    const emerdogPorNorm = new Map(nomesEmerdog.map((n) => [n.norm, n.nome]))

    // Normas de exames do plano por atendimento (para priorizar aliases sem par)
    const gruposEmAt = gruposEm || agruparLinhasPorAtendimento(emOrd)
    const normasEmPorAt = new Map()
    for (const g of gruposEmAt) {
        const set = new Set()
        for (const l of g.linhas || []) {
            const n = l.exameNorm || normalizarNomeExame(l.exame)
            if (n) set.add(n)
        }
        normasEmPorAt.set(g.chave, set)
    }
    const gruposLabAt = gruposLab || agruparLinhasPorAtendimento(labOrd)

    /** Conta em quantos atendimentos compartilhados o exame lab não acha o nome no plano. */
    const prioridadeSemPar = new Map()
    for (const g of gruposLabAt) {
        const normasEm = normasEmPorAt.get(g.chave)
        if (!normasEm || !normasEm.size) continue
        for (const l of g.linhas || []) {
            const norm = l.exameNorm || normalizarNomeExame(l.exame)
            if (!norm) continue
            const salvo = salvosPorNorm.get(norm)
            const viaSalvo =
                salvo?.status === 'confirmado' && salvo.nome_emerdog
                    ? normalizarNomeExame(salvo.nome_emerdog)
                    : null
            const matchNorm = viaSalvo || (emerdogPorNorm.has(norm) ? norm : null)
            if (matchNorm && normasEm.has(matchNorm)) continue
            prioridadeSemPar.set(norm, (prioridadeSemPar.get(norm) || 0) + 1)
        }
    }

    const fila = []
    const resolvidos = new Map()
    const aliasesPorAlvo = new Map()

    const registrarAliasResolvido = (nomeLab, nomeEmerdog, status) => {
        if (!nomeEmerdog) return
        const key = normalizarNomeExame(nomeEmerdog)
        if (!aliasesPorAlvo.has(key)) aliasesPorAlvo.set(key, [])
        const lista = aliasesPorAlvo.get(key)
        if (!lista.some((a) => normalizarNomeExame(a) === normalizarNomeExame(nomeLab))) {
            lista.push(nomeLab)
        }
        void status
    }

    for (const item of nomesLab) {
        const salvo = salvosPorNorm.get(item.norm)
        if (salvo?.status === 'confirmado' && salvo.nome_emerdog) {
            resolvidos.set(item.norm, {
                nomeLab: item.nome,
                nomeEmerdog: salvo.nome_emerdog,
                status: 'mapeado_automaticamente',
            })
            registrarAliasResolvido(item.nome, salvo.nome_emerdog, 'salvo')
            continue
        }
        if (salvo?.status === 'pendente_auditoria') {
            resolvidos.set(item.norm, {
                nomeLab: item.nome,
                nomeEmerdog: null,
                status: 'pendente_auditoria',
            })
            continue
        }

        if (emerdogPorNorm.has(item.norm)) {
            const nomeAlvo = emerdogPorNorm.get(item.norm)
            resolvidos.set(item.norm, {
                nomeLab: item.nome,
                nomeEmerdog: nomeAlvo,
                status: 'mapeado_automaticamente',
            })
            registrarAliasResolvido(item.nome, nomeAlvo, 'exato')
            continue
        }

        const { sugestao, sugestoes } = sugerirNomeEmerdogParaExame(item.nome, [
            ...itensCatalogo.map((i) => ({ nome: i.nome, norm: i.norm })),
            ...nomesEmerdogRelatorio,
        ])
        const sugestaoNome = sugestao?.nome || sugestoes[0]?.nome || itensCatalogo[0]?.nome || ''
        const sugestoesComCodigo = (sugestoes.length ? sugestoes : [])
            .map((s) => {
                const cat = itensCatalogo.find((i) => i.norm === normalizarNomeExame(s.nome || s))
                const nome = s.nome || s
                return cat ? cat.rotulo : nome
            })
            .slice(0, 6)

        fila.push({
            nomeLab: item.nome,
            nomeLabNorm: item.norm,
            valorLab: valorLabPorNorm.has(item.norm) ? valorLabPorNorm.get(item.norm) : null,
            sugestao: sugestaoNome,
            sugestoes: sugestoes.map((s) => s.nome),
            sugestoesRotulo: sugestoesComCodigo,
            nomesEmerdog: nomesEmerdogRelatorio.map((n) => n.nome),
            nomesCatalogo,
            itensCatalogo,
            noCatalogo: catalogoNormSet.has(item.norm),
            atendimentosSemPar: prioridadeSemPar.get(item.norm) || 0,
            aliasesDoSugestao: sugestaoNome
                ? listarAliasesDoExameAlvo(
                      [...resolvidos.values()]
                          .map((r) => ({
                              nomeLab: r.nomeLab,
                              nomeEmerdog: r.nomeEmerdog,
                          }))
                          .concat(
                              (mapeamentosSalvos || []).map((m) => ({
                                  nomeLab: m.nome_lab,
                                  nomeEmerdog: m.nome_emerdog,
                              })),
                          ),
                      sugestaoNome,
                  )
                : [],
        })
    }

    // Prioriza exames que aparecem sem correspondente em atendimentos
    fila.sort((a, b) => {
        const p = (b.atendimentosSemPar || 0) - (a.atendimentosSemPar || 0)
        if (p !== 0) return p
        return String(a.nomeLab).localeCompare(String(b.nomeLab), 'pt-BR')
    })

    return {
        fila,
        resolvidos,
        nomesEmerdog,
        nomesCatalogo,
        itensCatalogo,
        aliasesPorAlvo,
    }
}

/** Chave de comparação: tutor + animal + data + exame (já no “idioma” Emerdog). */
export function chaveMatchExame(tutor, pet, data, exameNorm) {
    return [
        normalizarTextoBusca(tutor),
        normalizarTextoBusca(pet),
        data || '',
        exameNorm || '',
    ].join('|')
}

function exameNormParaMatchLab(linha, resolvidosMapeamento) {
    const map = resolvidosMapeamento.get(linha.exameNorm)
    if (map?.nomeEmerdog) return normalizarNomeExame(map.nomeEmerdog)
    if (map?.status === 'pendente_auditoria') return null
    return linha.exameNorm || normalizarNomeExame(linha.exame)
}

function enriquecerLinhaLab(linha, resolvidosMapeamento) {
    const map = resolvidosMapeamento.get(linha.exameNorm)
    const exameMatchNorm = exameNormParaMatchLab(linha, resolvidosMapeamento)
    return {
        ...linha,
        nomeEmerdogMapeado: map?.nomeEmerdog || null,
        statusMapeamento: map?.status || null,
        exameMatchNorm,
    }
}

export function enriquecerLinhaEmerdog(
    linha,
    precosPorNomeNorm,
    resolvidosMapeamento = new Map(),
    nomeSistemaPorNorm = new Map(),
) {
    const exameNorm = linha.exameNorm || normalizarNomeExame(linha.exame)
    const map = resolvidosMapeamento.get(exameNorm)

    // Resolve para nome de sistema via alt/código/mapeamento (evita preço zerado)
    let nomeSistema =
        nomeSistemaPorNorm.get(exameNorm) ||
        (map?.nomeEmerdog ? nomeSistemaPorNorm.get(normalizarNomeExame(map.nomeEmerdog)) : null) ||
        map?.nomeEmerdog ||
        null

    let valorNegociacao = precosPorNomeNorm.get(exameNorm)
    if (!Number.isFinite(Number(valorNegociacao)) || Number(valorNegociacao) === 0) {
        if (nomeSistema) {
            const vSis = precosPorNomeNorm.get(normalizarNomeExame(nomeSistema))
            if (Number.isFinite(Number(vSis)) && Number(vSis) !== 0) valorNegociacao = vSis
        }
    }
    if ((!Number.isFinite(Number(valorNegociacao)) || Number(valorNegociacao) === 0) && map?.nomeEmerdog) {
        const vMap = precosPorNomeNorm.get(normalizarNomeExame(map.nomeEmerdog))
        if (Number.isFinite(Number(vMap)) && Number(vMap) !== 0) {
            valorNegociacao = vMap
            if (!nomeSistema) nomeSistema = map.nomeEmerdog
        }
    }

    const nomeNegociacao = nomeSistema || map?.nomeEmerdog || null
    const exameMatchNorm = nomeNegociacao
        ? normalizarNomeExame(nomeNegociacao)
        : exameNorm

    return {
        ...linha,
        exameMatchNorm,
        nomeNegociacao,
        nomeSistemaNegociacao: nomeSistema || null,
        valorNegociacao: Number.isFinite(Number(valorNegociacao)) ? Number(valorNegociacao) : null,
        semParNegociacao: !Number.isFinite(Number(valorNegociacao)),
    }
}

function resolverValorDoLabViaMapeamento(lab, precosPorNomeNorm, nomeSistemaPorNorm = new Map()) {
    const tentar = (nome) => {
        if (!nome) return null
        const norm = normalizarNomeExame(nome)
        const v = precosPorNomeNorm.get(norm)
        if (Number.isFinite(Number(v)) && Number(v) !== 0) return Number(v)
        const sis = nomeSistemaPorNorm.get(norm)
        if (sis) {
            const v2 = precosPorNomeNorm.get(normalizarNomeExame(sis))
            if (Number.isFinite(Number(v2))) return Number(v2)
        }
        if (Number.isFinite(Number(v))) return Number(v)
        return null
    }
    return (
        tentar(lab.nomeEmerdogMapeado) ??
        tentar(lab.exameNorm || lab.exame) ??
        null
    )
}

function resolverCodigoPorNome(nomeOuNorm, codigoPorNomeNorm = new Map(), resolvidosMapeamento = new Map()) {
    const norm = normalizarNomeExame(nomeOuNorm)
    if (!norm) return ''
    if (codigoPorNomeNorm.has(norm)) return String(codigoPorNomeNorm.get(norm) || '')
    const map = resolvidosMapeamento.get(norm)
    if (map?.nomeEmerdog) {
        const viaMap = codigoPorNomeNorm.get(normalizarNomeExame(map.nomeEmerdog))
        if (viaMap) return String(viaMap)
    }
    return ''
}

export function valoresExameDiferem(valorA, valorB, tolerancia = 0.009) {
    if (!Number.isFinite(Number(valorA)) || !Number.isFinite(Number(valorB))) return false
    return Math.abs(Number(valorA) - Number(valorB)) > tolerancia
}

export function ordenarExamesPorCodigo(exames) {
    return [...(exames || [])].sort((a, b) => {
        const ca = String(a.codigo || '')
        const cb = String(b.codigo || '')
        if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
        if (ca) return -1
        if (cb) return 1
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
    })
}

/**
 * Score de pareamento entre exames (nome e/ou código).
 * Código idêntico (não vazio) conta como match pleno.
 * Códigos ambos preenchidos e diferentes → 0 (nunca parear CREATININA com PCR urinária etc.).
 */
export function scorePareamentoExame(lab, em) {
    const codL = String(lab?.codigo || '').trim().toUpperCase()
    const codE = String(em?.codigo || '').trim().toUpperCase()
    if (codL && codE && codL === codE) return 1000
    if (codL && codE && codL !== codE) return 0

    const candidatosLab = [lab?.nomeNorm, lab?.nome].filter(Boolean)
    const candidatosEm = [em?.nomeNorm, em?.nome].filter(Boolean)
    let melhor = 0
    for (const a of candidatosLab) {
        for (const b of candidatosEm) {
            const s = scoreSimilaridadeNome(a, b)
            if (s > melhor) melhor = s
        }
    }
    return melhor
}

function parearLabComEm(lab, em) {
    const valoresDiferem = valoresExameDiferem(lab.valor, em.valor)
    const labOut = {
        ...lab,
        codigo: lab.codigo || em.codigo || '',
        valoresDiferem,
        semPar: false,
        idParEm: em.idLocal,
    }
    em.valoresDiferem = valoresDiferem
    em.semPar = false
    em.idParLab = lab.idLocal
    em.codigo = em.codigo || lab.codigo || ''
    return labOut
}

/**
 * Ordena exames do plano por código e alinha os do lab na mesma ordem do correspondente.
 * 1º pass: só código idêntico; 2º: similaridade de nome (sem roubar par de outro código).
 * Marca valoresDiferem quando o par bate e os valores divergem; semPar (amarelo) se não houver par.
 */
export function alinharExamesLabAoCodigoDoPlano(examesLab, examesEm) {
    const emOrd = ordenarExamesPorCodigo(examesEm).map((e) => ({ ...e }))
    const labRest = (examesLab || []).map((e) => ({ ...e }))
    const labPorEmId = new Map()

    for (const em of emOrd) {
        const codE = String(em?.codigo || '').trim().toUpperCase()
        if (!codE) continue
        const idx = labRest.findIndex(
            (lab) => String(lab?.codigo || '').trim().toUpperCase() === codE,
        )
        if (idx < 0) continue
        const [lab] = labRest.splice(idx, 1)
        labPorEmId.set(em.idLocal, parearLabComEm(lab, em))
    }

    for (const em of emOrd) {
        if (em.idParLab) continue
        let melhorIdx = -1
        let melhorScore = 0
        for (let i = 0; i < labRest.length; i += 1) {
            const score = scorePareamentoExame(labRest[i], em)
            if (score > melhorScore) {
                melhorScore = score
                melhorIdx = i
            }
        }
        if (melhorIdx >= 0 && melhorScore >= 650) {
            const [lab] = labRest.splice(melhorIdx, 1)
            labPorEmId.set(em.idLocal, parearLabComEm(lab, em))
        } else {
            em.valoresDiferem = false
            em.semPar = true
            em.idParLab = null
        }
    }

    const labOrd = []
    for (const em of emOrd) {
        const lab = labPorEmId.get(em.idLocal)
        if (lab) labOrd.push(lab)
    }
    for (const lab of ordenarExamesPorCodigo(labRest)) {
        labOrd.push({ ...lab, valoresDiferem: false, semPar: true, idParEm: null })
    }
    for (const em of emOrd) {
        if (em.valoresDiferem == null) em.valoresDiferem = false
        if (em.semPar == null) em.semPar = !em.idParLab
        if (em.idParLab == null) em.idParLab = null
    }

    return { examesLab: labOrd, examesEm: emOrd }
}

function montarCardPareado(lab, emerdog, opts = {}) {
    const codigoPorNomeNorm = opts.codigoPorNomeNorm || new Map()
    const resolvidos = opts.resolvidosMapeamento || new Map()
    const valorLab = Number.isFinite(Number(lab.valorRelatorio)) ? Number(lab.valorRelatorio) : null
    let valorEmerdog = Number.isFinite(Number(emerdog.valorNegociacao))
        ? Number(emerdog.valorNegociacao)
        : null
    if (valorEmerdog == null && opts.precosPorNomeNorm) {
        valorEmerdog = resolverValorDoLabViaMapeamento(
            lab,
            opts.precosPorNomeNorm,
            opts.nomeSistemaPorNorm || new Map(),
        )
    }
    // Se veio 0, tenta de novo pelo nome de sistema
    if (
        (valorEmerdog == null || valorEmerdog === 0) &&
        opts.precosPorNomeNorm &&
        (emerdog.nomeSistemaNegociacao || emerdog.nomeNegociacao)
    ) {
        const vSis = opts.precosPorNomeNorm.get(
            normalizarNomeExame(emerdog.nomeSistemaNegociacao || emerdog.nomeNegociacao),
        )
        if (Number.isFinite(Number(vSis)) && Number(vSis) !== 0) valorEmerdog = Number(vSis)
    }
    const diferenca =
        valorLab != null && valorEmerdog != null ? Number((valorLab - valorEmerdog).toFixed(2)) : null
    const valoresDiferem = valoresExameDiferem(valorLab, valorEmerdog)

    const exameParaNormalizar = emerdog.exame || lab.exame || null
    const semParNegociacao = valorEmerdog == null && Boolean(exameParaNormalizar)
    const codigo =
        resolverCodigoPorNome(emerdog.exame, codigoPorNomeNorm, resolvidos) ||
        resolverCodigoPorNome(emerdog.nomeNegociacao || lab.nomeEmerdogMapeado, codigoPorNomeNorm) ||
        resolverCodigoPorNome(lab.exame, codigoPorNomeNorm, resolvidos)

    let status = opts.status
    if (!status) {
        if (semParNegociacao || valoresDiferem) status = 'pendente'
        else status = 'verde'
    }

    return {
        tipo: 'pareado',
        chave: opts.chaveManual || chaveMatchExame(lab.tutor, lab.pet, lab.data, lab.exameMatchNorm),
        tutor: lab.tutor || emerdog.tutor || '—',
        pet: lab.pet || emerdog.pet || '—',
        data: lab.data || emerdog.data,
        exameLaboratorio: lab.exame,
        exameEmerdog: emerdog.exame,
        nomeNegociacao:
            emerdog.nomeSistemaNegociacao ||
            emerdog.nomeNegociacao ||
            lab.nomeEmerdogMapeado ||
            null,
        codigo,
        valorLab,
        valorEmerdog,
        diferenca,
        valoresDiferem,
        status,
        combinadoManual: Boolean(opts.combinadoManual),
        semParNegociacao,
        exameParaNormalizar,
        idLabLocal: lab.idLocal,
        idEmerdogLocal: emerdog.idLocal,
        linhaExcelLab: lab.linhaExcel,
        linhaExcelEmerdog: emerdog.linhaExcel,
    }
}

function montarCardOrfao(
    lado,
    linha,
    precosPorNomeNorm = new Map(),
    codigoPorNomeNorm = new Map(),
    resolvidosMapeamento = new Map(),
    nomeSistemaPorNorm = new Map(),
) {
    const isLab = lado === 'lab'
    let valorEmerdog = null
    let semParNegociacao = false
    let exameParaNormalizar = null
    let nomeNegociacao = null

    if (isLab) {
        exameParaNormalizar = linha.exame || null
        valorEmerdog = resolverValorDoLabViaMapeamento(
            linha,
            precosPorNomeNorm,
            nomeSistemaPorNorm,
        )
        nomeNegociacao =
            linha.nomeEmerdogMapeado ||
            nomeSistemaPorNorm.get(normalizarNomeExame(linha.exame)) ||
            null
        if (nomeNegociacao && (valorEmerdog == null || valorEmerdog === 0)) {
            const v = precosPorNomeNorm.get(normalizarNomeExame(nomeNegociacao))
            if (Number.isFinite(Number(v))) valorEmerdog = Number(v)
        }
        semParNegociacao = Boolean(exameParaNormalizar) && valorEmerdog == null
    } else {
        exameParaNormalizar = linha.exame || null
        valorEmerdog = Number.isFinite(Number(linha.valorNegociacao))
            ? Number(linha.valorNegociacao)
            : null
        nomeNegociacao =
            linha.nomeSistemaNegociacao || linha.nomeNegociacao || null
        semParNegociacao = Boolean(exameParaNormalizar) && valorEmerdog == null
    }

    const codigo =
        resolverCodigoPorNome(nomeNegociacao || linha.exame, codigoPorNomeNorm, resolvidosMapeamento) ||
        resolverCodigoPorNome(linha.exame, codigoPorNomeNorm, resolvidosMapeamento)

    return {
        tipo: isLab ? 'orfao_lab' : 'orfao_emerdog',
        chave: `${lado}:${linha.idLocal}`,
        tutor: linha.tutor || '—',
        pet: linha.pet || '—',
        data: linha.data,
        exameLaboratorio: isLab ? linha.exame : null,
        exameEmerdog: isLab ? null : linha.exame,
        nomeNegociacao,
        codigo,
        valorLab: isLab
            ? Number.isFinite(Number(linha.valorRelatorio))
                ? Number(linha.valorRelatorio)
                : null
            : null,
        valorEmerdog,
        diferenca: null,
        valoresDiferem: false,
        status: 'pendente',
        combinadoManual: false,
        semParNegociacao,
        exameParaNormalizar,
        idLabLocal: isLab ? linha.idLocal : null,
        idEmerdogLocal: isLab ? null : linha.idLocal,
        linhaExcelLab: isLab ? linha.linhaExcel : null,
        linhaExcelEmerdog: isLab ? null : linha.linhaExcel,
        _linhaLab: isLab ? linha : null,
        _linhaEmerdog: isLab ? null : linha,
    }
}

/**
 * Compara por tutor/animal/data/exame.
 * Valor lab = relatório do lab; valor plano = negociacoes_vet.
 * Itens sem par ficam como órfãos (combináveis manualmente na UI).
 */
export function montarCardsConferencia({
    linhasLab,
    linhasEmerdog,
    resolvidosMapeamento,
    precosPorNomeNorm = new Map(),
    codigoPorNomeNorm = new Map(),
    nomeSistemaPorNorm = new Map(),
    paresManuais = [],
}) {
    const labs = (linhasLab || []).map((l) => enriquecerLinhaLab(l, resolvidosMapeamento))
    const emerdogs = (linhasEmerdog || []).map((l) =>
        enriquecerLinhaEmerdog(l, precosPorNomeNorm, resolvidosMapeamento, nomeSistemaPorNorm),
    )

    const usadoLab = new Set()
    const usadoEm = new Set()
    const cards = []
    const optsPar = {
        precosPorNomeNorm,
        codigoPorNomeNorm,
        nomeSistemaPorNorm,
        resolvidosMapeamento,
    }

    // Pares manuais primeiro
    const labPorId = new Map(labs.map((l) => [l.idLocal, l]))
    const emPorId = new Map(emerdogs.map((l) => [l.idLocal, l]))
    for (const par of paresManuais || []) {
        const lab = labPorId.get(par.idLabLocal)
        const em = emPorId.get(par.idEmerdogLocal)
        if (!lab || !em) continue
        if (usadoLab.has(lab.idLocal) || usadoEm.has(em.idLocal)) continue
        usadoLab.add(lab.idLocal)
        usadoEm.add(em.idLocal)
        cards.push(
            montarCardPareado(lab, em, {
                ...optsPar,
                combinadoManual: true,
                status: 'conferido_manual',
                chaveManual: `manual:${lab.idLocal}|${em.idLocal}`,
            }),
        )
    }

    // Índice Emerdog por chave de match
    const bucketEm = new Map()
    for (const em of emerdogs) {
        if (usadoEm.has(em.idLocal) || !em.data || !em.exameMatchNorm) continue
        const chave = chaveMatchExame(em.tutor, em.pet, em.data, em.exameMatchNorm)
        if (!bucketEm.has(chave)) bucketEm.set(chave, [])
        bucketEm.get(chave).push(em)
    }

    for (const lab of labs) {
        if (usadoLab.has(lab.idLocal)) continue
        if (!lab.data || !lab.exameMatchNorm) continue
        const chave = chaveMatchExame(lab.tutor, lab.pet, lab.data, lab.exameMatchNorm)
        const fila = bucketEm.get(chave) || []
        const em = fila.shift()
        if (!em) continue
        usadoLab.add(lab.idLocal)
        usadoEm.add(em.idLocal)
        cards.push(montarCardPareado(lab, em, optsPar))
    }

    // Pareia remanescentes do mesmo atendimento (tutor+pet+data) por similaridade de exame
    // (sem fallback 1:1 — isso só ocorre após aprovação manual de órfãos)
    const labsRestPorAt = new Map()
    const emsRestPorAt = new Map()
    for (const lab of labs) {
        if (usadoLab.has(lab.idLocal)) continue
        const k = chaveGrupoAtendimento(lab.tutor, lab.pet, lab.data)
        if (!labsRestPorAt.has(k)) labsRestPorAt.set(k, [])
        labsRestPorAt.get(k).push(lab)
    }
    for (const em of emerdogs) {
        if (usadoEm.has(em.idLocal)) continue
        const k = chaveGrupoAtendimento(em.tutor, em.pet, em.data)
        if (!emsRestPorAt.has(k)) emsRestPorAt.set(k, [])
        emsRestPorAt.get(k).push(em)
    }
    for (const [chaveAt, labsG] of labsRestPorAt) {
        const emsG = emsRestPorAt.get(chaveAt)
        if (!emsG?.length) continue
        const usadoEmLocal = new Set()
        for (const lab of labsG) {
            if (usadoLab.has(lab.idLocal)) continue
            let melhor = null
            let melhorScore = 0
            for (const em of emsG) {
                if (usadoEm.has(em.idLocal) || usadoEmLocal.has(em.idLocal)) continue
                const codLab =
                    resolverCodigoPorNome(lab.exame, codigoPorNomeNorm, resolvidosMapeamento) ||
                    resolverCodigoPorNome(
                        lab.nomeEmerdogMapeado || lab.exameMatchNorm,
                        codigoPorNomeNorm,
                        resolvidosMapeamento,
                    )
                const codEm =
                    resolverCodigoPorNome(em.exame, codigoPorNomeNorm, resolvidosMapeamento) ||
                    resolverCodigoPorNome(
                        em.nomeNegociacao || em.exameMatchNorm,
                        codigoPorNomeNorm,
                        resolvidosMapeamento,
                    )
                const score = scorePareamentoExame(
                    {
                        nome: lab.exame,
                        nomeNorm: lab.exameMatchNorm || lab.exameNorm || lab.exame,
                        codigo: codLab,
                    },
                    {
                        nome: em.exame,
                        nomeNorm: em.exameMatchNorm || em.exameNorm || em.exame,
                        codigo: codEm,
                    },
                )
                if (score > melhorScore) {
                    melhorScore = score
                    melhor = em
                }
            }
            if (!melhor || melhorScore < 650) continue
            usadoLab.add(lab.idLocal)
            usadoEm.add(melhor.idLocal)
            usadoEmLocal.add(melhor.idLocal)
            cards.push(montarCardPareado(lab, melhor, optsPar))
        }
    }

    for (const lab of labs) {
        if (usadoLab.has(lab.idLocal)) continue
        cards.push(
            montarCardOrfao(
                'lab',
                lab,
                precosPorNomeNorm,
                codigoPorNomeNorm,
                resolvidosMapeamento,
                nomeSistemaPorNorm,
            ),
        )
    }
    for (const em of emerdogs) {
        if (usadoEm.has(em.idLocal)) continue
        cards.push(
            montarCardOrfao(
                'emerdog',
                em,
                precosPorNomeNorm,
                codigoPorNomeNorm,
                resolvidosMapeamento,
                nomeSistemaPorNorm,
            ),
        )
    }

    cards.sort((a, b) => {
        const at = chaveGrupoAtendimento(a.tutor, a.pet, a.data)
        const bt = chaveGrupoAtendimento(b.tutor, b.pet, b.data)
        if (at !== bt) {
            const d = String(a.data || '').localeCompare(String(b.data || ''))
            if (d !== 0) return d
            const t = String(a.tutor || '').localeCompare(String(b.tutor || ''), 'pt-BR')
            if (t !== 0) return t
            return String(a.pet || '').localeCompare(String(b.pet || ''), 'pt-BR')
        }
        const ca = String(a.codigo || '')
        const cb = String(b.codigo || '')
        if (ca && cb && ca !== cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
        return String(a.exameEmerdog || a.exameLaboratorio || '').localeCompare(
            String(b.exameEmerdog || b.exameLaboratorio || ''),
            'pt-BR',
        )
    })

    return cards
}

/**
 * Aplica combinação manual de dois órfãos e remonta a lista de cards.
 */
export function combinarOrfaosNosCards(cards, idLabLocal, idEmerdogLocal) {
    const orfaoLab = (cards || []).find(
        (c) => c.tipo === 'orfao_lab' && c.idLabLocal === idLabLocal,
    )
    const orfaoEm = (cards || []).find(
        (c) => c.tipo === 'orfao_emerdog' && c.idEmerdogLocal === idEmerdogLocal,
    )
    if (!orfaoLab?._linhaLab || !orfaoEm?._linhaEmerdog) {
        throw new Error('Selecione um órfão do laboratório e um do plano.')
    }

    const novo = montarCardPareado(orfaoLab._linhaLab, orfaoEm._linhaEmerdog, {
        combinadoManual: true,
        status: 'conferido_manual',
        chaveManual: `manual:${idLabLocal}|${idEmerdogLocal}`,
    })

    const resto = (cards || []).filter(
        (c) =>
            !(c.tipo === 'orfao_lab' && c.idLabLocal === idLabLocal) &&
            !(c.tipo === 'orfao_emerdog' && c.idEmerdogLocal === idEmerdogLocal),
    )
    return [novo, ...resto]
}

/** Score 0–1000 de similaridade textual (mesma lógica da sugestão de prestadores). */
export function scoreSimilaridadeNome(a, b) {
    const termo = normalizarTextoBusca(a)
    const n = normalizarTextoBusca(b)
    if (!termo || !n) return 0
    if (n === termo) return 1000
    if (n.startsWith(termo) || termo.startsWith(n)) return 850

    const palavrasTermo = termo.split(/\s+/).filter(Boolean)
    const palavrasN = n.split(/\s+/).filter(Boolean)
    // Evita "creatinina" ⊂ "relacao proteina creatinina urinaria" virar match pleno (650).
    const substringFraca =
        (termo.includes(n) || n.includes(termo)) &&
        Math.min(palavrasTermo.length, palavrasN.length) === 1 &&
        Math.max(palavrasTermo.length, palavrasN.length) >= 2
    if ((n.includes(termo) || termo.includes(n)) && !substringFraca) return 650

    const palavras = palavrasTermo.filter((w) => w.length >= 2)
    const palavrasCurtas = palavrasTermo.filter((w) => w.length === 1)
    const palavrasNome = palavrasN
    let hits = 0
    for (const w of palavras) {
        if (palavrasNome.some((pn) => pn.startsWith(w) || pn.includes(w))) hits += 1
    }
    for (const w of palavrasCurtas) {
        if (palavrasNome.some((pn) => pn.startsWith(w))) hits += 0.5
    }
    if (hits > 0 && (palavras.length || palavrasCurtas.length)) {
        const total = Math.max(palavras.length + palavrasCurtas.length * 0.5, 1)
        return 180 + Math.round((120 * hits) / total)
    }
    return 0
}

/**
 * Mesmo nome com grafia diferente (ex.: «GIORDANA» · «GIORDANA GOMERLATO»).
 * Não une só pelo primeiro nome («PATRICIA A» ≠ «PATRICIA B»).
 */
export function nomeCorrespondeFoco(nome, focoNorm, focoLabel = '') {
    const n = normalizarTextoBusca(nome)
    const foco = String(focoNorm || '').trim() || normalizarTextoBusca(focoLabel)
    if (!n || !foco) return false
    if (n === foco) return true

    const ref = String(focoLabel || foco).trim()
    const score = scoreSimilaridadeNome(ref || foco, nome)
    if (score >= 650) return true

    // Prefixo só quando o menor tem ≥ 2 palavras OU ≥ 8 chars (evita «patricia» sozinho)
    const menor = n.length <= foco.length ? n : foco
    const maior = n.length <= foco.length ? foco : n
    if (maior.startsWith(menor)) {
        const palavrasMenor = menor.split(/\s+/).filter(Boolean)
        if (palavrasMenor.length >= 2 || menor.length >= 8) return true
    }
    return false
}

/** @deprecated use nomeCorrespondeFoco */
export function tutorCorrespondeFoco(nomeTutor, focoNorm, focoLabel = '') {
    return nomeCorrespondeFoco(nomeTutor, focoNorm, focoLabel)
}

function scoreDataProximidade(dataA, dataB) {
    if (!dataA || !dataB) return 0
    if (dataA === dataB) return 200
    const ta = Date.parse(dataA)
    const tb = Date.parse(dataB)
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0
    const dias = Math.abs(ta - tb) / 86400000
    if (dias <= 1) return 120
    if (dias <= 3) return 60
    if (dias <= 7) return 25
    return 0
}

function rotulosMotivosGrupo({ scoreTutor, scorePet, scoreData, examesComuns, qtdLab, qtdEm }) {
    const motivos = []
    if (scoreTutor >= 1000) motivos.push('Tutor idêntico')
    else if (scoreTutor >= 650) motivos.push('Tutor parecido')
    else if (scoreTutor >= 180) motivos.push('Tutor parcialmente parecido')

    if (scorePet >= 1000) motivos.push('Animal idêntico')
    else if (scorePet >= 650) motivos.push('Animal parecido')
    else if (scorePet >= 180) motivos.push('Animal parcialmente parecido')

    if (scoreData >= 200) motivos.push('Mesma data')
    else if (scoreData >= 60) motivos.push('Data próxima')

    if (examesComuns > 0) {
        motivos.push(
            examesComuns === 1
                ? '1 exame em comum'
                : `${examesComuns} exames em comum`,
        )
    }
    motivos.push(`${qtdLab} exame(s) lab · ${qtdEm} exame(s) plano`)
    return motivos
}

function exameNormDoCardOrfao(card, lado) {
    if (lado === 'lab') {
        const lab = card._linhaLab || card
        return (
            lab.exameMatchNorm ||
            normalizarNomeExame(lab.nomeEmerdogMapeado || lab.exame || card.exameLaboratorio)
        )
    }
    const em = card._linhaEmerdog || card
    return em.exameMatchNorm || normalizarNomeExame(em.exame || card.exameEmerdog)
}

/**
 * Unifica cards de exame em um card de atendimento (tutor + animal + data).
 * Exames sem par ficam com `semPar` (amarelo na UI); divergência de valor usa `valoresDiferem`.
 */
export function agruparCardsComparacaoPorAtendimento(cards) {
    const grupos = new Map()
    for (const card of cards || []) {
        const chave = chaveGrupoAtendimento(card.tutor, card.pet, card.data)
        if (!grupos.has(chave)) {
            grupos.set(chave, {
                chave,
                tutor: card.tutor || '—',
                pet: card.pet || '—',
                data: card.data || '',
                cardsExame: [],
            })
        }
        grupos.get(chave).cardsExame.push(card)
    }

    const resultado = []
    for (const g of grupos.values()) {
        const linhas = []
        const usados = new Set()

        const addLinha = ({ card, lab, em, semPar }) => {
            const valoresDiferem = Boolean(card.valoresDiferem)
            linhas.push({
                idLocal: card.idLocal,
                card,
                codigo: card.codigo || lab?.codigo || em?.codigo || '',
                lab,
                em,
                valoresDiferem,
                semPar: Boolean(semPar),
                semParNegociacao: Boolean(card.semParNegociacao),
                status: card.status,
                tipo: card.tipo,
                diferenca: card.diferenca,
            })
            usados.add(card.idLocal)
        }

        for (const card of g.cardsExame) {
            if (card.tipo === 'pareado' || (card.idLabLocal && card.idEmerdogLocal)) {
                if (usados.has(card.idLocal)) continue
                addLinha({
                    card,
                    lab: card.exameLaboratorio
                        ? {
                              nome: card.exameLaboratorio,
                              valor: card.valorLab,
                              codigo: card.codigo || '',
                          }
                        : null,
                    em: {
                        nome: card.nomeNegociacao || card.exameEmerdog || '—',
                        valor: card.valorEmerdog,
                        codigo: card.codigo || '',
                    },
                    semPar: false,
                })
            }
        }

        for (const card of g.cardsExame) {
            if (card.tipo !== 'orfao_lab' || usados.has(card.idLocal)) continue
            addLinha({
                card,
                lab: {
                    nome: card.exameLaboratorio || '—',
                    valor: card.valorLab,
                    codigo: card.codigo || '',
                },
                em: null,
                semPar: true,
            })
        }

        for (const card of g.cardsExame) {
            if (card.tipo !== 'orfao_emerdog' || usados.has(card.idLocal)) continue
            addLinha({
                card,
                lab: null,
                em: {
                    nome: card.nomeNegociacao || card.exameEmerdog || '—',
                    valor: card.valorEmerdog,
                    codigo: card.codigo || '',
                },
                semPar: true,
            })
        }

        for (const card of g.cardsExame) {
            if (usados.has(card.idLocal)) continue
            addLinha({
                card,
                lab: card.exameLaboratorio
                    ? {
                          nome: card.exameLaboratorio,
                          valor: card.valorLab,
                          codigo: card.codigo || '',
                      }
                    : null,
                em:
                    card.exameEmerdog || card.nomeNegociacao
                        ? {
                              nome: card.nomeNegociacao || card.exameEmerdog,
                              valor: card.valorEmerdog,
                              codigo: card.codigo || '',
                          }
                        : null,
                semPar: card.tipo === 'orfao_lab' || card.tipo === 'orfao_emerdog',
            })
        }

        linhas.sort((a, b) => {
            const ca = String(a.codigo || '')
            const cb = String(b.codigo || '')
            if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
            if (ca) return -1
            if (cb) return 1
            const na = a.lab?.nome || a.em?.nome || ''
            const nb = b.lab?.nome || b.em?.nome || ''
            return String(na).localeCompare(String(nb), 'pt-BR')
        })

        const examesLab = linhas.map((l) => ({
            idLocal: l.card.idLabLocal || `lab-${l.idLocal}`,
            nome: l.lab?.nome || '',
            valor: l.lab ? l.lab.valor : null,
            codigo: l.lab?.codigo || l.codigo || '',
            vazio: !l.lab,
            valoresDiferem: l.valoresDiferem,
            semPar: Boolean(l.semPar || !l.lab),
            card: l.card,
            linhaId: l.idLocal,
        }))

        const examesEm = linhas.map((l) => ({
            idLocal: l.card.idEmerdogLocal || `em-${l.idLocal}`,
            nome: l.em?.nome || '',
            valor: l.em ? l.em.valor : null,
            codigo: l.em?.codigo || l.codigo || '',
            vazio: !l.em,
            valoresDiferem: l.valoresDiferem,
            semPar: Boolean(l.semPar || !l.em),
            semParNegociacao: l.semParNegociacao,
            card: l.card,
            linhaId: l.idLocal,
        }))

        const soma = (lista) =>
            Number(
                lista
                    .map((e) => Number(e.valor))
                    .filter((n) => Number.isFinite(n))
                    .reduce((a, n) => a + n, 0)
                    .toFixed(2),
            )

        const temOrfao = linhas.some((l) => l.semPar)
        const temDiff = linhas.some((l) => l.valoresDiferem)
        const todosConferidos = linhas.every(
            (l) => l.status === 'verde' || l.status === 'conferido_manual',
        )
        const algumManual = linhas.some((l) => l.status === 'conferido_manual')

        let status = 'pendente'
        if (todosConferidos && !temOrfao && !temDiff) {
            status = algumManual ? 'conferido_manual' : 'verde'
        }

        resultado.push({
            tipo: 'atendimento',
            chave: g.chave,
            idLocal: `at:${g.chave}`,
            tutor: g.tutor,
            pet: g.pet,
            data: g.data,
            linhas,
            examesLab,
            examesEm,
            subtotalLab: soma(examesLab),
            subtotalEm: soma(examesEm),
            status,
            temOrfao,
            temDiff,
            cardsExame: g.cardsExame,
            qtdExames: linhas.length,
            qtdPareados: linhas.filter((l) => !l.semPar).length,
            qtdOrfaos: linhas.filter((l) => l.semPar).length,
        })
    }

    resultado.sort((a, b) => {
        const d = String(a.data || '').localeCompare(String(b.data || ''))
        if (d !== 0) return d
        const t = String(a.tutor).localeCompare(String(b.tutor), 'pt-BR')
        if (t !== 0) return t
        return String(a.pet).localeCompare(String(b.pet), 'pt-BR')
    })

    return resultado
}

function agruparOrfaosPorAtendimento(orfaos, lado, codigoPorNomeNorm = new Map()) {
    const map = new Map()
    for (const card of orfaos || []) {
        const tutor = card.tutor || '—'
        const pet = card.pet || '—'
        const data = card.data || ''
        const chave = chaveGrupoAtendimento(tutor, pet, data)
        if (!map.has(chave)) {
            map.set(chave, {
                chave,
                tutor,
                pet,
                data,
                lado,
                itens: [],
            })
        }
        map.get(chave).itens.push(card)
    }
    return [...map.values()].map((g) => finalizarGrupoOrfaos(g, lado, codigoPorNomeNorm))
}

/** Atendimento 100% correto: todos pareados, sem diff de valor e sem falha de negociação. */
function atendimentoEsta100PorCento(cardsAt) {
    if (!(cardsAt || []).length) return false
    for (const c of cardsAt) {
        if (c.tipo === 'orfao_lab' || c.tipo === 'orfao_emerdog') return false
        if (c.valoresDiferem) return false
        if (c.semParNegociacao) return false
        if (c.tipo !== 'pareado') return false
    }
    return true
}

function finalizarGrupoOrfaos(g, lado, codigoPorNomeNorm = new Map()) {
    const exames = ordenarExamesPorCodigo(
        (g.itens || []).map((c) => {
            const nomeNorm = exameNormDoCardOrfao(c, lado)
            const codigo =
                c.codigo ||
                resolverCodigoPorNome(nomeNorm, codigoPorNomeNorm) ||
                resolverCodigoPorNome(
                    lado === 'lab' ? c.exameLaboratorio : c.exameEmerdog,
                    codigoPorNomeNorm,
                )
            const isOrfao = c.tipo === 'orfao_lab' || c.tipo === 'orfao_emerdog'
            return {
                idLocal: lado === 'lab' ? c.idLabLocal : c.idEmerdogLocal,
                nome: lado === 'lab' ? c.exameLaboratorio : c.exameEmerdog,
                nomeNorm,
                codigo,
                valor: lado === 'lab' ? c.valorLab : c.valorEmerdog,
                valoresDiferem: Boolean(c.valoresDiferem),
                semPar: isOrfao,
                card: c,
            }
        }),
    )
    const subtotal = exames
        .map((e) => Number(e.valor))
        .filter((n) => Number.isFinite(n))
        .reduce((acc, n) => acc + n, 0)
    return {
        ...g,
        exames,
        subtotal: Number(subtotal.toFixed(2)),
        ids: exames.map((e) => e.idLocal).filter(Boolean),
    }
}

/**
 * Monta grupo completo do atendimento (todos os exames lab ou plano),
 * não só os órfãos — para conferência quando há qualquer discrepância.
 */
function montarGrupoAtendimentoCompleto(cardsAt, lado, codigoPorNomeNorm = new Map()) {
    if (!(cardsAt || []).length) return null
    const tutor = cardsAt[0].tutor || '—'
    const pet = cardsAt[0].pet || '—'
    const data = cardsAt[0].data || ''
    const chave = chaveGrupoAtendimento(tutor, pet, data)
    const itens = []
    const vistos = new Set()

    for (const c of cardsAt) {
        if (lado === 'lab') {
            if (c.tipo === 'orfao_emerdog') continue
            const id = c.idLabLocal
            if (!id || vistos.has(id)) continue
            if (c.tipo !== 'pareado' && c.tipo !== 'orfao_lab') continue
            vistos.add(id)
            itens.push(c)
        } else {
            if (c.tipo === 'orfao_lab') continue
            const id = c.idEmerdogLocal
            if (!id || vistos.has(id)) continue
            if (c.tipo !== 'pareado' && c.tipo !== 'orfao_emerdog') continue
            vistos.add(id)
            itens.push(c)
        }
    }
    if (!itens.length) return null
    return finalizarGrupoOrfaos(
        { chave, tutor, pet, data, lado, itens },
        lado,
        codigoPorNomeNorm,
    )
}

function pontuarGruposOrfaos(grupoLab, grupoEm) {
    const scoreTutor = scoreSimilaridadeNome(grupoLab.tutor, grupoEm.tutor)
    const scorePet = scoreSimilaridadeNome(grupoLab.pet, grupoEm.pet)
    const scoreData = scoreDataProximidade(grupoLab.data, grupoEm.data)

    // Também conta códigos em comum (sem duplicar o mesmo exame)
    let examesComuns = 0
    const emUsados = new Set()
    for (const labEx of grupoLab.exames || []) {
        let melhor = null
        let melhorScore = 0
        for (const emEx of grupoEm.exames || []) {
            if (emUsados.has(emEx.idLocal)) continue
            const score = scorePareamentoExame(labEx, emEx)
            if (score > melhorScore) {
                melhorScore = score
                melhor = emEx
            }
        }
        if (melhor && melhorScore >= 650) {
            emUsados.add(melhor.idLocal)
            examesComuns += 1
        }
    }

    const scoreExames =
        examesComuns > 0
            ? 200 +
              Math.round(
                  (400 * examesComuns) /
                      Math.max(
                          (grupoLab.exames || []).length,
                          (grupoEm.exames || []).length,
                          1,
                      ),
              )
            : 0

    const total = scoreTutor * 4 + scorePet * 3 + scoreData + scoreExames * 0.8

    const qtdDiff = (grupoLab.exames || []).filter((e) => e.valoresDiferem || e.semPar).length
    const motivos = rotulosMotivosGrupo({
        scoreTutor,
        scorePet,
        scoreData,
        examesComuns,
        qtdLab: grupoLab.exames?.length || 0,
        qtdEm: grupoEm.exames?.length || 0,
    })
    if (qtdDiff > 0) {
        motivos.unshift(
            qtdDiff === 1
                ? '1 discrepância no atendimento'
                : `${qtdDiff} discrepâncias no atendimento`,
        )
    }

    return {
        scoreTutor,
        scorePet,
        scoreData,
        scoreExames,
        examesComuns,
        total,
        motivos,
    }
}

/**
 * Dado dois grupos (tutor/pet/data), gera pares exame↔exame pelo nome/código.
 */
export function expandirPareamentoGrupoOrfaos(grupoLab, grupoEm) {
    if (!grupoLab?.exames?.length || !grupoEm?.exames?.length) return []

    const pares = []
    const usadoEm = new Set()
    const emRestantes = [...grupoEm.exames]

    for (const labEx of grupoLab.exames) {
        let melhor = null
        let melhorScore = 0
        for (const emEx of emRestantes) {
            if (usadoEm.has(emEx.idLocal)) continue
            const score = scorePareamentoExame(labEx, emEx)
            if (score > melhorScore) {
                melhorScore = score
                melhor = emEx
            }
        }
        if (melhor && melhorScore >= 650) {
            usadoEm.add(melhor.idLocal)
            pares.push({ idLabLocal: labEx.idLocal, idEmerdogLocal: melhor.idLocal })
        }
    }

    // Se nenhum exame bateu por nome/código mas os grupos foram aprovados, pareia em ordem (1:1)
    if (!pares.length) {
        const n = Math.min(grupoLab.exames.length, grupoEm.exames.length)
        for (let i = 0; i < n; i += 1) {
            pares.push({
                idLabLocal: grupoLab.exames[i].idLocal,
                idEmerdogLocal: grupoEm.exames[i].idLocal,
            })
        }
    }

    return pares
}

/**
 * Monta fila de revisão por atendimento (tutor + animal + data).
 * Só atendimentos 100% corretos ficam de fora (aprovados automaticamente).
 * Qualquer discrepância (órfão ou diff de valor) traz o atendimento inteiro.
 */
export function montarFilaPareamentoOrfaos(
    cards,
    { limiteCandidatos = 8, scoreMinimo = 500, codigoPorNomeNorm = new Map() } = {},
) {
    const porChave = new Map()
    for (const c of cards || []) {
        const chave = chaveGrupoAtendimento(c.tutor, c.pet, c.data)
        if (!porChave.has(chave)) porChave.set(chave, [])
        porChave.get(chave).push(c)
    }

    const gruposLab = []
    const gruposEm = []
    const chavesRevisao = new Set()

    for (const [chave, cardsAt] of porChave) {
        if (atendimentoEsta100PorCento(cardsAt)) continue
        chavesRevisao.add(chave)
        const gLab = montarGrupoAtendimentoCompleto(cardsAt, 'lab', codigoPorNomeNorm)
        const gEm = montarGrupoAtendimentoCompleto(cardsAt, 'emerdog', codigoPorNomeNorm)
        if (gLab) gruposLab.push(gLab)
        if (gEm) gruposEm.push(gEm)
    }

    // Planos de outras datas do mesmo tutor/pet também entram como candidatos
    // (já cobertos se a chave deles também está em revisão; senão, gruposEm de chaves
    // só-plano com ófãos já foram adicionados acima)

    const orfaosLab = (cards || []).filter((c) => c.tipo === 'orfao_lab')
    const orfaosEm = (cards || []).filter((c) => c.tipo === 'orfao_emerdog')

    const candidatosPorLab = new Map()
    for (const gLab of gruposLab) {
        const ranked = []
        for (const gEm of gruposEm) {
            const scores = pontuarGruposOrfaos(gLab, gEm)
            const mesmaChave = gLab.chave === gEm.chave
            const passaFiltro =
                mesmaChave ||
                scores.scoreTutor >= 180 ||
                (scores.scorePet >= 650 && scores.scoreData >= 25) ||
                scores.total >= scoreMinimo
            if (!passaFiltro) continue
            ranked.push({
                chaveEm: gEm.chave,
                grupoEm: gEm,
                ...scores,
                total: mesmaChave ? scores.total + 5000 : scores.total,
            })
        }
        ranked.sort((a, b) => b.total - a.total || b.scoreTutor - a.scoreTutor)
        candidatosPorLab.set(gLab.chave, ranked.slice(0, limiteCandidatos))
    }

    const pares = []
    const usadoEm = new Set()
    const usadoLab = new Set()
    const todos = []
    for (const gLab of gruposLab) {
        for (const cand of candidatosPorLab.get(gLab.chave) || []) {
            todos.push({ gLab, cand })
        }
    }
    todos.sort((a, b) => b.cand.total - a.cand.total)

    for (const { gLab, cand } of todos) {
        if (usadoLab.has(gLab.chave) || usadoEm.has(cand.chaveEm)) continue
        if (cand.total < scoreMinimo && cand.scoreTutor < 650 && gLab.chave !== cand.chaveEm) {
            continue
        }
        usadoLab.add(gLab.chave)
        usadoEm.add(cand.chaveEm)
        const alts = (candidatosPorLab.get(gLab.chave) || []).filter((c) => c.chaveEm !== cand.chaveEm)
        pares.push({
            tipo: 'grupo',
            chaveLab: gLab.chave,
            chaveEm: cand.chaveEm,
            grupoLab: gLab,
            grupoEm: cand.grupoEm,
            scoreTutor: cand.scoreTutor,
            scorePet: cand.scorePet,
            scoreData: cand.scoreData,
            examesComuns: cand.examesComuns,
            total: cand.total,
            motivos: cand.motivos,
            candidatos: [
                {
                    chaveEm: cand.chaveEm,
                    grupoEm: cand.grupoEm,
                    total: cand.total,
                    motivos: cand.motivos,
                },
                ...alts.map((c) => ({
                    chaveEm: c.chaveEm,
                    grupoEm: c.grupoEm,
                    total: c.total,
                    motivos: c.motivos,
                })),
            ],
        })
    }

    for (const gLab of gruposLab) {
        if (usadoLab.has(gLab.chave)) continue
        const alts = candidatosPorLab.get(gLab.chave) || []
        pares.push({
            tipo: 'grupo',
            chaveLab: gLab.chave,
            chaveEm: alts[0]?.chaveEm || '',
            grupoLab: gLab,
            grupoEm: alts[0]?.grupoEm || null,
            scoreTutor: alts[0]?.scoreTutor || 0,
            scorePet: alts[0]?.scorePet || 0,
            scoreData: alts[0]?.scoreData || 0,
            examesComuns: alts[0]?.examesComuns || 0,
            total: alts[0]?.total || 0,
            motivos: alts[0]?.motivos || ['Atendimento com discrepância — confirme o plano'],
            candidatos: alts.map((c) => ({
                chaveEm: c.chaveEm,
                grupoEm: c.grupoEm,
                total: c.total,
                motivos: c.motivos,
            })),
            exigeEscolhaManual: true,
        })
        usadoLab.add(gLab.chave)
    }

    // Órfãos só-plano (sem lab na mesma chave) que ainda não entraram como candidato principal
    for (const gEm of gruposEm) {
        if (usadoEm.has(gEm.chave)) continue
        // Já há lab na mesma chave? Se não, cria item invertido para não perder o plano
        const temLabMesma = gruposLab.some((g) => g.chave === gEm.chave)
        if (temLabMesma) continue
        pares.push({
            tipo: 'grupo',
            chaveLab: '',
            chaveEm: gEm.chave,
            grupoLab: {
                chave: gEm.chave,
                tutor: gEm.tutor,
                pet: gEm.pet,
                data: gEm.data,
                lado: 'lab',
                exames: [],
                subtotal: 0,
                ids: [],
            },
            grupoEm: gEm,
            scoreTutor: 0,
            scorePet: 0,
            scoreData: 0,
            examesComuns: 0,
            total: 0,
            motivos: ['Atendimento só no plano — sem lab correspondente'],
            candidatos: [
                {
                    chaveEm: gEm.chave,
                    grupoEm: gEm,
                    total: 0,
                    motivos: ['Só plano'],
                },
            ],
            exigeEscolhaManual: true,
            soPlano: true,
        })
        usadoEm.add(gEm.chave)
    }

    return {
        fila: pares,
        totalOrfaosLab: orfaosLab.length,
        totalOrfaosEm: orfaosEm.length,
        totalGruposLab: gruposLab.length,
        totalGruposEm: gruposEm.length,
        totalRevisao: chavesRevisao.size,
        gruposLab,
        gruposEm,
        orfaosLab,
        orfaosEm,
    }
}

/** Chave estável para flag do pós-relatório. */
export function chaveMarcacaoPosRelatorio(card) {
    if (card?.idLabLocal && card?.idEmerdogLocal) {
        return `par:${card.idLabLocal}|${card.idEmerdogLocal}`
    }
    if (card?.idLabLocal) return `lab:${card.idLabLocal}`
    if (card?.idEmerdogLocal) return `em:${card.idEmerdogLocal}`
    return `k:${card?.chave || card?.idLocal || ''}`
}

/**
 * Monta linhas do pós-relatório a partir dos cards flagados.
 */
export function montarLinhasPosRelatorio(cards, chavesMarcadas) {
    const set = chavesMarcadas instanceof Set ? chavesMarcadas : new Set(chavesMarcadas || [])
    return (cards || [])
        .filter((c) => set.has(chaveMarcacaoPosRelatorio(c)))
        .map((c) => ({
            chave: chaveMarcacaoPosRelatorio(c),
            tutor: c.tutor || '—',
            pet: c.pet || '—',
            data: c.data || '',
            codigo: c.codigo || '',
            exameLaboratorio: c.exameLaboratorio || '—',
            exameEmerdog: c.exameEmerdog || c.nomeNegociacao || '—',
            nomeNegociacao: c.nomeNegociacao || null,
            valorLab: c.valorLab,
            valorEmerdog: c.valorEmerdog,
            diferenca: c.diferenca,
            valoresDiferem: Boolean(c.valoresDiferem),
            tipo: c.tipo,
            atendimento: [c.tutor, c.pet, c.data].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => {
            const d = String(a.data || '').localeCompare(String(b.data || ''))
            if (d !== 0) return d
            const t = String(a.tutor).localeCompare(String(b.tutor), 'pt-BR')
            if (t !== 0) return t
            const ca = String(a.codigo || '')
            const cb = String(b.codigo || '')
            if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
            return String(a.exameLaboratorio).localeCompare(String(b.exameLaboratorio), 'pt-BR')
        })
}

/**
 * Exporta o pós-relatório em Excel (.xlsx).
 */
export async function exportarPosRelatorioConferenciaExcel(linhas, opts = {}) {
    const { default: ExcelJS } = await import('exceljs')
    const { formatarDataConferencia, formatarValorConferencia } = await import(
        './conferenciaLaboratorioPrecos.js'
    )

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Emerdog SFSC'
    const ws = workbook.addWorksheet('Pós-relatório')

    ws.columns = [
        { header: 'Data', key: 'data', width: 12 },
        { header: 'Tutor', key: 'tutor', width: 28 },
        { header: 'Animal', key: 'pet', width: 16 },
        { header: 'Código', key: 'codigo', width: 12 },
        { header: 'Exame laboratório', key: 'exameLab', width: 28 },
        { header: 'Valor lab', key: 'valorLab', width: 12 },
        { header: 'Exame plano', key: 'examePlano', width: 28 },
        { header: 'Valor plano', key: 'valorPlano', width: 12 },
        { header: 'Diferença', key: 'diferenca', width: 12 },
    ]

    ws.getRow(1).font = { bold: true }

    for (const linha of linhas || []) {
        const row = ws.addRow({
            data: formatarDataConferencia(linha.data),
            tutor: linha.tutor,
            pet: linha.pet,
            codigo: linha.codigo || '',
            exameLab: linha.exameLaboratorio,
            valorLab: formatarValorConferencia(linha.valorLab),
            examePlano: linha.exameEmerdog,
            valorPlano: formatarValorConferencia(linha.valorEmerdog),
            diferenca: formatarValorConferencia(linha.diferenca),
        })
        if (linha.valoresDiferem) {
            row.getCell('exameLab').font = { color: { argb: 'FFB91C1C' } }
            row.getCell('valorLab').font = { color: { argb: 'FFB91C1C' } }
            row.getCell('examePlano').font = { color: { argb: 'FFB91C1C' } }
            row.getCell('valorPlano').font = { color: { argb: 'FFB91C1C' } }
            row.getCell('diferenca').font = { color: { argb: 'FFB91C1C' } }
        }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const lab = String(opts.laboratorioNome || 'laboratorio')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
    const periodo = String(opts.periodoYm || '').replace(/[^\d-]/g, '')
    const nomeArquivo = `pos-relatorio-conferencia-${lab || 'lab'}${periodo ? `-${periodo}` : ''}.xlsx`

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomeArquivo
    a.click()
    URL.revokeObjectURL(url)

    return { nomeArquivo, total: (linhas || []).length }
}
