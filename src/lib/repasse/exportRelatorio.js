/**
 * Downloads do relatório de repasse na página pública (docs/repasse-mensal.md §10).
 * `relatorio` = objeto devolvido por publico-ler (prestador, competencia, periodo, abaNome, dados, totais).
 * Bibliotecas pesadas (exceljs/jspdf) são carregadas só quando o prestador clica em baixar.
 */

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numeroPtBr = (n) => Number(n || 0).toFixed(2).replace('.', ',')

const dataBr = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-')
    return d ? `${d}/${m}/${a}` : ''
}

const nomeArquivoBase = (r) =>
    `Repasse_${String(r.competencia || '').replace('/', '-')}_${String(r.abaNome || r.prestador || 'prestador')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .slice(0, 40)}`

function baixar(blob, nome) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Excel no mesmo layout do relatório atual: A–D mescladas por atendimento e total final na coluna F. */
export async function baixarRelatorioExcel(r) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(String(r.abaNome || 'Repasse').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Repasse')
    ws.columns = [{ width: 14 }, { width: 28 }, { width: 22 }, { width: 12 }, { width: 44 }, { width: 14 }, { width: 14 }]
    ws.addRow([r.prestador]).font = { bold: true, size: 13 }
    ws.addRow([`Repasse ${r.competencia}${r.periodoInicio ? ` — ${dataBr(r.periodoInicio)} a ${dataBr(r.periodoFim)}` : ''}`])
    ws.addRow([])
    for (const g of r.dados?.grupos || []) {
        const titulo = ws.addRow([g.titulo])
        titulo.font = { bold: true }
        const cab = ws.addRow(['Atendimento', 'Tutor', 'Pet', 'Data', 'Procedimento', 'Diferença', 'Repasse'])
        cab.font = { bold: true }
        cab.eachCell((c) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F4FC' } }
        })
        let subR = 0
        let subT = 0
        for (const a of g.atendimentos || []) {
            const inicio = ws.rowCount + 1
            for (const [i, it] of (a.itens || []).entries()) {
                ws.addRow(i === 0 ? [a.id, a.tutor, a.pet, a.data, it[0], it[2], it[1]] : ['', '', '', '', it[0], it[2], it[1]])
                subR += Number(it[1] || 0)
                subT += Number(it[2] || 0)
            }
            const fim = ws.rowCount
            if (fim > inicio) for (const col of ['A', 'B', 'C', 'D']) ws.mergeCells(`${col}${inicio}:${col}${fim}`)
        }
        const tot = ws.addRow(['Totais', '', '', '', '', subT, subR])
        tot.font = { bold: true }
        ws.addRow([])
    }
    const final = ws.addRow(['Totais Prestador', '', '', '', '', r.totalTutor, r.totalRepasse])
    final.font = { bold: true }
    final.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB2E9F4' } }
    ws.eachRow((row) => {
        for (const c of [6, 7]) row.getCell(c).numFmt = '#,##0.00'
    })
    const buf = await wb.xlsx.writeBuffer()
    baixar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${nomeArquivoBase(r)}.xlsx`)
}

/** PDF: logo, cabeçalho, três totais e a tabela agrupada por veterinário. */
export async function baixarRelatorioPdf(r) {
    const [{ jsPDF }, autoTableMod, { carregarLogoPdfEmerdog }, { OPCOES_JSPDF_A4, blobDeJsPdf }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('../contratos/pdf/gerarContratoPdf.js'),
        import('../pdf/serializarPdf.js'),
    ])
    const autoTable = autoTableMod.default
    const doc = new jsPDF({ ...OPCOES_JSPDF_A4 })
    const M = 14
    let y = M
    try {
        const logo = await carregarLogoPdfEmerdog()
        doc.addImage(logo.dataUrl, 'PNG', M, y, logo.w, logo.h)
        y += logo.h + 6
    } catch {
        y += 6
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Relatório de repasse', M, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`${r.prestador} · Competência ${r.competencia}${r.periodoInicio ? ` (${dataBr(r.periodoInicio)} a ${dataBr(r.periodoFim)})` : ''}`, M, y)
    y += 5
    doc.text(`${r.atendimentos} atendimentos · ${r.veterinarios} veterinário(s)`, M, y)
    y += 7
    autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        theme: 'grid',
        styles: { fontSize: 9 },
        head: [['Valor total dos atendimentos (diferença + repasse)', 'Diferença', 'Repasse Emerdog']],
        body: [[brl(Number(r.totalRepasse) + Number(r.totalTutor)), brl(r.totalTutor), brl(r.totalRepasse)]],
        headStyles: { fillColor: [30, 77, 122], halign: 'center' },
        bodyStyles: { halign: 'center', fontStyle: 'bold' },
    })
    y = doc.lastAutoTable.finalY + 8
    for (const g of r.dados?.grupos || []) {
        const body = []
        let sub = 0
        for (const a of g.atendimentos || []) {
            const itens = a.itens || []
            // Prontuário, data, tutor e pet ocupam todas as linhas do atendimento (células mescladas, como no Excel).
            const mesclada = (conteudo) => ({ content: conteudo, rowSpan: itens.length, styles: { valign: 'middle' } })
            for (const [i, it] of itens.entries()) {
                const valores = [it[0], numeroPtBr(it[2]), numeroPtBr(it[1])]
                body.push(i === 0 ? [mesclada(a.id), mesclada(a.data), mesclada(a.tutor), mesclada(a.pet), ...valores] : valores)
                sub += Number(it[1] || 0)
            }
        }
        autoTable(doc, {
            startY: y,
            margin: { left: M, right: M },
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
            head: [[{ content: g.titulo, colSpan: 7, styles: { halign: 'left', fillColor: [231, 244, 252], textColor: [20, 32, 51] } }], ['Prontuário', 'Data', 'Tutor', 'Pet', 'Procedimento', 'Diferença', 'Repasse']],
            body,
            rowPageBreak: 'avoid',
            foot: [[{ content: `Subtotal repasse: ${brl(sub)}`, colSpan: 7, styles: { halign: 'right' } }]],
            headStyles: { fillColor: [30, 77, 122], textColor: 255 },
            footStyles: { fillColor: [26, 111, 163], textColor: 255 },
            columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right', fillColor: [231, 244, 252], fontStyle: 'bold' } },
        })
        y = doc.lastAutoTable.finalY + 6
    }
    autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        theme: 'grid',
        styles: { fontSize: 9, fontStyle: 'bold' },
        body: [[{ content: 'TOTAL GERAL', styles: { halign: 'left' } }, { content: `Diferença: ${brl(r.totalTutor)}`, styles: { halign: 'right' } }, { content: `Repasse: ${brl(r.totalRepasse)}`, styles: { halign: 'right' } }]],
        bodyStyles: { fillColor: [15, 47, 74], textColor: 255 },
    })
    baixar(blobDeJsPdf(doc), `${nomeArquivoBase(r)}.pdf`)
}
