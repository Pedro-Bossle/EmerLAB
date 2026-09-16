/**
 * Cidades do tráfego → contadores diários → limiar 4 → fila cron Emer-Radar.
 */

import { supabase } from '../supabase.js'
import { pipelineEnqueue, pipelinePreviewCities } from './emerRadarApi.js'
import { cidadeDisponivel, cidadeEmCooldown } from './emerRadarUi.js'

export const LIMIAR_MARCADORES_CRON = 4

const UFS_BR = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

/** Normaliza nome de cidade para chave única. */
export function normalizarCidadeTrafego(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

export function normalizarUfTrafego(uf) {
  return String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2)
}

/** YYYY-MM-DD em fuso local. */
export function dataLocalYmd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return dataLocalYmd(new Date())
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Extrai cidade + UF de uma linha.
 * Aceita: «Cidade», «Cidade/UF», «Cidade - UF», «Cidade, UF».
 * @returns {{ cidade: string, uf: string } | null}
 */
export function parseLinhaCidadeTrafego(linha, ufPadrao = '') {
  let raw = String(linha || '').trim()
  if (!raw) return null
  // Ignora cabeçalhos comuns
  if (/^(cidade|city|municipio|município|uf|estado)\b/i.test(raw) && raw.length < 40) {
    return null
  }
  // Remove prefixos tipo «- » ou numeração
  raw = raw.replace(/^[\d\-•*.)]+\s*/, '').trim()
  if (!raw) return null

  let cidade = raw
  let uf = ''

  const mSlash = raw.match(/^(.+?)[\/|,]\s*([A-Za-z]{2})\s*$/)
  if (mSlash) {
    cidade = mSlash[1].trim()
    uf = mSlash[2]
  } else {
    const mDash = raw.match(/^(.+?)\s+[-–—]\s*([A-Za-z]{2})\s*$/)
    if (mDash) {
      cidade = mDash[1].trim()
      uf = mDash[2]
    }
  }

  uf = normalizarUfTrafego(uf || ufPadrao)
  cidade = cidade.replace(/\s+/g, ' ').trim()
  if (!cidade || cidade.length < 2) return null
  if (!uf || !UFS_BR.has(uf)) return null

  return { cidade, uf }
}

/**
 * @param {string} texto
 * @param {string} ufPadrao
 * @returns {{ cidade: string, uf: string }[]}
 */
export function parseCidadesTrafego(texto, ufPadrao = '') {
  const linhas = String(texto || '').split(/\r?\n/)
  const vistos = new Set()
  const out = []
  for (const linha of linhas) {
    const parsed = parseLinhaCidadeTrafego(linha, ufPadrao)
    if (!parsed) continue
    const key = `${normalizarCidadeTrafego(parsed.cidade)}|${parsed.uf}`
    if (vistos.has(key)) continue
    vistos.add(key)
    out.push(parsed)
  }
  return out
}

/**
 * @returns {Promise<object[]>}
 */
export async function listarContadoresTrafego() {
  const { data, error } = await supabase
    .from('cred_trafego_cidades')
    .select('id, cidade, uf, cidade_norm, marcadores, ultima_aparicao_em, enfileirado_em, atualizado_em')
    .order('marcadores', { ascending: false })
    .order('cidade', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Regista aparições do dia (1× por cidade/UF/data) e incrementa marcadores.
 * @param {{ cidade: string, uf: string }[]} cidades
 * @param {{ data?: string }} [opts]
 * @returns {Promise<{ novas: number, jaTinhamDia: number, atualizadas: object[] }>}
 */
export async function registrarAparicoesDoDia(cidades, opts = {}) {
  const data = opts.data || dataLocalYmd()
  const lista = Array.isArray(cidades) ? cidades : []
  let novas = 0
  let jaTinhamDia = 0
  const atualizadas = []

  for (const item of lista) {
    const cidade = String(item?.cidade || '').trim()
    const uf = normalizarUfTrafego(item?.uf)
    const cidade_norm = normalizarCidadeTrafego(cidade)
    if (!cidade || !uf || !cidade_norm) continue

    const { error: errAp } = await supabase.from('cred_trafego_aparicoes').insert({
      cidade_norm,
      uf,
      data,
    })

    if (errAp) {
      // Unique violation = já contou hoje
      if (errAp.code === '23505' || /duplicate|unique/i.test(String(errAp.message || ''))) {
        jaTinhamDia += 1
        continue
      }
      throw new Error(errAp.message)
    }

    novas += 1

    const { data: existente, error: errGet } = await supabase
      .from('cred_trafego_cidades')
      .select('id, marcadores')
      .eq('cidade_norm', cidade_norm)
      .eq('uf', uf)
      .maybeSingle()
    if (errGet) throw new Error(errGet.message)

    const agora = new Date().toISOString()
    if (existente?.id) {
      const next = (Number(existente.marcadores) || 0) + 1
      const { data: upd, error: errUp } = await supabase
        .from('cred_trafego_cidades')
        .update({
          cidade,
          marcadores: next,
          ultima_aparicao_em: data,
          atualizado_em: agora,
        })
        .eq('id', existente.id)
        .select('id, cidade, uf, cidade_norm, marcadores, ultima_aparicao_em, enfileirado_em')
        .maybeSingle()
      if (errUp) throw new Error(errUp.message)
      if (upd) atualizadas.push(upd)
    } else {
      const { data: ins, error: errIns } = await supabase
        .from('cred_trafego_cidades')
        .insert({
          cidade,
          uf,
          cidade_norm,
          marcadores: 1,
          ultima_aparicao_em: data,
          atualizado_em: agora,
        })
        .select('id, cidade, uf, cidade_norm, marcadores, ultima_aparicao_em, enfileirado_em')
        .maybeSingle()
      if (errIns) throw new Error(errIns.message)
      if (ins) atualizadas.push(ins)
    }
  }

  return { novas, jaTinhamDia, atualizadas }
}

/**
 * Pure helper: quais rows batem o limiar.
 * @param {object[]} rows
 * @param {number} [limiar]
 */
export function filtrarCidadesNoLimiar(rows, limiar = LIMIAR_MARCADORES_CRON) {
  return (rows || []).filter((r) => (Number(r.marcadores) || 0) >= limiar)
}

/**
 * Enfileira cidades com marcadores >= limiar (respeita cooldown do worker).
 * @returns {Promise<{
 *   candidatas: number,
 *   enfileiradas: number,
 *   emCooldown: number,
 *   cidadesEnfileiradas: { cidade: string, uf: string }[],
 *   cidadesCooldown: { cidade: string, uf: string }[],
 * }>}
 */
export async function enfileirarCidadesQueBateramLimiar(opts = {}) {
  const limiar = opts.limiar ?? LIMIAR_MARCADORES_CRON
  const { data: rows, error } = await supabase
    .from('cred_trafego_cidades')
    .select('id, cidade, uf, marcadores')
    .gte('marcadores', limiar)
  if (error) throw new Error(error.message)

  const candidatas = rows || []
  if (!candidatas.length) {
    return {
      candidatas: 0,
      enfileiradas: 0,
      emCooldown: 0,
      cidadesEnfileiradas: [],
      cidadesCooldown: [],
    }
  }

  const payload = candidatas.map((r) => ({ cidade: r.cidade, uf: r.uf }))
  let previewCities = []
  try {
    const preview = await pipelinePreviewCities(payload)
    previewCities = preview?.cities || []
  } catch {
    // Sem worker: tenta enfileirar todas
    previewCities = payload.map((c) => ({ ...c, disponivel: true, em_cooldown: false }))
  }

  const byKey = new Map()
  for (const c of previewCities) {
    const key = `${normalizarCidadeTrafego(c.cidade)}|${normalizarUfTrafego(c.uf)}`
    byKey.set(key, c)
  }

  const liberadas = []
  const cooldown = []
  for (const row of candidatas) {
    const key = `${normalizarCidadeTrafego(row.cidade)}|${normalizarUfTrafego(row.uf)}`
    const prev = byKey.get(key) || { ...row, disponivel: true }
    if (cidadeEmCooldown(prev) || !cidadeDisponivel(prev)) {
      cooldown.push({ cidade: row.cidade, uf: row.uf, id: row.id })
    } else {
      liberadas.push(row)
    }
  }

  let enfileiradas = 0
  const cidadesEnfileiradas = []
  if (liberadas.length) {
    await pipelineEnqueue(liberadas.map((r) => ({ cidade: r.cidade, uf: r.uf })))
    const agora = new Date().toISOString()
    for (const row of liberadas) {
      const { error: errUp } = await supabase
        .from('cred_trafego_cidades')
        .update({
          marcadores: 0,
          enfileirado_em: agora,
          atualizado_em: agora,
        })
        .eq('id', row.id)
      if (errUp) throw new Error(errUp.message)
      enfileiradas += 1
      cidadesEnfileiradas.push({ cidade: row.cidade, uf: row.uf })
    }
  }

  return {
    candidatas: candidatas.length,
    enfileiradas,
    emCooldown: cooldown.length,
    cidadesEnfileiradas,
    cidadesCooldown: cooldown.map(({ cidade, uf }) => ({ cidade, uf })),
  }
}

/**
 * Fluxo completo: parse → registar → enfileirar limiar.
 */
export async function processarTrafegoDoDia(texto, ufPadrao, opts = {}) {
  const parsed = parseCidadesTrafego(texto, ufPadrao)
  if (!parsed.length) {
    return {
      parsed: 0,
      novas: 0,
      jaTinhamDia: 0,
      enfileiradas: 0,
      emCooldown: 0,
      cidadesEnfileiradas: [],
      cidadesCooldown: [],
      aviso: 'Nenhuma cidade válida no texto (informe UF padrão ou Cidade/UF por linha).',
    }
  }
  const reg = await registrarAparicoesDoDia(parsed, { data: opts.data })
  const enq = await enfileirarCidadesQueBateramLimiar({ limiar: opts.limiar })
  return {
    parsed: parsed.length,
    novas: reg.novas,
    jaTinhamDia: reg.jaTinhamDia,
    enfileiradas: enq.enfileiradas,
    emCooldown: enq.emCooldown,
    cidadesEnfileiradas: enq.cidadesEnfileiradas,
    cidadesCooldown: enq.cidadesCooldown,
    aviso: '',
  }
}
