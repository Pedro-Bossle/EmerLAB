const DEFAULT_MODEL = Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-2.0-flash-001'

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

  const model = DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.25,
    responseMimeType: 'application/json',
  }
  if (opts.jsonSchema) generationConfig.responseSchema = opts.jsonSchema
  if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig,
    }),
  })

  const raw = await res.text()
  let body: { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] }
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return { ok: false as const, erro: 'Resposta Gemini inválida.', status: res.status }
  }

  if (!res.ok) {
    const msg = body?.error?.message || raw.slice(0, 400)
    return {
      ok: false as const,
      erro: msg,
      erroOriginal: msg,
      status: res.status,
      quotaExceeded: isQuota(msg, res.status),
      modeloInvalido: isModelNotFound(msg, res.status),
    }
  }

  const texto = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim()
  if (!texto) return { ok: false as const, erro: 'Gemini não retornou conteúdo.' }

  try {
    return { ok: true as const, data: JSON.parse(texto) }
  } catch {
    return { ok: false as const, erro: 'JSON inválido do Gemini.' }
  }
}

export async function geminiVerificarDisponibilidade() {
  const r = await geminiGenerateJson({
    prompt: 'Responda apenas com JSON: {"ok":true}',
    temperature: 0,
    maxOutputTokens: 16,
  })
  if (r.ok) {
    return { configurado: true, disponivel: true, modelo: DEFAULT_MODEL }
  }
  return {
    configurado: Boolean(Deno.env.get('GEMINI_API_KEY')),
    disponivel: false,
    quotaExceeded: 'quotaExceeded' in r && Boolean(r.quotaExceeded),
    modeloInvalido: 'modeloInvalido' in r && Boolean(r.modeloInvalido),
    httpStatus: 'status' in r ? r.status : undefined,
    erro: r.erro,
    modelo: DEFAULT_MODEL,
  }
}
