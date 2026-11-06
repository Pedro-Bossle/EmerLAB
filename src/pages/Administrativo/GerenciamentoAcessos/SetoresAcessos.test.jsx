import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import SetoresAcessos from './SetoresAcessos.jsx'
import { setoresEfetivos } from '../../../lib/setores.js'

const render = (props) =>
    renderToString(
        <SetoresAcessos
            setores={setoresEfetivos([])}
            usuarios={[]}
            tabelaAusente={false}
            carregando={false}
            onSalvar={async () => null}
            onExcluir={async () => {}}
            {...props}
        />,
    )

describe('SetoresAcessos (renderização)', () => {
    it('lista os cinco setores padrão e abre o primeiro', () => {
        const html = render({})
        for (const nome of ['Credenciamento', 'Vendas', 'Financeiro', 'Comercial', 'Gerenciamento']) {
            expect(html).toContain(nome)
        }
        expect(html).toContain('+ Novo setor')
        expect(html).toContain('Setor padrão do EmerLAB')
        expect(html).toContain('Nome do setor')
        expect(html).toContain('Salvar setor')
        expect(html).toContain('Restaurar padrão')
    })

    it('explica que o setor é um ponto de partida', () => {
        expect(render({})).toContain('ponto de partida')
    })

    it('mostra quantas pessoas estão vinculadas', () => {
        const html = render({ usuarios: [{ id: 'u1', name: 'Ana Souza', setores: ['credenciamento'] }] })
        expect(html).toContain('Ana Souza')
        expect(html.replace(/<!-- -->/g, '')).toContain('1 usuário')
    })

    it('avisa quando a tabela de setores ainda não existe', () => {
        const html = render({ tabelaAusente: true })
        expect(html).toContain('20261107120000_setores_acesso.sql')
    })
})
