/**
 * Confere a leitura do relatório de repasse (.xlsx do sistema principal) contra o próprio arquivo.
 * Uso: node scripts/verificar-xlsx-repasse.mjs Repasse_01_10_2026_ate_31_10_2026.xlsx
 *
 * Um «oráculo» independente lê as células cruas (sem usar o interpretador do app) e compara, aba por aba:
 *   - todas as linhas de dados, na ordem (prontuário, tutor, pet, data, procedimento, repasse, diferença);
 *   - quantidade de atendimentos de cada veterinário × «Totais» («Atendimentos: N») da planilha;
 *   - total do prestador × «Totais Prestador»;
 *   - quantidade de atendimentos e de veterinários;
 *   - totais da aba «Resumo».
 * Não grava nada.
 */
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { lerRelatorioXlsx } from '../src/lib/repasse/lerRelatorioExcel.js'

const arq = process.argv[2]
if (!arq) {
    console.error('Informe o caminho do .xlsx')
    process.exit(1)
}
const buf = fs.readFileSync(arq)
const relatorio = await lerRelatorioXlsx({ name: path.basename(arq), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) })

const wb = new ExcelJS.Workbook()
await wb.xlsx.load(buf)

const txt = (v) => {
    if (v == null) return ''
    if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`
    if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('').trim()
        if ('result' in v) return txt(v.result)
        if ('text' in v) return String(v.text).trim()
    }
    return String(v).trim()
}
const cents = (v) => {
    const t = typeof v === 'number' ? String(v) : txt(v)
    if (t === '') return null
    const n = typeof v === 'number' ? v : Number(t.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 100) : null
}

const falhas = []
const falha = (aba, msg) => falhas.push(`[${aba}] ${msg}`)
let linhasOracle = 0
let abasOk = 0

// --- Resumo ---
const resumo = new Map()
const wsResumo = wb.worksheets.find((w) => /^resumo$/i.test(w.name.trim()))
if (wsResumo) {
    wsResumo.eachRow((row) => {
        const nome = txt(row.getCell(1).value)
        const total = cents(row.getCell(2).value)
        if (nome && total != null) resumo.set(nome.toLowerCase(), total)
    })
}

for (const ws of wb.worksheets) {
    if (/^resumo$/i.test(ws.name.trim())) continue
    const aba = relatorio.abas.find((a) => a.abaOriginal === ws.name)
    if (!aba) {
        falha(ws.name, 'aba não foi lida pelo importador')
        continue
    }
    // ----- oráculo: células cruas -----
    const linhas = []
    ws.eachRow({ includeEmpty: true }, (row, n) => {
        linhas[n] = [1, 2, 3, 4, 5, 6, 7].map((c) => row.getCell(c).value)
    })
    const nomeA1 = txt(linhas[1]?.[0])
    const segs = [] // { titulo, itens:[], totaisF, totaisG }
    let seg = null
    let tituloAtual = nomeA1
    let totalPrestador = null
    for (let n = 2; n < linhas.length; n++) {
        const l = linhas[n]
        if (!l || l.every((c) => txt(c) === '')) continue
        const a = txt(l[0])
        if (a.toLowerCase() === 'atendimento') {
            seg = { titulo: tituloAtual, itens: [], totaisF: null, totaisG: null }
            segs.push(seg)
            continue
        }
        if (/^totais prestador/i.test(a)) {
            totalPrestador = { f: cents(l[5]), g: cents(l[6]), qtd: Number((/(\d+)/.exec(txt(l[1])) || [])[1] ?? NaN) }
            continue
        }
        if (/^totais/i.test(a)) {
            if (seg) {
                seg.totaisF = cents(l[5])
                seg.totaisG = cents(l[6])
                seg.qtd = Number((/(\d+)/.exec(txt(l[1])) || [])[1] ?? NaN)
            }
            tituloAtual = ''
            continue
        }
        const soTitulo = a && l.slice(1, 7).every((c) => txt(c) === '' || txt(c) === a)
        if (soTitulo) {
            tituloAtual = a
            continue
        }
        if (!seg) {
            falha(ws.name, `linha ${n} antes do primeiro cabeçalho: ${JSON.stringify(l.map(txt))}`)
            continue
        }
        seg.itens.push({ id: a, tutor: txt(l[1]), pet: txt(l[2]), data: txt(l[3]), proc: txt(l[4]), f: cents(l[5]) ?? 0, g: cents(l[6]) ?? 0 })
        linhasOracle += 1
    }
    const itensOr = segs.flatMap((s) => s.itens)
    const somaF = itensOr.reduce((t, i) => t + i.f, 0)
    const somaG = itensOr.reduce((t, i) => t + i.g, 0)
    let ok = true
    const bad = (m) => {
        ok = false
        falha(ws.name, m)
    }

    if (totalPrestador == null) bad('sem linha «Totais Prestador»')
    else {
        if (somaF !== totalPrestador.f) bad(`soma do repasse (${somaF / 100}) ≠ Totais Prestador (${totalPrestador.f / 100})`)
        if (somaG !== totalPrestador.g) bad(`soma da diferença (${somaG / 100}) ≠ Totais Prestador (${totalPrestador.g / 100})`)
    }
    for (const s of segs) {
        const sf = s.itens.reduce((t, i) => t + i.f, 0)
        const sg = s.itens.reduce((t, i) => t + i.g, 0)
        if (s.totaisF != null && sf !== s.totaisF) bad(`veterinário «${s.titulo}»: soma do repasse ${sf / 100} ≠ «Totais» ${s.totaisF / 100}`)
        if (s.totaisG != null && sg !== s.totaisG) bad(`veterinário «${s.titulo}»: soma da diferença ${sg / 100} ≠ «Totais» ${s.totaisG / 100}`)
        const distintos = new Set(s.itens.map((i) => i.id)).size
        if (!Number.isFinite(s.qtd)) {
            // Aba de um veterinário só traz apenas «Totais Prestador» (a contagem dele vale pelo total).
            if (segs.length > 1) bad(`veterinário «${s.titulo}» sem linha «Totais» com «Atendimentos: N»`)
        } else if (s.qtd !== distintos) bad(`veterinário «${s.titulo}»: «Totais» diz ${s.qtd} atendimentos, mas há ${distintos} prontuários distintos`)
    }

    // ----- importador × oráculo -----
    if (aba.grupos.length !== segs.length) bad(`veterinários: importador ${aba.grupos.length} × planilha ${segs.length}`)
    segs.forEach((s, i) => {
        const g = aba.grupos[i]
        if (!g) return
        if (g.titulo !== s.titulo) bad(`título do veterinário ${i + 1}: importador «${g.titulo}» × planilha «${s.titulo}»`)
    })
    // linhas do importador, achatadas, na mesma ordem
    const itensApp = aba.grupos.flatMap((g) =>
        g.atendimentos.flatMap((at) => at.itens.map((it) => ({ id: at.id, tutor: at.tutor, pet: at.pet, data: at.data, proc: it[0], f: Math.round(it[1] * 100), g: Math.round(it[2] * 100) }))),
    )
    if (itensApp.length !== itensOr.length) bad(`linhas de dados: importador ${itensApp.length} × planilha ${itensOr.length}`)
    const n = Math.min(itensApp.length, itensOr.length)
    let difs = 0
    for (let i = 0; i < n; i++) {
        const a = itensApp[i]
        const o = itensOr[i]
        for (const k of ['id', 'tutor', 'pet', 'data', 'proc', 'f', 'g']) {
            if (a[k] !== o[k]) {
                if (difs < 3) bad(`linha de dados ${i + 1}, campo ${k}: importador «${a[k]}» × planilha «${o[k]}»`)
                difs += 1
            }
        }
    }
    if (difs > 3) bad(`… e mais ${difs - 3} diferenças de campo nesta aba`)
    const idsOr = new Set(itensOr.map((i) => i.id)).size
    if (totalPrestador && Number.isFinite(totalPrestador.qtd) && totalPrestador.qtd !== idsOr) bad(`«Totais Prestador» diz ${totalPrestador.qtd} atendimentos, mas há ${idsOr} prontuários distintos`)
    if (aba.atendimentos !== idsOr) bad(`atendimentos: importador ${aba.atendimentos} × ids distintos na planilha ${idsOr}`)
    aba.grupos.forEach((g, i) => {
        if (Number.isFinite(segs[i]?.qtd) && g.atendimentos.length !== segs[i].qtd) bad(`atendimentos do veterinário ${i + 1}: importador ${g.atendimentos.length} × «Totais» ${segs[i].qtd}`)
    })
    // subtotais por veterinário do importador
    aba.grupos.forEach((g, i) => {
        const sub = g.atendimentos.reduce((t, at) => t + at.itens.reduce((t2, it) => t2 + Math.round(it[1] * 100), 0), 0)
        const so = segs[i]?.totaisF
        if (so != null && sub !== so) bad(`subtotal exibido do veterinário ${i + 1} (${sub / 100}) ≠ «Totais» da planilha (${so / 100})`)
    })
    if (totalPrestador && aba.totalAba != null && Math.round(aba.totalAba * 100) !== totalPrestador.f) bad(`total da aba no importador ${aba.totalAba} × ${totalPrestador.f / 100}`)
    if (aba.divergente && aba.fluxo !== 'laboratorio_manual') bad('importador marcou «total não confere»')
    if (totalPrestador && Math.round(aba.totalTutor * 100) !== totalPrestador.g) bad(`total «Diferença» do importador ${aba.totalTutor} × ${totalPrestador.g / 100}`)
    // Resumo
    const rr = resumo.get(nomeA1.toLowerCase())
    if (wsResumo && rr == null) bad(`não encontrado no «Resumo» (${nomeA1})`)
    else if (rr != null && totalPrestador && rr !== totalPrestador.f) bad(`«Resumo» ${rr / 100} × aba ${totalPrestador.f / 100}`)
    if (ok) abasOk += 1
}

const total = wb.worksheets.filter((w) => !/^resumo$/i.test(w.name.trim())).length
console.log(`Abas: ${total} | conferidas sem diferença: ${abasOk} | com diferença: ${total - abasOk}`)
console.log(`Linhas de dados na planilha: ${linhasOracle} | atendimentos lidos: ${relatorio.abas.reduce((t, a) => t + a.atendimentos, 0)} | veterinários: ${relatorio.abas.reduce((t, a) => t + a.grupos.length, 0)}`)
console.log(`Resumo: ${resumo.size} linhas | importador: ${relatorio.abas.length} abas`)
if (falhas.length) {
    console.log(`\nDIFERENÇAS (${falhas.length}):`)
    for (const f of falhas.slice(0, 60)) console.log(' -', f)
    process.exit(2)
}
console.log('\nTudo confere: valores, textos e estrutura de cada aba batem com a planilha.')
