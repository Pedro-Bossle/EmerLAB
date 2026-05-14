/**
 * Proxy ReceitaWS (evita CORS no browser). GET /api/cnpj-lookup?cnpj=14digitos
 * Sem token: https://www.receitaws.com.br/v1/cnpj/{cnpj} (cota pública).
 * Com token (conta ReceitaWS): https://www.receitaws.com.br/v1/cnpj/{cnpj}/days/{dias} + Authorization: Bearer …
 * Variáveis: RECEITAWS_API_TOKEN (obrigatória para rota autenticada); RECEITAWS_CACHE_DAYS (1–30, default 3).
 */
const apenasDigitos = (v) => String(v || '').replace(/\D/g, '')

const formatarCep = (cepDigits) => {
    const c = apenasDigitos(cepDigits)
    if (c.length !== 8) return String(cepDigits || '').trim()
    return `${c.slice(0, 5)}-${c.slice(5)}`
}

const montarEnderecoReceitaWs = (d) => {
    const logradouro = d.logradouro || ''
    const numero = d.numero || ''
    const complemento = d.complemento || ''
    const bairro = d.bairro || ''
    const municipio = d.municipio || ''
    const uf = d.uf || ''
    const cepDigits = apenasDigitos(d.cep || '')
    const cepLabel = cepDigits ? formatarCep(cepDigits) : String(d.cep || '').trim()
    const partes = [
        [logradouro, numero].filter(Boolean).join(', '),
        complemento,
        bairro,
        [municipio, uf].filter(Boolean).join(' – '),
        cepLabel ? `CEP ${cepLabel}` : '',
    ].filter(Boolean)
    return partes.join(' — ')
}

/** Normaliza JSON v1 da ReceitaWS. */
const normalizarResposta = (data) => {
    if (!data || typeof data !== 'object') return null
    const razaoSocial = String(data.nome || '').trim()
    const enderecoCompleto = montarEnderecoReceitaWs(data).trim()
    return {
        razaoSocial,
        logradouro: data.logradouro || '',
        numero: data.numero || '',
        complemento: data.complemento || '',
        bairro: data.bairro || '',
        municipio: data.municipio || '',
        uf: data.uf || '',
        cep: apenasDigitos(data.cep || ''),
        enderecoCompleto,
    }
}

const clampDays = (raw) => {
    let n = parseInt(String(raw || '3'), 10)
    if (Number.isNaN(n)) n = 3
    if (n < 1) n = 1
    if (n > 30) n = 30
    return n
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const url = new URL(req.url || '/', 'http://localhost')
    const cnpj = apenasDigitos(url.searchParams.get('cnpj') || '')
    if (cnpj.length !== 14) {
        res.status(400).json({ error: 'Informe um CNPJ com 14 dígitos.' })
        return
    }

    const token = (process.env.RECEITAWS_API_TOKEN || '').trim()
    const days = clampDays(process.env.RECEITAWS_CACHE_DAYS)

    const headers = { Accept: 'application/json' }
    let upstreamUrl
    if (token) {
        headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
        upstreamUrl = `https://www.receitaws.com.br/v1/cnpj/${cnpj}/days/${days}`
    } else {
        upstreamUrl = `https://www.receitaws.com.br/v1/cnpj/${cnpj}`
    }

    try {
        const upstream = await fetch(upstreamUrl, { headers })
        const text = await upstream.text()

        let data
        try {
            data = JSON.parse(text)
        } catch {
            if (upstream.status === 401 || /unauthorized/i.test(text)) {
                res.status(502).json({
                    error: token
                        ? 'Token ReceitaWS inválido ou expirado (verifique RECEITAWS_API_TOKEN no .env.local).'
                        : 'ReceitaWS exigiu autenticação; defina RECEITAWS_API_TOKEN no .env.local.',
                })
                return
            }
            res.status(502).json({ error: 'Resposta inválida da ReceitaWS.' })
            return
        }

        if (!upstream.ok) {
            const msg =
                typeof data?.message === 'string'
                    ? data.message
                    : 'Consulta indisponível na ReceitaWS.'
            res.status(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502).json({ error: msg })
            return
        }

        if (data.status === 'ERROR') {
            res.status(404).json({
                error: typeof data.message === 'string' ? data.message : 'CNPJ não encontrado ou inválido.',
            })
            return
        }

        if (data.status !== 'OK') {
            res.status(502).json({
                error: typeof data.message === 'string' ? data.message : 'Resposta inesperada da ReceitaWS.',
            })
            return
        }

        const out = normalizarResposta(data)
        if (!out?.razaoSocial) {
            res.status(404).json({ error: 'CNPJ sem razão social na resposta da ReceitaWS.' })
            return
        }

        res.status(200).json(out)
    } catch (e) {
        res.status(502).json({ error: e?.message || 'Falha ao consultar a ReceitaWS.' })
    }
}
