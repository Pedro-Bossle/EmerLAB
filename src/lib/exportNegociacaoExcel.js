import { nomeParaHonorariosPdf } from './prestadorNomeAlternativo.js'

const FONTE_PADRAO = { name: 'Calibri', size: 11 }
const FONTE_CABECALHO = { ...FONTE_PADRAO, bold: true }
const PREENCHIMENTO_CABECALHO = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' },
}
const BORDA_FINA = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
}
const FORMATO_MOEDA_PT = '#,##0.00'

function aplicarEstiloCabecalho(cell) {
    cell.font = FONTE_CABECALHO
    cell.fill = PREENCHIMENTO_CABECALHO
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = BORDA_FINA
}

function aplicarEstiloTextoDados(cell) {
    cell.font = FONTE_PADRAO
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = BORDA_FINA
}

function aplicarEstiloNumeroDados(cell, valor) {
    cell.font = FONTE_PADRAO
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = BORDA_FINA
    if (valor !== '' && valor != null && Number.isFinite(Number(valor))) {
        cell.value = Number(valor)
        cell.numFmt = FORMATO_MOEDA_PT
    } else {
        cell.value = null
    }
}

function aplicarEstiloSeparadorCabecalho(cell) {
    cell.border = BORDA_FINA
    cell.fill = PREENCHIMENTO_CABECALHO
}

function aplicarEstiloSeparadorDados(cell) {
    cell.border = BORDA_FINA
}

function valorNumericoExport(valor) {
    if (valor === '' || valor == null) return ''
    const n = Number(valor)
    if (!Number.isFinite(n)) return ''
    return n
}

function montarValoresLinhaExport(linha, opcoes = {}) {
    const { preencherPropostaEmerdog = true, preencherRespostaVeterinario = false } = opcoes
    const proc = nomeParaHonorariosPdf(
        linha.procedimento ?? linha.nome ?? '',
        linha.nomeAlternativo ?? linha.nome_alternativo,
    )
    const propostaP = preencherPropostaEmerdog ? linha.propostaPorteP ?? linha.porteP : linha.propostaPorteP
    const propostaM = preencherPropostaEmerdog ? linha.propostaPorteM ?? linha.porteM : linha.propostaPorteM
    const propostaG = preencherPropostaEmerdog ? linha.propostaPorteG ?? linha.porteG : linha.propostaPorteG
    const respostaP = preencherRespostaVeterinario
        ? linha.respostaPorteP ?? linha.porteP
        : linha.respostaPorteP
    const respostaM = preencherRespostaVeterinario
        ? linha.respostaPorteM ?? linha.porteM
        : linha.respostaPorteM
    const respostaG = preencherRespostaVeterinario
        ? linha.respostaPorteG ?? linha.porteG
        : linha.respostaPorteG

    return {
        codigo: linha.codigo,
        procedimento: proc,
        propostaP: valorNumericoExport(propostaP),
        propostaM: valorNumericoExport(propostaM),
        propostaG: valorNumericoExport(propostaG),
        respostaP: valorNumericoExport(respostaP),
        respostaM: valorNumericoExport(respostaM),
        respostaG: valorNumericoExport(respostaG),
    }
}

function configurarLargurasColunas(worksheet) {
    worksheet.getColumn(1).width = 14
    worksheet.getColumn(2).width = 48
    worksheet.getColumn(3).width = 11
    worksheet.getColumn(4).width = 11
    worksheet.getColumn(5).width = 11
    worksheet.getColumn(6).width = 2.5
    worksheet.getColumn(7).width = 11
    worksheet.getColumn(8).width = 11
    worksheet.getColumn(9).width = 11
}

/** @returns {number} próxima linha livre (1-based) */
function escreverSecaoCategoria(worksheet, linhaInicio, categoriaNome, linhas, mapValores) {
    const r1 = linhaInicio
    const r2 = linhaInicio + 1
    const tituloGrupo = String(categoriaNome || '').trim() || 'Atendimento'

    worksheet.mergeCells(r1, 1, r2, 1)
    const celCodigo = worksheet.getCell(r1, 1)
    celCodigo.value = 'Codigo'
    aplicarEstiloCabecalho(celCodigo)

    const celGrupo = worksheet.getCell(r1, 2)
    celGrupo.value = tituloGrupo
    aplicarEstiloCabecalho(celGrupo)
    const celProcTitulo = worksheet.getCell(r2, 2)
    celProcTitulo.value = 'Procedimento'
    aplicarEstiloCabecalho(celProcTitulo)

    worksheet.mergeCells(r1, 3, r1, 5)
    const celProposta = worksheet.getCell(r1, 3)
    celProposta.value = 'Proposta Emerdog'
    aplicarEstiloCabecalho(celProposta)
    ;['P', 'M', 'G'].forEach((letra, indice) => {
        const cel = worksheet.getCell(r2, 3 + indice)
        cel.value = letra
        aplicarEstiloCabecalho(cel)
    })

    aplicarEstiloSeparadorCabecalho(worksheet.getCell(r1, 6))
    aplicarEstiloSeparadorCabecalho(worksheet.getCell(r2, 6))

    worksheet.mergeCells(r1, 7, r1, 9)
    const celResposta = worksheet.getCell(r1, 7)
    celResposta.value = 'Resposta [Veterinario]'
    aplicarEstiloCabecalho(celResposta)
    ;['P', 'M', 'G'].forEach((letra, indice) => {
        const cel = worksheet.getCell(r2, 7 + indice)
        cel.value = letra
        aplicarEstiloCabecalho(cel)
    })

    worksheet.getRow(r1).height = 20
    worksheet.getRow(r2).height = 20

    let linhaDados = r2 + 1
    for (const item of linhas) {
        const v = mapValores(item)
        const celA = worksheet.getCell(linhaDados, 1)
        celA.value = v.codigo
        aplicarEstiloTextoDados(celA)
        const celB = worksheet.getCell(linhaDados, 2)
        celB.value = v.procedimento
        aplicarEstiloTextoDados(celB)
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 3), v.propostaP)
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 4), v.propostaM)
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 5), v.propostaG)
        aplicarEstiloSeparadorDados(worksheet.getCell(linhaDados, 6))
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 7), v.respostaP)
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 8), v.respostaM)
        aplicarEstiloNumeroDados(worksheet.getCell(linhaDados, 9), v.respostaG)
        linhaDados += 1
    }

    return linhaDados
}

function sanitizarNomeArquivo(nomeArquivoBase) {
    return (
        String(nomeArquivoBase || 'export')
            .replace(/[^\w\s-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ\[\]]/gi, '')
            .trim()
            .slice(0, 80) || 'export'
    )
}

async function baixarPlanilhaNegociacaoXlsx(secoes, mapValores, nomeArquivoBase) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Emerdog SFSC Supertool'
    const worksheet = workbook.addWorksheet('Negociacao', {
        views: [{ showGridLines: true }],
    })
    configurarLargurasColunas(worksheet)

    const lista = (secoes || []).filter((s) => (s.linhas || []).length > 0)
    let linhaAtual = 1

    if (!lista.length) {
        escreverSecaoCategoria(worksheet, 1, '', [], mapValores)
    } else {
        lista.forEach((secao, indice) => {
            if (indice > 0) {
                linhaAtual += 1
            }
            linhaAtual = escreverSecaoCategoria(
                worksheet,
                linhaAtual,
                secao.categoriaNome,
                secao.linhas,
                mapValores,
            )
        })
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizarNomeArquivo(nomeArquivoBase)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

/**
 * @param {{ categoriaNome: string, linhas: object[] }[]} secoes
 */
export async function exportarNegociacaoParaExcel(secoes, nomeArquivoBase = 'negociacao') {
    await baixarPlanilhaNegociacaoXlsx(
        secoes,
        (linha) =>
            montarValoresLinhaExport(linha, {
                preencherPropostaEmerdog: false,
                preencherRespostaVeterinario: true,
            }),
        nomeArquivoBase,
    )
}

/**
 * @param {{ categoriaNome: string, linhas: object[] }[]} secoes
 */
export async function exportarTabelaCidadeParaExcel(secoes, opcoes = {}) {
    const { nomeArquivoBase = 'cidade-tabela' } = opcoes
    await baixarPlanilhaNegociacaoXlsx(
        secoes,
        (linha) =>
            montarValoresLinhaExport(
                {
                    codigo: linha.codigo,
                    procedimento: linha.procedimento ?? '',
                    propostaPorteP: linha.porteP,
                    propostaPorteM: linha.porteM,
                    propostaPorteG: linha.porteG,
                },
                { preencherPropostaEmerdog: true, preencherRespostaVeterinario: false },
            ),
        nomeArquivoBase,
    )
}
