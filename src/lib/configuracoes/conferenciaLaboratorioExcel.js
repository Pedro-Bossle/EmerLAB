import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'

export const CAMPOS_CONFERENCIA = ['tutor', 'pet', 'data', 'exame']

export function normalizarNomeExame(texto) {
    return normalizarTextoBusca(texto)
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
 * Módulo sem supabase — seguro para Web Worker.
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
