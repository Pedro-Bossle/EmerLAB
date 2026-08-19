import { statusEhDivergencia, resumirConferencia } from './index.js'

const COLUNAS_PLANAS = [
    { header: 'status', key: 'status', width: 24 },
    { header: 'tutor_honorarios', key: 'tutor_honorarios', width: 28 },
    { header: 'tutor_mellislab', key: 'tutor_mellislab', width: 28 },
    { header: 'pet_honorarios', key: 'pet_honorarios', width: 16 },
    { header: 'pet_mellislab', key: 'pet_mellislab', width: 16 },
    { header: 'data_honorarios', key: 'data_honorarios', width: 14 },
    { header: 'data_mellislab', key: 'data_mellislab', width: 14 },
    { header: 'diferenca_dias', key: 'diferenca_dias', width: 14 },
    { header: 'exame_honorarios', key: 'exame_honorarios', width: 36 },
    { header: 'exame_mellislab', key: 'exame_mellislab', width: 36 },
    { header: 'valor_honorarios', key: 'valor_honorarios', width: 16 },
    { header: 'valor_mellislab', key: 'valor_mellislab', width: 16 },
    { header: 'diferenca_valor', key: 'diferenca_valor', width: 16 },
    { header: 'confianca', key: 'confianca', width: 12 },
    { header: 'motivo', key: 'motivo', width: 40 },
    { header: 'acao_resultado', key: 'acao_resultado', width: 16 },
]

function isoParaBr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || ''
}

function linhaPlana(r) {
    const dv = r.diferenca_valor
    const sinal = Number.isFinite(Number(dv)) && Number(dv) > 0 ? '+' : ''
    return {
        status: r.status || '',
        tutor_honorarios: r.tutor_honorarios || '',
        tutor_mellislab: r.tutor_mellislab || '',
        pet_honorarios: r.pet_honorarios || '',
        pet_mellislab: r.pet_mellislab || '',
        data_honorarios: isoParaBr(r.data_honorarios),
        data_mellislab: isoParaBr(r.data_mellislab),
        diferenca_dias: r.diferenca_dias == null ? '' : r.diferenca_dias,
        exame_honorarios: r.exame_honorarios || '',
        exame_mellislab: r.exame_mellislab || '',
        valor_honorarios: r.valor_honorarios ?? '',
        valor_mellislab: r.valor_mellislab ?? '',
        diferenca_valor:
            dv == null || dv === '' ? '' : `${sinal}${Number(dv).toFixed(2).replace('.', ',')}`,
        confianca: r.confianca || '',
        motivo: r.motivo || '',
        acao_resultado: r.acao || '',
    }
}

function preencherAba(ws, linhas) {
    ws.columns = COLUNAS_PLANAS
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const r of linhas || []) ws.addRow(linhaPlana(r))
}

function sanitizarNome(nome) {
    return String(nome || 'laboratorio')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
}

export async function exportarConferenciaHonorariosExcel({
    resultados = [],
    resumo = null,
    revisoes = [],
    laboratorioNome = '',
    periodoYm = '',
} = {}) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Emerdog SFSC'

    const tot = resumo || resumirConferencia(resultados)
    const wsResumo = workbook.addWorksheet('RESUMO')
    wsResumo.columns = [
        { header: 'Indicador', key: 'indicador', width: 32 },
        { header: 'Quantidade', key: 'quantidade', width: 14 },
        { header: 'Valor', key: 'valor', width: 16 },
    ]
    wsResumo.getRow(1).font = { bold: true }
    const indicadores = [
        ['Total Honorários', '', tot.totalHonorarios],
        ['Total MellisLab', '', tot.totalMellis],
        ['Itens conferidos', tot.itensConferidos, ''],
        ['Itens OK', tot.itensOk, ''],
        ['Valores divergentes', tot.valoresDivergentes, ''],
        ['Datas divergentes', tot.datasDivergentes, ''],
        ['Órfãos MellisLab', tot.orfaosMellis, ''],
        ['Órfãos Honorários', tot.orfaosHonorarios, ''],
        ['Revisões manuais', tot.revisoesManuais, ''],
        ['Diferença financeira', '', tot.diferencaFinanceira],
        ['Valores cobrados a mais', '', tot.valoresCobradosAMais],
        ['Valores cobrados a menos', '', tot.valoresCobradosAMenos],
    ]
    for (const [indicador, quantidade, valor] of indicadores) {
        wsResumo.addRow({ indicador, quantidade, valor })
    }

    preencherAba(workbook.addWorksheet('COMPARACAO'), resultados)
    preencherAba(
        workbook.addWorksheet('DIVERGENCIAS'),
        resultados.filter((r) => statusEhDivergencia(r.status)),
    )
    preencherAba(
        workbook.addWorksheet('ORFAOS_MELLISLAB'),
        resultados.filter((r) => r.status === 'ORFAO_MELLISLAB'),
    )
    preencherAba(
        workbook.addWorksheet('ORFAOS_HONORARIOS'),
        resultados.filter((r) => r.status === 'ORFAO_HONORARIOS'),
    )

    const wsRev = workbook.addWorksheet('REVISOES_MANUAIS')
    wsRev.columns = [
        { header: 'usuario', key: 'usuario', width: 24 },
        { header: 'data_hora', key: 'data_hora', width: 22 },
        { header: 'acao_revisao', key: 'acao_revisao', width: 24 },
        { header: 'registro', key: 'registro', width: 28 },
        { header: 'justificativa', key: 'justificativa', width: 40 },
        ...COLUNAS_PLANAS,
    ]
    wsRev.getRow(1).font = { bold: true }
    const revisados = (resultados || []).filter((r) => r.revisao)
    const fonteRev = revisoes.length ? revisoes : revisados
    for (const item of fonteRev) {
        const r = item.resultado || item
        wsRev.addRow({
            usuario: item.usuario || r.revisao?.usuario || '',
            data_hora: item.dataHora || r.revisao?.dataHora || '',
            acao_revisao: item.acao || r.revisao?.acao || '',
            registro: item.resultadoId || r.id || '',
            justificativa: item.justificativa || r.revisao?.justificativa || '',
            ...linhaPlana(r),
        })
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const nomeArquivo = `conferencia-honorarios-${sanitizarNome(laboratorioNome) || 'lab'}${
        periodoYm ? `-${periodoYm}` : ''
    }.xlsx`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomeArquivo
    a.click()
    URL.revokeObjectURL(url)
    return { nomeArquivo, total: (resultados || []).length }
}
