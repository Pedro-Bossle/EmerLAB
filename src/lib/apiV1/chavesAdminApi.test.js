import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    ROTAS_TESTE,
    erroDaResposta,
    formDeChave,
    montarPayloadEdicao,
    montarPayloadChave,
    montarRequisicaoTeste,
    textoParaLista,
    validarFormChave,
} from './chavesAdminApi.js'

const AGORA = new Date('2026-11-10T12:00:00Z')

describe('textoParaLista', () => {
    it('separa por linha, vírgula e espaço, sem vazios nem repetidos', () => {
        expect(textoParaLista(' https://a.com,\nhttps://b.com  https://a.com\n\n')).toEqual(['https://a.com', 'https://b.com'])
        expect(textoParaLista('')).toEqual([])
    })
})

describe('montarPayloadChave', () => {
    it('rede: origens, limite e expiração (fim do dia)', () => {
        const p = montarPayloadChave({
            nome: ' Site ',
            tipo: 'rede',
            origensTexto: 'https://a.com\nhttps://b.com',
            limite: '200',
            expiraEm: '2026-12-31',
        })
        expect(p.nome).toBe('Site')
        expect(p.tipo).toBe('rede')
        expect(p.escopos).toEqual(['rede:ler'])
        expect(p.origens_permitidas).toEqual(['https://a.com', 'https://b.com'])
        expect(p.limite_por_minuto).toBe(200)
        expect(new Date(p.expira_em).getTime()).toBe(new Date('2026-12-31T23:59:59').getTime())
    })
    it('pagamentos: sem origens, escopos por permissão de escrita; limite vazio fica ao padrão do servidor', () => {
        const p = montarPayloadChave({ nome: 'ERP', tipo: 'pagamentos', origensTexto: 'https://x.com', limite: '', escrita: true })
        expect(p.origens_permitidas).toEqual([])
        expect(p.escopos).toEqual(['pagamentos:ler', 'pagamentos:escrever'])
        expect('limite_por_minuto' in p).toBe(false)
        expect(p.expira_em).toBeUndefined()
        expect(montarPayloadChave({ nome: 'ERP', tipo: 'pagamentos' }).escopos).toEqual(['pagamentos:ler'])
    })
})

describe('validarFormChave', () => {
    it('devolve o erro da regra compartilhada', () => {
        const r = validarFormChave({ nome: 'Site', tipo: 'rede', origensTexto: '' }, { agora: AGORA })
        expect(r.ok).toBe(false)
        expect(r.erro).toMatch(/origem/i)
    })
    it('limite não numérico é erro', () => {
        expect(validarFormChave({ nome: 'S', tipo: 'rede', origensTexto: 'https://a.com', limite: 'abc' }, { agora: AGORA }).ok).toBe(false)
    })
    it('ok devolve o payload', () => {
        const r = validarFormChave({ nome: 'Site', tipo: 'rede', origensTexto: 'https://a.com' }, { agora: AGORA })
        expect(r.ok).toBe(true)
        expect(r.payload.nome).toBe('Site')
    })
})

describe('montarRequisicaoTeste', () => {
    it('substitui {id} no caminho (codificado) e manda o resto na query', () => {
        const rota = ROTAS_TESTE.find((r) => r.caminho === '/rede/credenciados/{id}')
        const r = montarRequisicaoTeste(rota, { id: 'a/b' })
        expect(r).toEqual({ metodo: 'GET', caminho: '/rede/credenciados/a%2Fb', corpo: undefined })
    })
    it('parâmetros de query preenchidos entram na query string; vazios não', () => {
        const rota = ROTAS_TESTE.find((r) => r.caminho === '/rede/credenciados')
        const r = montarRequisicaoTeste(rota, { uf: 'RS', cidade: '  ', q: 'clínica a' })
        expect(r.caminho).toBe('/rede/credenciados?uf=RS&q=cl%C3%ADnica+a')
    })
    it('POST monta o corpo com os campos preenchidos', () => {
        const rota = ROTAS_TESTE.find((r) => r.metodo === 'POST' && r.caminho.endsWith('/pago'))
        const r = montarRequisicaoTeste(rota, { id: '7', data_pagamento: '2026-11-10', valor: '' })
        expect(r.caminho).toBe('/pagamentos/registros/7/pago')
        expect(r.corpo).toEqual({ data_pagamento: '2026-11-10' })
    })
    it('o catálogo cobre as rotas públicas e marca escrita', () => {
        const chaves = ROTAS_TESTE.map((r) => `${r.metodo} ${r.caminho}`)
        expect(chaves).toEqual(
            expect.arrayContaining([
                'GET /rede/credenciados',
                'GET /rede/credenciados/{id}',
                'GET /rede/filtros',
                'GET /pagamentos/registros',
                'GET /pagamentos/registros/{id}',
                'POST /pagamentos/registros/{id}/pago',
                'POST /pagamentos/registros/{id}/comprovantes',
                'DELETE /pagamentos/registros/{id}/pago',
            ]),
        )
        for (const r of ROTAS_TESTE) expect(r.escrita).toBe(r.metodo !== 'GET')
    })
})

describe('erroDaResposta', () => {
    it('lê a mensagem do corpo padrão da API', () => {
        expect(erroDaResposta(403, { erro: { codigo: 'sem_permissao', mensagem: 'Sem permissão.' } })).toBe('Sem permissão.')
        expect(erroDaResposta(500, null)).toMatch(/500/)
    })
})

describe('edição', () => {
    const linha = {
        nome: 'Site',
        escopos: ['rede:ler'],
        origens_permitidas: ['https://a.com'],
        ips_permitidos: [],
        limite_por_minuto: 120,
        expira_em: null,
    }
    it('formDeChave preenche o formulário', () => {
        expect(formDeChave(linha)).toMatchObject({ nome: 'Site', tipo: 'rede', origensTexto: 'https://a.com', limite: '120', expiraEm: '' })
        expect(formDeChave({ ...linha, escopos: ['pagamentos:ler', 'pagamentos:escrever'] })).toMatchObject({ tipo: 'pagamentos', escrita: true })
    })
    it('sem mudanças o payload é vazio', () => {
        expect(montarPayloadEdicao(formDeChave(linha), linha)).toEqual({})
    })
    it('manda só o que mudou; limpar a data manda expira_em null', () => {
        const form = { ...formDeChave(linha), nome: 'Outro', limite: '10' }
        expect(montarPayloadEdicao(form, linha)).toEqual({ nome: 'Outro', limite_por_minuto: 10 })
        const comData = { ...linha, expira_em: '2027-03-10T15:00:00Z' }
        expect(montarPayloadEdicao({ ...formDeChave(comData), expiraEm: '' }, comData)).toEqual({ expira_em: null })
    })
})

afterEach(() => vi.restoreAllMocks())
