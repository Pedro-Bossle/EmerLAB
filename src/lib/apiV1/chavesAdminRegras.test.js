import { describe, expect, it } from 'vitest'
import { ESCOPOS } from './chaves.js'
import {
    ESCOPOS_POR_TIPO,
    estadoDaChave,
    normalizarOrigem,
    tipoDosEscopos,
    validarEdicaoChave,
    validarNovaChave,
} from './chavesAdminRegras.js'

const AGORA = new Date('2026-11-10T12:00:00Z')
const rede = (extra = {}) => ({ nome: '  Site  ', tipo: 'rede', origens_permitidas: ['https://site.com.br'], ...extra })

describe('constantes', () => {
    it('os escopos por tipo cobrem exatamente ESCOPOS', () => {
        expect([...ESCOPOS_POR_TIPO.rede, ...ESCOPOS_POR_TIPO.pagamentos].sort()).toEqual([...ESCOPOS].sort())
    })
    it('tipoDosEscopos', () => {
        expect(tipoDosEscopos(['rede:ler'])).toBe('rede')
        expect(tipoDosEscopos(['pagamentos:ler', 'pagamentos:escrever'])).toBe('pagamentos')
        expect(tipoDosEscopos(['rede:ler', 'pagamentos:ler'])).toBeNull()
        expect(tipoDosEscopos([])).toBeNull()
    })
})

describe('normalizarOrigem', () => {
    it('aceita https://host[:porta] e normaliza', () => {
        expect(normalizarOrigem('https://Site.com.br')).toBe('https://site.com.br')
        expect(normalizarOrigem('https://site.com.br:8443')).toBe('https://site.com.br:8443')
        expect(normalizarOrigem('http://localhost:5173')).toBe('http://localhost:5173')
    })
    it('rejeita caminho, curinga, http público e lixo', () => {
        for (const o of [
            'https://site.com.br/',
            'https://site.com.br/x',
            'https://*.site.com',
            '*',
            'http://site.com.br',
            'site.com.br',
            'https://',
            'https://a b.com',
            'https://u@site.com',
            '',
        ]) {
            expect(normalizarOrigem(o)).toBeNull()
        }
    })
})

describe('validarNovaChave', () => {
    it('rede com origem: ok, nome aparado e padrões', () => {
        const r = validarNovaChave(rede(), { agora: AGORA })
        expect(r.ok).toBe(true)
        expect(r.dados).toMatchObject({
            nome: 'Site',
            tipo: 'rede',
            escopos: ['rede:ler'],
            origens_permitidas: ['https://site.com.br'],
            limite_por_minuto: 120,
            ips_permitidos: [],
            expira_em: null,
        })
    })
    it('pagamentos: padrão 60/min e escopo ler', () => {
        const r = validarNovaChave({ nome: 'ERP', tipo: 'pagamentos' }, { agora: AGORA })
        expect(r.ok).toBe(true)
        expect(r.dados.limite_por_minuto).toBe(60)
        expect(r.dados.escopos).toEqual(['pagamentos:ler'])
    })
    it('tipo deduzido dos escopos quando omitido', () => {
        const r = validarNovaChave({ nome: 'ERP', escopos: ['pagamentos:ler', 'pagamentos:escrever'] }, { agora: AGORA })
        expect(r.ok).toBe(true)
        expect(r.dados.tipo).toBe('pagamentos')
    })
    it.each([
        ['rede sem origens', rede({ origens_permitidas: [] }), 'origens_obrigatorias'],
        ['rede com origem inválida', rede({ origens_permitidas: ['https://x.com/caminho'] }), 'origens_invalidas'],
        ['pagamentos com origens', { nome: 'a', tipo: 'pagamentos', origens_permitidas: ['https://x.com'] }, 'origens_nao_permitidas'],
        ['escopo fora da lista', rede({ escopos: ['admin:tudo'] }), 'escopos_invalidos'],
        ['rede com escopo de pagamentos', rede({ escopos: ['pagamentos:ler'] }), 'escopos_invalidos'],
        ['escopos misturados', { nome: 'a', escopos: ['rede:ler', 'pagamentos:ler'] }, 'tipo_invalido'],
        ['tipo desconhecido', { nome: 'a', tipo: 'x' }, 'tipo_invalido'],
        ['sem nome', rede({ nome: '   ' }), 'nome_invalido'],
        ['nome longo', rede({ nome: 'a'.repeat(81) }), 'nome_invalido'],
        ['limite zero', rede({ limite_por_minuto: 0 }), 'limite_invalido'],
        ['limite alto', rede({ limite_por_minuto: 10001 }), 'limite_invalido'],
        ['limite fracionado', rede({ limite_por_minuto: 1.5 }), 'limite_invalido'],
        ['expiração no passado', rede({ expira_em: '2026-11-09T00:00:00Z' }), 'expiracao_invalida'],
        ['expiração inválida', rede({ expira_em: 'amanhã' }), 'expiracao_invalida'],
        ['ip inválido', rede({ ips_permitidos: ['999.1.1.1'] }), 'ips_invalidos'],
    ])('rejeita %s', (_n, dados, codigo) => {
        const r = validarNovaChave(dados, { agora: AGORA })
        expect(r.ok).toBe(false)
        expect(r.erro.codigo).toBe(codigo)
    })
    it('aceita limite 1 e 10000, expiração futura e ips', () => {
        const r = validarNovaChave(
            rede({ limite_por_minuto: 10000, expira_em: '2026-12-01T00:00:00Z', ips_permitidos: ['10.0.0.1', '2001:db8::1'] }),
            { agora: AGORA },
        )
        expect(r.ok).toBe(true)
        expect(r.dados.expira_em).toBe('2026-12-01T00:00:00.000Z')
        expect(validarNovaChave(rede({ limite_por_minuto: 1 }), { agora: AGORA }).ok).toBe(true)
    })
})

describe('validarEdicaoChave', () => {
    const existente = { escopos: ['rede:ler'], origens_permitidas: ['https://a.com'], revogada_em: null }
    it('só devolve o que mudou', () => {
        const r = validarEdicaoChave({ nome: ' Novo ', limite_por_minuto: 5 }, existente, { agora: AGORA })
        expect(r).toEqual({ ok: true, alteracoes: { nome: 'Novo', limite_por_minuto: 5 } })
    })
    it('não deixa rede ficar sem origens nem trocar de tipo', () => {
        expect(validarEdicaoChave({ origens_permitidas: [] }, existente, { agora: AGORA }).erro.codigo).toBe('origens_obrigatorias')
        expect(validarEdicaoChave({ escopos: ['pagamentos:ler'] }, existente, { agora: AGORA }).erro.codigo).toBe('escopos_invalidos')
    })
    it('pagamentos não aceita origens', () => {
        const pag = { escopos: ['pagamentos:ler'], origens_permitidas: [] }
        expect(validarEdicaoChave({ origens_permitidas: ['https://a.com'] }, pag, { agora: AGORA }).erro.codigo).toBe('origens_nao_permitidas')
        expect(validarEdicaoChave({ escopos: ['pagamentos:ler', 'pagamentos:escrever'] }, pag, { agora: AGORA }).ok).toBe(true)
    })
    it('expira_em null limpa; sem campos é erro', () => {
        expect(validarEdicaoChave({ expira_em: null }, existente, { agora: AGORA }).alteracoes).toEqual({ expira_em: null })
        expect(validarEdicaoChave({}, existente, { agora: AGORA }).erro.codigo).toBe('nada_a_alterar')
    })
})

describe('estadoDaChave', () => {
    it('revogada, expirada, ativa', () => {
        expect(estadoDaChave({ revogada_em: 'x' }, AGORA)).toBe('revogada')
        expect(estadoDaChave({ expira_em: '2026-01-01T00:00:00Z' }, AGORA)).toBe('expirada')
        expect(estadoDaChave({ expira_em: null }, AGORA)).toBe('ativa')
    })
})
