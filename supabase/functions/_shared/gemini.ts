/** Cliente Gemini — generateContent (REST) para Edge Functions Deno. */

const DEFAULT_MODEL = Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-2.5-flash'

const MODEL_ALIASES: Record<string, string> = {
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash-001': 'gemini-2.5-flash',
  'gemini-2.0-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite-001': 'gemini-2.5-flash-lite',
}

function resolverModelo(pedido?: string) {
  const raw = String(pedido || Deno.env.get('GEMINI_MODEL') || '').trim() || DEFAULT_MODEL
  return MODEL_ALIASES[raw.toLowerCase()] || raw
}

function isQuota(msg: string, status?: number) {
  if (status === 429 || status === 503) return true
  const m = msg.toLowerCase()
  return m.includes('quota') || m.includes('resource_exhausted') || m.includes('rate limit')
}

function isModelNotFound(msg: string, status?: number) {
  if (status === 404) return true
  const m = msg.toLowerCase()
  return m.includes('not found') || m.includes('not_found')
}

function limparTextoJson(texto: string) {
  let t = String(texto || '').trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  return t.trim()
}

function extrairTextoGenerateContent(body: {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
}) {
  const parts = body?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  let out = ''
  for (const part of parts) {
    if (part?.thought) continue
    if (typeof part?.text === 'string') out += part.text
  }
  return out.trim()
}

export async function geminiGenerateJson(opts: {
  prompt: string
  jsonSchema?: Record<string, unknown>
  temperature?: number
  maxOutputTokens?: number
}) {
  const apiKey = String(Deno.env.get('GEMINI_API_KEY') || '').trim()
  if (!apiKey) {
    return { ok: false as const, erro: 'GEMINI_API_KEY não configurada no Supabase.' }
  }

  const model = resolverModelo()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.25,
    responseMimeType: 'application/json',
  }
  if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens
  if (opts.jsonSchema) generationConfig.responseJsonSchema = opts.jsonSchema

  const body = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let parsed: {
    error?: { message?: string }
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    return { ok: false as const, erro: 'Resposta Gemini inválida.', status: res.status }
  }

  if (!res.ok) {
    const msg = parsed?.error?.message || raw.slice(0, 400)
    return {
      ok: false as const,
      erro: msg,
      erroOriginal: msg,
      status: res.status,
      quotaExceeded: isQuota(msg, res.status),
      modeloInvalido: isModelNotFound(msg, res.status),
    }
  }

  const texto = limparTextoJson(extrairTextoGenerateContent(parsed))
  if (!texto) return { ok: false as const, erro: 'Gemini não retornou conteúdo.' }

  try {
    return { ok: true as const, data: JSON.parse(texto), modeloUsado: model }
  } catch {
    return { ok: false as const, erro: 'JSON inválido do Gemini.' }
  }
}

export async function geminiVerificarDisponibilidade() {
  const r = await geminiGenerateJson({
    prompt: 'Responda apenas com JSON: {"ok":true}',
    temperature: 0,
    maxOutputTokens: 256,
    jsonSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
  })
  const modelo = resolverModelo()
  if (r.ok) {
    return { configurado: true, disponivel: true, modelo }
  }
  return {
    configurado: Boolean(Deno.env.get('GEMINI_API_KEY')),
    disponivel: false,
    quotaExceeded: 'quotaExceeded' in r && Boolean(r.quotaExceeded),
    modeloInvalido: 'modeloInvalido' in r && Boolean(r.modeloInvalido),
    httpStatus: 'status' in r ? r.status : undefined,
    erro: r.erro,
    modelo,
  }
}
