/**
 * Repasse mensal — leitura do .xlsx do sistema principal (docs/repasse-mensal.md §5).
 * Funções puras (sem exceljs) + um leitor de arquivo que converte o workbook em linhas.
 *
 * Estrutura de cada aba (uma por prestador): A1 = nome; blocos «título → cabeçalho
 * (Atendimento|Tutor|Pet|Data|Procedimento|Repasse|Diferença) → linhas → Totais»; coluna A vazia
 * = outro procedimento do atendimento de cima; última linha = «Totais Prestador».
 */
import { normalizarValorMonetarioEntrada } from '../pagamentosValor.js'

const TOLERANCIA_CONFERENCIA = 0.01
const LIMITE_NOME_ABA = 31
const CARACTERES_INVALIDOS_ABA = /[\\/?*[\]:]/
const PREFIXOS_REMOVIDOS = [
    'CLINICA VETERINARIA ',
    'CONSULTORIO VETERINARIO ',
    'HOSPITAL VETERINÁRIO ',
    'DRA. ',
    'DR. ',
]

const arredondar = (n) => Math.round((n + Number.EPSILON) * 100) / 100

function texto(celula) {
    if (celula == null) return ''
    if (celula instanceof Date) return celula.toISOString()
    if (typeof celula === 'object') {
        if (Array.isArray(celula.richText)) return celula.richText.map((p) => p.text).join('').trim()
        if ('result' in celula) return texto(celula.result)
        if ('text' in celula) return String(celula.text).trim()
    }
    return String(celula).trim()
}

function numero(celula) {
    if (celula == null || celula === '') return null
    if (typeof celula === 'number') return Number.isFinite(celula) ? celula : null
    if (typeof celula === 'object' && 'result' in celula) return numero(celula.result)
    return normalizarValorMonetarioEntrada(texto(celula))
}

function formatarData(celula) {
    if (celula instanceof Date) {
        const d = String(celula.getUTCDate()).padStart(2, '0')
        const m = String(celula.getUTCMonth() + 1).padStart(2, '0')
        return `${d}/${m}/${celula.getUTCFullYear()}`
    }
    return texto(celula)
}

/** Nome da aba (macro RearAbasPorA1): maiúsculas, sem prefixos, trim, 31 caracteres. */
export function nomeAbaRepasse(a1, nomesUsados = new Set()) {
    const original = texto(a1)
    let nome = original.toUpperCase()
    for (const prefixo of PREFIXOS_REMOVIDOS) nome = nome.split(prefixo).join('')
    nome = nome.replace(/\s+/g, ' ').trim().slice(0, LIMITE_NOME_ABA).trim()
    const invalido = !nome || CARACTERES_INVALIDOS_ABA.test(nome)
    // Como a macro (On Error Resume Next): nome vazio, inválido ou repetido mantém o nome original.
    if (invalido || nomesUsados.has(nome.toLowerCase())) return original.slice(0, LIMITE_NOME_ABA)
    return nome
}

/** `Repasse_01_10_2026_ate_31_10_2026.xlsx` → { inicio: '2026-10-01', fim: '2026-10-31' } (ou null). */
export function periodoDoNomeArquivo(nomeArquivo) {
    const m = /(\d{2})_(\d{2})_(\d{4})_?ate_?(\d{2})_(\d{2})_(\d{4})/i.exec(String(nomeArquivo || ''))
    if (!m) return null
    return { inicio: `${m[3]}-${m[2]}-${m[1]}`, fim: `${m[6]}-${m[5]}-${m[4]}` }
}

/** Colunas do relatório, nesta ordem (A..G). O vínculo manual exige exatamente estas. */
export const COLUNAS_RELATORIO = ['Atendimento', 'Tutor', 'Pet', 'Data', 'Procedimento', 'Repasse', 'Diferença']

const semAcento = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

/** A linha de cabeçalho tem as 7 colunas esperadas, na ordem? */
const cabecalhoConfere = (linha) => COLUNAS_RELATORIO.every((nome, i) => semAcento(texto(linha[i])) === semAcento(nome))

const ehCabecalho = (linha) => texto(linha[0]).toLowerCase() === 'atendimento'
const ehTotais = (linha) => /^totais/i.test(texto(linha[0]))
/**
 * Linha de título (nome do veterinário): só a coluna A tem texto. Células mescladas aparecem repetidas
 * em B..E (o exceljs devolve o valor da célula mestre em toda a mescla), então valores iguais a A também valem.
 */
const soTemA = (linha) => {
    const a = texto(linha[0])
    if (!a) return false
    return linha.slice(1, 7).every((c) => {
        const t = texto(c)
        return t === '' || t === a
    })
}

/**
 * Interpreta uma aba. `linhas` = matriz [linha][coluna A..G] com valores crus.
 * Retorna grupos (veterinários), somas e a conferência do §5.4.
 */
export function interpretarAba(linhas) {
    const nomeA1 = texto(linhas[0]?.[0])
    const grupos = []
    let grupo = null
    let atend = null
    let tituloPendente = nomeA1
    let somaLinhas = 0
    let somaTutor = 0
    let totalAba = null
    let atendimentos = 0
    let cabecalhosFora = 0 // linhas de cabeçalho que não têm as 7 colunas na ordem
    let temTotaisPrestador = false // existe a linha «Totais Prestador» com o total do repasse (coluna F)

    // Total do prestador = última célula preenchida da coluna F (macro GerarResumoAbas).
    for (let i = linhas.length - 1; i >= 0; i--) {
        const v = numero(linhas[i]?.[5])
        if (v != null) {
            totalAba = v
            break
        }
    }

    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i] || []
        if (linha.every((c) => texto(c) === '')) continue
        if (ehCabecalho(linha)) {
            if (!cabecalhoConfere(linha)) cabecalhosFora += 1
            grupo = { titulo: tituloPendente || nomeA1, atendimentos: [] }
            grupos.push(grupo)
            atend = null
            continue
        }
        if (ehTotais(linha)) {
            if (/^totais prestador/i.test(texto(linha[0])) && numero(linha[5]) != null) temTotaisPrestador = true
            tituloPendente = ''
            continue
        }
        if (soTemA(linha)) {
            tituloPendente = texto(linha[0])
            continue
        }
        if (!grupo) continue
        const repasse = numero(linha[5]) ?? 0
        const diferenca = numero(linha[6]) ?? 0
        const id = texto(linha[0])
        if (id) {
            atend = {
                id,
                tutor: texto(linha[1]),
                pet: texto(linha[2]),
                data: formatarData(linha[3]),
                itens: [],
            }
            grupo.atendimentos.push(atend)
            atendimentos += 1
        }
        if (!atend) continue
        atend.itens.push([texto(linha[4]), arredondar(repasse), arredondar(diferenca)])
        somaLinhas += repasse
        somaTutor += diferenca
    }

    somaLinhas = arredondar(somaLinhas)
    const diferencaTotais = totalAba == null ? null : arredondar(totalAba - somaLinhas)
    return {
        nomeA1,
        grupos,
        atendimentos,
        veterinarios: grupos.length,
        somaLinhas,
        totalTutor: arredondar(somaTutor),
        totalAba,
        diferencaTotais,
        cabecalhoOk: cabecalhosFora === 0,
        temTotaisPrestador,
        divergente: totalAba == null || Math.abs(diferencaTotais) > TOLERANCIA_CONFERENCIA,
    }
}

/**
 * Confere uma aba interpretada para o vínculo MANUAL e devolve a lista de problemas em português.
 * `erros` impedem o vínculo; `avisos` deixam vincular (o relatório fica «total não confere» fora do envio).
 */
export function validarAbaRelatorio(aba, { valorRegistro = null } = {}) {
    const erros = []
    const avisos = []
    if (!aba) return { erros: ['Nenhuma aba encontrada no arquivo.'], avisos }
    if (!aba.nomeA1) erros.push('A célula A1 precisa ter o nome do prestador.')
    if (!aba.grupos?.length) erros.push(`Não achei a linha de cabeçalho com as colunas: ${COLUNAS_RELATORIO.join(' | ')}.`)
    else if (aba.cabecalhoOk === false) erros.push(`O cabeçalho precisa ter as colunas, nesta ordem: ${COLUNAS_RELATORIO.join(' | ')}.`)
    if (aba.grupos?.length && !aba.atendimentos) erros.push('Nenhum atendimento encontrado abaixo do cabeçalho.')
    if (!aba.temTotaisPrestador) erros.push('Falta a linha «Totais Prestador» com o total da coluna Repasse (F).')
    else if (aba.divergente) avisos.push(`A soma das linhas (${aba.somaLinhas.toFixed(2).replace('.', ',')}) não bate com o «Totais Prestador» (${aba.totalAba.toFixed(2).replace('.', ',')}).`)
    if (aba.totalAba != null && valorRegistro != null && Math.abs(Number(valorRegistro) - aba.totalAba) > TOLERANCIA_CONFERENCIA) {
        avisos.push(`O total do relatório (${aba.totalAba.toFixed(2).replace('.', ',')}) é diferente do valor do registro (${Number(valorRegistro).toFixed(2).replace('.', ',')}).`)
    }
    return { erros, avisos }
}

/** Fluxo manual dos laboratórios (§6): nome começando com LABORATORIO. */
export function ehLaboratorio(nomeA1) {
    return /^LABORAT[ÓO]RIO\b/i.test(texto(nomeA1).normalize('NFC'))
}

/**
 * Interpreta o workbook inteiro. `abas` = [{ nome, linhas }]. Ignora «Resumo» e abas sem A1.
 * Laboratórios não são marcados como divergentes (fluxo manual, §6).
 */
export function interpretarRelatorio(abas, nomeArquivo = '') {
    const usados = new Set()
    const resultado = []
    for (const aba of abas) {
        if (/^resumo$/i.test(String(aba.nome || '').trim())) continue
        const dados = interpretarAba(aba.linhas || [])
        if (!dados.nomeA1) continue
        const fluxo = ehLaboratorio(dados.nomeA1) ? 'laboratorio_manual' : 'automatico'
        const abaNome = nomeAbaRepasse(dados.nomeA1, usados)
        usados.add(abaNome.toLowerCase())
        resultado.push({
            ...dados,
            fluxo,
            divergente: fluxo === 'laboratorio_manual' ? false : dados.divergente,
            abaOriginal: aba.nome,
            abaNome,
        })
    }
    return { arquivo: nomeArquivo, periodo: periodoDoNomeArquivo(nomeArquivo), abas: resultado }
}

/** Texto para o textarea da Inclusão em massa: `A1[TAB]valor` (valor = total da aba, como a macro). */
export function linhasResumoMassa(abas) {
    return abas
        .filter((a) => a.totalAba != null)
        .map((a) => `${a.nomeA1}\t${a.totalAba.toFixed(2).replace('.', ',')}`)
        .join('\n')
}

/** Lê um File .xlsx no navegador (exceljs carregado sob demanda) e devolve o relatório interpretado. */
export async function lerRelatorioXlsx(arquivo) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await arquivo.arrayBuffer())
    const abas = []
    wb.eachSheet((ws) => {
        const linhas = []
        ws.eachRow({ includeEmpty: true }, (row, n) => {
            // Célula mesclada: só a «mestre» tem valor. O exceljs repete o valor da mestre nas demais, o que
            // fazia cada procedimento virar um atendimento novo (prontuário/tutor/pet/data mesclados na vertical).
            linhas[n - 1] = [1, 2, 3, 4, 5, 6, 7].map((c) => {
                const cel = row.getCell(c)
                return cel.type === ExcelJS.ValueType.Merge ? null : cel.value
            })
        })
        for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = []
        abas.push({ nome: ws.name, linhas })
    })
    return interpretarRelatorio(abas, arquivo.name)
}
