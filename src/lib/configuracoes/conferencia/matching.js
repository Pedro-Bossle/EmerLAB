import { compareDates } from './dates.js'
import { compareValues } from './values.js'
import { applyExamEquivalence } from './examSimilarity.js'
import { nomesPessoaEquivalentes, petsEquivalentes, normalizeName } from './normalize.js'

function tutorPorAlias(tutorHonorarios, tutorMellis, aliasesTutor = []) {
    const nh = normalizeName(tutorHonorarios)
    const nm = normalizeName(tutorMellis)
    if (!nh || !nm) return false
    return (aliasesTutor || []).some((a) => {
        const plano = normalizeName(a.nomePlano || a.nome_plano || a.honorarios)
        const lab = normalizeName(a.nomeLab || a.nome_lab || a.mellislab)
        return (plano === nh && lab === nm) || (plano === nm && lab === nh)
    })
}

export function avaliarPar(honorarios, mellis, { equivalencias = [], aliasesTutor = [] } = {}) {
    const tutorOk = nomesPessoaEquivalentes(honorarios.tutor, mellis.tutor)
    const tutorAlias = !tutorOk && tutorPorAlias(honorarios.tutor, mellis.tutor, aliasesTutor)
    const petOk = petsEquivalentes(honorarios.pet, mellis.pet)
    const data = compareDates(honorarios.data, mellis.data)
    const valor = compareValues(honorarios.valor, mellis.valor)
    const exame = applyExamEquivalence(honorarios.exame, mellis.exame, equivalencias)
    return { tutorOk, tutorAlias, petOk, data, valor, exame }
}

function passaPrioridade(av, prioridade) {
    const { tutorOk, tutorAlias, petOk, data, valor, exame } = av
    const examOk = exame.exact || exame.equivalent
    switch (prioridade) {
        case 1:
            return tutorOk && petOk && exame.exact && valor.ok && data.exata
        case 2:
            return tutorOk && petOk && exame.equivalent && valor.ok && data.exata
        case 3:
            return tutorOk && petOk && examOk && valor.ok && data.compativel
        case 4:
            return tutorAlias && petOk && examOk && valor.ok && data.compativel
        case 6:
            return tutorOk && petOk && examOk && data.exata
        case 7:
            return tutorOk && petOk && examOk && data.compativel
        case 8:
            return tutorAlias && petOk && examOk && data.compativel
        case 9:
            return tutorOk && petOk && examOk
        case 10:
            return petOk && examOk && valor.ok && data.compativel && !tutorOk && !tutorAlias
        default:
            return false
    }
}

const PRIORIDADES = [1, 2, 3, 4, 6, 7, 8, 9, 10]

/**
 * Conservador: na maior prioridade com candidato(s), 1 → match; 2+ → revisão.
 * Não escolhe FIFO/guloso.
 */
export function findBestMatch(linhaMellis, honorariosLivres, ctx = {}) {
    if (!linhaMellis || !honorariosLivres?.length) {
        return { tipo: 'nenhum', candidatos: [], prioridade: null, avaliacoes: [] }
    }

    const avaliacoes = honorariosLivres.map((h) => ({
        honorarios: h,
        av: avaliarPar(h, linhaMellis, ctx),
    }))

    for (const prioridade of PRIORIDADES) {
        const candidatos = avaliacoes.filter((x) => passaPrioridade(x.av, prioridade))
        if (candidatos.length === 1) {
            return {
                tipo: 'unico',
                prioridade,
                candidatos,
                match: candidatos[0],
            }
        }
        if (candidatos.length > 1) {
            return {
                tipo: 'ambiguo',
                prioridade,
                candidatos,
                match: null,
            }
        }
    }

    return { tipo: 'nenhum', candidatos: [], prioridade: null, avaliacoes }
}
