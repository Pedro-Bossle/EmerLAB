import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const apenasDigitos = (v: string) => String(v || '').replace(/\D/g, '')

const BRASIL_API_CNPJ_BASE = (
  Deno.env.get('BRASILAPI_CNPJ_URL') || 'https://brasilapi.com.br/api/cnpj/v1'
).replace(/\/$/, '')

const UPSTREAM_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    Deno.env.get('BRASILAPI_USER_AGENT') ||
    'EmerdogSFSC/1.0 (consulta-cnpj; +https://www.emerdog.com.br)',
}

const formatarCep = (cepDigits: string) => {
  const c = apenasDigitos(cepDigits)
  if (c.length !== 8) return String(cepDigits || '').trim()
  return `${c.slice(0, 5)}-${c.slice(5)}`
}

const montarEnderecoBrasilApi = (d: Record<string, unknown>) => {
  const partes = [
    [d.logradouro, d.numero].filter(Boolean).join(', '),
    d.complemento,
    d.bairro,
    [d.municipio, d.uf].filter(Boolean).join(' – '),
    d.cep ? `CEP ${formatarCep(String(d.cep))}` : '',
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  return partes.join(' — ')
}

const normalizarResposta = (data: Record<string, unknown>) => {
  const razaoSocial = String(data.razao_social || data.nome_fantasia || '').trim()
  const enderecoCompleto = montarEnderecoBrasilApi(data).trim()
  return {
    razaoSocial,
    logradouro: String(data.logradouro || '').trim(),
    numero: String(data.numero || '').trim(),
    complemento: String(data.complemento || '').trim(),
    bairro: String(data.bairro || '').trim(),
    municipio: String(data.municipio || '').trim(),
    uf: String(data.uf || '').trim(),
    cep: apenasDigitos(String(data.cep || '')),
    enderecoCompleto,
  }
}

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  const url = new URL(req.url)
  const cnpj = apenasDigitos(url.searchParams.get('cnpj') || '')
  if (cnpj.length !== 14) {
    return jsonResponse({ error: 'Informe um CNPJ com 14 dígitos.' }, 400)
  }

  try {
    const upstream = await fetch(`${BRASIL_API_CNPJ_BASE}/${cnpj}`, { headers: UPSTREAM_HEADERS })
    const text = await upstream.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      return jsonResponse({ error: 'Resposta inválida da Brasil API.' }, 502)
    }

    if (upstream.status === 429) {
      return jsonResponse(
        { error: 'Limite de consultas na Brasil API. Aguarde um pouco.' },
        429,
      )
    }
    if (upstream.status === 404 || data?.type === 'not_found') {
      return jsonResponse({ error: 'CNPJ não encontrado ou inválido.' }, 404)
    }
    if (!upstream.ok) {
      return jsonResponse({ error: 'Consulta indisponível na Brasil API.' }, upstream.status >= 400 ? upstream.status : 502)
    }

    const out = normalizarResposta(data)
    if (!out.razaoSocial) {
      return jsonResponse({ error: 'CNPJ sem razão social na resposta.' }, 404)
    }

    return jsonResponse(out, 200, {
      'X-Consulta-CNPJ-Provider': 'brasilapi',
    })
  } catch (e) {
    return jsonResponse({ error: (e as Error)?.message || 'Falha ao consultar a Brasil API.' }, 502)
  }
})
