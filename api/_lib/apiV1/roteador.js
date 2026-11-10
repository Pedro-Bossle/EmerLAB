/**
 * Roteador da API pública /api/v1 (docs/api/especificacao-design.md, seções 4, 5 e 9).
 *
 * `processarRequisicao` é o núcleo, sem req/res (a Task 6 o chama em processo);
 * `apiV1Handler` só adapta req/res. Os módulos de rotas se registram com `registrarRota`.
 * Erros de chave nunca revelam se a chave existe (desconhecida, revogada e expirada dão o mesmo 401).
 */
import { PERMISSION_KEYS } from '../../../src/lib/accessControl.js'
import { consumirRateLimit } from '../../../src/lib/api/rateLimit.js'
import {
    createSupabaseAdminClient,
    getClientIp,
    readJsonBodyLimited,
    validarJwtComPermissao,
} from '../../../src/lib/api/serverAuth.js'
import { autorizarChave, hashChave } from '../../../src/lib/apiV1/chaves.js'
import { MODULOS_DE_ROTAS } from './indiceRotas.js'

export const ESCOPO_JWT_ACCESS_MANAGE = 'jwt:access.manage'

const CACHE_TTL_MS = 30_000
const ULTIMO_USO_INTERVALO_MS = 60_000
const JANELA_LIMITE_MS = 60_000

export class ErroApi extends Error {
    constructor(status, codigo, mensagem) {
        super(mensagem || codigo)
        this.name = 'ErroApi'
        this.status = status
        this.codigo = codigo
    }
}

const rotas = []

/**
 * @param {string} metodo
 * @param {string} padrao ex.: '/rede/prestadores/{id}'
 * @param {string|null} escopo 'rede:ler' | 'pagamentos:ler' | 'pagamentos:escrever' | 'jwt:access.manage'
 * @param {(ctx: object) => Promise<{ status?: number, corpo: any, headers?: object }>} fn
 */
export function registrarRota(metodo, padrao, escopo, fn) {
    const nomes = []
    const fonte = padrao
        .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
        .replace(/\{(\w+)\}/g, (_, nome) => {
            nomes.push(nome)
            return '([^/]+)'
        })
    rotas.push({ metodo: String(metodo).toUpperCase(), regex: new RegExp(`^${fonte}/?$`), nomes, escopo, fn })
}

let modulosCarregados = null
function carregarModulos() {
    if (!modulosCarregados) {
        modulosCarregados = Promise.all(MODULOS_DE_ROTAS.map((carregar) => carregar())).catch((e) => {
            modulosCarregados = null
            throw e
        })
    }
    return modulosCarregados
}

function normalizarCaminho(caminho) {
    let c = String(caminho || '').split('?')[0].trim()
    c = '/' + c.replace(/^\/+/, '')
    c = c.replace(/^\/api\/v1(?=\/|$)/, '').replace(/^\/v1(?=\/|$)/, '')
    return c === '' ? '/' : c
}

function acharRota(metodo, caminho) {
    for (const rota of rotas) {
        if (rota.metodo !== metodo) continue
        const m = rota.regex.exec(caminho)
        if (!m) continue
        const params = {}
        rota.nomes.forEach((nome, i) => {
            try {
                params[nome] = decodeURIComponent(m[i + 1])
            } catch {
                params[nome] = m[i + 1]
            }
        })
        return { rota, params }
    }
    return null
}

const minusculas = (headers) =>
    Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]))

function respostaErro(status, codigo, mensagem, headers = {}) {
    return { status, headers, corpo: { erro: { codigo, mensagem } } }
}

const MENSAGENS = {
    chave_invalida: 'Chave de API ausente ou inválida.',
    escopo_insuficiente: 'A chave não tem o escopo necessário.',
    origem_nao_permitida: 'Origem não permitida para esta chave.',
    ip_nao_permitido: 'IP não permitido para esta chave.',
}

// ---- cache de chaves (em memória, 30 s, por hash) e de origens permitidas ----

const cacheChaves = new Map()
let cacheOrigens = { ate: 0, lista: new Set() }
const ultimoUsoGravado = new Map()

async function buscarChave(admin, hash) {
    const agora = Date.now()
    const hit = cacheChaves.get(hash)
    if (hit && hit.ate > agora) return hit.linha
    const { data, error } = await admin.from('api_chaves').select('*').eq('hash', hash).maybeSingle()
    if (error) throw error
    if (!data) {
        cacheChaves.delete(hash)
        return null
    }
    if (cacheChaves.size > 2000) cacheChaves.clear()
    cacheChaves.set(hash, { linha: data, ate: agora + CACHE_TTL_MS })
    return data
}

async function origemPermitidaEmAlgumaChave(admin, origem) {
    const agora = Date.now()
    if (cacheOrigens.ate <= agora) {
        const { data, error } = await admin.from('api_chaves').select('origens_permitidas').is('revogada_em', null)
        if (error) throw error
        const lista = new Set()
        for (const l of data || []) for (const o of l.origens_permitidas || []) lista.add(o)
        cacheOrigens = { ate: agora + CACHE_TTL_MS, lista }
    }
    return cacheOrigens.lista.has(origem)
}

function registrarUsoSePreciso(admin, linha) {
    const agora = Date.now()
    const ultimo = ultimoUsoGravado.get(linha.id) || 0
    if (agora - ultimo < ULTIMO_USO_INTERVALO_MS) return Promise.resolve()
    ultimoUsoGravado.set(linha.id, agora)
    return Promise.resolve(admin.from('api_chaves').update({ ultimo_uso_em: new Date(agora).toISOString() }).eq('id', linha.id))
        .then(() => undefined)
        .catch(() => undefined)
}

function extrairChave(headers) {
    const x = String(headers['x-api-key'] || '').trim()
    if (x) return x
    const auth = String(headers.authorization || '')
    if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
    return ''
}

const CORS_BASE = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Api-Key, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
}

async function nucleo({ metodo, caminho, query, headers, body, ip }, admin) {
    const rota = acharRota(metodo, caminho)
    const req = { method: metodo, headers, body, query }

    // Rotas administrativas autenticam por JWT do usuário (o Bearer é o JWT, não uma chave).
    if (rota && rota.rota.escopo === ESCOPO_JWT_ACCESS_MANAGE) {
        const aut = await validarJwtComPermissao(req, [PERMISSION_KEYS.ACCESS_MANAGE], { supabaseAdmin: admin })
        if (aut.error) {
            const status = aut.status === 403 ? 403 : 401
            return respostaErro(status, status === 403 ? 'sem_permissao' : 'nao_autenticado', aut.error)
        }
        const usuario = { id: aut.user.id, email: aut.user.email }
        const r = await rota.rota.fn({ admin, chave: null, usuario, params: rota.params, query, body, req })
        return { status: r?.status || 200, headers: r?.headers || {}, corpo: r?.corpo }
    }

    const chaveTexto = extrairChave(headers)
    if (!chaveTexto) return respostaErro(401, 'chave_invalida', MENSAGENS.chave_invalida)
    const linha = await buscarChave(admin, hashChave(chaveTexto))
    if (!linha) return respostaErro(401, 'chave_invalida', MENSAGENS.chave_invalida)

    if (!rota) {
        // Revogada/expirada nunca chega ao 404: o mesmo 401 de chave desconhecida.
        const base = autorizarChave(linha, { escopo: linha.escopos?.[0] || '', origem: '', ip, agora: new Date() })
        if (base.codigo === 'chave_invalida') return respostaErro(401, 'chave_invalida', MENSAGENS.chave_invalida)
        return respostaErro(404, 'rota_nao_encontrada', 'Rota não encontrada.')
    }

    const origem = String(headers.origin || '')
    const auth = autorizarChave(linha, { escopo: rota.rota.escopo, origem, ip, agora: new Date() })
    if (!auth.ok) return respostaErro(auth.status, auth.codigo, MENSAGENS[auth.codigo] || 'Acesso negado.')

    const limite = Number(linha.limite_por_minuto) > 0 ? Number(linha.limite_por_minuto) : 60
    const rl = consumirRateLimit(`apiv1:${linha.id}`, { limit: limite, windowMs: JANELA_LIMITE_MS })
    const cabecalhosLimite = {
        'X-RateLimit-Limit': String(limite),
        'X-RateLimit-Remaining': String(rl.remaining),
    }
    if (!rl.ok) {
        return respostaErro(429, 'limite_excedido', 'Limite de requisições por minuto excedido.', {
            ...cabecalhosLimite,
            'Retry-After': String(rl.retryAfterSec),
        })
    }

    await registrarUsoSePreciso(admin, linha)
    const r = await rota.rota.fn({ admin, chave: linha, params: rota.params, query, body, req })
    return { status: r?.status || 200, headers: { ...cabecalhosLimite, ...(r?.headers || {}) }, corpo: r?.corpo }
}

export async function processarRequisicao({ metodo, caminho, query = {}, headers = {}, body = {}, ip = '' } = {}) {
    const m = String(metodo || 'GET').toUpperCase()
    const h = minusculas(headers)
    const cam = normalizarCaminho(caminho)
    let admin
    let resultado
    try {
        admin = createSupabaseAdminClient()
        await carregarModulos()
        if (m === 'OPTIONS') {
            resultado = { status: 204, headers: {}, corpo: undefined }
        } else {
            resultado = await nucleo({ metodo: m, caminho: cam, query, headers: h, body, ip }, admin)
        }
    } catch (e) {
        if (e instanceof ErroApi) resultado = respostaErro(e.status, e.codigo, e.message)
        else {
            console.error('[api-v1] erro interno:', e?.message || 'desconhecido')
            resultado = respostaErro(500, 'erro_interno', 'Erro interno.')
        }
    }

    const origem = String(h.origin || '')
    if (origem && admin) {
        try {
            if (await origemPermitidaEmAlgumaChave(admin, origem)) {
                resultado.headers = {
                    ...resultado.headers,
                    ...CORS_BASE,
                    'Access-Control-Allow-Origin': origem,
                    'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining',
                }
            }
        } catch {
            /* sem CORS se não for possível consultar */
        }
    }
    return resultado
}

export default async function apiV1Handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const query = {}
    for (const [k, v] of url.searchParams.entries()) {
        if (k === '_fn' || k === '_path') continue
        query[k] = v
    }
    const metodo = String(req.method || 'GET').toUpperCase()
    let body = {}
    if (metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS') {
        try {
            body = await readJsonBodyLimited(req)
        } catch (e) {
            const grande = e?.code === 'PAYLOAD_TOO_LARGE' || e?.message === 'payload_too_large'
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            return res
                .status(grande ? 413 : 400)
                .json({ erro: { codigo: grande ? 'payload_grande' : 'corpo_invalido', mensagem: 'Corpo inválido.' } })
        }
    }
    const r = await processarRequisicao({
        metodo,
        caminho: url.searchParams.get('_path') || '/',
        query,
        headers: req.headers || {},
        body,
        ip: getClientIp(req),
    })
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v)
    if (r.status === 204 || r.corpo === undefined) {
        res.status(r.status)
        return res.end()
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(r.status).json(r.corpo)
}
