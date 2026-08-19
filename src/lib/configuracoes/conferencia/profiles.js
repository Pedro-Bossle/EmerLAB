import { compareDates } from './dates.js'
import { compareValues } from './values.js'
import { applyExamEquivalence, normalizeExam } from './examSimilarity.js'
import { nomesPessoaEquivalentes, petsEquivalentes, normalizeName } from './normalize.js'

function perfilAtivo(perfil, dataIso) {
    if (!perfil || perfil.ativo === false) return false
    const d = String(dataIso || '').slice(0, 10)
    if (perfil.vigencia_inicio && d && d < String(perfil.vigencia_inicio).slice(0, 10)) return false
    if (perfil.vigencia_fim && d && d > String(perfil.vigencia_fim).slice(0, 10)) return false
    return true
}

function membrosNorm(perfil) {
    return (perfil.exames || perfil.itens || [])
        .map((e) => normalizeExam(typeof e === 'string' ? e : e.nome || e.exame))
        .filter(Boolean)
}

function exameNoPerfil(exame, perfil, incluirTitulo = true) {
    const n = normalizeExam(exame)
    if (!n) return false
    if (incluirTitulo) {
        const titulo = normalizeExam(perfil.nome) || normalizeExam(perfil.descricao)
        if (titulo && n === titulo) return true
    }
    return membrosNorm(perfil).some((m) => {
        if (n === m) return true
        const ev = applyExamEquivalence(n, m, [])
        return ev.equivalent || ev.score >= 850
    })
}

/**
 * Agrupa órfãos remanescentes em perfil cadastrado (conservador).
 * Retorna pares perfil + linhas usadas, ou revisão se ambíguo.
 */
export function applyProfileEquivalence({
    orfaosHonorarios = [],
    orfaosMellis = [],
    perfis = [],
} = {}) {
    const usadosH = new Set()
    const usadosM = new Set()
    const grupos = []
    const revisoes = []

    for (const perfil of perfis || []) {
        const honCands = orfaosHonorarios.filter(
            (h) =>
                !usadosH.has(h.id) &&
                perfilAtivo(perfil, h.data) &&
                exameNoPerfil(h.exame, perfil),
        )
        if (!honCands.length) continue

        const porChave = new Map()
        for (const h of honCands) {
            const chave = `${normalizeName(h.tutor)}|${normalizeName(h.pet)}`
            if (!porChave.has(chave)) porChave.set(chave, [])
            porChave.get(chave).push(h)
        }

        for (const [, honGrupo] of porChave) {
            if (honGrupo.length !== 1) {
                revisoes.push({
                    tipo: 'perfil',
                    perfil: perfil.nome,
                    honorarios: honGrupo,
                    mellis: [],
                    motivo: 'Vários lançamentos de Honorários para o mesmo perfil — revisão.',
                })
                continue
            }
            const hon = honGrupo[0]
            const membros = orfaosMellis.filter((m) => {
                if (usadosM.has(m.id)) return false
                if (!petsEquivalentes(hon.pet, m.pet)) return false
                if (
                    !nomesPessoaEquivalentes(hon.tutor, m.tutor) &&
                    normalizeName(hon.tutor) !== normalizeName(m.tutor)
                ) {
                    return false
                }
                const dt = compareDates(hon.data, m.data)
                if (!dt.compativel) return false
                return exameNoPerfil(m.exame, perfil, false)
            })

            if (!membros.length) continue
            const valor = compareValues(hon.valor, membros.reduce((s, x) => s + Number(x.valor || 0), 0))
            if (membros.length > 1 && honCands.length > 1) {
                revisoes.push({
                    tipo: 'perfil',
                    perfil: perfil.nome,
                    honorarios: [hon],
                    mellis: membros,
                    motivo: 'Perfil com candidatos ambíguos.',
                })
                continue
            }

            usadosH.add(hon.id)
            for (const m of membros) usadosM.add(m.id)
            grupos.push({
                perfil,
                honorarios: hon,
                mellis: membros,
                valor,
            })
        }
    }

    return { grupos, revisoes, usadosH, usadosM }
}
