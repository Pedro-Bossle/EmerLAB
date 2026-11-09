import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Linhas do banco: uma conversa do setor 1, uma do setor 2 e uma atribuída a ana
const linhas = [
    { wa_id: '5511911111111', nome: 'Cliente Um', departamento_id: 1, atendente_email: null, status: 'aberta', ultima_msg_em: '2026-11-09T10:00:00Z' },
    { wa_id: '5511922222222', nome: 'Cliente Dois', departamento_id: 2, atendente_email: null, status: 'aberta', ultima_msg_em: '2026-11-09T11:00:00Z' },
    { wa_id: '5511933333333', nome: 'Cliente Três', departamento_id: 2, atendente_email: 'ana@x.com', status: 'aberta', ultima_msg_em: '2026-11-09T12:00:00Z' },
]
const chamadas = { contatos: 0, banco: 0, colunas: [] }
const invalidadosWati = []

vi.mock('./db.js', () => {
    const consultaDe = (tabela) => {
        const consulta = {
            select: (cols) => {
                if (tabela === 'zap_conversas') chamadas.colunas.push(cols)
                return consulta
            },
            eq: () => consulta,
            order: () => consulta,
            limit: () => consulta,
            then: (res, rej) => {
                if (tabela === 'zap_conversas') chamadas.banco += 1
                return Promise.resolve({ data: tabela === 'zap_conversas' ? linhas : [], error: null }).then(res, rej)
            },
        }
        return consulta
    }
    return {
        db: () => ({ from: consultaDe }),
        ok: ({ data, error }) => {
            if (error) throw new Error(error.message)
            return data
        },
        DbError: class extends Error {},
        buscarUsuarioPorEmail: vi.fn(),
        buscarUsuarioPorId: vi.fn(),
        idsDepartamentos: vi.fn(() => []),
        invalidarUsuarios: vi.fn(),
        listarDepartamentos: vi.fn(async () => []),
        invalidarDepartamentos: vi.fn(),
    }
})

vi.mock('./wati.js', () => {
    class WatiError extends Error {}
    return {
        WatiError,
        watiEmPausa: () => true, // sem conferência com a WATI neste teste
        listarContatos: vi.fn(async () => {
            chamadas.contatos += 1
            return { contatos: [] }
        }),
        invalidarCache: (...a) => invalidadosWati.push(a[0]),
    }
})

const { __teste } = await import('./router.js')
const { invalidar } = await import('./cache.js')

const usuario = (extra) => ({ id: 'u', papel: 'atendente', email: 'u@x.com', departamentos: [], ...extra })
const query = (q = '') => new URLSearchParams(q ? { q } : {})
const ids = (r) => r.conversas.map((c) => c.waId)

beforeEach(() => {
    invalidar('conversas:')
    chamadas.contatos = 0
    chamadas.banco = 0
    chamadas.colunas.length = 0
    invalidadosWati.length = 0
})

describe('lista de conversas compartilhada entre atendentes', () => {
    it('calcula a parte pesada uma vez para vários atendentes ao mesmo tempo', async () => {
        const rs = await Promise.all([
            __teste.listarConversas(usuario({ departamentos: [1] }), query()),
            __teste.listarConversas(usuario({ email: 'b@x.com', departamentos: [2] }), query()),
            __teste.listarConversas(usuario({ papel: 'admin' }), query()),
        ])
        expect(chamadas.contatos).toBe(1)
        expect(chamadas.banco).toBe(1)
        expect(rs).toHaveLength(3)
    })

    it('cada atendente vê só o que a permissão dele permite', async () => {
        const setor1 = await __teste.listarConversas(usuario({ departamentos: [1] }), query())
        const setor2 = await __teste.listarConversas(usuario({ email: 'b@x.com', departamentos: [2] }), query())
        const ana = await __teste.listarConversas(usuario({ email: 'ana@x.com', departamentos: [] }), query())
        const admin = await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(ids(setor1)).toEqual(['5511911111111'])
        expect(ids(setor2).sort()).toEqual(['5511922222222', '5511933333333'])
        expect(ids(ana)).toContain('5511933333333')
        expect(ids(admin)).toHaveLength(3)
        // ordem: mais recente primeiro
        expect(ids(admin)).toEqual(['5511933333333', '5511922222222', '5511911111111'])
    })

    it('uma gravação (invalidar) faz a lista ser recalculada', async () => {
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(1)
        invalidar('conversas:')
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(2)
    })
})

describe('colunas da lista', () => {
    it('não carrega as colunas que a lista não usa', async () => {
        invalidar('conversas:')
        chamadas.colunas.length = 0
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        const cols = chamadas.colunas[0]
        expect(cols).not.toBe('*')
        expect(cols).not.toMatch(/email(?!_)/)
        expect(cols).not.toMatch(/ticks_em/)
        // o que a lista usa continua lá
        for (const c of ['wa_id', 'atendente_email', 'departamento_id', 'status', 'notas', 'anuncio', 'ultima_cliente_em']) {
            expect(cols).toContain(c)
        }
    })
})

describe('recarga fresca restrita ao alvo', () => {
    it('recarga da lista descarta a lista mas não o cache de mensagens', async () => {
        invalidar('conversas:')
        invalidadosWati.length = 0
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(1)
        __teste.descartarCacheDaRecargaFresca('conversas', ['conversas'])
        expect(invalidadosWati).toEqual([])
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(2)
    })

    it('recarga do chat de uma conversa não descarta a lista e só limpa as mensagens dela', async () => {
        invalidar('conversas:')
        invalidadosWati.length = 0
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        const antes = chamadas.banco
        __teste.descartarCacheDaRecargaFresca('conversas/5511999990001/mensagens', ['conversas', '5511999990001', 'mensagens'])
        expect(invalidadosWati.length).toBeGreaterThan(0)
        expect(invalidadosWati.every((k) => k.includes('5511999990001') || k.includes('55119999990001') || /^msgs:55/.test(k))).toBe(true)
        await __teste.listarConversas(usuario({ papel: 'admin' }), query())
        expect(chamadas.banco).toBe(antes) // lista continua em cache
    })

    it('várias recargas na mesma janela descartam o cache uma única vez', () => {
        invalidadosWati.length = 0
        const partes = ['conversas', '5511988880002', 'mensagens']
        __teste.descartarCacheDaRecargaFresca('conversas/5511988880002/mensagens', partes)
        const primeira = invalidadosWati.length
        __teste.descartarCacheDaRecargaFresca('conversas/5511988880002/mensagens', partes)
        __teste.descartarCacheDaRecargaFresca('conversas/5511988880002/mensagens', partes)
        expect(primeira).toBeGreaterThan(0)
        expect(invalidadosWati.length).toBe(primeira)
    })
})

describe('medição por rota', () => {
    it('troca ids por :id para agrupar as rotas', () => {
        expect(__teste.rotaGenerica('conversas/5511999990001/mensagens')).toBe('conversas/:id/mensagens')
        expect(__teste.rotaGenerica('respostas/3f2a1c9e-1b2d-4c3e-8f4a-5b6c7d8e9f01/arquivos')).toBe('respostas/:id/arquivos')
        expect(__teste.rotaGenerica('conversas')).toBe('conversas')
    })
})

describe('roteador com a medição ligada', () => {
    it('responde normalmente e registra o resumo a cada 100 pedidos', async () => {
        const { handle } = await import('./router.js')
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const novaResposta = () =>
            Object.assign(new EventEmitter(), {
                statusCode: 0,
                headers: {},
                setHeader(k, v) {
                    this.headers[k] = v
                },
                end(corpo) {
                    this.corpo = corpo
                    this.emit('finish')
                },
            })
        let ultima
        for (let i = 0; i < 100; i += 1) {
            ultima = novaResposta()
            await handle({ url: '/api/status', method: 'GET', headers: {} }, ultima)
        }
        expect(ultima.statusCode).toBe(200)
        expect(JSON.parse(ultima.corpo)).toHaveProperty('configurado')
        const resumos = info.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('[zap-perf] resumo'))
        expect(resumos.length).toBeGreaterThanOrEqual(1)
        expect(resumos[0]).toContain('GET status')
        info.mockRestore()
    })
})
