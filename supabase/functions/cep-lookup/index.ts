import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const apenasDigitos = (v: string) => String(v || '').replace(/\D/g, '')

const formatarCep = (cepDigits: string) => {
  const c = apenasDigitos(cepDigits)
  if (c.length !== 8) return String(cepDigits || '').trim()
  return `${c.slice(0, 5)}-${c.slice(5)}`
}

Deno.serve(async (req) => {
  const opt = handleOptions(req)
  if (opt) return opt

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  const url = new URL(req.url)
  const cep = apenasDigitos(url.searchParams.get('cep') || '')
  if (cep.length !== 8) {
    return jsonResponse({ error: 'Informe um CEP com 8 dígitos.' }, 400)
  }

  try {
    const upstream = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' },
    })
    const data = await upstream.json()
    if (!upstream.ok) {
      return jsonResponse({ error: 'Falha ao consultar ViaCEP.' }, upstream.status)
    }
    if (data?.erro) {
      return jsonResponse({ error: 'CEP não encontrado.' }, 404)
    }

    return jsonResponse({
      cep: formatarCep(data.cep || cep),
      logradouro: String(data.logradouro || '').trim(),
      complemento: String(data.complemento || '').trim(),
      bairro: String(data.bairro || '').trim(),
      cidade: String(data.localidade || '').trim(),
      uf: String(data.uf || '').trim(),
      pais: 'Brasil',
      ibge: data.ibge || null,
    })
  } catch (e) {
    return jsonResponse({ error: (e as Error)?.message || 'Falha na consulta de CEP.' }, 502)
  }
})
