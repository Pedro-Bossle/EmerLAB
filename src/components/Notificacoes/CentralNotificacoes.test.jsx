import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/accessControl', () => ({
    PERMISSION_KEYS: { NOTIFICACOES_CONTRATOS: 'c', NOTIFICACOES_FORMULARIO: 'f', PAGAMENTOS_VIEW: 'p' },
    useStoredPermission: () => true,
}))
vi.mock('../../lib/supabase', () => ({
    supabase: { channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} },
}))
vi.mock('../../lib/notifContagens', () => ({ publicarContagens: () => {} }))
vi.mock('../../lib/formularioCredenciamento', () => ({ FORMULARIO_ENTRADAS_CHANGE_EVENT: 'x' }))
vi.mock('../../lib/repasse/notificacoesPagamentos', () => ({ EVENTO_MUDANCA_NOTIF_PAGAMENTOS: 'y' }))
vi.mock('../../lib/notificacoesCentral', async () => {
    const real = await vi.importActual('../../lib/notificacoesCentral.js').catch(() => ({}))
    return {
        ...real,
        TIPOS_NOTIFICACAO: { generico: { icone: 'info', tom: 'info' } },
        agruparNotificacoes: () => [],
        carregarNotificacoesCentral: async () => [],
        dispensarNotificacao: async () => {},
        limparGrupoNotificacoes: async () => {},
        limparTudoNotificacoes: async () => {},
        rotuloAcessivelSino: (n) => (n ? `Notificações, ${n}` : 'Notificações, nenhum aviso'),
        rotuloTempoRelativo: () => 'agora',
    }
})

const { default: CentralNotificacoes } = await import('./CentralNotificacoes.jsx')

const render = (props) =>
    renderToString(
        <MemoryRouter>
            <CentralNotificacoes {...props} />
        </MemoryRouter>,
    )

describe('CentralNotificacoes (renderização)', () => {
    it('no desktop mostra o sino fixo e o painel fechado', () => {
        const html = render({})
        expect(html).toContain('nc_bell')
        expect(html).toContain('aria-label="Notificações, nenhum aviso"')
        expect(html).toContain('id="nc-painel"')
        expect(html).toContain('Limpar tudo')
        expect(html).not.toContain('nc_panel is-open')
    })

    it('abre o painel quando controlado como aberto', () => {
        const html = render({ open: true, onOpenChange: () => {} })
        expect(html).toContain('nc_panel is-open')
        expect(html).toContain('aria-expanded="true"')
    })

    it('no celular (compact) não desenha o sino fixo: quem abre é a barra inferior', () => {
        const html = render({ compact: true, open: false, onOpenChange: () => {} })
        expect(html).not.toContain('nc_bell')
        expect(html).toContain('id="nc-painel"')
    })
})
