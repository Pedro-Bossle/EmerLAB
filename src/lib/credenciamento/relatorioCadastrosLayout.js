export const STORAGE_LAYOUT_RELATORIO_CADASTROS = 'emerdog_relatorio_cadastros_layout_v1'

/** @typedef {'nome'|'especialidade'|'cidade'|'situacao'|'usuario'|'credenciadoEm'} ColunaRelatorioCadastrosId */
/** @typedef {'situacao'|'usuario'|'especialidade'|'cidade'} BlocoResumoRelatorioCadastrosId */

export const METADADOS_COLUNAS_RELATORIO_CADASTROS = {
    nome: { id: 'nome', label: 'Nome' },
    especialidade: { id: 'especialidade', label: 'Especialidade' },
    cidade: { id: 'cidade', label: 'Cidade' },
    situacao: { id: 'situacao', label: 'Situação' },
    usuario: { id: 'usuario', label: 'Usuário' },
    credenciadoEm: { id: 'credenciadoEm', label: 'Credenciado Em' },
}

export const METADADOS_RESUMOS_RELATORIO_CADASTROS = {
    situacao: { id: 'situacao', label: 'Por situação (contagens)' },
    usuario: { id: 'usuario', label: 'Por usuário (contagens)' },
    especialidade: { id: 'especialidade', label: 'Por especialidade (qtd. e nomes)' },
    cidade: { id: 'cidade', label: 'Por cidade (qtd. e nomes)' },
}

const IDS_COLUNAS = Object.keys(METADADOS_COLUNAS_RELATORIO_CADASTROS)
const IDS_RESUMOS = Object.keys(METADADOS_RESUMOS_RELATORIO_CADASTROS)

export function layoutRelatorioCadastrosPadrao() {
    return {
        incluirTabelaGeral: true,
        incluirGraficoMeses: true,
        colunasAtivas: [...IDS_COLUNAS],
        ordemColunas: [...IDS_COLUNAS],
        resumosAtivos: Object.fromEntries(IDS_RESUMOS.map((id) => [id, true])),
        ordemResumos: [...IDS_RESUMOS],
    }
}

function uniqOrdem(lista, permitidos) {
    const setPerm = new Set(permitidos)
    const out = []
    for (const id of lista || []) {
        const s = String(id)
        if (!setPerm.has(s) || out.includes(s)) continue
        out.push(s)
    }
    for (const id of permitidos) {
        if (!out.includes(id)) out.push(id)
    }
    return out
}

/** @param {unknown} bruto */
export function normalizarLayoutRelatorioCadastros(bruto) {
    const padrao = layoutRelatorioCadastrosPadrao()
    const src = bruto && typeof bruto === 'object' ? bruto : {}
    const ordemColunas = uniqOrdem(src.ordemColunas, IDS_COLUNAS)
    const ativasRaw = Array.isArray(src.colunasAtivas) ? src.colunasAtivas.map(String) : padrao.colunasAtivas
    let colunasAtivas = ordemColunas.filter((id) => ativasRaw.includes(id))
    if (!colunasAtivas.length) colunasAtivas = [ordemColunas[0]]

    const ordemResumos = uniqOrdem(src.ordemResumos, IDS_RESUMOS)
    const resumosAtivos = { ...padrao.resumosAtivos, ...(src.resumosAtivos || {}) }
    for (const id of IDS_RESUMOS) {
        if (typeof resumosAtivos[id] !== 'boolean') resumosAtivos[id] = padrao.resumosAtivos[id]
    }

    return {
        incluirTabelaGeral: src.incluirTabelaGeral !== false,
        incluirGraficoMeses: src.incluirGraficoMeses !== false,
        colunasAtivas,
        ordemColunas,
        resumosAtivos,
        ordemResumos,
    }
}

export function lerLayoutRelatorioCadastrosSalvo() {
    try {
        const raw = localStorage.getItem(STORAGE_LAYOUT_RELATORIO_CADASTROS)
        if (!raw) return layoutRelatorioCadastrosPadrao()
        return normalizarLayoutRelatorioCadastros(JSON.parse(raw))
    } catch {
        return layoutRelatorioCadastrosPadrao()
    }
}

export function salvarLayoutRelatorioCadastros(layout) {
    try {
        localStorage.setItem(
            STORAGE_LAYOUT_RELATORIO_CADASTROS,
            JSON.stringify(normalizarLayoutRelatorioCadastros(layout)),
        )
    } catch {
        /* ignore quota / private mode */
    }
}

export function valorCelulaColunaRelatorioCadastros(linha, colunaId) {
    const l = linha || {}
    switch (colunaId) {
        case 'nome':
            return String(l.nome || '—')
        case 'especialidade':
            return String(l.especialidade || '—')
        case 'cidade':
            return String(l.cidade || '—')
        case 'situacao':
            return String(l.situacao || '—')
        case 'usuario':
            return String(l.usuario || '—')
        case 'credenciadoEm':
            return String(l.credenciadoEm || '—')
        default:
            return '—'
    }
}

/** Colunas visíveis na ordem escolhida. */
export function colunasTabelaRelatorioAtivas(layout) {
    const norm = normalizarLayoutRelatorioCadastros(layout)
    const ativas = new Set(norm.colunasAtivas)
    return norm.ordemColunas.filter((id) => ativas.has(id))
}

export function blocosResumoRelatorioAtivos(layout) {
    const norm = normalizarLayoutRelatorioCadastros(layout)
    return norm.ordemResumos.filter((id) => norm.resumosAtivos[id])
}

export function validarLayoutRelatorioCadastros(layout) {
    const norm = normalizarLayoutRelatorioCadastros(layout)
    const temTabela = norm.incluirTabelaGeral && colunasTabelaRelatorioAtivas(norm).length > 0
    const temResumo = blocosResumoRelatorioAtivos(norm).length > 0
    const temGrafico = norm.incluirGraficoMeses
    if (!temTabela && !temResumo && !temGrafico) {
        return 'Marque ao menos a tabela geral, um resumo ou o gráfico por mês.'
    }
    if (norm.incluirTabelaGeral && !colunasTabelaRelatorioAtivas(norm).length) {
        return 'Selecione ao menos uma coluna na tabela geral.'
    }
    return ''
}

/** Larguras proporcionais (mm) para autoTable. */
export function largurasColunasTabelaRelatorio(idsColunas, tableWidthMm) {
    const pesos = {
        nome: 1.35,
        especialidade: 1.05,
        cidade: 0.95,
        situacao: 0.85,
        usuario: 0.95,
        credenciadoEm: 0.85,
    }
    const soma = idsColunas.reduce((acc, id) => acc + (pesos[id] || 1), 0)
    const styles = {}
    idsColunas.forEach((id, idx) => {
        styles[idx] = {
            cellWidth: (tableWidthMm * (pesos[id] || 1)) / soma,
            ...(id === 'credenciadoEm' ? { halign: 'center' } : {}),
        }
    })
    return styles
}
