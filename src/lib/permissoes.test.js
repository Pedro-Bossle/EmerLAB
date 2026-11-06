import { describe, expect, it } from 'vitest'
import { normalizarProfileAcesso, PERMISSION_KEYS } from './accessControl.js'
import {
    PERMISSION_CATALOG,
    aclCompleto,
    aclKey,
    assinaturaAcl,
    getToolMeta,
    listarTodasChavesAcl,
    sanitizarPermissionsParaSalvar,
} from './permissionCatalog.js'
import {
    MODELOS_PERMISSAO,
    aplicarModelo,
    aplicarNivelFerramenta,
    copiarPermissoesEmerlab,
    diffPermissoes,
    linhasDoDiff,
    nivelDaFerramenta,
    niveisDaFerramenta,
} from './permissoesNiveis.js'

const perfil = (permissions) => normalizarProfileAcesso({ id: 'u1', permissions }).permissions
const k = aclKey

describe('revogação e herança implícita', () => {
    it('respeita false explícito (antes voltava sozinho)', () => {
        const p = perfil({
            [k('credenciamento.processos', 'read')]: true,
            [k('configuracoes.conferencia_laboratorio', 'read')]: false,
        })
        expect(p[k('configuracoes.conferencia_laboratorio', 'read')]).toBe(false)
    })

    it('perfil gravado pela tela (conjunto completo) não ganha acesso implícito', () => {
        // só «Inbox do formulário: ler + editar»; o resto fica false explícito ao salvar
        const salvo = sanitizarPermissionsParaSalvar({
            [k('credenciamento.formulario_inbox', 'read')]: true,
            [k('credenciamento.formulario_inbox', 'update')]: true,
        })
        expect(aclCompleto(salvo)).toBe(true)
        const p = perfil(salvo)
        expect(p[k('configuracoes.conferencia_laboratorio', 'update')]).toBe(false)
        expect(p[k('configuracoes.observacoes_honorarios', 'delete')]).toBe(false)
        expect(p[k('configuracoes.observacoes_planos', 'create')]).toBe(false)
        expect(p[k('credenciamento.prospectos_osm', 'update')]).toBe(false)
        expect(p[k('credenciamento.formulario_inbox', 'update')]).toBe(true)
    })

    it('perfil antigo SEM chaves ACL continua herdando do legado (compatibilidade)', () => {
        const p = perfil({ [PERMISSION_KEYS.CREDENCIAMENTO_VIEW]: true, [PERMISSION_KEYS.CREDENCIAMENTO_EDIT]: true })
        expect(p[k('configuracoes.conferencia_laboratorio', 'update')]).toBe(true)
    })

    it('ferramenta nova (chave ausente) ainda é complementada em perfil antigo', () => {
        const parcial = { [k('credenciamento.processos', 'read')]: true }
        const p = perfil(parcial)
        expect(p[k('configuracoes.conferencia_laboratorio', 'read')]).toBe(true)
    })
})

describe('gravação', () => {
    it('grava todas as chaves ACL como true/false', () => {
        const salvo = sanitizarPermissionsParaSalvar({ [k('compras.orcamento', 'read')]: true })
        for (const chave of listarTodasChavesAcl()) expect(typeof salvo[chave]).toBe('boolean')
        expect(salvo[k('compras.orcamento', 'read')]).toBe(true)
        expect(salvo[k('compras.valor_venda', 'read')]).toBe(false)
    })

    it('descarta chaves desconhecidas', () => {
        const salvo = sanitizarPermissionsParaSalvar({ 'invasor.admin': true, [k('compras.orcamento', 'read')]: true })
        expect('invasor.admin' in salvo).toBe(false)
    })

    it('Gerenciar acessos só tem Ver e Editar (Criar/Excluir não existem)', () => {
        const tool = getToolMeta('admin.acessos')
        expect(tool.actions).toEqual(['read', 'update'])
    })

    it('assinaturaAcl ignora a ordem e muda com o conteúdo', () => {
        const a = { [k('compras.orcamento', 'read')]: true, [k('planos.impressao', 'read')]: true }
        const b = { [k('planos.impressao', 'read')]: true, [k('compras.orcamento', 'read')]: true }
        expect(assinaturaAcl(a)).toBe(assinaturaAcl(b))
        expect(assinaturaAcl(a)).not.toBe(assinaturaAcl({ [k('compras.orcamento', 'read')]: true }))
    })
})

describe('níveis por ferramenta', () => {
    const cadastro = getToolMeta('credenciamento.cadastro') // RCUD
    const mapa = getToolMeta('credenciamento.mapa') // R
    const negoc = getToolMeta('supertabela.negociacoes') // RU

    it('só oferece níveis que a ferramenta suporta', () => {
        expect(niveisDaFerramenta(cadastro).map((n) => n.id)).toEqual(['nenhum', 'ver', 'editar', 'total'])
        expect(niveisDaFerramenta(mapa).map((n) => n.id)).toEqual(['nenhum', 'ver'])
        expect(niveisDaFerramenta(negoc).map((n) => n.id)).toEqual(['nenhum', 'ver', 'editar'])
    })

    it('aplica e lê o nível (ida e volta)', () => {
        let p = {}
        for (const nivel of ['ver', 'editar', 'total', 'nenhum']) {
            p = aplicarNivelFerramenta(p, cadastro, nivel)
            expect(nivelDaFerramenta(p, cadastro)).toBe(nivel)
        }
    })

    it('Editar liga ler+adicionar+editar e NÃO liga excluir', () => {
        const p = aplicarNivelFerramenta({}, cadastro, 'editar')
        expect(p[k('credenciamento.cadastro', 'read')]).toBe(true)
        expect(p[k('credenciamento.cadastro', 'create')]).toBe(true)
        expect(p[k('credenciamento.cadastro', 'update')]).toBe(true)
        expect(p[k('credenciamento.cadastro', 'delete')]).toBe(false)
    })

    it('marcações fora do padrão aparecem como personalizado', () => {
        const p = { [k('credenciamento.cadastro', 'read')]: true, [k('credenciamento.cadastro', 'delete')]: true }
        expect(nivelDaFerramenta(p, cadastro)).toBe('personalizado')
    })
})

describe('modelos', () => {
    const algumaEscrita = (p) => listarTodasChavesAcl().some((x) => /\.(create|update|delete)$/.test(x) && p[x])

    it('«Somente leitura» não concede escrita nem administração', () => {
        const p = aplicarModelo({}, 'leitura')
        expect(algumaEscrita(p)).toBe(false)
        expect(p[PERMISSION_KEYS.ACCESS_MANAGE]).toBe(false)
        expect(p[k('compras.valor_venda', 'read')]).toBe(true)
    })

    it('«Administrador» liga Gerenciar acessos', () => {
        const p = aplicarModelo({}, 'administrador')
        expect(p[PERMISSION_KEYS.ACCESS_MANAGE]).toBe(true)
    })

    it('modelo não mexe no EmerMarketing', () => {
        const base = { [k('emermarketing.app', 'read')]: true }
        const p = aplicarModelo(base, 'leitura')
        expect(p[k('emermarketing.app', 'read')]).toBe(true)
    })

    it('ao editar a si mesmo mantém Gerenciar acessos', () => {
        const p = aplicarModelo({}, 'leitura', { preservarAdmin: true })
        expect(p[PERMISSION_KEYS.ACCESS_MANAGE]).toBe(true)
    })

    it('todos os modelos só citam grupos que existem', () => {
        const ids = new Set(PERMISSION_CATALOG.map((g) => g.id))
        for (const m of MODELOS_PERMISSAO) for (const g of Object.keys(m.grupos)) expect(ids.has(g)).toBe(true)
    })

    it('copiar de outro usuário traz o EmerLAB e preserva o marketing do destino', () => {
        const origem = aplicarModelo({}, 'financeiro')
        const destino = { [k('emermarketing.app', 'read')]: true }
        const p = copiarPermissoesEmerlab(destino, origem)
        expect(p[k('pagamentos.registro', 'update')]).toBe(true)
        expect(p[k('emermarketing.app', 'read')]).toBe(true)
    })
})

describe('comparação antes × depois', () => {
    const base = aplicarModelo({}, 'leitura')

    it('lista só o que mudou, no vocabulário da tela', () => {
        const cadastro = getToolMeta('credenciamento.cadastro')
        const depois = aplicarNivelFerramenta(base, cadastro, 'editar')
        const diff = diffPermissoes(base, depois)
        expect(diff).toHaveLength(1)
        expect(linhasDoDiff(diff)[0]).toBe('Credenciamento › Cadastros: Ver → Editar')
        expect(diff[0].sensivel).toBe(false)
    })

    it('sem mudança não há diferença', () => {
        expect(diffPermissoes(base, { ...base })).toEqual([])
    })

    it('marca como sensível dar Gerenciar acessos ou Excluir', () => {
        const admin = getToolMeta('admin.acessos')
        const cadastro = getToolMeta('credenciamento.cadastro')
        expect(diffPermissoes(base, aplicarNivelFerramenta(base, admin, 'editar'))[0].sensivel).toBe(true)
        expect(diffPermissoes(base, aplicarNivelFerramenta(base, cadastro, 'total'))[0].sensivel).toBe(true)
    })
})
