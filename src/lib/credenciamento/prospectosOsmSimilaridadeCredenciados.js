import { sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'
import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'

/** Score mínimo (includes / startsWith em sugerirPrestadoresPorNome). */
export const SCORE_MIN_ALERTA_CREDENCIADO = 650

const DISMISS_STORAGE_KEY = 'emerlab-prospectos-osm-alerta-credenciado-v1'

/**
 * Lê IDs de prospectos cuja flag «Talvez já credenciado» foi limpa pelo utilizador.
 * @returns {Set<string>}
 */
export function lerAlertasCredenciadoDismissed() {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set((Array.isArray(arr) ? arr : []).map(String))
  } catch {
    return new Set()
  }
}

/**
 * @param {Iterable<string>|Set<string>} ids
 */
export function salvarAlertasCredenciadoDismissed(ids) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...ids].map(String)))
  } catch {
    /* ignore */
  }
}

/**
 * Filtra credenciados pelo município/UF do prospecto (quando há dados).
 */
export function filtrarCredenciadosParaProspecto(credenciados, prospecto) {
  const lista = credenciados || []
  const ufP = normalizarTextoBusca(prospecto?.uf)
  const cidadeP = normalizarTextoBusca(prospecto?.cidade)
  if (!ufP && !cidadeP) return lista

  const mesmaRegiao = lista.filter((p) => {
    const uf = normalizarTextoBusca(p.endereco_uf || p.uf)
    const cidade = normalizarTextoBusca(p.endereco_cidade || p.cidade)
    if (ufP && uf && uf !== ufP) return false
    if (cidadeP && cidade && cidade !== cidadeP) return false
    return true
  })
  // Se o filtro regional esvaziar a base, cai no conjunto completo (evita falsos negativos).
  return mesmaRegiao.length ? mesmaRegiao : lista
}

/**
 * Melhor match por nome entre credenciados e o nome do prospecto.
 * @returns {{ prestador: object, score: number } | null}
 */
export function melhorMatchCredenciadoPorNome(credenciados, nomeBruto, { minScore = SCORE_MIN_ALERTA_CREDENCIADO } = {}) {
  const termo = normalizarTextoBusca(nomeBruto)
  if (!termo) return null
  const lista = credenciados || []
  if (!lista.length) return null

  // Reusa a ordenação fuzzy existente; o 1.º resultado é o mais próximo.
  const sugestoes = sugerirPrestadoresPorNome(lista, nomeBruto, { limite: 1 })
  const melhor = sugestoes[0]
  if (!melhor) return null

  const n = normalizarTextoBusca(melhor.nome)
  let score = 0
  if (n === termo) score = 1000
  else if (n.startsWith(termo) || termo.startsWith(n)) score = 850
  else if (n.includes(termo) || termo.includes(n)) score = 650
  else {
    // Palavras em comum (mesmo limiar que a sugestão fraca — só alerta se >= minScore)
    const palavras = termo.split(/\s+/).filter((w) => w.length >= 2)
    const palavrasNome = n.split(/\s+/).filter(Boolean)
    let hits = 0
    for (const w of palavras) {
      if (palavrasNome.some((pn) => pn.startsWith(w) || pn.includes(w))) hits += 1
    }
    if (hits > 0 && palavras.length) {
      score = 180 + Math.round((120 * hits) / palavras.length)
    }
  }

  if (score < minScore) return null
  return { prestador: melhor, score }
}

/**
 * @param {object[]} prospectos
 * @param {object[]} credenciados
 * @param {{ dismissedIds?: Set<string>, minScore?: number }} [opts]
 * @returns {Map<string, { prestadorId: string, nome: string, score: number }>}
 */
export function mapearAlertasCredenciadoProspectos(prospectos, credenciados, opts = {}) {
  const dismissed = opts.dismissedIds || new Set()
  const minScore = opts.minScore ?? SCORE_MIN_ALERTA_CREDENCIADO
  const out = new Map()

  for (const row of prospectos || []) {
    const id = String(row?.id || '')
    if (!id || dismissed.has(id)) continue
    if (String(row.status_prospeccao || '') === 'credenciado') continue

    const base = filtrarCredenciadosParaProspecto(credenciados, row)
    const match = melhorMatchCredenciadoPorNome(base, row.nome, { minScore })
    if (!match) continue

    out.set(id, {
      prestadorId: String(match.prestador.id),
      nome: String(match.prestador.nome || ''),
      score: match.score,
    })
  }
  return out
}
