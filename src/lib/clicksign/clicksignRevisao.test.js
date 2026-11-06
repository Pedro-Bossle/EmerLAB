import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    fetchComRetry,
    hostEhApiClicksign,
    hostEhArquivoClicksign,
    removerSegredosWebhook,
    resolverBaseClicksign,
} from './clicksignConfig.js'
import {
    deadlineAtDeDias,
    payloadAtualizarEnvelope,
    payloadEnvelopeRascunho,
    payloadNotificarEnvelope,
    requisitoDuplicadoOuConflito,
} from './clicksignClient.js'

describe('resolverBaseClicksign', () => {
    it('exige CLICKSIGN_API_BASE na Vercel (não cai no sandbox em silêncio)', () => {
        const r = resolverBaseClicksign({ VERCEL: '1' })
        expect(r.base).toBe('')
        expect(r.error).toMatch(/CLICKSIGN_API_BASE/)
    })
    it('usa sandbox como padrão só fora da Vercel', () => {
        expect(resolverBaseClicksign({}).base).toBe('https://sandbox.clicksign.com/api/v3')
    })
    it('recusa a API 1.x e normaliza barra final', () => {
        expect(resolverBaseClicksign({ CLICKSIGN_API_BASE: 'https://api.clicksign.com.br/api/v1' }).error).toBeTruthy()
        expect(resolverBaseClicksign({ CLICKSIGN_API_BASE: 'https://app.clicksign.com/api/v3/' }).base).toBe(
            'https://app.clicksign.com/api/v3',
        )
    })
})

describe('hosts de arquivo', () => {
    it('envia token só à API Clicksign, nunca ao S3', () => {
        expect(hostEhApiClicksign('app.clicksign.com')).toBe(true)
        expect(hostEhApiClicksign('clicksign-content-production.s3.amazonaws.com')).toBe(false)
        expect(hostEhApiClicksign('evil-clicksign.com.attacker.io')).toBe(false)
    })
    it('aceita apenas hosts de conteúdo da Clicksign', () => {
        expect(hostEhArquivoClicksign('clicksign-content-production.s3.amazonaws.com')).toBe(true)
        expect(hostEhArquivoClicksign('clicksign-content-sandbox.s3.amazonaws.com')).toBe(true)
        expect(hostEhArquivoClicksign('outro-bucket.s3.amazonaws.com')).toBe(false)
        expect(hostEhArquivoClicksign('attacker.io')).toBe(false)
    })
})

describe('removerSegredosWebhook', () => {
    it('remove `secret` em qualquer nível', () => {
        const out = removerSegredosWebhook({
            data: [{ id: '1', attributes: { endpoint: 'x', secret: 'abc' } }],
        })
        expect(out.data[0].attributes).toEqual({ endpoint: 'x' })
    })
})

describe('fetchComRetry', () => {
    afterEach(() => vi.restoreAllMocks())

    const resp = (status) => new Response('{}', { status })

    it('repete GET em 503 e devolve o sucesso', async () => {
        const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200))
        const r = await fetchComRetry('https://x', { method: 'GET' }, { esperaInicialMs: 1, esperaMaximaMs: 2 })
        expect(r.status).toBe(200)
        expect(f).toHaveBeenCalledTimes(2)
    })

    it('POST só repete em 429, nunca em 5xx (evita duplicar)', async () => {
        const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(500))
        const r = await fetchComRetry('https://x', { method: 'POST' }, { esperaInicialMs: 1, esperaMaximaMs: 2 })
        expect(r.status).toBe(500)
        expect(f).toHaveBeenCalledTimes(1)

        f.mockReset()
        f.mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(201))
        const r2 = await fetchComRetry('https://x', { method: 'POST' }, { esperaInicialMs: 1, esperaMaximaMs: 2 })
        expect(r2.status).toBe(201)
        expect(f).toHaveBeenCalledTimes(2)
    })

    it('não repete erros de validação (422)', async () => {
        const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(422))
        await fetchComRetry('https://x', { method: 'GET' }, { esperaInicialMs: 1, esperaMaximaMs: 2 })
        expect(f).toHaveBeenCalledTimes(1)
    })

    it('limita as tentativas e devolve a última resposta', async () => {
        const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(429))
        const r = await fetchComRetry('https://x', { method: 'GET' }, { maxTentativas: 3, esperaInicialMs: 1, esperaMaximaMs: 2 })
        expect(r.status).toBe(429)
        expect(f).toHaveBeenCalledTimes(3)
    })
})

describe('payloads de envelope', () => {
    it('payloadAtualizarEnvelope envia só o que foi informado e limita o assunto a 100', () => {
        const p = payloadAtualizarEnvelope('abc', { name: '  Contrato X  ', default_subject: 'a'.repeat(150) })
        expect(p.data).toMatchObject({ id: 'abc', type: 'envelopes' })
        expect(p.data.attributes.name).toBe('Contrato X')
        expect(p.data.attributes.default_subject).toHaveLength(100)
        expect('default_message' in p.data.attributes).toBe(false)
    })

    it('null limpa assunto/mensagem na API', () => {
        const p = payloadAtualizarEnvelope('abc', { default_subject: null, default_message: '' })
        expect(p.data.attributes.default_subject).toBeNull()
        expect(p.data.attributes.default_message).toBeNull()
    })

    it('payloadEnvelopeRascunho ignora extras undefined', () => {
        const p = payloadEnvelopeRascunho('Nome', { deadline_at: undefined, default_subject: 'Assunto' })
        expect(p.data.attributes).toEqual({ name: 'Nome', locale: 'pt-BR', default_subject: 'Assunto' })
    })

    it('deadlineAtDeDias respeita 1–90 dias e ignora vazio', () => {
        const base = new Date('2026-01-01T00:00:00.000Z')
        expect(deadlineAtDeDias('', base)).toBeUndefined()
        expect(deadlineAtDeDias('0', base)).toBeUndefined()
        expect(deadlineAtDeDias('10', base)).toBe('2026-01-11T00:00:00.000Z')
        const max = new Date(deadlineAtDeDias('500', base)).getTime() - base.getTime()
        expect(max).toBeLessThan(90 * 86_400_000)
    })

    it('payloadNotificarEnvelope usa a mensagem padrão quando vazia', () => {
        expect(payloadNotificarEnvelope('').data).toEqual({ type: 'notifications', attributes: {} })
        expect(payloadNotificarEnvelope(' oi ').data.attributes.message).toBe('oi')
    })
})

describe('requisitoDuplicadoOuConflito', () => {
    it('só trata 422 de duplicidade como "já existe"', () => {
        expect(requisitoDuplicadoOuConflito({ ok: false, status: 422, data: { errors: [{ detail: 'já existe requisito' }] } })).toBe(true)
        expect(requisitoDuplicadoOuConflito({ ok: false, status: 422, data: { errors: [{ detail: 'role inválido' }] } })).toBe(false)
        expect(requisitoDuplicadoOuConflito({ ok: false, status: 422, data: { errors: [{ detail: 'signer não pode ser vazio' }] } })).toBe(false)
        expect(requisitoDuplicadoOuConflito({ ok: false, status: 500, data: { error: 'duplicado' } })).toBe(false)
    })
})
