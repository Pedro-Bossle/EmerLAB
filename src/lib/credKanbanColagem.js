import { UFS_BRASIL } from './ibgeLocalidades.js'
import { normalizarTextoBusca } from './prestadorCadastroHelpers.js'
import { maskTelefoneBr } from './telefoneBrasil.js'

const CABECALHOS = new Set([
    'nome',
    'especialidade',
    'especialidade principal',
    'uf',
    'cidade',
    'telefone',
    'tel',
    'responsavel',
    'responsável',
    'assignee',
])

/**
 * Detecta colagem tabular (Excel/Sheets) para cards do Kanban.
 * @param {string} texto
 */
export function pareceColagemTabelaKanban(texto) {
    const t = String(texto || '')
    if (!t.trim()) return false
    if (t.includes('\t')) return true
    const linhas = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim())
    return linhas.length >= 2
}

function cel(cols, i) {
    return String(cols[i] ?? '').trim()
}

function ehLinhaCabecalho(cols) {
    if (!cols?.length) return false
    const a = normalizarTextoBusca(cel(cols, 0))
    const b = normalizarTextoBusca(cel(cols, 1))
    return CABECALHOS.has(a) || (a === 'nome' && CABECALHOS.has(b))
}

/**
 * Resolve UUID do responsável por nome ou e-mail.
 * @param {string} raw
 * @param {Array<{ id: string, nome?: string, email?: string }>} usuarios
 */
export function resolverResponsavelKanban(raw, usuarios = []) {
    const q = String(raw || '').trim()
    if (!q) return ''
    const qn = normalizarTextoBusca(q)
    const qEmail = q.toLowerCase()
    const lista = usuarios || []

    const porId = lista.find((u) => String(u.id) === q)
    if (porId) return porId.id

    const exato = lista.find((u) => {
        const n = normalizarTextoBusca(u.nome)
        const e = String(u.email || '')
            .trim()
            .toLowerCase()
        return n === qn || (e && e === qEmail)
    })
    if (exato) return exato.id

    const parciais = lista.filter((u) => {
        const n = normalizarTextoBusca(u.nome)
        return n && (n.includes(qn) || qn.includes(n))
    })
    if (parciais.length === 1) return parciais[0].id
    return ''
}

function normalizarUf(raw) {
    const u = String(raw || '')
        .trim()
        .toUpperCase()
        .slice(0, 2)
    if (!u) return ''
    return UFS_BRASIL.includes(u) ? u : u
}

/**
 * Colunas esperadas (tab): Nome | Especialidade | UF | Cidade | Telefone | Responsável
 * @param {string} texto
 * @param {{ usuarios?: Array<{ id: string, nome?: string, email?: string }>, atribuidoAPadrao?: string }} [opts]
 * @returns {Array<{ nome: string, especialidade: string, uf: string, cidade: string, telefone: string, atribuidoA: string }>}
 */
export function parseColagemCardsKanban(texto, opts = {}) {
    const usuarios = opts.usuarios || []
    const padraoResp = opts.atribuidoAPadrao || ''
    const bruto = String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
    const linhas = bruto
        .split('\n')
        .map((l) => l.replace(/\s+$/g, ''))
        .filter((l) => l.trim().length > 0)

    if (!linhas.length) return []

    let start = 0
    const primeira = linhas[0].split('\t')
    if (ehLinhaCabecalho(primeira)) start = 1

    const out = []
    for (let i = start; i < linhas.length; i += 1) {
        const cols = linhas[i].includes('\t')
            ? linhas[i].split('\t')
            : [linhas[i]]
        const nome = cel(cols, 0)
        if (!nome) continue
        if (i === start && ehLinhaCabecalho(cols)) continue

        const especialidade = cel(cols, 1)
        const uf = normalizarUf(cel(cols, 2))
        const cidade = cel(cols, 3)
        const telefone = maskTelefoneBr(cel(cols, 4))
        const respRaw = cel(cols, 5)
        const atribuidoA = respRaw ? resolverResponsavelKanban(respRaw, usuarios) || '' : padraoResp

        out.push({
            nome,
            especialidade,
            uf,
            cidade,
            telefone,
            atribuidoA: atribuidoA || padraoResp || '',
        })
    }
    return out
}
