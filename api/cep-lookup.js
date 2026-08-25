/**
 * Proxy ViaCEP. GET /api/cep-lookup?cep=8digitos
 * Público (formulário de credenciamento) — rate limit por IP.
 */
import { getClientIp } from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'

const apenasDigitos = (v) => String(v || '').replace(/\D/g, '')

const formatarCep = (cepDigits) => {
    const c = apenasDigitos(cepDigits)
    if (c.length !== 8) return String(cepDigits || '').trim()
    return `${c.slice(0, 5)}-${c.slice(5)}`
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    const ip = getClientIp(req)
    if (!aplicarRateLimit(res, `cep:${ip}`, RATE_LIMITS.cep)) return

    const url = new URL(req.url || '/', 'http://localhost')
    const cep = apenasDigitos(url.searchParams.get('cep') || '')
    if (cep.length !== 8) {
        res.status(400).json({ error: 'Informe um CEP com 8 dígitos.' })
        return
    }

    try {
        const upstream = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            headers: { Accept: 'application/json' },
        })
        const data = await upstream.json()
        if (!upstream.ok) {
            res.status(upstream.status).json({ error: 'Falha ao consultar ViaCEP.' })
            return
        }
        if (data?.erro) {
            res.status(404).json({ error: 'CEP não encontrado.' })
            return
        }

        res.status(200).json({
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
        res.status(502).json({ error: e?.message || 'Falha na consulta de CEP.' })
    }
}
