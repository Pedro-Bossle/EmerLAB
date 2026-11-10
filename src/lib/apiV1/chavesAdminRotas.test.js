import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashChave } from './chaves.js'

const ORIGEM = 'https://site.exemplo.com.br'
const db = { api_chaves: [], audit_logs: [] }
const sessao = { jwt: null }
let sequencia = 0

function tabela(nome) {
    if (!(nome in db)) throw new Error('tabela inesperada ' + nome)
    const filtros = []
    let modo = 'select'
    let payload = null
    let ordem = null
    const executar = () => {
        if (modo === 'insert') {
            const linha = {
                id: `k${++sequencia}`,
                criada_em: new Date().toISOString(),
                ultimo_uso_em: null,
                revogada_em: null,
                ...payload,
            }
            db[nome].push(linha)
            return [linha]
        }
        let achadas = db[nome].filter((r) => filtros.every((f) => f(r)))
        if (modo === 'delete') db[nome] = db[nome].filter((r) => !achadas.includes(r))
        if (modo === 'update') {
            achadas.forEach((r) => Object.assign(r, payload))
        }
        if (ordem) achadas = [...achadas].sort((a, b) => (String(a[ordem]) < String(b[ordem]) ? 1 : -1))
        return achadas.map((r) => ({ ...r }))
    }
    const b = {
        select: () => b,
        insert: (p) => ((modo = 'insert'), (payload = p), b),
        update: (p) => ((modo = 'update'), (payload = p), b),
        delete: () => ((modo = 'delete'), b),
        eq: (k, v) => (filtros.push((r) => r[k] === v), b),
        is: (k, v) => (filtros.push((r) => (r[k] ?? null) === v), b),
        order: (k) => ((ordem = k), b),
        maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
        single: async () => ({ data: executar()[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve({ data: executar(), error: null }).then(res, rej),
    }
    return b
}
const admin = { from: tabela }

vi.mock('../api/serverAuth.js', () => ({
    createSupabaseAdminClient: () => admin,
    getClientIp: () => '1.2.3.4',
    validarJwtComPermissao: async () => sessao.jwt,
}))

const ADMIN = { user: { id: 'u-admin', email: 'admin@emerlab.com' } }
const JWT = { authorization: 'Bearer jwt-do-usuario' }

let mod

const chamar = (metodo, caminho, body = {}, query = {}) =>
    mod.processarRequisicao({ metodo, caminho, query, headers: { ...JWT }, body, ip: '9.9.9.9' })
const criarRede = async (extra = {}) =>
    chamar('POST', '/admin/chaves', { nome: 'Site', tipo: 'rede', origens_permitidas: [ORIGEM], ...extra })

beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    vi.resetModules()
    db.api_chaves = []
    db.audit_logs = []
    sequencia = 0
    sessao.jwt = ADMIN
    mod = await import('../../../api/_lib/apiV1/roteador.js')
    // Rotas de teste registradas antes das reais: ganham na busca.
    mod.registrarRota('GET', '/rede/filtros', 'rede:ler', async () => ({ corpo: { planos: ['x'] } }))
    mod.registrarRota('POST', '/pagamentos/registros/{id}/pago', 'pagamentos:escrever', async (ctx) => ({
        corpo: { gravou: ctx.params.id, chave: ctx.chave.prefixo },
    }))
})

afterEach(() => vi.useRealTimers())

describe('permissão', () => {
    it('sem access.manage: 403 em todas as rotas /admin/*', async () => {
        sessao.jwt = { error: 'Sem permissão', status: 403 }
        const rotas = [
            ['POST', '/admin/chaves'],
            ['GET', '/admin/chaves'],
            ['PATCH', '/admin/chaves/k1'],
            ['POST', '/admin/chaves/k1/revogar'],
            ['POST', '/admin/chaves/k1/girar'],
            ['POST', '/admin/testar'],
        ]
        for (const [m, c] of rotas) {
            const r = await chamar(m, c)
            expect(r.status, `${m} ${c}`).toBe(403)
        }
        expect(db.api_chaves).toHaveLength(0)
    })

    it('sem sessão: 401', async () => {
        sessao.jwt = { error: 'Token inválido', status: 401 }
        expect((await chamar('GET', '/admin/chaves')).status).toBe(401)
    })
})

describe('POST /admin/chaves', () => {
    it('rede sem origens_permitidas: 400', async () => {
        const r = await chamar('POST', '/admin/chaves', { nome: 'Site', escopos: ['rede:ler'] })
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('origens_obrigatorias')
        expect(db.api_chaves).toHaveLength(0)
    })

    it('pagamentos com origens: 400', async () => {
        const r = await chamar('POST', '/admin/chaves', {
            nome: 'ERP',
            escopos: ['pagamentos:ler', 'pagamentos:escrever'],
            origens_permitidas: [ORIGEM],
        })
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('origens_nao_permitidas')
    })

    it('cria devolvendo a chave completa uma vez; grava só o hash', async () => {
        const r = await criarRede()
        expect(r.status).toBe(201)
        expect(r.corpo.chave).toMatch(/^emer_rede_[A-Za-z0-9]{32}$/)
        expect(r.corpo.registro).toMatchObject({ nome: 'Site', escopos: ['rede:ler'], limite_por_minuto: 120, estado: 'ativa' })
        expect(r.corpo.registro.hash).toBeUndefined()
        const linha = db.api_chaves[0]
        expect(linha.hash).toBe(hashChave(r.corpo.chave))
        expect(linha.prefixo).toBe(r.corpo.chave.slice(0, 8))
        expect(linha.criada_por).toBe('u-admin')
        expect(JSON.stringify(linha)).not.toContain(r.corpo.chave)
    })

    it('o GET seguinte não contém chave nem hash', async () => {
        const c = await criarRede()
        const r = await chamar('GET', '/admin/chaves')
        expect(r.status).toBe(200)
        expect(r.corpo).toHaveLength(1)
        const texto = JSON.stringify(r.corpo)
        expect(texto).not.toContain(c.corpo.chave)
        expect(texto).not.toContain(hashChave(c.corpo.chave))
        expect(texto).not.toContain('"hash"')
        expect(r.corpo[0]).toMatchObject({ nome: 'Site', prefixo: c.corpo.chave.slice(0, 8), estado: 'ativa' })
    })

    it('chave de pagamentos usa o prefixo emer_pag_ e limite 60', async () => {
        const r = await chamar('POST', '/admin/chaves', { nome: 'ERP', tipo: 'pagamentos', escopos: ['pagamentos:ler'] })
        expect(r.status).toBe(201)
        expect(r.corpo.chave.startsWith('emer_pag_')).toBe(true)
        expect(r.corpo.registro.limite_por_minuto).toBe(60)
    })

    it('grava auditoria sem a chave nem o hash', async () => {
        const r = await criarRede()
        expect(db.audit_logs).toHaveLength(1)
        const a = db.audit_logs[0]
        expect(a).toMatchObject({
            usuario_id: 'u-admin',
            usuario_nome: 'admin@emerlab.com',
            acao: 'API_CHAVE_CRIADA',
            tabela: 'api_chaves',
            registro_id: db.api_chaves[0].id,
            severidade: 'warning',
        })
        expect(a.valor_novo).toMatchObject({ nome: 'Site', prefixo: r.corpo.chave.slice(0, 8), escopos: ['rede:ler'] })
        const texto = JSON.stringify(a)
        expect(texto).not.toContain(r.corpo.chave)
        expect(texto).not.toContain(db.api_chaves[0].hash)
    })
})

describe('PATCH /admin/chaves/{id}', () => {
    it('edita, audita com valor antigo e novo', async () => {
        await criarRede()
        const id = db.api_chaves[0].id
        const r = await chamar('PATCH', `/admin/chaves/${id}`, { nome: 'Novo nome', limite_por_minuto: 30 })
        expect(r.status).toBe(200)
        expect(r.corpo).toMatchObject({ nome: 'Novo nome', limite_por_minuto: 30 })
        expect(db.api_chaves[0].nome).toBe('Novo nome')
        const a = db.audit_logs.at(-1)
        expect(a.acao).toBe('API_CHAVE_EDITADA')
        expect(a.valor_antigo.nome).toBe('Site')
        expect(a.valor_novo.nome).toBe('Novo nome')
    })

    it('validação, inexistente e revogada', async () => {
        await criarRede()
        const id = db.api_chaves[0].id
        expect((await chamar('PATCH', `/admin/chaves/${id}`, { origens_permitidas: [] })).status).toBe(400)
        expect((await chamar('PATCH', '/admin/chaves/nao-existe', { nome: 'x' })).status).toBe(404)
        await chamar('POST', `/admin/chaves/${id}/revogar`)
        const r = await chamar('PATCH', `/admin/chaves/${id}`, { nome: 'x' })
        expect(r.status).toBe(409)
        expect(r.corpo.erro.codigo).toBe('chave_revogada')
    })
})

describe('revogar', () => {
    it('define revogada_em, audita, e a chave falha em /rede/filtros após o cache de 30 s', async () => {
        const c = await criarRede()
        const usar = () =>
            mod.processarRequisicao({
                metodo: 'GET',
                caminho: '/rede/filtros',
                headers: { authorization: `Bearer ${c.corpo.chave}`, origin: ORIGEM },
                ip: '1.2.3.4',
            })
        expect((await usar()).status).toBe(200)

        const id = db.api_chaves[0].id
        const r = await chamar('POST', `/admin/chaves/${id}/revogar`)
        expect(r.status).toBe(200)
        expect(r.corpo.estado).toBe('revogada')
        expect(db.api_chaves[0].revogada_em).toBe('2026-11-10T12:00:00.000Z')
        expect(db.audit_logs.at(-1).acao).toBe('API_CHAVE_REVOGADA')

        vi.advanceTimersByTime(31_000)
        const depois = await usar()
        expect(depois.status).toBe(401)
    })

    it('inexistente 404; já revogada 409', async () => {
        expect((await chamar('POST', '/admin/chaves/xyz/revogar')).status).toBe(404)
        await criarRede()
        const id = db.api_chaves[0].id
        await chamar('POST', `/admin/chaves/${id}/revogar`)
        const r = await chamar('POST', `/admin/chaves/${id}/revogar`)
        expect(r.status).toBe(409)
    })
})

describe('girar', () => {
    it('cria chave nova igual, revoga a antiga e audita', async () => {
        const antiga = await criarRede({ limite_por_minuto: 77, ips_permitidos: ['10.0.0.1'], expira_em: '2027-01-01T00:00:00Z' })
        const idAntigo = db.api_chaves[0].id
        const r = await chamar('POST', `/admin/chaves/${idAntigo}/girar`)
        expect(r.status).toBe(201)
        expect(r.corpo.chave).toMatch(/^emer_rede_/)
        expect(r.corpo.chave).not.toBe(antiga.corpo.chave)
        expect(db.api_chaves).toHaveLength(2)
        const [velha, nova] = db.api_chaves
        expect(velha.revogada_em).toBeTruthy()
        expect(nova.revogada_em).toBeNull()
        expect(nova).toMatchObject({
            nome: 'Site',
            escopos: ['rede:ler'],
            origens_permitidas: [ORIGEM],
            limite_por_minuto: 77,
            ips_permitidos: ['10.0.0.1'],
            expira_em: '2027-01-01T00:00:00.000Z',
            criada_por: 'u-admin',
        })
        expect(nova.hash).toBe(hashChave(r.corpo.chave))
        const a = db.audit_logs.at(-1)
        expect(a.acao).toBe('API_CHAVE_GIRADA')
        expect(JSON.stringify(a)).not.toContain(r.corpo.chave)
    })

    it('não gira chave revogada nem inexistente', async () => {
        await criarRede()
        const id = db.api_chaves[0].id
        await chamar('POST', `/admin/chaves/${id}/revogar`)
        expect((await chamar('POST', `/admin/chaves/${id}/girar`)).status).toBe(409)
        expect((await chamar('POST', '/admin/chaves/xyz/girar')).status).toBe(404)
        expect(db.api_chaves).toHaveLength(1)
    })
})

describe('POST /admin/testar', () => {
    const testar = (extra = {}) =>
        chamar('POST', '/admin/testar', { metodo: 'GET', caminho: '/rede/filtros', origem: ORIGEM, ...extra })

    it('GET com chave válida: HTTP 200 com status 200 e o corpo', async () => {
        const c = await criarRede()
        const r = await testar({ chave: c.corpo.chave })
        expect(r.status).toBe(200)
        expect(r.corpo.status).toBe(200)
        expect(r.corpo.corpo).toEqual({ planos: ['x'] })
        expect(typeof r.corpo.duracao_ms).toBe('number')
        expect(r.corpo.headers['x-ratelimit-limit']).toBe('120')
        expect(r.corpo.headers['x-ratelimit-remaining']).toBeDefined()
    })

    it('chave inválida: HTTP 200 com status 401 dentro do resultado', async () => {
        const r = await testar({ chave: 'emer_rede_invalida' })
        expect(r.status).toBe(200)
        expect(r.corpo.status).toBe(401)
        expect(r.corpo.corpo.erro.codigo).toBe('chave_invalida')
        expect(JSON.stringify(r.corpo)).not.toContain('emer_rede_invalida')
    })

    it('origem fora da lista: status 403; sem origem também', async () => {
        const c = await criarRede()
        const a = await testar({ chave: c.corpo.chave, origem: 'https://outro.com' })
        expect(a.status).toBe(200)
        expect(a.corpo.status).toBe(403)
        const b = await testar({ chave: c.corpo.chave, origem: '' })
        expect(b.corpo.status).toBe(403)
    })

    it('método de escrita sem confirmar_escrita: 400; com confirmação executa', async () => {
        const c = await chamar('POST', '/admin/chaves', { nome: 'ERP', tipo: 'pagamentos', escopos: ['pagamentos:escrever'] })
        const corpo = { chave: c.corpo.chave, metodo: 'POST', caminho: '/pagamentos/registros/42/pago', origem: '' }
        const sem = await chamar('POST', '/admin/testar', corpo)
        expect(sem.status).toBe(400)
        expect(sem.corpo.erro.codigo).toBe('confirmacao_necessaria')
        const com = await chamar('POST', '/admin/testar', { ...corpo, confirmar_escrita: true })
        expect(com.status).toBe(200)
        expect(com.corpo.status).toBe(200)
        expect(com.corpo.corpo.gravou).toBe('42')
    })

    it('caminho inválido: 400; nunca alcança /admin', async () => {
        const c = await criarRede()
        for (const caminho of ['/admin/chaves', '/v1/admin/chaves', '/api/v1/admin/chaves', '/qualquer', '/rede/../admin/chaves', '/rede/nao-existe', 'http://x.com/rede/filtros', '']) {
            const r = await testar({ chave: c.corpo.chave, caminho })
            expect(r.status, caminho).toBe(400)
            expect(r.corpo.erro.codigo, caminho).toBe('caminho_invalido')
        }
    })

    it('aceita /v1 e query string no caminho; método fora de GET/POST/DELETE: 400', async () => {
        const c = await criarRede()
        const ok = await testar({ chave: c.corpo.chave, caminho: '/v1/rede/filtros?x=1' })
        expect(ok.corpo.status).toBe(200)
        const ruim = await testar({ chave: c.corpo.chave, metodo: 'PUT' })
        expect(ruim.status).toBe(400)
        expect(ruim.corpo.erro.codigo).toBe('metodo_invalido')
    })

    it('chave ausente: 400', async () => {
        const r = await testar({ chave: '   ' })
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('chave_ausente')
    })

    it('consome o limite por minuto da chave como uma chamada real', async () => {
        const c = await criarRede({ limite_por_minuto: 2 })
        await testar({ chave: c.corpo.chave })
        await testar({ chave: c.corpo.chave })
        const r = await testar({ chave: c.corpo.chave })
        expect(r.corpo.status).toBe(429)
        expect(r.corpo.headers['retry-after']).toBeDefined()
    })

    it('só devolve cabeçalhos da lista permitida', async () => {
        mod.registrarRota('GET', '/rede/com-extras', 'rede:ler', async () => ({
            corpo: { a: 1 },
            headers: { 'Cache-Control': 'no-store', 'X-Total-Count': '3', 'X-Interno': 'segredo', 'Set-Cookie': 'a=b' },
        }))
        const c = await criarRede()
        const r = await testar({ chave: c.corpo.chave, caminho: '/rede/com-extras' })
        expect(r.corpo.headers['cache-control']).toBe('no-store')
        expect(r.corpo.headers['x-total-count']).toBe('3')
        expect(r.corpo.headers['access-control-allow-origin']).toBe(ORIGEM)
        expect(r.corpo.headers['x-interno']).toBeUndefined()
        expect(r.corpo.headers['set-cookie']).toBeUndefined()
    })

    it('a chave usada não aparece na resposta, na auditoria nem nos logs', async () => {
        const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {})
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        mod.registrarRota('GET', '/rede/eco', 'rede:ler', async (ctx) => ({ corpo: { eco: ctx.req.headers['x-api-key'] } }))
        const c = await criarRede()
        const r = await testar({ chave: c.corpo.chave, caminho: '/rede/eco' })
        expect(r.corpo.status).toBe(200)
        expect(JSON.stringify(r)).not.toContain(c.corpo.chave)
        expect(JSON.stringify(db.audit_logs)).not.toContain(c.corpo.chave)
        for (const spy of [erroLog, aviso, log]) expect(JSON.stringify(spy.mock.calls)).not.toContain(c.corpo.chave)
        // O teste não grava auditoria nova (só a criação existe).
        expect(db.audit_logs).toHaveLength(1)
        erroLog.mockRestore()
        aviso.mockRestore()
        log.mockRestore()
    })
})
