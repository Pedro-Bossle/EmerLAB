import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
    caminhoComprovante,
    decodificarBase64,
    hashArquivo,
    lerFiltrosRegistros,
    MAX_COMPROVANTE_BYTES,
    registroPublico,
    validarComprovante,
    validarDataPagamento,
    validarMotivo,
    validarValor,
} from './pagamentosRegras.js'
import { ErroValidacao } from './redeRegras.js'

const bytes = (...ini) => Buffer.concat([Buffer.from(ini), Buffer.alloc(32)])
const codigo = (fn) => {
    try {
        fn()
    } catch (e) {
        expect(e).toBeInstanceOf(ErroValidacao)
        return e.codigo
    }
    return null
}

describe('validarComprovante', () => {
    it('reconhece PDF, PNG e JPEG pelos bytes, não pelo nome', () => {
        expect(validarComprovante({ nome: 'x.png', bytes: Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)]) })).toEqual({ ext: 'pdf', contentType: 'application/pdf' })
        expect(validarComprovante({ nome: 'x.pdf', bytes: bytes(0x89, 0x50, 0x4e, 0x47) })).toEqual({ ext: 'png', contentType: 'image/png' })
        expect(validarComprovante({ nome: 'foto', bytes: bytes(0xff, 0xd8, 0xff) })).toEqual({ ext: 'jpg', contentType: 'image/jpeg' })
    })

    it('.exe renomeado para .pdf é arquivo_invalido', () => {
        expect(codigo(() => validarComprovante({ nome: 'boleto.pdf', tipoMime: 'application/pdf', bytes: bytes(0x4d, 0x5a, 0x90) }))).toBe('arquivo_invalido')
        expect(codigo(() => validarComprovante({ nome: 'v.pdf', bytes: Buffer.alloc(0) }))).toBe('arquivo_invalido')
    })

    it('3 MB passa; 3 MB + 1 byte é arquivo_grande', () => {
        const pdf = (n) => Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(n - 4)])
        expect(validarComprovante({ bytes: pdf(MAX_COMPROVANTE_BYTES) }).ext).toBe('pdf')
        expect(codigo(() => validarComprovante({ bytes: pdf(MAX_COMPROVANTE_BYTES + 1) }))).toBe('arquivo_grande')
    })
})

describe('decodificarBase64 e hashArquivo', () => {
    it('decodifica base64 puro e data URL; recusa texto que não é base64', () => {
        expect(decodificarBase64(Buffer.from('%PDF-1').toString('base64')).toString()).toBe('%PDF-1')
        expect(decodificarBase64('data:application/pdf;base64,' + Buffer.from('oi').toString('base64')).toString()).toBe('oi')
        expect(codigo(() => decodificarBase64('não é base64!'))).toBe('arquivo_invalido')
        expect(codigo(() => decodificarBase64(''))).toBe('arquivo_obrigatorio')
        expect(codigo(() => decodificarBase64(123))).toBe('arquivo_obrigatorio')
    })

    it('hash é sha256 hex', () => {
        expect(hashArquivo(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    })
})

describe('validações de corpo', () => {
    it('data_pagamento: AAAA-MM-DD de verdade', () => {
        expect(validarDataPagamento('2026-11-05')).toBe('2026-11-05')
        expect(validarDataPagamento(undefined, { obrigatoria: false })).toBe(null)
        expect(codigo(() => validarDataPagamento('2026-02-30'))).toBe('data_pagamento_invalida')
        expect(codigo(() => validarDataPagamento('05/11/2026'))).toBe('data_pagamento_invalida')
        expect(codigo(() => validarDataPagamento(undefined))).toBe('data_pagamento_invalida')
    })

    it('valor: número positivo, arredondado a centavos', () => {
        expect(validarValor(272)).toBe(272)
        expect(validarValor('272.005')).toBe(272.01)
        expect(validarValor(undefined, { obrigatorio: false })).toBe(null)
        for (const v of [0, -1, 'abc', null, Infinity]) expect(codigo(() => validarValor(v))).toBe('valor_invalido')
    })

    it('motivo: mínimo 5 caracteres, cortado em 500', () => {
        expect(codigo(() => validarMotivo('  abc  '))).toBe('motivo_obrigatorio')
        expect(validarMotivo(' pago em duplicidade ')).toBe('pago em duplicidade')
        expect(validarMotivo('x'.repeat(900))).toHaveLength(500)
    })
})

describe('lerFiltrosRegistros', () => {
    it('padrões e conversões', () => {
        expect(lerFiltrosRegistros({})).toEqual({ mes: null, ano: null, pago: null, prestadorId: null, pagina: 1, porPagina: 18 })
        expect(lerFiltrosRegistros({ mes: '11', ano: '2026', pago: 'false', prestador_id: '7', pagina: '2', por_pagina: '500' }))
            .toEqual({ mes: 11, ano: 2026, pago: false, prestadorId: 7, pagina: 2, porPagina: 100 })
    })

    it.each([[{ mes: '13' }], [{ mes: 'x' }], [{ ano: '26' }], [{ pago: 'sim' }], [{ prestador_id: 'abc' }]])('%o é parametro_invalido', (q) => {
        expect(codigo(() => lerFiltrosRegistros(q))).toBe('parametro_invalido')
    })
})

describe('caminhoComprovante e registroPublico', () => {
    it('caminho com relatório e sem relatório, extensão do tipo detectado', () => {
        expect(caminhoComprovante({ registro: { id: 'r1', mes: 3, ano: 2026 }, relatorio: { id: 'rel9', mes: 3, ano: 2026 }, hash: 'ab', ext: 'pdf' }))
            .toBe('2026-03/rel9/comprovante/ab.pdf')
        expect(caminhoComprovante({ registro: { id: 'r1', mes: 11, ano: 2026 }, relatorio: null, hash: 'cd', ext: 'png' }))
            .toBe('2026-11/registro-r1/comprovante/cd.png')
    })

    it('registro público não leva PIX, obs nem resposta', () => {
        const pub = registroPublico(
            { id: 'r1', mes: 11, ano: 2026, prestador_id: 7, prestador_nome: 'X', tipo_repasse: 'rpa', chave_pix: 'p@x', valor: '272.00', resposta: true, pago: false, obs: 'interno' },
            { temRelatorio: true, temComprovante: false },
        )
        expect(pub).toEqual({
            id: 'r1', competencia: { mes: 11, ano: 2026 }, prestador_id: 7, prestador_nome: 'X', tipo_repasse: 'rpa', valor: 272,
            pago: false, tem_relatorio: true, tem_comprovante: false,
        })
    })
})
