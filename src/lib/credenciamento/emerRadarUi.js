/** Helpers de UI compartilhados com a página própria do Emer-Radar. */

export function formatDateBR(value) {
  if (!value) return ''
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return String(value)
}

/** Tipos do Maps que não fazem sentido para prospecção vet (ex.: POI vizinho). */
const CATEGORIA_IRRELEVANTE_RE =
  /escrit[oó]rio\s+do\s+governo|governo\s+do\s+estado|prefeitura|c[aâ]mara\s+municipal|delegacia|tribunal|cart[oó]rio|autarquia|secretaria\s+de\s+estado/i

export function categoriaMapsIrrelevante(cat) {
  return CATEGORIA_IRRELEVANTE_RE.test(String(cat || '').trim())
}

function labelCategoriaPorTermo(termo) {
  const t = String(termo || '').toLowerCase()
  if (t.includes('hospital')) return 'Hospital Veterinário'
  if (t.includes('pet')) return 'Pet Shop Veterinário'
  if (t.includes('clínica') || t.includes('clinica')) return 'Clínica Veterinária'
  if (t.includes('veterin')) return 'Veterinário'
  return ''
}

export function displayCategory(est) {
  const cat = String(est?.categoria || '').trim()
  if (cat && !categoriaMapsIrrelevante(cat)) return cat
  const porTermo = labelCategoriaPorTermo(est?.termo_busca)
  if (porTermo) return porTermo
  return (est?.tipo || est?.especialidade || '').trim() || 'Estabelecimento'
}

/** Google Maps usa 0–5; scrape às vezes grava escala 0–10 (ex.: "10,0" = 5,0). */
export function formatarNotaMaps(nota) {
  if (nota == null || nota === '') return ''
  const raw = String(nota).trim()
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n)) return raw
  let v = n
  if (v > 5 && v <= 10) v = v / 2
  if (v < 0 || v > 5) return raw
  return v.toFixed(1).replace('.', ',')
}

const UF_BR =
  'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO'

export function ufFromEndereco(endereco, fallback = '') {
  const addr = String(endereco || '').trim()
  if (addr) {
    const re = new RegExp(`-\\s*(${UF_BR})\\b`, 'gi')
    let match = null
    let m
    while ((m = re.exec(addr)) !== null) match = m
    if (match?.[1]) return match[1].toUpperCase()
  }
  return String(fallback || '')
    .trim()
    .toUpperCase()
    .slice(0, 2)
}

export function classify(est) {
  const raw = `${est?.categoria || ''} ${est?.termo_busca || ''}`.toLowerCase()
  if (raw.includes('hospital')) return 'hospital'
  if (raw.includes('pet')) return 'pet'
  if (raw.includes('clínica') || raw.includes('clinica')) return 'clinica'
  if (raw.includes('veterin')) return 'clinica'
  return 'outros'
}

export function copyText(est) {
  let horario = est?.horario || '—'
  if (est?.horario_detalhado) {
    const linhas = String(est.horario_detalhado)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace('=', ': '))
    if (linhas.length) {
      horario = [est.horario, ...linhas].filter(Boolean).join('\n')
    }
  }
  return [
    `Nome: ${est?.nome || '—'}`,
    `Endereço: ${est?.endereco || '—'}`,
    `Telefone: ${est?.telefone || '—'}`,
    `Horário: ${horario}`,
    `Cidade: ${est?.cidade || '—'}`,
    `UF: ${est?.uf || '—'}`,
  ].join('\n')
}

function phoneDigits(raw) {
  let d = String(raw || '').replace(/\D+/g, '')
  if (d.startsWith('55') && d.length > 11) d = d.slice(2)
  return d.length >= 10 ? d.slice(-11) : d
}

function isMobilePhone(raw) {
  const d = phoneDigits(raw)
  return d.length === 11 && d[2] === '9'
}

export function unifyContato(tel, wa) {
  const t = String(tel || '').trim()
  const w = String(wa || '').trim()
  if (!t && !w) return ''
  if (!t) return w
  if (!w) return t
  if (phoneDigits(t) === phoneDigits(w)) return w || t
  if (isMobilePhone(w)) return w
  if (isMobilePhone(t)) return t
  return w || t
}

export function cidadeFromEndereco(endereco, fallback) {
  const addr = String(endereco || '').trim()
  if (addr) {
    // Última ocorrência de "Cidade - UF" (evita "453 - Centro" / "101 - Bairro")
    const re = new RegExp(`,\\s*([^,]+?)\\s*-\\s*(${UF_BR})\\b`, 'gi')
    let match = null
    let m
    while ((m = re.exec(addr)) !== null) match = m
    if (match?.[1]) {
      const part = match[1].trim()
      if (part.length >= 2) return part
    }
  }
  return String(fallback || '').trim()
}

/**
 * Cidade do estabelecimento: worker > endereço > cidade da busca.
 * Se o worker só ecoou a cidade da busca mas o endereço aponta outra, confia no endereço
 * (comum quando a busca em Esteio devolve clínica em Sapucaia).
 */
export function resolverCidadeProspectoMaps(est, { cidadePadrao = '' } = {}) {
  const endereco = String(est?.endereco || '').trim()
  const doWorker = String(est?.cidade || '').trim()
  const doEndereco = cidadeFromEndereco(endereco, '')
  const padrao = String(cidadePadrao || '').trim()
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()

  if (doWorker && doEndereco && padrao && norm(doWorker) === norm(padrao) && norm(doEndereco) !== norm(padrao)) {
    return doEndereco
  }
  if (doWorker) return doWorker
  if (doEndereco) return doEndereco
  return padrao
}

export function isSomenteRede(r) {
  return String(r?.match_status || '') === 'somente_rede'
}

export function isVinculado(r) {
  return (r?.planos || []).length > 0 && !isSomenteRede(r)
}

export function planoPrincipal(r) {
  const p = (r?.planos || [])[0]
  if (p) return p
  const o = (r?.origens || []).find((x) => x !== 'maps')
  return o || 'outro'
}

export const PLANO_ORDER = ['petlove', 'petlife', 'doglife', 'emerdog']

export const PLANO_LABELS = {
  petlove: 'Petlove',
  petlife: 'Petlife',
  doglife: 'Doglife',
  emerdog: 'Emerdog',
}

export function planoLabel(id) {
  return PLANO_LABELS[id] || id
}

/** Normaliza campos de cooldown da API (em_cooldown) com fallback legado (bloqueada). */
export function cidadeEmCooldown(c) {
  if (!c) return false
  if (typeof c.em_cooldown === 'boolean') return c.em_cooldown
  if (typeof c.disponivel === 'boolean') return !c.disponivel
  return Boolean(c.bloqueada)
}

export function cidadeDisponivel(c) {
  if (!c) return true
  if (typeof c.disponivel === 'boolean') return c.disponivel
  return !cidadeEmCooldown(c)
}

export const FASE_PIPELINE_LABEL = {
  iniciando: 'Iniciando…',
  maps: 'Google Maps',
  redes: 'Planos / redes',
  matching: 'Matching',
  cidade_ok: 'Cidade concluída',
  concluido: 'Concluído',
}

export const STATUS_SCRAPE_LABEL = {
  IDLE: 'Aguardando',
  BUSCANDO: 'Buscando',
  FINALIZANDO: 'Finalizando',
  CONCLUIDO: 'Concluído',
  ERRO: 'Erro',
}
