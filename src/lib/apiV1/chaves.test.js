import { describe, it, expect } from 'vitest'
import { gerarChave, hashChave, autorizarChave, ESCOPOS } from './chaves.js'

const agora = new Date('2026-11-10T12:00:00Z')

const linhaBase = (extra = {}) => ({
    id: 'a',
    nome: 'Teste',
    prefixo: 'emer_red',
    escopos: ['rede:ler'],
    origens_permitidas: ['https://www.emerdog.com.br'],
    limite_por_minuto: 120,
    ips_permitidos: [],
    expira_em: null,
    revogada_em: null,
    ...extra,
})

describe('gerarChave', () => {
    it('gera chave da rede no formato esperado', () => {
        const { chave, prefixo, hash } = gerarChave('rede')
        expect(chave.startsWith('emer_rede_')).toBe(true)
        expect(chave).toHaveLength(42)
        expect(prefixo).toBe(chave.slice(0, 8))
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })
    it('gera chave de pagamentos', () => {
        const { chave } = gerarChave('pag')
        expect(chave.startsWith('emer_pag_')).toBe(true)
        expect(chave).toHaveLength(41)
    })
    it('chaves são diferentes e hash é determinístico', () => {
        const a = gerarChave('rede')
        const b = gerarChave('rede')
        expect(a.chave).not.toBe(b.chave)
        expect(hashChave(a.chave)).toBe(a.hash)
        expect(hashChave(a.chave)).toBe(hashChave(a.chave))
    })
    it('rejeita tipo desconhecido', () => {
        expect(() => gerarChave('x')).toThrow()
    })
})

describe('autorizarChave', () => {
    const ctx = (extra = {}) => ({ escopo: 'rede:ler', origem: 'https://www.emerdog.com.br', ip: '1.1.1.1', agora, ...extra })

    it('linha nula', () => {
        expect(autorizarChave(null, ctx())).toEqual({ ok: false, status: 401, codigo: 'chave_invalida' })
    })
    it('revogada ou expirada', () => {
        expect(autorizarChave(linhaBase({ revogada_em: '2026-11-01T00:00:00Z' }), ctx())).toEqual({ ok: false, status: 401, codigo: 'chave_invalida' })
        expect(autorizarChave(linhaBase({ expira_em: '2026-11-09T00:00:00Z' }), ctx())).toEqual({ ok: false, status: 401, codigo: 'chave_invalida' })
    })
    it('não expirada ainda é válida', () => {
        expect(autorizarChave(linhaBase({ expira_em: '2026-12-01T00:00:00Z' }), ctx())).toEqual({ ok: true })
    })
    it('escopo ausente', () => {
        expect(autorizarChave(linhaBase(), ctx({ escopo: 'pagamentos:ler' }))).toEqual({ ok: false, status: 403, codigo: 'escopo_insuficiente' })
    })
    it('rede:ler exige origem na lista', () => {
        expect(autorizarChave(linhaBase(), ctx())).toEqual({ ok: true })
        expect(autorizarChave(linhaBase(), ctx({ origem: 'https://outro.com' }))).toEqual({ ok: false, status: 403, codigo: 'origem_nao_permitida' })
        expect(autorizarChave(linhaBase(), ctx({ origem: undefined }))).toEqual({ ok: false, status: 403, codigo: 'origem_nao_permitida' })
    })
    it('pagamentos nunca aceita origem de navegador', () => {
        const l = linhaBase({ escopos: ['pagamentos:escrever'], origens_permitidas: [] })
        const c = ctx({ escopo: 'pagamentos:escrever' })
        expect(autorizarChave(l, { ...c, origem: 'https://www.emerdog.com.br' })).toEqual({ ok: false, status: 403, codigo: 'origem_nao_permitida' })
        expect(autorizarChave(l, { ...c, origem: undefined })).toEqual({ ok: true })
    })
    it('ips_permitidos', () => {
        const l = linhaBase({ escopos: ['pagamentos:ler'], ips_permitidos: ['2.2.2.2'] })
        const c = ctx({ escopo: 'pagamentos:ler', origem: undefined })
        expect(autorizarChave(l, c)).toEqual({ ok: false, status: 403, codigo: 'ip_nao_permitido' })
        expect(autorizarChave(l, { ...c, ip: '2.2.2.2' })).toEqual({ ok: true })
    })
    it('exporta escopos', () => {
        expect(ESCOPOS).toEqual(['rede:ler', 'pagamentos:ler', 'pagamentos:escrever'])
    })
})
