import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { resolverPrestadorPorNome, sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'
import { supabase } from '../supabase.js'
import {
    CAMPOS_CONFERENCIA,
    camposFaltantesMapeamento,
    mapearIndicesColunasConferencia,
    normalizarCabecalho,
    normalizarNomeExame,
    parsearDataFlexivel,
    parsearExcelConferenciaLaboratorio,
    parsearValorMonetario,
    linhaConferenciaTemRegistro,
} from './conferenciaLaboratorioExcel.js'

export {
    CAMPOS_CONFERENCIA,
    camposFaltantesMapeamento,
    mapearIndicesColunasConferencia,
    normalizarCabecalho,
    normalizarNomeExame,
    parsearDataFlexivel,
    parsearExcelConferenciaLaboratorio,
    parsearValorMonetario,
}

export const CARDS_POR_PAGINA = 10

/** Arredonda valor do lab para chave/comparação (2 casas). */
export function arredondarValorLab(valor) {
    if (valor == null || !Number.isFinite(Number(valor))) return null
    return Math.round(Number(valor) * 100) / 100
}

/** Persistência: -1 = sem valor / legado. */
export function valorLabParaPersistencia(valor) {
    const v = arredondarValorLab(valor)
    return v == null ? -1 : v
}

/**
 * Chave de alias: nome normalizado + valor (quando houver).
 * Sem valor finito → só o nome (compatível com mapeamentos legados).
 */
export function chaveAliasExame(nomeNorm, valor) {
    const n = String(nomeNorm || '')
    if (!n) return ''
    const v = arredondarValorLab(valor)
    if (v == null) return n
    return `${n}|${v}`
}

export function valorLabDeMapeamentoSalvo(m) {
    const raw = m?.valor_lab
    if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0) return null
    return arredondarValorLab(raw)
}

/** Busca mapeamento resolvido por nome+valor, com fallback só-nome (legado). */
export function obterMapeamentoResolvido(mapa, nomeNorm, valor) {
    if (!(mapa instanceof Map) || !nomeNorm) return null
    const k = chaveAliasExame(nomeNorm, valor)
    if (mapa.has(k)) return mapa.get(k)
    if (k !== nomeNorm && mapa.has(nomeNorm)) return mapa.get(nomeNorm)
    return null
}

/** Indexa mapeamentos salvos por chave nome+valor (e legado só-nome). */
export function indexarMapeamentosSalvos(mapeamentosSalvos) {
    const map = new Map()
    for (const m of mapeamentosSalvos || []) {
        const norm = String(m?.nome_lab_normalizado || '')
        if (!norm) continue
        const valor = valorLabDeMapeamentoSalvo(m)
        map.set(chaveAliasExame(norm, valor), m)
    }
    return map
}

/** Chave de atendimento: tutor + animal + data. */
export function chaveGrupoAtendimento(tutor, pet, data, mapasAliases = null) {
    return `${resolverNomeViaAlias(tutor, mapasAliases?.tutor)}|${resolverNomeViaAlias(pet, mapasAliases?.pet)}|${data || ''}`
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
    const selectCols =
        'id, laboratorio_id, nome_lab, nome_lab_normalizado, valor_lab, nome_emerdog, nome_emerdog_normalizado, status, confirmado_por, confirmado_em'
    let { data, error } = await supabase
        .from('lab_exame_mapeamento')
        .select(selectCols)
        .eq('laboratorio_id', id)
        .order('nome_lab', { ascending: true })
    // Coluna valor_lab ainda não migrada
    if (error && /valor_lab|column/i.test(error.message || '')) {
        const retry = await supabase
            .from('lab_exame_mapeamento')
            .select(
                'id, laboratorio_id, nome_lab, nome_lab_normalizado, nome_emerdog, nome_emerdog_normalizado, status, confirmado_por, confirmado_em',
            )
            .eq('laboratorio_id', id)
            .order('nome_lab', { ascending: true })
        data = retry.data
        error = retry.error
    }
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
    valorLab = null,
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
        valor_lab: valorLabParaPersistencia(valorLab),
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

    const selectCols =
        'id, laboratorio_id, nome_lab, nome_lab_normalizado, valor_lab, nome_emerdog, nome_emerdog_normalizado, status'
    const onConflict = 'laboratorio_id,nome_lab_normalizado,valor_lab'

    let { data, error } = await supabase
        .from('lab_exame_mapeamento')
        .upsert(payload, { onConflict })
        .select(selectCols)
        .single()

    // Se FK de confirmado_por falhar, tenta de novo sem o usuário
    if (error && /confirmado_por|foreign key|users/i.test(error.message || '')) {
        const retry = await supabase
            .from('lab_exame_mapeamento')
            .upsert({ ...payload, confirmado_por: null }, { onConflict })
            .select(selectCols)
            .single()
        data = retry.data
        error = retry.error
    }

    // Schema antigo sem valor_lab: fallback por nome apenas
    if (error && /valor_lab|on conflict|constraint|column/i.test(error.message || '')) {
        const { valor_lab: _v, ...legado } = payload
        const retry = await supabase
            .from('lab_exame_mapeamento')
            .upsert(legado, { onConflict: 'laboratorio_id,nome_lab_normalizado' })
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

/** Resolve nome para o canônico do laboratório via mapa de aliases (norm → norm lab). */
export function resolverNomeViaAlias(nome, mapaAliases) {
    const n = normalizarTextoBusca(nome)
    if (!n) return ''
    if (!mapaAliases?.size) return n
    return mapaAliases.get(n) || n
}

/**
 * Monta mapas norm→canônico (lab) para tutor e pet a partir da lista persistida/sessão.
 * @returns {{ tutor: Map<string,string>, pet: Map<string,string> }}
 */
export function montarMapasAliasesPessoa(lista) {
    const tutor = new Map()
    const pet = new Map()
    for (const a of lista || []) {
        const alvo = a?.tipo === 'pet' ? pet : tutor
        const lab = normalizarTextoBusca(a?.nomeLab)
        const plano = normalizarTextoBusca(a?.nomePlano)
        if (!lab || !plano) continue
        alvo.set(lab, lab)
        alvo.set(plano, lab)
    }
    return { tutor, pet }
}

/**
 * Se tutor/pet do plano diferem do lab (após normalizar), gera alias plano → lab.
 * Usado ao aprovar pareamento manual.
 */
export function aliasesPessoaDePareamento({
    tutorLab,
    tutorPlano,
    petLab,
    petPlano,
} = {}) {
    const out = []
    const tLab = String(tutorLab || '').trim()
    const tPlano = String(tutorPlano || '').trim()
    if (
        tLab &&
        tPlano &&
        normalizarTextoBusca(tLab) !== normalizarTextoBusca(tPlano)
    ) {
        out.push({ tipo: 'tutor', nomeLab: tLab, nomePlano: tPlano })
    }
    const pLab = String(petLab || '').trim()
    const pPlano = String(petPlano || '').trim()
    if (
        pLab &&
        pPlano &&
        normalizarTextoBusca(pLab) !== normalizarTextoBusca(pPlano)
    ) {
        out.push({ tipo: 'pet', nomeLab: pLab, nomePlano: pPlano })
    }
    return out
}

/** Mescla novos aliases sem duplicar (chave tipo + nome_plano_normalizado). */
export function mesclarAliasesPessoa(existentes, novos) {
    const mapa = new Map()
    for (const a of [...(existentes || []), ...(novos || [])]) {
        if (!a?.tipo || !a?.nomeLab || !a?.nomePlano) continue
        const chave = `${a.tipo}|${normalizarTextoBusca(a.nomePlano)}`
        mapa.set(chave, {
            tipo: a.tipo,
            nomeLab: String(a.nomeLab).trim(),
            nomePlano: String(a.nomePlano).trim(),
        })
    }
    return [...mapa.values()]
}

export async function carregarAliasesPessoaLaboratorio(laboratorioId) {
    const id = Number(laboratorioId)
    if (!id) return []
    try {
        const { data, error } = await supabase
            .from('lab_pessoa_mapeamento')
            .select(
                'id, laboratorio_id, tipo, nome_lab, nome_lab_normalizado, nome_plano, nome_plano_normalizado',
            )
            .eq('laboratorio_id', id)
            .order('nome_lab', { ascending: true })
        if (error) {
            if (/lab_pessoa_mapeamento|does not exist|schema cache|42P01|PGRST/i.test(error.message)) {
                return []
            }
            console.warn('[conferencia] carregarAliasesPessoa:', error.message)
            return []
        }
        return (data || []).map((r) => ({
            tipo: r.tipo,
            nomeLab: r.nome_lab,
            nomePlano: r.nome_plano,
        }))
    } catch (e) {
        console.warn('[conferencia] carregarAliasesPessoa:', e?.message || e)
        return []
    }
}

export async function salvarAliasPessoa({
    laboratorioId,
    tipo,
    nomeLab,
    nomePlano,
    userId,
}) {
    const id = Number(laboratorioId)
    const t = tipo === 'pet' ? 'pet' : 'tutor'
    const lab = String(nomeLab || '').trim()
    const plano = String(nomePlano || '').trim()
    if (!id || !lab || !plano) return { ok: false }

    let confirmadoPor = null
    try {
        const { data: userData } = await supabase.auth.getUser()
        confirmadoPor = userData?.user?.id || null
    } catch {
        confirmadoPor = null
    }
    if (!confirmadoPor && userId) confirmadoPor = userId

    const payload = {
        laboratorio_id: id,
        tipo: t,
        nome_lab: lab,
        nome_lab_normalizado: normalizarTextoBusca(lab),
        nome_plano: plano,
        nome_plano_normalizado: normalizarTextoBusca(plano),
        confirmado_por: confirmadoPor,
        confirmado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
    }

    try {
        let { error } = await supabase
            .from('lab_pessoa_mapeamento')
            .upsert(payload, { onConflict: 'laboratorio_id,tipo,nome_plano_normalizado' })

        if (error && /confirmado_por|foreign key|users/i.test(error.message || '')) {
            const retry = await supabase
                .from('lab_pessoa_mapeamento')
                .upsert(
                    { ...payload, confirmado_por: null },
                    { onConflict: 'laboratorio_id,tipo,nome_plano_normalizado' },
                )
            error = retry.error
        }

        if (error) {
            if (/lab_pessoa_mapeamento|does not exist|schema cache|42P01|PGRST|rls|row-level/i.test(
                error.message || '',
            )) {
                return { ok: false, motivo: error.message }
            }
            return { ok: false, motivo: error.message }
        }
        return { ok: true }
    } catch (e) {
        return { ok: false, motivo: e?.message || String(e) }
    }
}

export async function salvarAliasesPessoaEmLote({ laboratorioId, aliases, userId }) {
    const resultados = []
    for (const a of aliases || []) {
        resultados.push(
            await salvarAliasPessoa({
                laboratorioId,
                tipo: a.tipo,
                nomeLab: a.nomeLab,
                nomePlano: a.nomePlano,
                userId,
            }),
        )
    }
    return resultados
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
    const salvosPorNorm = new Map()
    for (const m of mapeamentosSalvos || []) {
        const norm = String(m?.nome_lab_normalizado || '')
        if (!norm) continue
        // Preferência: legado sem valor; senão o primeiro encontrado
        if (!salvosPorNorm.has(norm) || valorLabDeMapeamentoSalvo(m) == null) {
            salvosPorNorm.set(norm, m)
        }
    }
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
            // Só aplica legado (sem valor) no nível do nome; overlays por valor abaixo.
            if (valorLabDeMapeamentoSalvo(salvo) == null) {
                resolvidos.set(item.norm, {
                    nomeLab: item.nome,
                    nomeEmerdog: salvo.nome_emerdog,
                    status: 'mapeado_automaticamente',
                    valorLab: null,
                })
                registrarAliasResolvido(item.nome, salvo.nome_emerdog, 'salvo')
                continue
            }
        }
        if (salvo?.status === 'pendente_auditoria' && valorLabDeMapeamentoSalvo(salvo) == null) {
            resolvidos.set(item.norm, {
                nomeLab: item.nome,
                nomeEmerdog: null,
                status: 'pendente_auditoria',
                valorLab: null,
            })
            continue
        }

        if (emerdogPorNorm.has(item.norm)) {
            const nomeAlvo = emerdogPorNorm.get(item.norm)
            resolvidos.set(item.norm, {
                nomeLab: item.nome,
                nomeEmerdog: nomeAlvo,
                status: 'mapeado_automaticamente',
                valorLab: null,
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

    // Overlay: aliases salvos por nome+valor (vínculos independentes por preço)
    for (const m of mapeamentosSalvos || []) {
        const norm = String(m?.nome_lab_normalizado || '')
        if (!norm) continue
        const valor = valorLabDeMapeamentoSalvo(m)
        const chave = chaveAliasExame(norm, valor)
        if (m.status === 'confirmado' && m.nome_emerdog) {
            resolvidos.set(chave, {
                nomeLab: m.nome_lab,
                nomeEmerdog: m.nome_emerdog,
                status: 'mapeado_automaticamente',
                valorLab: valor,
            })
            registrarAliasResolvido(m.nome_lab, m.nome_emerdog, 'salvo')
        } else if (m.status === 'pendente_auditoria') {
            resolvidos.set(chave, {
                nomeLab: m.nome_lab,
                nomeEmerdog: null,
                status: 'pendente_auditoria',
                valorLab: valor,
            })
        }
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

/**
 * Catálogo de negociação normalizado (Cod - Nome alt - Valor).
 */
export function montarItensCatalogoAlias(catalogoNegociacao = []) {
    return [...(catalogoNegociacao || [])]
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
                nome,
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
}

/**
 * Lista um item por combinação nome+valor do lab × catálogo de negociação.
 * Mesmo nome com preços distintos vira linhas separadas (vínculos independentes).
 */
export function montarListaAliasesExames({
    linhasLab,
    catalogoNegociacao = [],
    mapeamentosSalvos = [],
    resolvidos = new Map(),
}) {
    const itensCatalogo = montarItensCatalogoAlias(catalogoNegociacao)
    const catalogoPorNorm = new Map()
    for (const i of itensCatalogo) {
        catalogoPorNorm.set(i.norm, i)
        if (i.nomeAlternativo) {
            const an = normalizarNomeExame(i.nomeAlternativo)
            if (an && !catalogoPorNorm.has(an)) catalogoPorNorm.set(an, i)
        }
    }

    const salvosPorChave = indexarMapeamentosSalvos(mapeamentosSalvos)
    const mapaRes =
        resolvidos instanceof Map
            ? resolvidos
            : new Map(Object.entries(resolvidos || {}))

    const porChave = new Map()
    for (const linha of linhasLab || []) {
        const nome = String(linha.exame || '').trim()
        const norm = linha.exameNorm || normalizarNomeExame(nome)
        if (!norm || !nome) continue
        const valor = arredondarValorLab(linha.valorRelatorio)
        const chave = chaveAliasExame(norm, valor)
        if (!porChave.has(chave)) {
            porChave.set(chave, {
                chave,
                nomeLab: nome,
                nomeLabNorm: norm,
                valorLab: valor,
                qtd: 0,
            })
        }
        porChave.get(chave).qtd += 1
    }

    const acharCatalogo = (nomeNorm, valorLab, nomeEmerdog) => {
        if (nomeEmerdog) {
            const cat = catalogoPorNorm.get(normalizarNomeExame(nomeEmerdog))
            if (cat) return cat
        }
        if (valorLab != null) {
            const mesmosValor = itensCatalogo.filter(
                (i) =>
                    Number.isFinite(Number(i.valor)) &&
                    Math.abs(Number(i.valor) - valorLab) <= 0.009,
            )
            const porNomeEValor = mesmosValor.find((i) => i.norm === nomeNorm)
            if (porNomeEValor) return porNomeEValor
        }
        return catalogoPorNorm.get(nomeNorm) || null
    }

    const lista = []
    for (const entry of porChave.values()) {
        const salvo = salvosPorChave.get(entry.chave) || salvosPorChave.get(entry.nomeLabNorm)
        const res = obterMapeamentoResolvido(mapaRes, entry.nomeLabNorm, entry.valorLab)
        let nomeEmerdog =
            (res?.nomeEmerdog && String(res.nomeEmerdog).trim()) ||
            (salvo?.status === 'confirmado' && salvo.nome_emerdog
                ? String(salvo.nome_emerdog).trim()
                : '') ||
            ''

        const catPorAlias = nomeEmerdog
            ? catalogoPorNorm.get(normalizarNomeExame(nomeEmerdog))
            : null
        const catPorNome = catalogoPorNorm.get(entry.nomeLabNorm)
        const itemCatalogo =
            catPorAlias ||
            (!nomeEmerdog
                ? acharCatalogo(entry.nomeLabNorm, entry.valorLab, null)
                : null) ||
            null

        if (!nomeEmerdog && itemCatalogo) {
            nomeEmerdog = itemCatalogo.nome
        }

        const valorNegociacao =
            itemCatalogo && Number.isFinite(Number(itemCatalogo.valor))
                ? Number(itemCatalogo.valor)
                : null

        const nomeIgualNoCatalogo = Boolean(catPorNome)
        const valorDiff =
            valorNegociacao != null &&
            entry.valorLab != null &&
            Math.abs(entry.valorLab - valorNegociacao) > 0.009

        const pendenteAuditoria =
            res?.status === 'pendente_auditoria' ||
            salvo?.status === 'pendente_auditoria'

        const vinculado = Boolean(nomeEmerdog) && !pendenteAuditoria

        let status = 'pendente'
        if (pendenteAuditoria) status = 'auditoria'
        else if (vinculado && valorDiff) status = 'valor_diff'
        else if (vinculado) status = 'ok'

        lista.push({
            chave: entry.chave,
            nomeLab: entry.nomeLab,
            nomeLabNorm: entry.nomeLabNorm,
            qtd: entry.qtd,
            valoresLab: entry.valorLab != null ? [entry.valorLab] : [],
            valorLab: entry.valorLab,
            nomeEmerdog: nomeEmerdog || null,
            itemCatalogo,
            valorNegociacao,
            valorDiff,
            nomeIgualValorDiff: nomeIgualNoCatalogo && valorDiff,
            vinculado,
            status,
            origem:
                res?.status ||
                (salvo?.status === 'confirmado' ? 'salvo' : null) ||
                (itemCatalogo && !catPorAlias ? 'exato' : null),
        })
    }

    lista.sort((a, b) => {
        const rank = (s) =>
            s === 'pendente' ? 0 : s === 'valor_diff' ? 1 : s === 'auditoria' ? 2 : 3
        const r = rank(a.status) - rank(b.status)
        if (r !== 0) return r
        const n = String(a.nomeLab).localeCompare(String(b.nomeLab), 'pt-BR')
        if (n !== 0) return n
        return (a.valorLab ?? -1) - (b.valorLab ?? -1)
    })

    const total = lista.length
    const vinculados = lista.filter((i) => i.vinculado).length
    const pendentes = lista.filter((i) => i.status === 'pendente').length
    const comValorDiff = lista.filter((i) => i.valorDiff).length

    return {
        lista,
        itensCatalogo,
        total,
        vinculados,
        pendentes,
        restantes: pendentes,
        comValorDiff,
        progressoPct: total > 0 ? Math.round((vinculados / total) * 100) : 100,
    }
}

/** Chave de comparação: tutor + animal + data + exame (já no “idioma” Emerdog). */
export function chaveMatchExame(tutor, pet, data, exameNorm, mapasAliases = null) {
    return [
        resolverNomeViaAlias(tutor, mapasAliases?.tutor),
        resolverNomeViaAlias(pet, mapasAliases?.pet),
        data || '',
        exameNorm || '',
    ].join('|')
}

function exameNormParaMatchLab(linha, resolvidosMapeamento) {
    const map = obterMapeamentoResolvido(
        resolvidosMapeamento,
        linha.exameNorm,
        linha.valorRelatorio,
    )
    if (map?.nomeEmerdog) return normalizarNomeExame(map.nomeEmerdog)
    if (map?.status === 'pendente_auditoria') return null
    return linha.exameNorm || normalizarNomeExame(linha.exame)
}

function enriquecerLinhaLab(linha, resolvidosMapeamento) {
    const map = obterMapeamentoResolvido(
        resolvidosMapeamento,
        linha.exameNorm,
        linha.valorRelatorio,
    )
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
    codigoPorNomeNorm = new Map(),
) {
    const exameNorm = linha.exameNorm || normalizarNomeExame(linha.exame)
    const map =
        obterMapeamentoResolvido(resolvidosMapeamento, exameNorm, linha.valorRelatorio) ||
        resolvidosMapeamento.get(exameNorm)

    // Resolve para nome de sistema via alt/código/mapeamento (evita preço zerado)
    let nomeSistema =
        nomeSistemaPorNorm.get(exameNorm) ||
        (map?.nomeEmerdog ? nomeSistemaPorNorm.get(normalizarNomeExame(map.nomeEmerdog)) : null) ||
        map?.nomeEmerdog ||
        null

    const codigoHint =
        codigoPorNomeNorm.get(exameNorm) ||
        (map?.nomeEmerdog
            ? codigoPorNomeNorm.get(normalizarNomeExame(map.nomeEmerdog))
            : null) ||
        (nomeSistema ? codigoPorNomeNorm.get(normalizarNomeExame(nomeSistema)) : null)

    let valorNegociacao = precoUtilDoMapa(
        precosPorNomeNorm,
        exameNorm,
        nomeSistema,
        map?.nomeEmerdog,
        linha.exame,
        codigoHint,
    )

    if (!nomeSistema && map?.nomeEmerdog) nomeSistema = map.nomeEmerdog

    const nomeNegociacao = nomeSistema || map?.nomeEmerdog || null
    const exameMatchNorm = nomeNegociacao
        ? normalizarNomeExame(nomeNegociacao)
        : exameNorm

    return {
        ...linha,
        exameMatchNorm,
        nomeNegociacao,
        nomeSistemaNegociacao: nomeSistema || null,
        valorNegociacao,
        semParNegociacao: valorNegociacao == null,
    }
}

function resolverValorDoLabViaMapeamento(
    lab,
    precosPorNomeNorm,
    nomeSistemaPorNorm = new Map(),
    codigoPorNomeNorm = new Map(),
) {
    const tentar = (nome) => {
        if (!nome) return null
        const direto = precoUtilDoMapa(precosPorNomeNorm, nome)
        if (direto != null) return direto
        const sis = nomeSistemaPorNorm.get(normalizarNomeExame(nome))
        const viaSis = precoUtilDoMapa(precosPorNomeNorm, sis)
        if (viaSis != null) return viaSis
        const codigo = codigoPorNomeNorm.get(normalizarNomeExame(nome))
        return precoUtilDoMapa(precosPorNomeNorm, codigo)
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

/**
 * Badge de valor para UI: OK (igual), parecido (perto), diferente (diverge).
 * Retorna null se algum lado não tiver valor numérico.
 */
export function motivoComparacaoValor(
    valorA,
    valorB,
    { toleranciaOk = 0.009, toleranciaParecido = 1.7 } = {},
) {
    if (valorA == null || valorB == null || valorA === '' || valorB === '') return null
    const a = Number(valorA)
    const b = Number(valorB)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    const diff = Math.round(Math.abs(a - b) * 100) / 100
    if (diff <= toleranciaOk) return 'Valor OK'
    // até R$ 1,70 → parecido; acima → diferente
    if (diff <= toleranciaParecido) return 'Valor parecido'
    return 'Valor diferente'
}

function valorNumericoOpcional(v) {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

function precoUtilDoMapa(precosPorNomeNorm, ...nomesOuCodigos) {
    if (!precosPorNomeNorm) return null
    for (const bruto of nomesOuCodigos) {
        const chave = normalizarNomeExame(bruto)
        if (!chave || !precosPorNomeNorm.has(chave)) continue
        const v = Number(precosPorNomeNorm.get(chave))
        if (Number.isFinite(v) && v !== 0) return v
    }
    return null
}

/** Valor “do exame” no card: lab usa relatório; plano usa negociado. */
function valorCardConferencia(card) {
    if (!card) return null
    if (card.tipo === 'orfao_emerdog') {
        return valorNumericoOpcional(card.valorEmerdog)
    }
    if (card.tipo === 'orfao_lab') {
        return valorNumericoOpcional(card.valorLab)
    }
    // pareado / outros: preferir o lado presente
    return (
        valorNumericoOpcional(card.valorLab) ??
        valorNumericoOpcional(card.valorEmerdog)
    )
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
    const precos = opts.precosPorNomeNorm || new Map()
    const nomesSis = opts.nomeSistemaPorNorm || new Map()
    const valorLab = Number.isFinite(Number(lab.valorRelatorio)) ? Number(lab.valorRelatorio) : null
    const codigo =
        resolverCodigoPorNome(emerdog.exame, codigoPorNomeNorm, resolvidos) ||
        resolverCodigoPorNome(emerdog.nomeNegociacao || lab.nomeEmerdogMapeado, codigoPorNomeNorm) ||
        resolverCodigoPorNome(lab.exame, codigoPorNomeNorm, resolvidos)

    let valorEmerdog = Number(emerdog.valorNegociacao)
    if (!Number.isFinite(valorEmerdog) || valorEmerdog === 0) valorEmerdog = null
    if (valorEmerdog == null) {
        valorEmerdog =
            resolverValorDoLabViaMapeamento(lab, precos, nomesSis, codigoPorNomeNorm) ??
            precoUtilDoMapa(
                precos,
                emerdog.nomeSistemaNegociacao,
                emerdog.nomeNegociacao,
                emerdog.exame,
                lab.nomeEmerdogMapeado,
                codigo,
            )
    }
    if (valorEmerdog === 0) valorEmerdog = null
    const diferenca =
        valorLab != null && valorEmerdog != null ? Number((valorLab - valorEmerdog).toFixed(2)) : null
    const valoresDiferem = valoresExameDiferem(valorLab, valorEmerdog)

    const exameParaNormalizar = emerdog.exame || lab.exame || null
    const semParNegociacao = valorEmerdog == null && Boolean(exameParaNormalizar)

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
        nomeNegociacao =
            linha.nomeEmerdogMapeado ||
            nomeSistemaPorNorm.get(normalizarNomeExame(linha.exame)) ||
            null
        valorEmerdog =
            resolverValorDoLabViaMapeamento(
                linha,
                precosPorNomeNorm,
                nomeSistemaPorNorm,
                codigoPorNomeNorm,
            ) ?? precoUtilDoMapa(precosPorNomeNorm, nomeNegociacao, linha.exame)
        if (valorEmerdog === 0) valorEmerdog = null
        semParNegociacao = Boolean(exameParaNormalizar) && valorEmerdog == null
    } else {
        exameParaNormalizar = linha.exame || null
        nomeNegociacao =
            linha.nomeSistemaNegociacao || linha.nomeNegociacao || null
        valorEmerdog = Number(linha.valorNegociacao)
        if (!Number.isFinite(valorEmerdog) || valorEmerdog === 0) {
            valorEmerdog = precoUtilDoMapa(
                precosPorNomeNorm,
                nomeNegociacao,
                linha.exame,
                linha.nomeEmerdogMapeado,
            )
        }
        semParNegociacao = Boolean(exameParaNormalizar) && valorEmerdog == null
    }

    const codigo =
        resolverCodigoPorNome(nomeNegociacao || linha.exame, codigoPorNomeNorm, resolvidosMapeamento) ||
        resolverCodigoPorNome(linha.exame, codigoPorNomeNorm, resolvidosMapeamento)

    if (valorEmerdog == null && codigo) {
        valorEmerdog = precoUtilDoMapa(precosPorNomeNorm, codigo)
    }

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
    mapasAliasesPessoa = null,
}) {
    const labs = (linhasLab || [])
        .filter((l) => linhaConferenciaTemRegistro(l))
        .map((l) => enriquecerLinhaLab(l, resolvidosMapeamento))
    const emerdogs = (linhasEmerdog || [])
        .filter((l) => linhaConferenciaTemRegistro(l))
        .map((l) =>
            enriquecerLinhaEmerdog(
                l,
                precosPorNomeNorm,
                resolvidosMapeamento,
                nomeSistemaPorNorm,
                codigoPorNomeNorm,
            ),
        )
    const mapas = mapasAliasesPessoa || { tutor: new Map(), pet: new Map() }

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
        const chave = chaveMatchExame(
            em.tutor,
            em.pet,
            em.data,
            em.exameMatchNorm,
            mapas,
        )
        if (!bucketEm.has(chave)) bucketEm.set(chave, [])
        bucketEm.get(chave).push(em)
    }

    for (const lab of labs) {
        if (usadoLab.has(lab.idLocal)) continue
        if (!lab.data || !lab.exameMatchNorm) continue
        const chave = chaveMatchExame(
            lab.tutor,
            lab.pet,
            lab.data,
            lab.exameMatchNorm,
            mapas,
        )
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
        const k = chaveGrupoAtendimento(lab.tutor, lab.pet, lab.data, mapas)
        if (!labsRestPorAt.has(k)) labsRestPorAt.set(k, [])
        labsRestPorAt.get(k).push(lab)
    }
    for (const em of emerdogs) {
        if (usadoEm.has(em.idLocal)) continue
        const k = chaveGrupoAtendimento(em.tutor, em.pet, em.data, mapas)
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
 * Aplica combinação manual de dois órfãos e remonta a lista de cards (síncrono, sem rede).
 */
export function combinarOrfaosNosCards(cards, idLabLocal, idEmerdogLocal, opts = {}) {
    const orfaoLab = (cards || []).find(
        (c) => c.tipo === 'orfao_lab' && String(c.idLabLocal) === String(idLabLocal),
    )
    const orfaoEm = (cards || []).find(
        (c) => c.tipo === 'orfao_emerdog' && String(c.idEmerdogLocal) === String(idEmerdogLocal),
    )
    if (!orfaoLab || !orfaoEm) {
        throw new Error('Selecione um órfão do laboratório e um do plano.')
    }

    const linhaLab =
        orfaoLab._linhaLab ||
        ({
            idLocal: orfaoLab.idLabLocal,
            tutor: orfaoLab.tutor,
            pet: orfaoLab.pet,
            data: orfaoLab.data,
            exame: orfaoLab.exameLaboratorio,
            exameNorm: normalizarNomeExame(orfaoLab.exameLaboratorio),
            valorRelatorio: orfaoLab.valorLab,
            linhaExcel: orfaoLab.linhaExcelLab,
            nomeEmerdogMapeado: orfaoLab.nomeNegociacao,
        })
    const linhaEm =
        orfaoEm._linhaEmerdog ||
        ({
            idLocal: orfaoEm.idEmerdogLocal,
            tutor: orfaoEm.tutor,
            pet: orfaoEm.pet,
            data: orfaoEm.data,
            exame: orfaoEm.exameEmerdog,
            exameNorm: normalizarNomeExame(orfaoEm.exameEmerdog),
            valorNegociacao: orfaoEm.valorEmerdog,
            nomeNegociacao: orfaoEm.nomeNegociacao,
            nomeSistemaNegociacao: orfaoEm.nomeNegociacao,
            linhaExcel: orfaoEm.linhaExcelEmerdog,
        })

    const novo = montarCardPareado(linhaLab, linhaEm, {
        ...opts,
        combinadoManual: true,
        status: 'conferido_manual',
        chaveManual: `manual:${idLabLocal}|${idEmerdogLocal}`,
    })

    const resto = (cards || []).filter(
        (c) =>
            !(c.tipo === 'orfao_lab' && String(c.idLabLocal) === String(idLabLocal)) &&
            !(c.tipo === 'orfao_emerdog' && String(c.idEmerdogLocal) === String(idEmerdogLocal)),
    )
    return [{ ...novo, idLocal: `par-${idLabLocal}-${idEmerdogLocal}` }, ...resto]
}

/** Score 0–1000 de similaridade textual (mesma lógica da sugestão de prestadores). */
export function scoreSimilaridadeNome(a, b, mapaAliases = null) {
    let termo = normalizarTextoBusca(a)
    let n = normalizarTextoBusca(b)
    if (mapaAliases?.size) {
        termo = mapaAliases.get(termo) || termo
        n = mapaAliases.get(n) || n
    }
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
            const valoresDiferem = cardTemDiffPendente(card)
            const idLinha = chaveMarcacaoPosRelatorio(card) || card.idLocal
            linhas.push({
                idLocal: idLinha,
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
            usados.add(idLinha)
        }

        for (const card of g.cardsExame) {
            if (card.tipo === 'pareado' || (card.idLabLocal && card.idEmerdogLocal)) {
                const idLinha = chaveMarcacaoPosRelatorio(card) || card.idLocal
                if (usados.has(idLinha)) continue
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
            const idLinha = chaveMarcacaoPosRelatorio(card) || card.idLocal
            if (card.tipo !== 'orfao_lab' || usados.has(idLinha)) continue
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
            const idLinha = chaveMarcacaoPosRelatorio(card) || card.idLocal
            if (card.tipo !== 'orfao_emerdog' || usados.has(idLinha)) continue
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
            const idLinha = chaveMarcacaoPosRelatorio(card) || card.idLocal
            if (usados.has(idLinha)) continue
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

/**
 * Se o plano ficou R$ 0,00, completa com o preço da negociação (nome/código).
 */
export function preencherPrecosZeroNosGruposComparacao(grupos, precosPorNomeNorm) {
    return (grupos || []).map((g) => {
        const examesEm = (g.examesEm || []).map((ex) => {
            const atual = Number(ex.valor)
            const diffPendente = cardTemDiffPendente(ex.card)
            if (Number.isFinite(atual) && atual !== 0) {
                if (ex.valoresDiferem && !diffPendente) {
                    return { ...ex, valoresDiferem: false }
                }
                return ex
            }
            const achado = precoUtilDoMapa(
                precosPorNomeNorm,
                ex.codigo,
                ex.nome,
                ex.card?.nomeNegociacao,
                ex.card?.exameEmerdog,
                ex.card?.codigo,
            )
            if (achado == null) {
                return Number.isFinite(atual) && atual === 0 ? { ...ex, valor: null } : ex
            }
            const valorLab = ex.card?.valorLab
            const valoresDiferem = cardTemDiffPendente({
                ...ex.card,
                valoresDiferem: valoresExameDiferem(valorLab, achado),
            })
            return {
                ...ex,
                valor: achado,
                valoresDiferem,
                semParNegociacao: false,
                card: ex.card
                    ? {
                          ...ex.card,
                          valorEmerdog: achado,
                          diferenca:
                              valorLab != null
                                  ? Number((Number(valorLab) - achado).toFixed(2))
                                  : null,
                          valoresDiferem,
                          semParNegociacao: false,
                      }
                    : ex.card,
            }
        })

        const porLinha = new Map(examesEm.map((e) => [e.linhaId, e]))
        const examesLab = (g.examesLab || []).map((ex) => {
            const em = porLinha.get(ex.linhaId)
            if (!em) return ex
            return { ...ex, valoresDiferem: Boolean(em.valoresDiferem) }
        })
        const linhas = (g.linhas || []).map((l) => {
            const em = porLinha.get(l.idLocal)
            if (!em?.card) return l
            return {
                ...l,
                valoresDiferem: Boolean(em.valoresDiferem),
                diferenca: em.card.diferenca,
                semParNegociacao: false,
                card: em.card,
                em: l.em ? { ...l.em, valor: em.valor } : l.em,
            }
        })
        const soma = (lista) =>
            Number(
                (lista || [])
                    .map((e) => Number(e.valor))
                    .filter((n) => Number.isFinite(n))
                    .reduce((a, n) => a + n, 0)
                    .toFixed(2),
            )
        const temDiff = linhas.some((l) => l.valoresDiferem)
        return {
            ...g,
            examesEm,
            examesLab,
            linhas,
            subtotalEm: soma(examesEm),
            temDiff,
        }
    })
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

function pontuarGruposOrfaos(grupoLab, grupoEm, mapasAliases = null) {
    const scoreTutor = scoreSimilaridadeNome(
        grupoLab.tutor,
        grupoEm.tutor,
        mapasAliases?.tutor,
    )
    const scorePet = scoreSimilaridadeNome(
        grupoLab.pet,
        grupoEm.pet,
        mapasAliases?.pet,
    )
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

    // Se nenhum exame bateu por nome/código, não força 1:1 (evita parear exames errados)
    return pares
}

/**
 * Score + badges de pareamento entre dois cards/lados (lab ↔ plano).
 * Usado na fila e na UI ao trocar o atendimento do plano.
 */
export function pontuarPareamentoExamesIndividuais(ladoA, ladoB, mapasAliases = null) {
    const scoreTutor = scoreSimilaridadeNome(
        ladoA?.tutor,
        ladoB?.tutor,
        mapasAliases?.tutor,
    )
    const scorePet = scoreSimilaridadeNome(ladoA?.pet, ladoB?.pet, mapasAliases?.pet)
    const scoreData = scoreDataProximidade(ladoA?.data, ladoB?.data)
    const nomeA = ladoA?.exameLaboratorio || ladoA?.exameEmerdog || ladoA?.exame || ''
    const nomeB = ladoB?.exameEmerdog || ladoB?.exameLaboratorio || ladoB?.exame || ''
    const scoreExame = scorePareamentoExame(
        {
            nome: nomeA,
            nomeNorm: normalizarNomeExame(nomeA),
            codigo: ladoA?.codigo,
        },
        {
            nome: nomeB,
            nomeNorm: normalizarNomeExame(nomeB),
            codigo: ladoB?.codigo,
        },
    )
    const total = scoreTutor * 4 + scorePet * 3 + scoreData + scoreExame * 0.5
    const motivos = []
    if (scoreTutor >= 1000) motivos.push('Tutor idêntico')
    else if (scoreTutor >= 650) motivos.push('Tutor parecido')
    else if (scoreTutor >= 180) motivos.push('Tutor parcialmente parecido')
    if (scorePet >= 1000) motivos.push('Animal idêntico')
    else if (scorePet >= 650) motivos.push('Animal parecido')
    else if (scorePet >= 180) motivos.push('Animal parcialmente parecido')
    if (scoreData >= 200) motivos.push('Mesma data')
    else if (scoreData >= 60) motivos.push('Data próxima')
    if (scoreExame >= 1000) motivos.push('Exame/código idêntico')
    else if (scoreExame >= 650) motivos.push('Exame parecido')
    const motivoValor = motivoComparacaoValor(
        valorCardConferencia(ladoA),
        valorCardConferencia(ladoB),
    )
    if (motivoValor) motivos.push(motivoValor)
    return { scoreTutor, scorePet, scoreData, scoreExame, total, motivos }
}

/**
 * Match 100%: tutor, animal, data, exame/código idênticos e valor OK.
 * Esses podem ser aprovados automaticamente e sair da fila.
 */
export function ehPareamentoExamePerfeito(scores) {
    if (!scores) return false
    if (Number(scores.scoreTutor) < 1000) return false
    if (Number(scores.scorePet) < 1000) return false
    if (Number(scores.scoreData) < 200) return false
    if (Number(scores.scoreExame) < 1000) return false
    const motivos = scores.motivos || []
    return motivos.includes('Valor OK')
}

/**
 * Pareia órfãos lab↔plano com match 100% e remove da lista de órfãos.
 * Cada lab/em entra em no máximo um par (guloso por score total).
 */
export function autoAprovarPareamentosPerfeitos(cards, opts = {}) {
    const mapas = opts.mapasAliasesPessoa || { tutor: new Map(), pet: new Map() }
    let atual = [...(cards || [])]
    const orfaosLab = atual.filter((c) => c.tipo === 'orfao_lab')
    const orfaosEm = atual.filter((c) => c.tipo === 'orfao_emerdog')

    const candidatos = []
    for (const lab of orfaosLab) {
        for (const em of orfaosEm) {
            const scores = pontuarPareamentoExamesIndividuais(lab, em, mapas)
            if (!ehPareamentoExamePerfeito(scores)) continue
            candidatos.push({
                idLabLocal: lab.idLabLocal,
                idEmerdogLocal: em.idEmerdogLocal,
                total: scores.total,
            })
        }
    }
    candidatos.sort((a, b) => b.total - a.total)

    const usadosLab = new Set()
    const usadosEm = new Set()
    const paresAuto = []
    for (const p of candidatos) {
        const idL = String(p.idLabLocal)
        const idE = String(p.idEmerdogLocal)
        if (usadosLab.has(idL) || usadosEm.has(idE)) continue
        usadosLab.add(idL)
        usadosEm.add(idE)
        paresAuto.push({
            idLabLocal: p.idLabLocal,
            idEmerdogLocal: p.idEmerdogLocal,
        })
    }

    for (const par of paresAuto) {
        try {
            atual = combinarOrfaosNosCards(
                atual,
                par.idLabLocal,
                par.idEmerdogLocal,
                opts,
            )
        } catch {
            // par já consumido / inconsistente — ignora
        }
    }

    return {
        cards: atual,
        paresAuto,
        qtdAuto: paresAuto.length,
    }
}

/**
 * Fila de revisão exame a exame (linha da planilha).
 * Inclui órfãos lab, órfãos plano e pares com valor divergente.
 * Candidatos do outro lado ranqueados por tutor/pet (+ data/exame).
 */
export function montarFilaExamesIndividuais(
    cards,
    { limiteCandidatos = 12, scoreMinimoTutorPet = 180, mapasAliasesPessoa = null } = {},
) {
    const lista = cards || []
    const orfaosLab = lista.filter((c) => c.tipo === 'orfao_lab')
    const orfaosEm = lista.filter((c) => c.tipo === 'orfao_emerdog')
    const diffs = lista.filter((c) => c.tipo === 'pareado' && c.valoresDiferem)
    const mapas = mapasAliasesPessoa || { tutor: new Map(), pet: new Map() }

    const ranquearCandidatos = (origem, pool, idField) => {
        const ranked = []
        for (const cand of pool) {
            const scores = pontuarPareamentoExamesIndividuais(origem, cand, mapas)
            if (
                scores.scoreTutor < scoreMinimoTutorPet &&
                scores.scorePet < 650 &&
                scores.total < 500
            ) {
                continue
            }
            ranked.push({
                idLocal: cand[idField] || cand.idEmerdogLocal || cand.idLabLocal,
                card: cand,
                ...scores,
            })
        }
        ranked.sort((a, b) => b.total - a.total || b.scoreExame - a.scoreExame)
        return ranked.slice(0, limiteCandidatos)
    }

    const fila = []

    for (const lab of orfaosLab) {
        const candidatos = ranquearCandidatos(lab, orfaosEm, 'idEmerdogLocal')
        fila.push({
            tipo: 'orfao_lab',
            idItem: `lab:${lab.idLabLocal}`,
            idLabLocal: lab.idLabLocal,
            idEmerdogLocal: null,
            cardLab: lab,
            cardEm: null,
            tutor: lab.tutor,
            pet: lab.pet,
            data: lab.data,
            exame: lab.exameLaboratorio,
            codigo: lab.codigo,
            valorLab: lab.valorLab,
            valorEm: null,
            candidatos,
            idEmSugerido: candidatos[0]?.idLocal || '',
            motivos: candidatos[0]?.motivos || ['Sem sugestão automática — escolha o exame do plano'],
        })
    }

    for (const em of orfaosEm) {
        // Só entra se ainda não é o melhor candidato exclusivo de algum lab já listado
        // (continua visível para parear lab→em; itens só-plano ajudam achar matches invertidos)
        const candidatos = ranquearCandidatos(em, orfaosLab, 'idLabLocal')
        if (!candidatos.length) {
            fila.push({
                tipo: 'orfao_emerdog',
                idItem: `em:${em.idEmerdogLocal}`,
                idLabLocal: null,
                idEmerdogLocal: em.idEmerdogLocal,
                cardLab: null,
                cardEm: em,
                tutor: em.tutor,
                pet: em.pet,
                data: em.data,
                exame: em.exameEmerdog,
                codigo: em.codigo,
                valorLab: null,
                valorEm: em.valorEmerdog,
                candidatos: [],
                idEmSugerido: '',
                idLabSugerido: '',
                motivos: ['Exame só no plano — sem lab correspondente próximo'],
                soPlano: true,
            })
        }
    }

    for (const par of diffs) {
        fila.push({
            tipo: 'diff_valor',
            idItem: `diff:${par.idLabLocal}|${par.idEmerdogLocal}`,
            idLabLocal: par.idLabLocal,
            idEmerdogLocal: par.idEmerdogLocal,
            cardLab: par,
            cardEm: par,
            tutor: par.tutor,
            pet: par.pet,
            data: par.data,
            exame: par.exameLaboratorio,
            examePlano: par.exameEmerdog,
            codigo: par.codigo,
            valorLab: par.valorLab,
            valorEm: par.valorEmerdog,
            diferenca: par.diferenca,
            candidatos: [
                {
                    idLocal: par.idEmerdogLocal,
                    card: par,
                    scoreTutor: 1000,
                    scorePet: 1000,
                    scoreData: 200,
                    scoreExame: 1000,
                    total: 9999,
                    motivos: [
                        'Par atual',
                        motivoComparacaoValor(par.valorLab, par.valorEmerdog) ||
                            'Valor diferente',
                    ],
                },
            ],
            idEmSugerido: par.idEmerdogLocal,
            motivos: [
                motivoComparacaoValor(par.valorLab, par.valorEmerdog) || 'Valor diferente',
            ],
            valoresDiferem: true,
        })
    }

    fila.sort((a, b) => {
        const t = normalizarTextoBusca(a.tutor).localeCompare(normalizarTextoBusca(b.tutor), 'pt-BR')
        if (t !== 0) return t
        const p = normalizarTextoBusca(a.pet).localeCompare(normalizarTextoBusca(b.pet), 'pt-BR')
        if (p !== 0) return p
        const d = String(a.data || '').localeCompare(String(b.data || ''))
        if (d !== 0) return d
        return String(a.exame || '').localeCompare(String(b.exame || ''), 'pt-BR')
    })

    return {
        fila,
        totalOrfaosLab: orfaosLab.length,
        totalOrfaosEm: orfaosEm.length,
        totalDiffs: diffs.length,
        totalPendentes: fila.length,
        orfaosLab,
        orfaosEm,
    }
}

/** Compat: mantém API antiga, agora baseada em exames individuais. */
export function montarFilaPareamentoOrfaos(cards, opts = {}) {
    const r = montarFilaExamesIndividuais(cards, opts)
    return {
        fila: r.fila,
        totalOrfaosLab: r.totalOrfaosLab,
        totalOrfaosEm: r.totalOrfaosEm,
        totalGruposLab: 0,
        totalGruposEm: 0,
        totalRevisao: r.totalPendentes,
        gruposLab: [],
        gruposEm: [],
        orfaosLab: r.orfaosLab,
        orfaosEm: r.orfaosEm,
        modoExamesIndividuais: true,
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

/** Diff de valor ainda pendente (conferido manual não conta). */
export function cardTemDiffPendente(card) {
    if (!card?.valoresDiferem) return false
    const st = card.status
    if (st === 'conferido_manual' || st === 'verde') return false
    return true
}

export function mesmoCardConferencia(a, b) {
    if (!a || !b) return false
    const ka = chaveMarcacaoPosRelatorio(a)
    const kb = chaveMarcacaoPosRelatorio(b)
    if (ka && kb && ka !== 'k:' && ka === kb) return true
    if (a.idLocal && b.idLocal && String(a.idLocal) === String(b.idLocal)) return true
    return false
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

function mapParaEntradas(mapLike) {
    if (!mapLike) return []
    if (mapLike instanceof Map) return [...mapLike.entries()]
    if (Array.isArray(mapLike)) return mapLike
    return Object.entries(mapLike)
}

function entradasParaMap(entries) {
    return new Map(Array.isArray(entries) ? entries : [])
}

/**
 * Totais da comparação para o resumo da etapa 4.
 */
export function resumirTotaisConferencia(cards) {
    const lista = cards || []
    let totalLab = 0
    let totalEm = 0
    let qtdPareados = 0
    let qtdDiff = 0
    let qtdOrfaoLab = 0
    let qtdOrfaoEm = 0
    for (const c of lista) {
        if (Number.isFinite(Number(c.valorLab))) totalLab += Number(c.valorLab)
        if (Number.isFinite(Number(c.valorEmerdog))) totalEm += Number(c.valorEmerdog)
        if (c.tipo === 'orfao_lab') qtdOrfaoLab += 1
        else if (c.tipo === 'orfao_emerdog') qtdOrfaoEm += 1
        else {
            qtdPareados += 1
            if (c.valoresDiferem && cardTemDiffPendente(c)) qtdDiff += 1
        }
    }
    return {
        totalLab,
        totalEm,
        diferenca: totalLab - totalEm,
        qtdPareados,
        qtdDiff,
        qtdOrfaoLab,
        qtdOrfaoEm,
        qtdExames: lista.length,
    }
}

/**
 * Serializa o estado da conferência (sem arquivos File) para JSONB.
 */
export function serializarEstadoSessaoConferencia(estado) {
    const e = estado || {}
    return {
        versao: 1,
        passo: e.passo || 'setup',
        periodoYm: e.periodoYm || '',
        laboratorioId: e.laboratorioId ? Number(e.laboratorioId) : null,
        mapColsLab: e.mapColsLab || {},
        mapColsEmerdog: e.mapColsEmerdog || {},
        linhasLab: e.linhasLab || [],
        linhasEmerdog: e.linhasEmerdog || [],
        paresManuais: e.paresManuais || [],
        resolvidos: mapParaEntradas(e.resolvidos),
        mapaResolvidosAtual: mapParaEntradas(e.mapaResolvidosAtual),
        decisoesOrfaos: mapParaEntradas(e.decisoesOrfaos),
        escolhasExames: e.escolhasExames || {},
        marcadosPosRelatorio: [...(e.marcadosPosRelatorio || [])],
        cards: e.cards || [],
        filaOrfaos: e.filaOrfaos || [],
        obsAuditoria: e.obsAuditoria || {},
        aliasesPessoa: e.aliasesPessoa || [],
        atualizadoEm: new Date().toISOString(),
    }
}

export function desserializarEstadoSessaoConferencia(payload) {
    const e = payload || {}
    return {
        versao: e.versao || 1,
        passo: e.passo || 'setup',
        periodoYm: e.periodoYm || '',
        laboratorioId: e.laboratorioId ? String(e.laboratorioId) : '',
        mapColsLab: e.mapColsLab || {},
        mapColsEmerdog: e.mapColsEmerdog || {},
        linhasLab: (e.linhasLab || []).filter((l) => linhaConferenciaTemRegistro(l)),
        linhasEmerdog: (e.linhasEmerdog || []).filter((l) => linhaConferenciaTemRegistro(l)),
        paresManuais: e.paresManuais || [],
        resolvidos: entradasParaMap(e.resolvidos),
        mapaResolvidosAtual: entradasParaMap(e.mapaResolvidosAtual),
        decisoesOrfaos: entradasParaMap(e.decisoesOrfaos),
        escolhasExames: e.escolhasExames || {},
        marcadosPosRelatorio: new Set(e.marcadosPosRelatorio || []),
        cards: (e.cards || []).filter((c) =>
            linhaConferenciaTemRegistro({
                tutor: c.tutor,
                pet: c.pet,
                exame: c.exameLaboratorio || c.exameEmerdog || c.exame || c.nomeNegociacao,
            }),
        ),
        filaOrfaos: (e.filaOrfaos || []).filter((i) =>
            linhaConferenciaTemRegistro({
                tutor: i.tutor,
                pet: i.pet,
                exame: i.exame || i.examePlano,
            }),
        ),
        aliasesPessoa: Array.isArray(e.aliasesPessoa) ? e.aliasesPessoa : [],
        obsAuditoria: e.obsAuditoria || {},
    }
}

export async function carregarSessaoConferencia({ laboratorioId, periodoYm }) {
    const labId = Number(laboratorioId)
    const periodo = String(periodoYm || '').trim()
    if (!labId || !periodo) return null

    try {
        const { data: userData } = await supabase.auth.getUser()
        const userId = userData?.user?.id
        if (!userId) return null

        const { data, error } = await supabase
            .from('lab_conferencia_sessao')
            .select('id, laboratorio_id, periodo_ym, passo, estado, atualizado_em')
            .eq('laboratorio_id', labId)
            .eq('periodo_ym', periodo)
            .eq('criado_por', userId)
            .maybeSingle()

        if (error) {
            // Tabela ausente / schema / 500: sessão é opcional — não bloqueia a conferência
            return null
        }
        if (!data) return null
        return {
            id: data.id,
            passo: data.passo,
            atualizadoEm: data.atualizado_em,
            estado: desserializarEstadoSessaoConferencia(data.estado),
        }
    } catch {
        return null
    }
}

/**
 * Persiste progresso. Retorna { ok, data?, aviso? } — nunca lança
 * (sessão é opcional; falha não deve impedir aprovar/parear).
 */
export async function salvarSessaoConferencia({ laboratorioId, periodoYm, passo, estado }) {
    const labId = Number(laboratorioId)
    const periodo = String(periodoYm || '').trim()
    if (!labId || !periodo) {
        return { ok: false, aviso: 'Laboratório e período são obrigatórios para salvar a sessão.' }
    }

    try {
        const { data: userData } = await supabase.auth.getUser()
        const userId = userData?.user?.id
        if (!userId) {
            return { ok: false, aviso: 'Sessão de usuário necessária para persistir a conferência.' }
        }

        const payload = {
            laboratorio_id: labId,
            periodo_ym: periodo,
            passo: passo || estado?.passo || 'setup',
            estado: serializarEstadoSessaoConferencia({
                ...estado,
                laboratorioId: labId,
                periodoYm: periodo,
                passo: passo || estado?.passo,
            }),
            criado_por: userId,
            atualizado_em: new Date().toISOString(),
        }

        const { data, error } = await supabase
            .from('lab_conferencia_sessao')
            .upsert(payload, { onConflict: 'laboratorio_id,periodo_ym,criado_por' })
            .select('id, atualizado_em')
            .single()

        if (error) {
            const msg = String(error.message || error.code || '')
            if (/lab_conferencia_sessao|does not exist|schema cache|42P01|PGRST/i.test(msg)) {
                return {
                    ok: false,
                    aviso:
                        'Tabela de sessão não configurada. Execute scripts/sql/conferencia_laboratorio.sql no Supabase (opcional).',
                }
            }
            return { ok: false, aviso: msg || 'Falha ao salvar sessão.' }
        }
        return { ok: true, data }
    } catch (e) {
        return { ok: false, aviso: e?.message || String(e) }
    }
}
