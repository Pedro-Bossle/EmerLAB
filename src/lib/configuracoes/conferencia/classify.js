import { normalizeExam } from './examSimilarity.js'

function primeiroTokenExame(exame) {
    return (normalizeExam(exame) || '').split(/\s+/).filter(Boolean)[0] || ''
}

export function mesmoRadicalExame(exameA, exameB) {
    const a = primeiroTokenExame(exameA)
    const b = primeiroTokenExame(exameB)
    return Boolean(a && b && a === b)
}

const STATUS_OK = new Set([
    'OK',
    'OK_COM_NOME_DIFERENTE',
    'OK_COM_DATA_TOLERADA',
    'OK_COM_TUTOR_ALTERNATIVO',
    'OK_COM_EXAME_EQUIVALENTE',
    'PERFIL_EQUIVALENTE',
])

export function statusEhOk(status) {
    return STATUS_OK.has(status)
}

export function statusEhDivergencia(status) {
    return (
        status === 'VALOR_DIVERGENTE' ||
        status === 'DATA_DIVERGENTE' ||
        status === 'TUTOR_DIVERGENTE' ||
        status === 'PET_DIVERGENTE' ||
        status === 'EXAME_DIVERGENTE' ||
        status === 'REVISAO_MANUAL'
    )
}

export function classifyComparison({
    valor,
    data,
    tutorOk,
    tutorAlias,
    petOk,
    exame,
    exameHonorarios,
    exameMellis,
    perfil = false,
    ambiguo = false,
} = {}) {
    if (ambiguo) {
        return {
            status: 'REVISAO_MANUAL',
            motivo: 'Mais de um candidato possível — revisão humana obrigatória.',
        }
    }
    if (!petOk) {
        return { status: 'PET_DIVERGENTE', motivo: 'Pet divergente entre Honorários e MellisLab.' }
    }
    if (!tutorOk && !tutorAlias) {
        return {
            status: 'TUTOR_DIVERGENTE',
            motivo: 'Tutor divergente. Pode ser quem levou o animal — revisar.',
        }
    }
    if (!data?.compativel) {
        return {
            status: 'DATA_DIVERGENTE',
            motivo: `Diferença de ${data?.diferenca_dias ?? '—'} dia(s) (acima de 7).`,
        }
    }
    if (!valor?.ok) {
        const d = valor?.diferenca_valor
        const sinal = d > 0 ? '+' : ''
        return {
            status: 'VALOR_DIVERGENTE',
            motivo: `Exame correspondente, porém valor divergente (${sinal}${d ?? '—'}).`,
        }
    }
    if (perfil) {
        return {
            status: 'PERFIL_EQUIVALENTE',
            motivo: 'Exames contemplados em perfil cadastrado.',
        }
    }
    if (data.compativel && !data.exata) {
        return {
            status: 'OK_COM_DATA_TOLERADA',
            motivo: `Data dentro da tolerância (${data.diferenca_dias} dia(s)).`,
        }
    }
    if (exame?.equivalent && !exame?.exact) {
        if (mesmoRadicalExame(exameHonorarios, exameMellis)) {
            return { status: 'OK', motivo: 'Correspondência conferida.' }
        }
        return {
            status: 'OK_COM_EXAME_EQUIVALENTE',
            motivo: 'Exame equivalente cadastrado; valor conferido.',
        }
    }
    if (tutorAlias && tutorOk === false) {
        return {
            status: 'OK_COM_TUTOR_ALTERNATIVO',
            motivo: 'Tutor alternativo conhecido (quem levou o animal).',
        }
    }
    if (exame?.exact === false && (exame?.score || 0) >= 650) {
        return {
            status: 'OK_COM_NOME_DIFERENTE',
            motivo: 'Nome de exame diferente, correspondência conferida.',
        }
    }
    if (exame?.exact === false && !exame?.equivalent && (exame?.score || 0) < 650) {
        return {
            status: 'EXAME_DIVERGENTE',
            motivo: 'Nome de exame divergente entre Honorários e MellisLab.',
        }
    }
    return { status: 'OK', motivo: 'Correspondência conferida.' }
}

export function classifyOrphan(origem) {
    if (origem === 'mellislab') {
        return {
            status: 'ORFAO_MELLISLAB',
            motivo: 'Exame no MellisLab sem correspondente nos Honorários.',
        }
    }
    return {
        status: 'ORFAO_HONORARIOS',
        motivo: 'Exame nos Honorários sem correspondente no MellisLab.',
    }
}

const ROTULO_STATUS = {
    OK: 'OK',
    OK_COM_NOME_DIFERENTE: 'OK com nome diferente',
    OK_COM_DATA_TOLERADA: 'OK com data tolerada',
    OK_COM_TUTOR_ALTERNATIVO: 'OK com tutor alternativo',
    OK_COM_EXAME_EQUIVALENTE: 'OK com exame equivalente',
    PERFIL_EQUIVALENTE: 'Perfil equivalente',
    VALOR_DIVERGENTE: 'Valor divergente',
    DATA_DIVERGENTE: 'Data divergente',
    TUTOR_DIVERGENTE: 'Tutor divergente',
    PET_DIVERGENTE: 'Pet divergente',
    EXAME_DIVERGENTE: 'Exame divergente',
    REVISAO_MANUAL: 'Revisão manual',
    ORFAO_MELLISLAB: 'Órfão lab',
    ORFAO_HONORARIOS: 'Órfão plano',
}

export function rotuloStatusConferencia(status) {
    const chave = String(status || '').trim()
    if (!chave) return '—'
    if (ROTULO_STATUS[chave]) return ROTULO_STATUS[chave]
    return chave.replace(/_/g, ' ').toLowerCase()
}
