import { nominatimSearchJson } from './nominatim.ts'

export async function geocodificarEnderecoNominatim(enderecoCompleto: string) {
  const q = String(enderecoCompleto || '').trim()
  if (!q) return { ok: false as const, erro: 'Endereço vazio.' }

  const r = await nominatimSearchJson({
    q,
    limit: '1',
    countrycodes: 'br',
    addressdetails: '1',
    namedetails: '1',
    extratags: '1',
  })
  if (!r.ok) return { ok: false as const, erro: r.erro || 'Falha Nominatim.', codigo: r.codigo }

  const data = r.data as { lat?: string; lon?: string; display_name?: string }[] | undefined
  const hit = data?.[0]
  if (!hit) return { ok: false as const, erro: 'Endereço não encontrado.' }

  const lat = Number(hit.lat)
  const lon = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false as const, erro: 'Coordenadas inválidas na resposta.' }
  }
  return {
    ok: true as const,
    latitude: lat,
    longitude: lon,
    displayName: hit.display_name || '',
  }
}

function montarEndereco(p: Record<string, unknown>): string {
  const partes = [
    [p.endereco_logradouro, p.endereco_numero].filter(Boolean).join(', '),
    p.endereco_bairro,
    [p.endereco_cidade, p.endereco_uf].filter(Boolean).join(' / '),
    p.endereco_pais || 'Brasil',
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  if (partes.length) return partes.join(' — ')
  return String(p.endereco || '').trim()
}

function listarConsultas(p: Record<string, unknown>): { query: string }[] {
  const out: { query: string }[] = []
  const legado = String(p.endereco || '').trim()
  if (legado) out.push({ query: legado })
  const estruturado = montarEndereco(p)
  if (estruturado && estruturado !== legado) out.push({ query: estruturado })
  const nome = String(p.nome || '').trim()
  const cidade = String(p.endereco_cidade || '').trim()
  const uf = String(p.endereco_uf || '').trim()
  if (nome && cidade) {
    const q = [nome, estruturado || legado, cidade, uf, 'Brasil'].filter(Boolean).join(', ')
    if (!out.some((o) => o.query === q)) out.push({ query: q })
  }
  return out
}

export async function geocodificarESalvarPrestador(
  supabase: ReturnType<typeof import('./supabaseAdmin.ts').createServiceClient>,
  prestadorId: number,
  { forcar = false } = {},
) {
  const { data: prestador, error } = await supabase
    .from('prestadores')
    .select(
      'id, nome, tipo, especialidade_id, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_pais, latitude, longitude, endereco_geocode_hash',
    )
    .eq('id', prestadorId)
    .maybeSingle()

  if (error) return { ok: false, erro: error.message }
  if (!prestador) return { ok: false, erro: 'Prestador não encontrado.' }

  const consultas = listarConsultas(prestador as Record<string, unknown>)
  if (!consultas.length) return { ok: true, skipped: true, motivo: 'sem_endereco' }

  const canonico = montarEndereco(prestador as Record<string, unknown>) || consultas[0].query
  const hash = canonico.slice(0, 200)

  if (
    !forcar &&
    prestador.latitude != null &&
    prestador.longitude != null &&
    prestador.endereco_geocode_hash === hash
  ) {
    return { ok: true, skipped: true, motivo: 'ja_atualizado' }
  }

  let geo: Awaited<ReturnType<typeof geocodificarEnderecoNominatim>> | null = null
  for (const { query } of consultas) {
    geo = await geocodificarEnderecoNominatim(query)
    if (geo.ok) break
    await new Promise((r) => setTimeout(r, 1100))
  }

  if (!geo?.ok) return { ok: false, erro: geo?.erro || 'Geocodificação falhou.' }

  const agora = new Date().toISOString()
  const { error: upErr } = await supabase
    .from('prestadores')
    .update({
      latitude: geo.latitude,
      longitude: geo.longitude,
      geocoded_at: agora,
      geocode_fonte: 'nominatim',
      endereco_geocode_hash: hash,
      data_atualizacao: agora,
    })
    .eq('id', prestadorId)

  if (upErr) return { ok: false, erro: upErr.message }
  return { ok: true, latitude: geo.latitude, longitude: geo.longitude }
}
