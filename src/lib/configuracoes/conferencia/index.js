import { findBestMatch, avaliarPar } from './matching.js'
import { classifyComparison, classifyOrphan, statusEhOk, statusEhDivergencia, rotuloStatusConferencia } from './classify.js'
import { montarMatchScore } from './confidence.js'
import { applyProfileEquivalence } from './profiles.js'
import {
    EQUIVALENCIAS_PADRAO,
    indexarEquivalencias,
    applyExamEquivalence,
} from './examSimilarity.js'
import { compareValues } from './values.js'
import { aplicarValoresBase, examesPendentesVinculo } from './lookupBase.js'

function uid(prefix, i) {
    return `${prefix}-${i}`
}

export function normalizarLinhaInterna(linha, origem, indice) {
    const id = linha.id || linha.idLocal || uid(origem, indice)
    return {
        id,
        prontuario: linha.prontuario || linha.atendimento || '',
        tutor: linha.tutor || '',
        pet: linha.pet || '',
        data: linha.data || null,
        exame: linha.exame || '',
        valor: linha.valor ?? linha.valorRelatorio ?? linha.valor_base ?? null,
        origem,
        linha_original: linha.linha_original ?? linha.linhaExcel ?? indice + 1,
        dataRaw: linha.dataRaw || '',
        codigo: linha.codigo || linha.codigo_base || '',
        codigo_base: linha.codigo_base || linha.codigo || '',
        nome_base: linha.nome_base || '',
        lookup_base: linha.lookup_base || null,
        bruto: linha.bruto || linha,
    }
}

function montarResultadoPar({ honorarios, mellis, av, classificacao, prioridade, candidatos = [] }) {
    const score = montarMatchScore({
        tutor: av.tutorOk ? 1000 : av.tutorAlias ? 800 : 0,
        pet: av.petOk ? 1000 : 0,
        data: av.data?.exata ? 1000 : av.data?.compativel ? 750 : 0,
        exame: av.exame?.score ?? 0,
        valor: av.valor?.ok ? 1000 : 0,
    })
    return {
        id: `par:${honorarios.id}|${mellis.id}`,
        status: classificacao.status,
        motivo: classificacao.motivo,
        acao: statusEhOk(classificacao.status) ? '—' : 'Revisar',
        prioridade,
        honorarios,
        mellis,
        tutor_honorarios: honorarios.tutor,
        tutor_mellislab: mellis.tutor,
        pet_honorarios: honorarios.pet,
        pet_mellislab: mellis.pet,
        data_honorarios: honorarios.data,
        data_mellislab: mellis.data,
        diferenca_dias: av.data?.diferenca_dias ?? null,
        exame_honorarios: honorarios.exame,
        exame_mellislab: mellis.exame,
        valor_honorarios: av.valor?.valor_honorarios ?? honorarios.valor,
        valor_mellislab: av.valor?.valor_mellislab ?? mellis.valor,
        diferenca_valor: av.valor?.diferenca_valor ?? null,
        prontuario_honorarios: honorarios.prontuario,
        prontuario_mellislab: mellis.prontuario,
        confianca: score.confianca,
        match_score: score,
        checks: {
            tutor: av.tutorOk || av.tutorAlias,
            pet: av.petOk,
            data: av.data,
            exame: av.exame,
            valor: av.valor,
        },
        candidatos: candidatos.map((c) => c.honorarios),
        revisao: null,
    }
}

function contextoMatching({ equivalencias = [], mapeamentosExame = [], aliasesPessoa = [] } = {}) {
    const eqs = indexarEquivalencias([
        ...EQUIVALENCIAS_PADRAO,
        ...equivalenciasDeMapeamentos(mapeamentosExame),
        ...(equivalencias || []),
    ])
    const aliasesTutor = (aliasesPessoa || []).filter((a) => (a.tipo || 'tutor') === 'tutor')
    return { equivalencias: eqs, aliasesTutor }
}

function montarOrfao(linha, origem) {
    const { status, motivo } = classifyOrphan(origem)
    const hon = origem === 'honorarios' ? linha : null
    const mel = origem === 'mellislab' ? linha : null
    return {
        id: `orfao:${origem}:${linha.id}`,
        status,
        motivo,
        acao: 'Revisar',
        prioridade: null,
        honorarios: hon,
        mellis: mel,
        tutor_honorarios: hon?.tutor || '',
        tutor_mellislab: mel?.tutor || '',
        pet_honorarios: hon?.pet || '',
        pet_mellislab: mel?.pet || '',
        data_honorarios: hon?.data || null,
        data_mellislab: mel?.data || null,
        diferenca_dias: null,
        exame_honorarios: hon?.exame || '',
        exame_mellislab: mel?.exame || '',
        valor_honorarios: hon?.valor ?? null,
        valor_mellislab: mel?.valor ?? null,
        diferenca_valor: null,
        prontuario_honorarios: hon?.prontuario || '',
        prontuario_mellislab: mel?.prontuario || '',
        confianca: 'BAIXA',
        match_score: null,
        checks: null,
        candidatos: [],
        revisao: null,
    }
}

export function equivalenciasDeMapeamentos(mapeamentos = []) {
    return (mapeamentos || [])
        .map((m) => ({
            a: m.nomeLab || m.nome_lab || m.a,
            b: m.nomeEmerdog || m.nome_emerdog || m.b || m.nomePlano,
        }))
        .filter((p) => p.a && p.b)
}

export function resumirConferencia(resultados = []) {
    const list = resultados || []
    const pares = list.filter((r) => r.honorarios && r.mellis)
    const soma = (lado) =>
        Math.round(
            list.reduce((s, r) => {
                const v = lado === 'h' ? r.valor_honorarios : r.valor_mellislab
                return s + (Number.isFinite(Number(v)) ? Number(v) : 0)
            }, 0) * 100,
        ) / 100

    const totalHonorarios = soma('h')
    const totalMellis = soma('m')
    const diferencaFinanceira = Math.round((totalMellis - totalHonorarios) * 100) / 100
    const aMais = Math.round(
        pares.reduce((s, r) => s + Math.max(0, Number(r.diferenca_valor) || 0), 0) * 100,
    ) / 100
    const aMenos = Math.round(
        pares.reduce((s, r) => s + Math.max(0, -(Number(r.diferenca_valor) || 0)), 0) * 100,
    ) / 100

    const contar = (pred) => list.filter(pred).length

    return {
        totalHonorarios,
        totalMellis,
        itensConferidos: pares.length,
        itensOk: contar((r) => statusEhOk(r.status)),
        valoresDivergentes: contar((r) => r.status === 'VALOR_DIVERGENTE'),
        datasDivergentes: contar((r) => r.status === 'DATA_DIVERGENTE'),
        orfaosMellis: contar((r) => r.status === 'ORFAO_MELLISLAB'),
        orfaosHonorarios: contar((r) => r.status === 'ORFAO_HONORARIOS'),
        revisoesManuais: contar((r) => r.status === 'REVISAO_MANUAL'),
        divergentes: contar((r) => statusEhDivergencia(r.status)),
        diferencaFinanceira,
        valoresCobradosAMais: aMais,
        valoresCobradosAMenos: aMenos,
    }
}

/**
 * Motor principal: MellisLab × Honorários (Honorários = valor oficial).
 */
export function runConferencia({
    honorarios = [],
    mellislab = [],
    plano = [],
    laboratorio = [],
    valoresBase = [],
    vinculosBase = {},
    equivalencias = [],
    mapeamentosExame = [],
    aliasesPessoa = [],
    perfis = [],
} = {}) {
    const ctx = contextoMatching({ equivalencias, mapeamentosExame, aliasesPessoa })
    const eqs = ctx.equivalencias

    const honBruto = (honorarios.length ? honorarios : plano) || []
    const melBruto = (mellislab.length ? mellislab : laboratorio) || []

    let honFonte = honBruto
    let pendentesBase = []
    if ((valoresBase || []).length) {
        honFonte = aplicarValoresBase(honBruto, valoresBase, vinculosBase, eqs)
        pendentesBase = honFonte.filter((l) => l.lookup_base?.tipo !== 'unico')
        honFonte = honFonte.filter((l) => l.lookup_base?.tipo === 'unico')
    }

    const hon = honFonte.map((l, i) => normalizarLinhaInterna(l, 'honorarios', i))
    const mel = melBruto.map((l, i) => normalizarLinhaInterna(l, 'mellislab', i))

    const usadosH = new Set()
    const usadosM = new Set()
    const resultados = []

    for (const m of mel) {
        const livres = hon.filter((h) => !usadosH.has(h.id))
        const found = findBestMatch(m, livres, ctx)
        if (found.tipo === 'unico') {
            const { honorarios: h, av } = found.match
            usadosH.add(h.id)
            usadosM.add(m.id)
            const classificacao = classifyComparison({
                ...av,
                exameHonorarios: h.exame,
                exameMellis: m.exame,
            })
            resultados.push(
                montarResultadoPar({
                    honorarios: h,
                    mellis: m,
                    av,
                    classificacao,
                    prioridade: found.prioridade,
                }),
            )
        } else if (found.tipo === 'ambiguo') {
            usadosM.add(m.id)
            const primeiro = found.candidatos[0]
            if (primeiro?.honorarios?.id) usadosH.add(primeiro.honorarios.id)
            const av = primeiro?.av || {
                tutorOk: false,
                tutorAlias: false,
                petOk: false,
                data: {},
                valor: {},
                exame: applyExamEquivalence('', '', eqs),
            }
            const classificacao = classifyComparison({ ambiguo: true })
            resultados.push({
                ...montarResultadoPar({
                    honorarios: primeiro.honorarios,
                    mellis: m,
                    av,
                    classificacao,
                    prioridade: found.prioridade,
                    candidatos: found.candidatos,
                }),
                honorarios: primeiro.honorarios,
                candidatos: found.candidatos.map((c) => c.honorarios),
            })
        }
    }

    const orfaosH = hon.filter((h) => !usadosH.has(h.id))
    const orfaosM = mel.filter((m) => !usadosM.has(m.id))
    const perfilOut = applyProfileEquivalence({
        orfaosHonorarios: orfaosH,
        orfaosMellis: orfaosM,
        perfis,
    })

    for (const g of perfilOut.grupos || []) {
        usadosH.add(g.honorarios.id)
        const valorMellis = (g.mellis || []).reduce((s, x) => s + Number(x.valor || 0), 0)
        const valor = g.valor || compareValues(g.honorarios.valor, valorMellis)
        const classificacao = classifyComparison({
            valor,
            data: { compativel: true, exata: true, diferenca_dias: 0 },
            tutorOk: true,
            petOk: true,
            exame: { exact: false, equivalent: true, score: 900 },
            perfil: true,
        })
        for (let i = 0; i < (g.mellis || []).length; i += 1) {
            const m = g.mellis[i]
            usadosM.add(m.id)
            const par = montarResultadoPar({
                honorarios: g.honorarios,
                mellis: m,
                av: {
                    tutorOk: true,
                    tutorAlias: false,
                    petOk: true,
                    data: { compativel: true, exata: true, diferenca_dias: 0 },
                    valor,
                    exame: { exact: false, equivalent: true, score: 900 },
                },
                classificacao,
                prioridade: 5,
            })
            if (i > 0) {
                par.valor_honorarios = null
                par.diferenca_valor = null
            }
            resultados.push(par)
        }
    }

    for (const rev of perfilOut.revisoes || []) {
        const h = rev.honorarios?.[0]
        const m = rev.mellis?.[0]
        if (!h && !m) continue
        if (h) usadosH.add(h.id)
        if (m) usadosM.add(m.id)
        for (const extra of rev.honorarios || []) usadosH.add(extra.id)
        for (const extra of rev.mellis || []) usadosM.add(extra.id)
        resultados.push({
            ...montarOrfao(m || h, m ? 'mellislab' : 'honorarios'),
            status: 'REVISAO_MANUAL',
            motivo: rev.motivo || 'Perfil com candidatos ambíguos.',
            honorarios: h || null,
            mellis: m || null,
            candidatos: [...(rev.honorarios || []), ...(rev.mellis || [])],
        })
    }

    for (const m of mel.filter((x) => !usadosM.has(x.id))) {
        resultados.push(montarOrfao(m, 'mellislab'))
    }
    for (const h of hon.filter((x) => !usadosH.has(x.id))) {
        resultados.push(montarOrfao(h, 'honorarios'))
    }

    for (const p of pendentesBase) {
        const linha = normalizarLinhaInterna(p, 'honorarios', 0)
        resultados.push({
            ...montarOrfao(linha, 'honorarios'),
            status: 'REVISAO_MANUAL',
            motivo:
                p.lookup_base?.tipo === 'ambiguo'
                    ? 'Mais de um item em Valores de Base para este exame — vincule manualmente.'
                    : 'Exame do plano sem valor de base. Vincule um item da lista desta conferência.',
            candidatos: p.lookup_base?.candidatos || [],
        })
    }

    const resumo = resumirConferencia(resultados)
    return {
        resultados,
        resumo,
        equivalencias: eqs,
        pendentesBase: examesPendentesVinculo(pendentesBase),
    }
}

export function montarParManual(honorarios, mellis, extra = {}) {
    const ctx = extra.aliasesTutor ? extra : contextoMatching(extra)
    const av = avaliarPar(honorarios, mellis, ctx)
    const classificacao = classifyComparison({
        ...av,
        exameHonorarios: honorarios.exame,
        exameMellis: mellis.exame,
    })
    return {
        ...montarResultadoPar({
            honorarios,
            mellis,
            av,
            classificacao,
            prioridade: null,
        }),
        acao: 'Pareado manualmente',
    }
}

export { statusEhOk, statusEhDivergencia, rotuloStatusConferencia }
