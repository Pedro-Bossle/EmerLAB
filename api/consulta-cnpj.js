/**
 * Proxy Brasil API (evita CORS no browser). GET /api/consulta-cnpj?cnpj=14digitos
 * Upstream: https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 * Cache em memória: CNPJ_CACHE_DAYS ou RECEITAWS_CACHE_DAYS (legado), default 3.
 */
const apenasDigitos = (v) => String(v || '').replace(/\D/g, '')

const BRASIL_API_CNPJ_BASE =
    (process.env.BRASILAPI_CNPJ_URL || 'https://brasilapi.com.br/api/cnpj/v1').replace(/\/$/, '')

const UPSTREAM_HEADERS = {
    Accept: 'application/json',
    'User-Agent':
        process.env.BRASILAPI_USER_AGENT ||
        'EmerdogSFSC/1.0 (consulta-cnpj; +https://www.emerdog.com.br)',
}

/** Cache em memória do processo (Vercel: reutilizado enquanto a instância estiver quente). */
const cacheServidor = new Map()
/** @type {Map<string, Promise<object>>} */
const emVooServidor = new Map()

const formatarCep = (cepDigits) => {
    const c = apenasDigitos(cepDigits)
    if (c.length !== 8) return String(cepDigits || '').trim()
    return `${c.slice(0, 5)}-${c.slice(5)}`
}

const montarEnderecoBrasilApi = (d) => {
    const logradouro = String(d.logradouro || '').trim()
    const numero = String(d.numero || '').trim()
    const complemento = String(d.complemento || '').trim()
    const bairro = String(d.bairro || '').trim()
    const municipio = String(d.municipio || '').trim()
    const uf = String(d.uf || '').trim()
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

/** Normaliza JSON v1 da Brasil API para o contrato interno do app. */
const normalizarResposta = (data) => {
    if (!data || typeof data !== 'object') return null
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

function diasCacheEnv() {
    return clampDays(process.env.CNPJ_CACHE_DAYS || process.env.RECEITAWS_CACHE_DAYS)
}

const cacheTtlMs = (days) => days * 24 * 60 * 60 * 1000

function lerCacheServidor(cnpj) {
    const hit = cacheServidor.get(cnpj)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
        cacheServidor.delete(cnpj)
        return null
    }
    return hit.payload
}

function gravarCacheServidor(cnpj, payload, days) {
    cacheServidor.set(cnpj, {
        payload,
        expiresAt: Date.now() + cacheTtlMs(days),
    })
}

function mensagemIndicaLimite(status, data, text) {
    if (status === 429) return true
    const msg = String(data?.message || text || '').toLowerCase()
    return /too many|rate limit|limite|throttl/.test(msg)
}

async function consultarBrasilApi(cnpj) {
    const upstreamUrl = `${BRASIL_API_CNPJ_BASE}/${cnpj}`
    const upstream = await fetch(upstreamUrl, { headers: UPSTREAM_HEADERS })
    const text = await upstream.text()

    let data
    try {
        data = JSON.parse(text)
    } catch {
        const err = new Error('Resposta inválida da Brasil API.')
        err.status = 502
        throw err
    }

    if (mensagemIndicaLimite(upstream.status, data, text)) {
        const err = new Error(
            data?.message || 'Limite de consultas na Brasil API. Aguarde um pouco ou reutilize um CNPJ já buscado.',
        )
        err.status = 429
        err.limite = true
        throw err
    }

    if (upstream.status === 404 || data?.type === 'not_found') {
        const err = new Error(
            typeof data?.message === 'string' ? data.message : 'CNPJ não encontrado ou inválido.',
        )
        err.status = 404
        throw err
    }

    if (!upstream.ok) {
        const msg =
            upstream.status === 403
                ? 'Brasil API recusou a consulta (403). Tente novamente em instantes.'
                : typeof data?.message === 'string'
                  ? data.message
                  : 'Consulta indisponível na Brasil API.'
        const err = new Error(msg)
        err.status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502
        throw err
    }

    const out = normalizarResposta(data)
    if (!out?.razaoSocial) {
        const err = new Error('CNPJ sem razão social na resposta da Brasil API.')
        err.status = 404
        throw err
    }

    return out
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

    const days = diasCacheEnv()
    const forcar = url.searchParams.get('refresh') === '1'

    if (!forcar) {
        const emCache = lerCacheServidor(cnpj)
        if (emCache) {
            res.setHeader('X-Consulta-CNPJ-Cache', 'hit')
            res.status(200).json(emCache)
            return
        }
        const pendente = emVooServidor.get(cnpj)
        if (pendente) {
            try {
                const out = await pendente
                res.setHeader('X-Consulta-CNPJ-Cache', 'dedupe')
                res.status(200).json(out)
                return
            } catch (e) {
                res.status(e.status || 502).json({ error: e.message || 'Falha na consulta CNPJ.' })
                return
            }
        }
    }

    const tarefa = consultarBrasilApi(cnpj)
    emVooServidor.set(cnpj, tarefa)

    try {
        const out = await tarefa
        gravarCacheServidor(cnpj, out, days)
        res.setHeader('X-Consulta-CNPJ-Cache', 'miss')
        res.setHeader('X-Consulta-CNPJ-Provider', 'brasilapi')
        res.status(200).json(out)
    } catch (e) {
        const stale = lerCacheServidor(cnpj)
        if (e.limite && stale) {
            res.setHeader('X-Consulta-CNPJ-Cache', 'stale')
            res.status(200).json(stale)
            return
        }
        res.status(e.status || 502).json({ error: e?.message || 'Falha ao consultar a Brasil API.' })
    } finally {
        if (emVooServidor.get(cnpj) === tarefa) emVooServidor.delete(cnpj)
    }
}
