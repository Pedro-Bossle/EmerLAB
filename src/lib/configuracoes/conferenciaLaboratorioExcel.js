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

function textoCelulaPlaceholder(valor) {
    const t = String(valor || '').trim()
    if (!t) return true
    const n = t
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
    if (/^[-–—._/*]+$/.test(t)) return true
    return [
        '-',
        '--',
        '---',
        'n/a',
        'na',
        'null',
        'none',
        'nil',
        'undefined',
        'sem',
        'vazio',
        'false',
        '0',
    ].includes(n)
}

function pareceLinhaRodapeConferencia(texto) {
    const n = String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    return /^(total|totais|soma|subtotal|geral|quantidade|qtd|qtde)\b/.test(n)
}

function temLetra(valor) {
    return /[a-zA-ZÀ-ÿ]/.test(String(valor || ''))
}

/**
 * Registro útil: tutor ou animal com nome, e exame com texto (não número solto / placeholder).
 */
export function linhaConferenciaTemRegistro({ tutor, pet, exame } = {}) {
    const exameTxt = String(exame || '').trim()
    const tutorTxt = String(tutor || '').trim()
    const petTxt = String(pet || '').trim()
    if (textoCelulaPlaceholder(exameTxt) || pareceLinhaRodapeConferencia(exameTxt)) return false
    if (pareceLinhaRodapeConferencia(tutorTxt) || pareceLinhaRodapeConferencia(petTxt)) return false
    if (!temLetra(exameTxt)) return false
    const pessoaOk =
        (!textoCelulaPlaceholder(tutorTxt) && temLetra(tutorTxt)) ||
        (!textoCelulaPlaceholder(petTxt) && temLetra(petTxt))
    return pessoaOk
}

function celulaTemConteudoUtil(valor) {
    const t = String(valor || '').trim()
    if (!t || textoCelulaPlaceholder(t)) return false
    return true
}

function copiarParaUint8Array(buffer) {
    if (buffer instanceof Uint8Array) return buffer.slice()
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer.slice(0))
    if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    }
    throw new Error('Arquivo inválido: não foi possível ler os bytes da planilha.')
}

function detectarTipoPlanilha(u8) {
    if (!u8?.length) return 'vazio'
    if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b) return 'zip'
    if (u8.length >= 8 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) {
        return 'ole'
    }
    const amostra = decodificarTextoPlanilha(u8.slice(0, Math.min(u8.length, 8192)))
        .replace(/^\uFEFF/, '')
        .trimStart()
        .toLowerCase()
    if (
        amostra.startsWith('<html') ||
        amostra.startsWith('<!doctype html') ||
        amostra.startsWith('<table') ||
        amostra.includes('<html')
    ) {
        return 'html'
    }
    if (
        amostra.startsWith('<?xml') ||
        amostra.includes('spreadsheetml') ||
        amostra.includes('urn:schemas-microsoft-com:office:spreadsheet')
    ) {
        return 'xml'
    }
    return 'texto'
}

function decodificarTextoPlanilha(u8) {
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(u8)
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(u8)
    }
    const utf8 = new TextDecoder('utf-8').decode(u8)
    const ruins = (utf8.match(/\uFFFD/g) || []).length
    if (ruins > 8) {
        try {
            return new TextDecoder('windows-1252').decode(u8)
        } catch {
            try {
                return new TextDecoder('iso-8859-1').decode(u8)
            } catch {
                return utf8
            }
        }
    }
    return utf8
}

function textoDeCelulaHtml(html) {
    return String(html || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function matrizDeHtmlTabela(html) {
    const trs = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || []
    const matrix = []
    for (const tr of trs) {
        const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        if (!cells.length) continue
        const vals = cells.map((m) => textoDeCelulaHtml(m[1]))
        if (vals.some((v) => celulaTemConteudoUtil(v))) matrix.push(vals)
    }
    return matrix
}

export function matrizDeSpreadsheetMl(xml) {
    const rowTags = String(xml || '').match(/<Row\b[\s\S]*?<\/Row>/gi) || []
    const matrix = []
    for (const rowXml of rowTags) {
        const vals = []
        const cellTags = [...rowXml.matchAll(/<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi)]
        for (const cell of cellTags) {
            const attrs = cell[1] || ''
            const idxHit = attrs.match(/\bss:Index=["'](\d+)["']/i)
            const col = idxHit ? Number(idxHit[1]) - 1 : vals.length
            const dataHit = String(cell[2] || '').match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i)
            const texto = textoDeCelulaHtml(dataHit ? dataHit[1] : cell[2])
            while (vals.length < col) vals.push('')
            vals[col] = texto
        }
        if (vals.some((v) => celulaTemConteudoUtil(v))) matrix.push(vals)
    }
    return matrix
}

function matrizDeCsv(texto) {
    const linhas = String(texto || '')
        .replace(/^\uFEFF/, '')
        .split(/\r\n|\n|\r/)
        .filter((l) => l.trim())
    if (!linhas.length) return []
    const sep = linhas[0].includes(';') && !linhas[0].includes('\t') ? ';' : linhas[0].includes('\t') ? '\t' : ','
    return linhas.map((linha) =>
        linha.split(sep).map((c) => c.replace(/^["']|["']$/g, '').trim()),
    )
}

function matrizDaWorksheetExcelJs(ws) {
    const matrix = []
    if (!ws) return matrix
    ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = []
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            vals[colNumber - 1] = celulaTexto(cell.value)
        })
        if (vals.some((v) => celulaTemConteudoUtil(v))) matrix.push(vals)
    })
    return matrix
}

function decodificarEntidadesXml(texto) {
    return String(texto || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function semPrefixoXml(xml) {
    return String(xml || '').replace(/<\/?([A-Za-z_][\w.-]*):/g, (full) => (full.startsWith('</') ? '</' : '<'))
}

function colunaDeRefXlsx(ref) {
    const hit = String(ref || '').match(/^([A-Z]+)/i)
    if (!hit) return 0
    let n = 0
    for (const ch of hit[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
    return Math.max(0, n - 1)
}

function acharArquivoZip(zip, terminaCom) {
    const alvo = String(terminaCom || '').toLowerCase()
    const nomes = Object.keys(zip.files || {})
    return nomes.find((n) => !zip.files[n].dir && n.replace(/\\/g, '/').toLowerCase().endsWith(alvo))
}

function parsearSharedStringsXlsx(xml) {
    const corpo = semPrefixoXml(xml)
    const sis = corpo.match(/<si\b[\s\S]*?<\/si>/gi) || []
    return sis.map((si) => {
        const ts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
        return ts.map((m) => decodificarEntidadesXml(m[1])).join('')
    })
}

export function matrizDeWorksheetXmlXlsx(sheetXml, sharedStrings = []) {
    const corpo = semPrefixoXml(sheetXml)
    const rows = corpo.match(/<row\b[\s\S]*?<\/row>/gi) || []
    const matrix = []
    for (const rowXml of rows) {
        const vals = []
        const cells = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)]
        for (const cell of cells) {
            const attrs = cell[1] || ''
            const refHit = attrs.match(/\br=["']([^"']+)["']/)
            const col = refHit ? colunaDeRefXlsx(refHit[1]) : vals.length
            const tipoHit = attrs.match(/\bt=["']([^"']+)["']/)
            const tipo = (tipoHit?.[1] || '').toLowerCase()
            const inner = cell[2] || ''
            let texto = ''
            if (tipo === 's') {
                const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)
                const rawIdx = v ? String(v[1]).trim() : ''
                texto = /^\d+$/.test(rawIdx) ? String(sharedStrings[Number(rawIdx)] ?? '') : ''
            } else if (tipo === 'inlinestr') {
                const ts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
                texto = ts.map((m) => decodificarEntidadesXml(m[1])).join('')
            } else if (tipo === 'b') {
                const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)
                texto = String(v?.[1] || '').trim() === '1' ? 'TRUE' : 'FALSE'
            } else {
                const isT = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
                if (isT.length) texto = isT.map((m) => decodificarEntidadesXml(m[1])).join('')
                else {
                    const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)
                    texto = v ? decodificarEntidadesXml(v[1]) : ''
                }
            }
            while (vals.length < col) vals.push('')
            vals[col] = texto.trim()
        }
        if (vals.some((v) => celulaTemConteudoUtil(v))) matrix.push(vals)
    }
    return matrix
}

async function arquivoZipComoTexto(zip, nome) {
    const f = zip.file(nome)
    if (!f) return ''
    return f.async('string')
}

async function matrizDeXlsxViaZip(u8) {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(u8)
    const sstNome = acharArquivoZip(zip, 'sharedstrings.xml')
    const shared = sstNome ? parsearSharedStringsXlsx(await arquivoZipComoTexto(zip, sstNome)) : []

    const sheetNomes = Object.keys(zip.files)
        .filter((n) => {
            const p = n.replace(/\\/g, '/').toLowerCase()
            return /xl\/worksheets\/sheet\d+\.xml$/.test(p)
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

    const candidatos = sheetNomes.length
        ? sheetNomes
        : Object.keys(zip.files).filter((n) =>
              /worksheets\/.+\.xml$/i.test(n.replace(/\\/g, '/')),
          )

    for (const nome of candidatos) {
        if (zip.files[nome]?.dir) continue
        const xml = await arquivoZipComoTexto(zip, nome)
        const matrix = matrizDeWorksheetXmlXlsx(xml, shared)
        if (matrix.length >= 2) return matrix
    }
    if (candidatos[0]) {
        const xml = await arquivoZipComoTexto(zip, candidatos[0])
        return matrizDeWorksheetXmlXlsx(xml, shared)
    }
    throw new Error('O .xlsx não contém uma planilha com dados.')
}

async function matrizDeXlsxExcelJs(u8) {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const payload = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    await workbook.xlsx.load(payload, { ignoreNodes: ['extLst'] })
    const sheets = workbook.worksheets || []
    for (const ws of sheets) {
        const matrix = matrizDaWorksheetExcelJs(ws)
        if (matrix.length >= 2) return matrix
    }
    return matrizDaWorksheetExcelJs(sheets[0])
}

/**
 * Lê .xlsx (ZIP), HTML/XML exportado como Excel, ou CSV.
 */
export async function lerMatrizPlanilhaConferencia(buffer) {
    const u8 = copiarParaUint8Array(buffer)
    const tipo = detectarTipoPlanilha(u8)
    if (tipo === 'vazio') {
        throw new Error('Arquivo vazio.')
    }
    if (tipo === 'ole') {
        throw new Error(
            'Arquivo .xls antigo (formato binário). Abra no Excel ou LibreOffice e salve como .xlsx.',
        )
    }

    if (tipo === 'zip') {
        try {
            const viaZip = await matrizDeXlsxViaZip(u8)
            if (viaZip.length) return viaZip
        } catch {
            /* tenta ExcelJS */
        }
        try {
            const viaExcelJs = await matrizDeXlsxExcelJs(u8)
            if (viaExcelJs.length) return viaExcelJs
        } catch (e) {
            const msg = String(e?.message || e)
            throw new Error(
                /zip|central directory|invalid|corrupt|sheets|undefined|passthrough|buffer/i.test(msg)
                    ? 'Não foi possível ler o .xlsx. Tente outro arquivo ou salve de novo pelo Excel como Pasta de Trabalho (.xlsx).'
                    : msg,
            )
        }
        throw new Error('Planilha vazia no arquivo .xlsx.')
    }

    const texto = decodificarTextoPlanilha(u8)
    if (tipo === 'html') {
        const matrix = matrizDeHtmlTabela(texto)
        if (matrix.length) return matrix
        throw new Error('A planilha HTML não contém uma tabela com dados.')
    }
    if (tipo === 'xml') {
        const matrix = matrizDeSpreadsheetMl(texto)
        if (matrix.length) return matrix
        throw new Error('Não foi possível ler o XML da planilha.')
    }

    const csv = matrizDeCsv(texto)
    if (csv.length >= 2) return csv

    throw new Error(
        'Formato não reconhecido. Use .xlsx, ou um relatório Excel exportado como tabela (HTML/XML/CSV).',
    )
}

/**
 * Lê Excel (.xlsx) e devolve linhas brutas + cabeçalhos detectados.
 * Módulo sem supabase — seguro para Web Worker.
 */
export async function parsearExcelConferenciaLaboratorio(buffer, opts = {}) {
    const matrix = await lerMatrizPlanilhaConferencia(buffer)
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
        if (!linhaConferenciaTemRegistro({ tutor, pet, exame })) continue
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
