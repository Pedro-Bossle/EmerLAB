import { cidadeFromEndereco, displayCategory, formatarNotaMaps, planoLabel, unifyContato } from './emerRadarUi.js'

const M = 10

const texto = (v) => String(v ?? '').trim()

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

/**
 * PDF dos prospectos exibidos (já sem os removidos/descartados), gerado no navegador.
 * Bibliotecas pesadas só são carregadas quando o usuário clica.
 * @param {object[]} itens registros no formato de cartão (nome, endereco, telefone, horario, nota…)
 * @param {{ titulo?: string, subtitulo?: string }} [opts]
 */
export async function exportarProspectosMapsParaPdf(itens, { titulo = 'Prospectos — Emer-Radar', subtitulo = '' } = {}) {
    const lista = (itens || []).filter((r) => r && texto(r.nome))
    if (!lista.length) return { ok: false, erro: 'Nenhum prospecto para exportar.' }

    const [{ jsPDF }, autoTableMod, { carregarLogoPdfEmerdog }, { OPCOES_JSPDF_A4, blobDeJsPdf }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('../contratos/pdf/gerarContratoPdf.js'),
        import('../pdf/serializarPdf.js'),
    ])
    const autoTable = autoTableMod.default
    const doc = new jsPDF({ ...OPCOES_JSPDF_A4, orientation: 'landscape' })
    let y = M
    try {
        const logo = await carregarLogoPdfEmerdog()
        doc.addImage(logo.dataUrl, 'PNG', M, y, logo.w, logo.h)
        y += logo.h + 5
    } catch {
        y += 4
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(titulo, M, y)
    y += 5.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const hoje = new Date().toLocaleDateString('pt-BR')
    doc.text([`${lista.length} prospecto${lista.length === 1 ? '' : 's'}`, subtitulo, `gerado em ${hoje}`].filter(Boolean).join(' · '), M, y)
    y += 4

    const corpo = lista.map((r) => {
        const planos = Array.isArray(r.planos) && r.planos.length ? `\nJá em: ${r.planos.map((p) => planoLabel(p)).join(', ')}` : ''
        const nota = formatarNotaMaps(r.nota) || texto(r.nota)
        const aval = texto(r.num_avaliacoes)
        return [
            `${texto(r.nome)}${planos}`,
            displayCategory(r),
            texto(r.endereco) || '—',
            cidadeFromEndereco(r.endereco, r.cidade) || texto(r.cidade) || '—',
            unifyContato(r.telefone, r.whatsapp) || '—',
            texto(r.horario) || '—',
            nota ? `${nota}${aval ? ` (${aval})` : ''}` : '—',
        ]
    })

    autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
        head: [['Nome', 'Tipo', 'Endereço', 'Cidade', 'Contato', 'Horário', 'Nota']],
        body: corpo,
        headStyles: { fillColor: [30, 77, 122], textColor: 255 },
        columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' }, 1: { cellWidth: 30 }, 4: { cellWidth: 32 }, 6: { cellWidth: 20, halign: 'center' } },
        rowPageBreak: 'avoid',
    })

    baixar(blobDeJsPdf(doc), `emer-radar-prospectos-${new Date().toISOString().slice(0, 10)}.pdf`)
    return { ok: true, total: lista.length }
}
