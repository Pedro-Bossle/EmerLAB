/** Helpers de UI compartilhados com a página própria do Emer-Radar. */

export function formatDateBR(value) {
  if (!value) return ''
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return String(value)
}

export function displayCategory(est) {
  if (est?.categoria) return est.categoria
  const t = String(est?.termo_busca || '').toLowerCase()
  if (t.includes('hospital')) return 'Hospital Veterinário'
  if (t.includes('pet')) return 'Pet Shop Veterinário'
  if (t.includes('clínica') || t.includes('clinica')) return 'Clínica Veterinária'
  if (t.includes('veterin')) return 'Veterinário'
  return (est?.tipo || est?.especialidade || '').trim() || 'Estabelecimento'
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
    const m = addr.match(/,\s*([^,]+?)\s*-\s*[A-Za-z]{2}\b/)
    if (m?.[1]) {
      const part = m[1].trim()
      if (part.length >= 2) return part
    }
  }
  return String(fallback || '').trim()
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
