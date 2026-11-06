import { describe, expect, it } from 'vitest'
import { aclKey } from './permissionCatalog.js'
import {
    SETORES_PADRAO,
    aplicarSetoresAoPerfil,
    contarFerramentasDoSetor,
    ehSetorPadrao,
    filtrarIdsDeSetores,
    permissoesPadraoDoSetor,
    setoresEfetivos,
    slugSetor,
    unirPermissoes,
} from './setores.js'

const k = aclKey
const porId = (id) => setoresEfetivos().find((s) => s.id === id)

describe('setores padrão', () => {
    it('existem os cinco setores definidos', () => {
        expect(SETORES_PADRAO.map((s) => s.id)).toEqual(['credenciamento', 'vendas', 'financeiro', 'comercial', 'gerenciamento'])
        expect(ehSetorPadrao('vendas')).toBe(true)
        expect(ehSetorPadrao('outro')).toBe(false)
    })

    it('Credenciamento: todo o Credenciamento e as Tabelas de Valores (só ver)', () => {
        const p = porId('credenciamento').permissions
        expect(p[k('credenciamento.cadastro', 'update')]).toBe(true)
        expect(p[k('credenciamento.mapa', 'read')]).toBe(true)
        expect(p[k('supertabela.cidades', 'read')]).toBe(true)
        expect(p[k('supertabela.cidades', 'update')]).toBe(false)
        expect(p[k('pagamentos.registro', 'read')]).toBe(false)
    })

    it('Vendas: só as ferramentas listadas, sem o resto do Credenciamento', () => {
        const p = porId('vendas').permissions
        expect(p[k('credenciamento.quem_realiza', 'read')]).toBe(true)
        expect(p[k('credenciamento.mapa', 'read')]).toBe(true)
        expect(p[k('credenciamento.especialidades_cidade', 'read')]).toBe(true)
        expect(p[k('planos.impressao', 'create')]).toBe(true)
        expect(p[k('supertabela.tabelas', 'read')] ?? p[k('supertabela.planos', 'read')]).toBe(true)
        expect(p[k('credenciamento.cadastro', 'read')]).toBe(false)
        expect(p[k('credenciamento.processos', 'read')]).toBe(false)
    })

    it('Financeiro: Pagamentos; Comercial: EmerMarketing', () => {
        expect(porId('financeiro').permissions[k('pagamentos.caixa', 'update')]).toBe(true)
        expect(porId('financeiro').permissions[k('credenciamento.cadastro', 'read')]).toBe(false)
        expect(porId('comercial').permissions[k('emermarketing.app', 'read')]).toBe(true)
        expect(porId('comercial').permissions[k('pagamentos.registro', 'read')]).toBe(false)
    })

    it('Gerenciamento enxerga tudo e gerencia acessos', () => {
        const p = porId('gerenciamento').permissions
        expect(p['access.manage']).toBe(true)
        expect(p[k('credenciamento.cadastro', 'delete')]).toBe(true)
        expect(p[k('emermarketing.app', 'read')]).toBe(true)
    })

    it('os padrões não concedem Gerenciar acessos (exceto Gerenciamento)', () => {
        for (const s of setoresEfetivos().filter((x) => x.id !== 'gerenciamento')) {
            expect(s.permissions['access.manage']).toBe(false)
        }
    })

    it('contagem de ferramentas por setor', () => {
        expect(contarFerramentasDoSetor(porId('comercial').permissions)).toBe(1) // só Início
        expect(contarFerramentasDoSetor(porId('gerenciamento').permissions)).toBeGreaterThan(30)
    })
})

describe('setoresEfetivos', () => {
    it('a versão salva vence a padrão e setores novos aparecem', () => {
        const salvos = [
            { id: 'vendas', nome: 'Vendas e Pós', descricao: 'x', permissions: { [k('compras.orcamento', 'read')]: true }, ordem: 2 },
            { id: 'pos-venda', nome: 'Pós-venda', permissions: { [k('compras.orcamento', 'read')]: true }, ordem: 6 },
        ]
        const lista = setoresEfetivos(salvos)
        const vendas = lista.find((s) => s.id === 'vendas')
        expect(vendas.nome).toBe('Vendas e Pós')
        expect(vendas.salvo).toBe(true)
        expect(vendas.permissions[k('compras.orcamento', 'read')]).toBe(true)
        expect(vendas.permissions[k('credenciamento.mapa', 'read')]).toBe(false)
        const novo = lista.find((s) => s.id === 'pos-venda')
        expect(novo.padrao).toBe(false)
        expect(lista).toHaveLength(6)
    })

    it('setor sem linha no banco usa o padrão', () => {
        expect(setoresEfetivos([]).every((s) => s.salvo === false)).toBe(true)
    })
})

describe('preset de usuário', () => {
    const setores = setoresEfetivos()

    it('une as permissões de vários setores', () => {
        const p = aplicarSetoresAoPerfil({}, ['vendas', 'financeiro'], setores)
        expect(p[k('credenciamento.quem_realiza', 'read')]).toBe(true)
        expect(p[k('pagamentos.registro', 'update')]).toBe(true)
        expect(p[k('credenciamento.cadastro', 'read')]).toBe(false)
    })

    it('sem setor escolhido, nada é concedido', () => {
        const p = aplicarSetoresAoPerfil({ [k('compras.orcamento', 'read')]: true }, [], setores)
        expect(p[k('compras.orcamento', 'read')]).toBe(false)
    })

    it('ao editar a si mesmo mantém Gerenciar acessos', () => {
        const p = aplicarSetoresAoPerfil({}, ['vendas'], setores, { preservarAdmin: true })
        expect(p['access.manage']).toBe(true)
    })

    it('unirPermissoes é OR por chave', () => {
        const u = unirPermissoes([{ [k('compras.orcamento', 'read')]: true }, { [k('planos.impressao', 'read')]: true }])
        expect(u[k('compras.orcamento', 'read')]).toBe(true)
        expect(u[k('planos.impressao', 'read')]).toBe(true)
        expect(u[k('compras.valor_venda', 'read')]).toBe(false)
    })
})

describe('utilitários', () => {
    it('slugSetor', () => {
        expect(slugSetor('Pós-venda & Suporte')).toBe('pos-venda-suporte')
        expect(slugSetor('  ')).toBe('')
    })

    it('filtrarIdsDeSetores ignora desconhecidos e repetidos', () => {
        const s = setoresEfetivos()
        expect(filtrarIdsDeSetores(['vendas', 'vendas', 'xyz', 'financeiro'], s)).toEqual(['vendas', 'financeiro'])
        expect(filtrarIdsDeSetores(null, s)).toEqual([])
    })

    it('permissoesPadraoDoSetor sempre grava o conjunto completo', () => {
        const p = permissoesPadraoDoSetor({ id: 'x', grupos: {} })
        expect(Object.values(p).filter((v) => typeof v === 'boolean').length).toBeGreaterThan(80)
        expect(p[k('credenciamento.cadastro', 'read')]).toBe(false)
    })
})
