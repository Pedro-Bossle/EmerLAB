import { avaliarViaCidadeParalela, prestadorAtendeCidadeAlvo } from '../buscarQuemRealizaPrestadores.js'
import { tipoEspecialidadePrestador } from '../prestadorCadastroHelpers.js'

export function especialidadeCatalogoEhLocal(esp) {
    return tipoEspecialidadePrestador(esp?.tipo || '') === 'LOCAL'
}

/** IDs de especialidade do prestador (principal + secundárias em prestador_especialidades). */
export function idsEspecialidadesPrestador(prestador, linhasPrestadorEsp = []) {
    const ids = new Set()
    const pid = Number(prestador?.id)
    const principal = Number(prestador?.especialidade_id)
    if (principal) ids.add(principal)
    for (const row of linhasPrestadorEsp) {
        if (Number(row.prestador_id) !== pid) continue
        const eid = Number(row.especialidade_id)
        if (eid) ids.add(eid)
    }
    return ids
}

/** Como idsEspecialidadesPrestador, restrito a especialidades com tipo LOCAL no catálogo. */
export function idsEspecialidadesPrestadorLocal(prestador, linhasPrestadorEsp = [], mapaEspPorId) {
    const todos = idsEspecialidadesPrestador(prestador, linhasPrestadorEsp)
    const out = new Set()
    for (const id of todos) {
        const esp = mapaEspPorId?.get(Number(id))
        if (especialidadeCatalogoEhLocal(esp)) out.add(Number(id))
    }
    return out
}

function mapaEspecialidadesPorPrestador(linhas) {
    const m = new Map()
    for (const row of linhas || []) {
        const pid = Number(row.prestador_id)
        if (!pid) continue
        if (!m.has(pid)) m.set(pid, [])
        m.get(pid).push(row)
    }
    return m
}

/**
 * Agrupa credenciados por especialidade na cidade (UF + município).
 * @returns {Array<{ especialidadeId: number, nome: string, total: number, itens: { id, nome, viaParalela }[] }>}
 */
export function agruparCredenciadosPorEspecialidadeCidade({
    prestadores = [],
    prestadorEspecialidades = [],
    especialidades = [],
    cidadeAlvo,
    ctx,
    incluirCidadesParalelas = false,
}) {
    const cidade = String(cidadeAlvo?.nome || '').trim()
    if (!cidade) return []

    const mapaEsp = new Map((especialidades || []).map((e) => [Number(e.id), String(e.nome || '').trim()]))
    const espPorPrestador = mapaEspecialidadesPorPrestador(prestadorEspecialidades)
    const cidadesAlvo = [{ nome: cidade, uf: cidadeAlvo?.uf || '' }]
    const ctxBusca = { ...ctx, incluirCidadesParalelas }

    const porEsp = new Map()

    for (const p of prestadores || []) {
        const atende = prestadorAtendeCidadeAlvo(p, cidadesAlvo[0], ctxBusca)
        if (!atende) continue
        const viaParalela = avaliarViaCidadeParalela(p, cidadesAlvo, ctxBusca)
        const espIds = idsEspecialidadesPrestador(p, espPorPrestador.get(Number(p.id)) || [])
        for (const eid of espIds) {
            if (!mapaEsp.has(eid)) continue
            let bloco = porEsp.get(eid)
            if (!bloco) {
                bloco = {
                    especialidadeId: eid,
                    nome: mapaEsp.get(eid) || `Especialidade ${eid}`,
                    itens: [],
                }
                porEsp.set(eid, bloco)
            }
            if (!bloco.itens.some((x) => Number(x.id) === Number(p.id))) {
                bloco.itens.push({
                    id: p.id,
                    nome: String(p.nome || '').trim() || `#${p.id}`,
                    viaParalela,
                })
            }
        }
    }

    return [...porEsp.values()]
        .map((b) => ({
            ...b,
            total: b.itens.length,
            itens: [...b.itens].sort((a, c) => a.nome.localeCompare(c.nome, 'pt-BR', { sensitivity: 'base' })),
        }))
        .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
}
