import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { PROSPECTOS_OSM_CATEGORIAS, labelProspectoOsmCategoria } from './osmCategories.ts'
import { geocodificarEnderecoNominatim } from './geocodePrestador.ts'
import { geminiGenerateJson } from './gemini.ts'

const MAX_ITENS = Number(Deno.env.get('PROSPECTOS_GEMINI_MAX') || 20)

const SCHEMA = {
  type: 'object',
  properties: {
    estabelecimentos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          categoria_id: { type: 'string' },
          endereco: { type: 'string' },
          telefone: { type: 'string' },
          website: { type: 'string' },
          horario_atendimento: { type: 'string' },
          nota: { type: 'string' },
          ativo: { type: 'boolean' },
        },
        required: ['nome', 'categoria_id', 'endereco'],
      },
    },
  },
  required: ['estabelecimentos'],
}

function hashId(chave: string) {
  let h = 5381
  for (let i = 0; i < chave.length; i += 1) {
    h = (Math.imul(33, h) ^ chave.charCodeAt(i)) >>> 0
  }
  return h || 1
}

function montarPrompt(cidade: string, uf: string) {
  const cats = PROSPECTOS_OSM_CATEGORIAS.map((c) => `${c.id}: ${c.label}`).join('\n')
  const loc = uf ? `${cidade}, ${uf}, Brasil` : `${cidade}, Brasil`
  return `Liste estabelecimentos REAIS, ATIVOS e em funcionamento em ${loc} voltados a animais / veterinária.
Inclua SOMENTE locais abertos e operando hoje. NÃO incluir fechados, desativados, abandonados, demolidos, “antigo …”, inexistentes ou com dúvida se ainda funcionam — nesse caso OMITA.
categoria_id deve ser um destes:
${cats}
Máximo ${MAX_ITENS} itens.
Retorne JSON: { "estabelecimentos": [ { "nome", "categoria_id", "endereco", "telefone", "website", "horario_atendimento", "ativo" } ] }
Campo ativo=true apenas se estiver em operação.`
}

export async function coletarProspectosGeminiCidade(
  supabaseAdmin: SupabaseClient,
  opts: { cidade: string; uf?: string },
) {
  const cidade = String(opts.cidade || '').trim()
  const uf = String(opts.uf || '').trim()
  if (!cidade) return { ok: false as const, erro: 'Informe a cidade.' }

  const gem = await geminiGenerateJson({
    prompt: montarPrompt(cidade, uf),
    jsonSchema: SCHEMA,
    maxOutputTokens: 8192,
    timeoutMs: 90_000,
  })
  if (!gem.ok) {
    return {
      ok: false as const,
      erro: gem.erro || 'Falha na consulta Gemini.',
      quotaExceeded: gem.quotaExceeded,
      erroOriginal: gem.erroOriginal,
    }
  }

  const listaRaw = Array.isArray((gem.data as { estabelecimentos?: unknown[] })?.estabelecimentos)
    ? (gem.data as { estabelecimentos: Record<string, unknown>[] }).estabelecimentos
    : []
  const lista = listaRaw.slice(0, MAX_ITENS)

  const rows: Record<string, unknown>[] = []
  for (const raw of lista) {
    const nome = String(raw?.nome || '').trim()
    const categoria_id = String(raw?.categoria_id || '').trim()
    const endereco = String(raw?.endereco || '').trim()
    if (!nome || !endereco) continue
    if (!PROSPECTOS_OSM_CATEGORIAS.some((c) => c.id === categoria_id)) continue
    if (raw?.ativo === false) continue
    const horario = String(raw?.horario_atendimento || '').trim()
    const nota = String(raw?.nota || '').trim()
    const nomeLow = nome.toLowerCase()
    if (
      /\b(fechado|fechada|desativado|abandonado|inexistente|antig[oa])\b/i.test(nomeLow) ||
      /^(closed|off|fechado)$/i.test(horario)
    ) {
      continue
    }
    const chave = `${nome}|${endereco}|${cidade}|${uf}|${categoria_id}`
    const row = {
      osm_type: 'gemini_poc',
      osm_id: hashId(chave),
      categoria_id,
      categoria_label: labelProspectoOsmCategoria(categoria_id),
      nome,
      endereco,
      cidade,
      uf,
      lat: null,
      lng: null,
      telefone: String(raw?.telefone || '').trim(),
      horario_atendimento: horario,
      website: String(raw?.website || '').trim(),
      tags: { fonte: 'gemini_poc', nota, ativo: true },
      coletado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }
    const consulta = [nome, endereco, cidade, uf].filter(Boolean).join(', ')
    const g = await geocodificarEnderecoNominatim(consulta)
    if (g.ok) {
      row.lat = g.latitude
      row.lng = g.longitude
    }
    rows.push(row)
  }

  if (!rows.length) {
    return { ok: true as const, inseridos: 0, fonte: 'gemini', aviso: 'Gemini não retornou estabelecimentos válidos.' }
  }

  const { error } = await supabaseAdmin.from('cred_prospectos_osm').upsert(rows, {
    onConflict: 'osm_type,osm_id',
  })
  if (error) return { ok: false as const, erro: error.message }

  return {
    ok: true as const,
    inseridos: rows.length,
    fonte: 'gemini',
    aviso: `PoC Gemini: ${rows.length} sugestão(ões).`,
  }
}
