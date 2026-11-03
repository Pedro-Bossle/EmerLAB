/**
 * sincronizarPrestadorProcedimentos agora trabalha por diferença. Estes testes garantem que o ESTADO FINAL do
 * banco (códigos, ids de catálogo, nomes alternativos) é o mesmo de «apagar tudo e reinserir», e que linhas
 * inalteradas não são recriadas. Banco falso em memória (sem rede).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = { tabelas: {}, seq: 100, chamadas: [] }
const tab = (n) => (db.tabelas[n] ||= [])

function consulta(nome) {
    const filtros = []
    let modo = 'select'
    let payload
    const q = {
        select: () => q,
        eq: (k, v) => (filtros.push((r) => String(r[k]) === String(v)), q),
        in: (k, vs) => (filtros.push((r) => vs.map(String).includes(String(r[k]))), q),
        delete: () => ((modo = 'delete'), q),
        insert: (p) => ((modo = 'insert'), (payload = p), q),
        update: (p) => ((modo = 'update'), (payload = p), q),
        then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    }
    function exec() {
        db.chamadas.push(`${modo}:${nome}`)
        const linhas = tab(nome)
        if (modo === 'insert') {
            const novos = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: db.seq++, ...r }))
            linhas.push(...novos)
            return { data: novos, error: null }
        }
        const alvo = linhas.filter((r) => filtros.every((f) => f(r)))
        if (modo === 'delete') {
            db.tabelas[nome] = linhas.filter((r) => !alvo.includes(r))
            return { data: null, error: null }
        }
        if (modo === 'update') {
            alvo.forEach((r) => Object.assign(r, payload))
            return { data: null, error: null }
        }
        return { data: alvo.map((r) => ({ ...r })), error: null }
    }
    return q
}

vi.mock('./supabase.js', () => ({ supabase: { from: (n) => consulta(n) } }))

import { sincronizarPrestadorProcedimentos } from './prestadorProcedimentos.js'

const estado = () =>
    tab('prestador_procedimentos')
        .filter((r) => String(r.prestador_id) === '7')
        .map((r) => ({ cod: r.procedimento_cod, id: r.procedimento_id, alt: r.nome_alternativo ?? null }))
        .sort((a, b) => a.cod.localeCompare(b.cod))

beforeEach(() => {
    db.tabelas = {
        procedimentos: [
            { id: 1, codigo: 'CONS-001', nome: 'A' },
            { id: 2, codigo: 'CONS-002', nome: 'B' },
            { id: 3, codigo: 'EXAM-003', nome: 'C' },
        ],
        prestador_procedimentos: [
            { id: 10, prestador_id: 7, procedimento_cod: 'CONS-001', procedimento_id: 1, nome_alternativo: 'Consulta X' },
            { id: 11, prestador_id: 7, procedimento_cod: 'CONS-002', procedimento_id: 2, nome_alternativo: null },
            { id: 12, prestador_id: 8, procedimento_cod: 'CONS-001', procedimento_id: 1, nome_alternativo: null },
        ],
    }
    db.chamadas = []
})

describe('sincronizarPrestadorProcedimentos (por diferença)', () => {
    it('remove o que saiu, insere o que entrou e preserva o nome alternativo existente', async () => {
        await sincronizarPrestadorProcedimentos(7, ['CONS-001', 'EXAM-003'])
        expect(estado()).toEqual([
            { cod: 'CONS-001', id: 1, alt: 'Consulta X' },
            { cod: 'EXAM-003', id: 3, alt: null },
        ])
    })

    it('não recria linhas inalteradas (mesmo id) e não usa «apagar tudo»', async () => {
        await sincronizarPrestadorProcedimentos(7, ['CONS-001', 'CONS-002'])
        expect(tab('prestador_procedimentos').find((r) => r.procedimento_cod === 'CONS-001').id).toBe(10)
        expect(tab('prestador_procedimentos').find((r) => r.procedimento_cod === 'CONS-002').id).toBe(11)
        expect(db.chamadas.filter((c) => c === 'insert:prestador_procedimentos')).toHaveLength(0)
        expect(db.chamadas.filter((c) => c === 'delete:prestador_procedimentos')).toHaveLength(0)
    })

    it('aplica o mapa de nomes alternativos informado (inclusive limpar)', async () => {
        await sincronizarPrestadorProcedimentos(7, ['CONS-001', 'CONS-002'], new Map([['CONS-001', ''], ['CONS-002', 'Reconsulta']]))
        expect(estado()).toEqual([
            { cod: 'CONS-001', id: 1, alt: null },
            { cod: 'CONS-002', id: 2, alt: 'Reconsulta' },
        ])
    })

    it('lista vazia remove todos os vínculos do prestador, sem tocar nos de outro', async () => {
        await sincronizarPrestadorProcedimentos(7, [])
        expect(estado()).toEqual([])
        expect(tab('prestador_procedimentos').some((r) => String(r.prestador_id) === '8')).toBe(true)
    })

    it('código fora do catálogo continua falhando antes de gravar qualquer coisa', async () => {
        await expect(sincronizarPrestadorProcedimentos(7, ['CONS-001', 'NAO-EXISTE'])).rejects.toThrow(/sem id/)
        expect(estado().map((e) => e.cod)).toEqual(['CONS-001', 'CONS-002'])
    })
})
