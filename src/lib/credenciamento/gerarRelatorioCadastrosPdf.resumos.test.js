import { describe, expect, it } from 'vitest'
import {
    enriquecerMapaNomesUsuariosDeAuditoria,
    montarResumosRelatorioCadastros,
} from './gerarRelatorioCadastrosPdf.js'

describe('montarResumosRelatorioCadastros', () => {
    it('conta especialidades e cidades secundárias', () => {
        const linhas = [
            {
                nome: 'Clínica A',
                situacao: 'Credenciado',
                usuario: 'Ana',
                especialidadesTodas: ['Clínica', 'Laboratório'],
                cidadesTodas: ['Curitiba', 'São José dos Pinhais'],
            },
            {
                nome: 'Vet B',
                situacao: 'Credenciado',
                usuario: 'Bruno',
                especialidadesTodas: ['Clínica'],
                cidadesTodas: ['Curitiba'],
            },
        ]
        const r = montarResumosRelatorioCadastros(linhas)
        const espClinica = r.porEspecialidade.find((e) => e.label === 'Clínica')
        const espLab = r.porEspecialidade.find((e) => e.label === 'Laboratório')
        expect(espClinica?.total).toBe(2)
        expect(espClinica?.nomes).toEqual(expect.arrayContaining(['Clínica A', 'Vet B']))
        expect(espLab?.total).toBe(1)
        expect(espLab?.nomes).toEqual(['Clínica A'])

        const curitiba = r.porCidade.find((c) => c.label === 'Curitiba')
        const sjp = r.porCidade.find((c) => c.label === 'São José dos Pinhais')
        expect(curitiba?.total).toBe(2)
        expect(curitiba?.nomes).toEqual(expect.arrayContaining(['Clínica A', 'Vet B']))
        expect(sjp?.total).toBe(1)
        expect(sjp?.nomes).toEqual(['Clínica A'])
    })
})

describe('enriquecerMapaNomesUsuariosDeAuditoria', () => {
    it('regista nomes de vários usuários nos logs', () => {
        const mapa = new Map()
        enriquecerMapaNomesUsuariosDeAuditoria(
            [
                { usuario_id: 'u1', usuario_nome: 'Ana' },
                { usuario_id: 'u2', usuario_nome: 'Bruno' },
                { usuario_id: 'u1', usuario_nome: 'Ana Silva' },
            ],
            mapa,
        )
        expect(mapa.get('u1')).toBe('Ana')
        expect(mapa.get('u2')).toBe('Bruno')
    })
})
