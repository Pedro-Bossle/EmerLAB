import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { hashChave } from './chaves.js'

const db = { chaves: [], consultas: 0, atualizacoes: [] }
const sessao = { jwt: null }

const admin = {
    from: (nome) => {
        if (nome !== 'api_chaves') throw new Error('tabela inesperada ' + nome)
        const filtros = []
        let modo = 'select'
        let payload = null
        const executar = () => {
            const achadas = db.chaves.filter((r) => filtros.every((f) => f(r)))
            if (modo === 'update') {
                achadas.forEach((r) => Object.assign(r, payload))
                db.atualizacoes.push(...achadas.map((r) => r.id))
                return achadas
            }
            db.consultas += 1
            return achadas
        }
        const b = {
            select: () => b,
            update: (p) => ((modo = 'update'), (payload = p), b),
            eq: (k, v) => (filtros.push((r) => r[k] === v), b),
            is: (k, v) => (filtros.push((r) => (r[k] ?? null) === v), b),
            maybeSingle: async () => {
                const l = executar()[0]
                return { data: l ? { ...l } : null, error: null }
            },
            then: (res, rej) => Promise.resolve({ data: executar(), error: null }).then(res, rej),
        }
        return b
    },
}

vi.mock('../api/serverAuth.js', () => ({
    createSupabaseAdminClient: () => admin,
    getClientIp: () => '1.2.3.4',
    readJsonBodyLimited: async (req) => req.body ?? {},
    responderSePayloadGrande: () => false,
    validarJwtComPermissao: async () => sessao.jwt,
}))

const CHAVE = 'emer_rede_abc123'
const ORIGEM = 'https://cliente.exemplo.com'

function linha(extra = {}) {
    return {
        id: 'k1',
        nome: 'Chave teste',
        prefixo: 'emer_red',
        hash: hashChave(CHAVE),
        escopos: ['rede:ler'],
        origens_permitidas: [ORIGEM],
        limite_por_minuto: 60,
        ips_permitidos: [],
        expira_em: null,
        revogada_em: null,
        ultimo_uso_em: null,
        ...extra,
    }
}

const pedido = (extra = {}) => ({
    metodo: 'GET',
    caminho: '/rede/ping',
    query: {},
    headers: { authorization: `Bearer ${CHAVE}`, origin: ORIGEM },
    body: {},
    ip: '1.2.3.4',
    ...extra,
})

let mod

beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    vi.resetModules()
    db.chaves = [linha()]
    db.consultas = 0
    db.atualizacoes = []
    sessao.jwt = null
    mod = await import('../../../api/_lib/apiV1/roteador.js')
    mod.registrarRota('GET', '/rede/ping', 'rede:ler', async (ctx) => ({ corpo: { ok: true, params: ctx.params, q: ctx.query } }))
    mod.registrarRota('GET', '/rede/itens/{id}', 'rede:ler', async (ctx) => ({ corpo: { id: ctx.params.id } }))
    mod.registrarRota('GET', '/rede/falha', 'rede:ler', async () => {
        throw new Error('segredo interno')
    })
    mod.registrarRota('GET', '/rede/erro', 'rede:ler', async () => {
        throw new mod.ErroApi(422, 'dados_invalidos', 'Dados inválidos.')
    })
    mod.registrarRota('POST', '/admin/chaves', 'jwt:access.manage', async (ctx) => ({
        status: 201,
        corpo: { usuario: ctx.usuario, chave: ctx.chave },
    }))
})

afterEach(() => vi.useRealTimers())

describe('autenticação por chave', () => {
    it('sem chave: 401 chave_invalida', async () => {
        const r = await mod.processarRequisicao(pedido({ headers: { origin: ORIGEM } }))
        expect(r.status).toBe(401)
        expect(r.corpo.erro.codigo).toBe('chave_invalida')
    })

    it('chave desconhecida: mesmo 401', async () => {
        const r = await mod.processarRequisicao(pedido({ headers: { 'x-api-key': 'emer_rede_nada', origin: ORIGEM } }))
        expect(r.status).toBe(401)
        expect(r.corpo.erro.codigo).toBe('chave_invalida')
    })

    it('aceita X-Api-Key e Bearer', async () => {
        const a = await mod.processarRequisicao(pedido({ headers: { 'x-api-key': CHAVE, origin: ORIGEM } }))
        const b = await mod.processarRequisicao(pedido())
        expect(a.status).toBe(200)
        expect(b.status).toBe(200)
    })

    it('rota inexistente com chave válida: 404 rota_nao_encontrada', async () => {
        const r = await mod.processarRequisicao(pedido({ caminho: '/rede/nada' }))
        expect(r.status).toBe(404)
        expect(r.corpo.erro.codigo).toBe('rota_nao_encontrada')
    })

    it('escopo insuficiente: 403 vindo de autorizarChave', async () => {
        db.chaves = [linha({ escopos: ['pagamentos:ler'] })]
        const r = await mod.processarRequisicao(pedido())
        expect(r.status).toBe(403)
        expect(r.corpo.erro.codigo).toBe('escopo_insuficiente')
    })

    it('normaliza /v1 e /api/v1, extrai parâmetros {id}', async () => {
        for (const caminho of ['/v1/rede/itens/42', '/api/v1/rede/itens/42', 'rede/itens/42']) {
            const r = await mod.processarRequisicao(pedido({ caminho }))
            expect(r.corpo).toEqual({ id: '42' })
        }
    })

    it('ErroApi vira JSON de erro; erro desconhecido vira 500 sem detalhe', async () => {
        const e = await mod.processarRequisicao(pedido({ caminho: '/rede/erro' }))
        expect(e.status).toBe(422)
        expect(e.corpo.erro.codigo).toBe('dados_invalidos')
        const f = await mod.processarRequisicao(pedido({ caminho: '/rede/falha' }))
        expect(f.status).toBe(500)
        expect(f.corpo.erro.codigo).toBe('erro_interno')
        expect(JSON.stringify(f.corpo)).not.toContain('segredo')
    })
})

describe('CORS', () => {
    const preflight = (origin) => ({
        metodo: 'OPTIONS',
        caminho: '/rede/ping',
        query: {},
        headers: { origin, 'access-control-request-method': 'GET' },
        body: {},
        ip: '1.2.3.4',
    })

    it('OPTIONS com origem permitida: 204 e Allow-Origin igual', async () => {
        const r = await mod.processarRequisicao(preflight(ORIGEM))
        expect(r.status).toBe(204)
        expect(r.headers['Access-Control-Allow-Origin']).toBe(ORIGEM)
    })

    it('OPTIONS com origem não permitida: sem Allow-Origin', async () => {
        const r = await mod.processarRequisicao(preflight('https://malvado.example'))
        expect(r.status).toBe(204)
        expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined()
    })

    it('resposta normal inclui Allow-Origin da origem permitida', async () => {
        const r = await mod.processarRequisicao(pedido())
        expect(r.headers['Access-Control-Allow-Origin']).toBe(ORIGEM)
    })
})

describe('limite por minuto', () => {
    it('estourou: 429 com Retry-After e X-RateLimit-Remaining 0', async () => {
        db.chaves = [linha({ limite_por_minuto: 2 })]
        const a = await mod.processarRequisicao(pedido())
        expect(a.headers['X-RateLimit-Remaining']).toBe('1')
        await mod.processarRequisicao(pedido())
        const r = await mod.processarRequisicao(pedido())
        expect(r.status).toBe(429)
        expect(r.headers['Retry-After']).toBeDefined()
        expect(r.headers['X-RateLimit-Remaining']).toBe('0')
        expect(r.corpo.erro.codigo).toBe('limite_excedido')
    })
})

describe('cache e ultimo_uso_em', () => {
    it('atualiza ultimo_uso_em no máximo 1 vez por minuto por chave', async () => {
        await mod.processarRequisicao(pedido())
        await mod.processarRequisicao(pedido())
        await mod.processarRequisicao(pedido())
        expect(db.atualizacoes).toHaveLength(1)
        vi.setSystemTime(new Date('2026-11-10T12:01:01Z'))
        await mod.processarRequisicao(pedido())
        expect(db.atualizacoes).toHaveLength(2)
    })

    it('chave revogada só é recusada após expirar o cache de 30 s', async () => {
        expect((await mod.processarRequisicao(pedido())).status).toBe(200)
        db.chaves[0].revogada_em = '2026-11-10T12:00:05Z'
        vi.setSystemTime(new Date('2026-11-10T12:00:20Z'))
        expect((await mod.processarRequisicao(pedido())).status).toBe(200)
        vi.setSystemTime(new Date('2026-11-10T12:00:31Z'))
        const r = await mod.processarRequisicao(pedido())
        expect(r.status).toBe(401)
        expect(r.corpo.erro.codigo).toBe('chave_invalida')
    })
})

describe('rotas com escopo jwt:access.manage', () => {
    const req = () => pedido({ metodo: 'POST', caminho: '/admin/chaves', headers: { authorization: 'Bearer jwt' } })

    it('sem JWT válido: 401', async () => {
        sessao.jwt = { error: 'Sessão inválida.', status: 401 }
        expect((await mod.processarRequisicao(req())).status).toBe(401)
    })

    it('JWT sem access.manage: 403', async () => {
        sessao.jwt = { error: 'Sem permissão para esta operação.', status: 403 }
        expect((await mod.processarRequisicao(req())).status).toBe(403)
    })

    it('com permissão: executa com ctx.usuario e ctx.chave nulo', async () => {
        sessao.jwt = { user: { id: 'u1', email: 'a@b.c', extra: 'x' }, profile: {} }
        const r = await mod.processarRequisicao(req())
        expect(r.status).toBe(201)
        expect(r.corpo).toEqual({ usuario: { id: 'u1', email: 'a@b.c' }, chave: null })
    })
})

describe('handler HTTP', () => {
    function resFalso() {
        const res = {
            codigo: 200,
            headers: {},
            corpo: undefined,
            setHeader: (k, v) => (res.headers[k] = v),
            status: (c) => ((res.codigo = c), res),
            json: (c) => ((res.corpo = c), res),
            end: () => res,
        }
        return res
    }

    it('devolve o mesmo status e corpo que processarRequisicao', async () => {
        const direto = await mod.processarRequisicao(pedido({ caminho: '/rede/itens/7' }))
        const res = resFalso()
        await mod.default(
            {
                method: 'GET',
                url: '/api/email?_fn=api-v1&_path=rede%2Fitens%2F7',
                headers: { authorization: `Bearer ${CHAVE}`, origin: ORIGEM },
            },
            res,
        )
        expect(res.codigo).toBe(direto.status)
        expect(res.corpo).toEqual(direto.corpo)
        expect(res.headers['Access-Control-Allow-Origin']).toBe(ORIGEM)
        expect(res.headers['X-RateLimit-Limit']).toBeDefined()
    })

    it('OPTIONS responde 204 sem corpo', async () => {
        const res = resFalso()
        await mod.default(
            {
                method: 'OPTIONS',
                url: '/api/email?_fn=api-v1&_path=rede%2Fping',
                headers: { origin: ORIGEM },
            },
            res,
        )
        expect(res.codigo).toBe(204)
        expect(res.headers['Access-Control-Allow-Origin']).toBe(ORIGEM)
    })
})
