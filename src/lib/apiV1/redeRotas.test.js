import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashChave } from './chaves.js'

const CHAVE = 'emer_rede_abc123'
const ORIGEM = 'https://cliente.exemplo.com'

const tabelas = {}
const leituras = {}

function montarTabelas() {
    const prest = (id, nome, extra = {}) => ({
        id,
        nome,
        ativo: true,
        situacao_id: 1,
        especialidade_id: 10,
        tipo: 'Especialidade',
        telefone: '(54) 3000-0000',
        celular: null,
        endereco_cidade: 'Caxias do Sul',
        endereco_uf: 'RS',
        cpf_cnpj: '000.000.000-00',
        chave_pix: 'segredo-pix',
        email: 'interno@emerlab.com',
        observacoes: 'obs interna',
        ...extra,
    })
    Object.assign(tabelas, {
        api_chaves: [
            {
                id: 'k1',
                hash: hashChave(CHAVE),
                escopos: ['rede:ler'],
                origens_permitidas: [ORIGEM],
                limite_por_minuto: 1000,
                ips_permitidos: [],
                expira_em: null,
                revogada_em: null,
            },
        ],
        prestadores: [
            prest(1, 'Clinica Alfa', { especialidade_id: 2, tipo: 'Local' }),
            prest(2, 'Dr Beta'),
            prest(3, 'Gama Descredenciado', { situacao_id: 2 }),
            prest(4, 'Delta', { endereco_cidade: 'Porto Alegre e Região' }),
            prest(5, 'Epsilon Inativo', { ativo: false }),
        ],
        situacoes: [
            { id: 1, descricao: 'Credenciado' },
            { id: 2, descricao: 'Descredenciado' },
        ],
        prestador_estabelecimentos: [],
        procedimentos: [{ id: 1, codigo: 'CONS-001', nome: 'Consulta', categoria_id: 1, plano_base_id: 1 }],
        prestador_procedimentos: [{ prestador_id: 2, procedimento_cod: 'CONS-001', procedimento_id: 1, nome_alternativo: null }],
        prestador_cidades: [],
        cidades_credenciamento: [],
        especialidades: [
            { id: 2, nome: 'Clínica', tipo: 'Local' },
            { id: 10, nome: 'Dermatologia', tipo: 'Especialidade' },
        ],
        prestador_especialidades: [],
        beneficios_catalogo: [],
        prestador_beneficios: [],
        prestador_beneficios_obs: [],
        planos: [
            { id: 1, nome: 'Básico' },
            { id: 2, nome: 'Clássico' },
            { id: 3, nome: 'Avançado' },
            { id: 4, nome: 'Ultra' },
            { id: 5, nome: 'Apenas Loja' },
        ],
        planos_cidade: [],
        cidades: [],
        cidades_municipios_vinculo: [],
        categorias: [{ id: 1, nome: 'Consultas' }],
    })
}

const admin = {
    from: (nome) => {
        if (!(nome in tabelas)) throw new Error('tabela inesperada ' + nome)
        leituras[nome] = (leituras[nome] || 0) + 1
        const filtros = []
        let modo = 'select'
        let colunas = null
        let faixa = null
        const executar = () => {
            if (modo === 'update') return []
            let linhas = tabelas[nome].filter((r) => filtros.every((f) => f(r)))
            if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1)
            if (colunas && colunas !== '*') {
                const cols = colunas.split(',').map((c) => c.trim())
                linhas = linhas.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
            }
            return linhas.map((r) => ({ ...r }))
        }
        const b = {
            select: (c) => ((colunas = c), b),
            update: () => ((modo = 'update'), b),
            eq: (k, v) => (filtros.push((r) => r[k] === v), b),
            is: (k, v) => (filtros.push((r) => (r[k] ?? null) === v), b),
            order: () => b,
            range: (a, z) => ((faixa = [a, z]), b),
            maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
            then: (res, rej) => Promise.resolve({ data: executar(), error: null }).then(res, rej),
        }
        return b
    },
}

vi.mock('../api/serverAuth.js', () => ({
    createSupabaseAdminClient: () => admin,
    getClientIp: () => '1.2.3.4',
    validarJwtComPermissao: async () => ({ error: 'x', status: 401 }),
}))

const pedido = (caminho, query = {}, extra = {}) => ({
    metodo: 'GET',
    caminho,
    query,
    headers: { authorization: `Bearer ${CHAVE}`, origin: ORIGEM },
    body: {},
    ip: '1.2.3.4',
    ...extra,
})

let roteador

beforeEach(async () => {
    vi.resetModules()
    for (const k of Object.keys(leituras)) delete leituras[k]
    montarTabelas()
    roteador = await import('../../../api/_lib/apiV1/roteador.js')
    const dados = await import('../../../api/_lib/apiV1/redeDados.js')
    dados.limparCacheRede()
})

describe('GET /rede/credenciados', () => {
    it('filtra por uf e cidade, com cabecalhos e formato publico', async () => {
        const r = await roteador.processarRequisicao(pedido('/rede/credenciados', { uf: 'RS', cidade: 'Caxias do Sul' }))
        expect(r.status).toBe(200)
        expect(r.headers['X-Total-Count']).toBe('2')
        expect(r.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=3600')
        expect(r.corpo.map((c) => c.nome)).toEqual(['Clinica Alfa', 'Dr Beta'])
        expect(r.corpo[1].procedimentos).toEqual([
            { categoria: 'Consultas', itens: [{ codigo: 'CONS-001', nome: 'Consulta', nome_alternativo: null }] },
        ])
        const json = JSON.stringify(r.corpo)
        for (const segredo of ['segredo-pix', '000.000.000-00', 'interno@emerlab.com', 'obs interna']) {
            expect(json).not.toContain(segredo)
        }
    })

    it('por_pagina acima de 100 vira 100; valores invalidos usam o padrao', async () => {
        const a = await roteador.processarRequisicao(pedido('/rede/credenciados', { por_pagina: '500' }))
        expect(a.status).toBe(200)
        expect(a.corpo).toHaveLength(3)
        const b = await roteador.processarRequisicao(pedido('/rede/credenciados', { por_pagina: 'abc', pagina: 'x' }))
        expect(b.corpo).toHaveLength(3)
        const c = await roteador.processarRequisicao(pedido('/rede/credenciados', { por_pagina: '2', pagina: '2' }))
        expect(c.corpo.map((x) => x.nome)).toEqual(['Dr Beta'])
        expect(c.headers['X-Total-Count']).toBe('3')
    })

    it('pagina alem do fim devolve [] com total correto', async () => {
        const r = await roteador.processarRequisicao(pedido('/rede/credenciados', { pagina: '99' }))
        expect(r.status).toBe(200)
        expect(r.corpo).toEqual([])
        expect(r.headers['X-Total-Count']).toBe('3')
    })

    it('filtro invalido vira 400 com o codigo da regra', async () => {
        const r = await roteador.processarRequisicao(pedido('/rede/credenciados', { tipo: 'zzz' }))
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('tipo_invalido')
    })

    it('chave sem rede:ler recebe 403', async () => {
        tabelas.api_chaves[0].escopos = ['pagamentos:ler']
        const r = await roteador.processarRequisicao(pedido('/rede/credenciados'))
        expect(r.status).toBe(403)
    })

    it('duas chamadas seguidas leem o banco uma vez so', async () => {
        await roteador.processarRequisicao(pedido('/rede/credenciados'))
        await roteador.processarRequisicao(pedido('/rede/filtros'))
        await roteador.processarRequisicao(pedido('/rede/credenciados/2'))
        expect(leituras.prestadores).toBe(1)
        expect(leituras.planos).toBe(1)
    })

    it('chamadas simultaneas juntam a leitura e falha nao fica em cache', async () => {
        await Promise.all([
            roteador.processarRequisicao(pedido('/rede/credenciados')),
            roteador.processarRequisicao(pedido('/rede/credenciados')),
        ])
        expect(leituras.prestadores).toBe(1)

        const dados = await import('../../../api/_lib/apiV1/redeDados.js')
        dados.limparCacheRede()
        const original = tabelas.situacoes
        tabelas.situacoes = null
        const falha = await roteador.processarRequisicao(pedido('/rede/credenciados'))
        expect(falha.status).toBe(500)
        tabelas.situacoes = original
        const ok = await roteador.processarRequisicao(pedido('/rede/credenciados'))
        expect(ok.status).toBe(200)
    })
})

describe('GET /rede/credenciados/{id}', () => {
    it('devolve o credenciado com os cabecalhos de cache', async () => {
        const r = await roteador.processarRequisicao(pedido('/rede/credenciados/2'))
        expect(r.status).toBe(200)
        expect(r.corpo.nome).toBe('Dr Beta')
        expect(r.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=3600')
    })

    it.each(['999', '3', '5', 'abc'])('id %s inexistente ou nao credenciado: 404', async (id) => {
        const r = await roteador.processarRequisicao(pedido(`/rede/credenciados/${id}`))
        expect(r.status).toBe(404)
        expect(r.corpo.erro.codigo).toBe('credenciado_nao_encontrado')
    })
})

describe('GET /rede/filtros', () => {
    it('devolve ufs, cidades por UF, especialidades e planos sem Apenas Loja', async () => {
        const r = await roteador.processarRequisicao(pedido('/rede/filtros'))
        expect(r.status).toBe(200)
        expect(r.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=3600')
        expect(r.corpo.ufs).toEqual(['RS'])
        expect(r.corpo.cidades).toEqual({ RS: ['Caxias do Sul', 'Porto Alegre e Região'] })
        expect(r.corpo.especialidades.map((e) => e.nome)).toEqual(['Clínica', 'Dermatologia'])
        expect(r.corpo.planos.map((p) => p.nome)).toEqual(['Básico', 'Clássico', 'Avançado', 'Ultra'])
        expect(JSON.stringify(r.corpo.planos)).not.toContain('Apenas')
    })
})

describe('Vary e base antiga', () => {
    const VARY = 'Origin, Authorization, X-Api-Key'

    it('200 e 401 carregam o Vary completo', async () => {
        const ok = await roteador.processarRequisicao(pedido('/rede/filtros'))
        expect(ok.status).toBe(200)
        expect(ok.headers.Vary).toBe(VARY)
        const sem = await roteador.processarRequisicao(pedido('/rede/filtros', {}, { headers: { origin: ORIGEM } }))
        expect(sem.status).toBe(401)
        expect(sem.headers.Vary).toBe(VARY)
    })

    describe('recarga que falha', () => {
        beforeEach(() => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
        })
        afterEach(() => vi.useRealTimers())

        const filtros = () => roteador.processarRequisicao(pedido('/rede/filtros'))

        it('cache vencido + recarga falha: serve a base antiga, adia 30 s e depois tenta de novo', async () => {
            expect((await filtros()).status).toBe(200)
            const antes = leituras.prestadores
            vi.setSystemTime(new Date('2026-11-10T12:06:00Z'))
            const original = tabelas.situacoes
            tabelas.situacoes = null
            const r = await filtros()
            expect(r.status).toBe(200)
            expect(r.corpo.planos.map((p) => p.nome)).toEqual(['Básico', 'Clássico', 'Avançado', 'Ultra'])
            const tentou = leituras.prestadores
            expect(tentou).toBeGreaterThan(antes)
            vi.setSystemTime(new Date('2026-11-10T12:06:20Z'))
            expect((await filtros()).status).toBe(200)
            expect(leituras.prestadores).toBe(tentou)
            tabelas.situacoes = original
            vi.setSystemTime(new Date('2026-11-10T12:06:40Z'))
            expect((await filtros()).status).toBe(200)
            expect(leituras.prestadores).toBeGreaterThan(tentou)
        })

        it('sem base anterior a falha continua sendo erro', async () => {
            tabelas.situacoes = null
            expect((await filtros()).status).toBe(500)
        })
    })
})
