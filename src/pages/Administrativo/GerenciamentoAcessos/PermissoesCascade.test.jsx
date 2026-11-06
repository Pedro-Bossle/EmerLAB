import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import PermissoesCascade from './PermissoesCascade.jsx'
import { aplicarModelo } from '../../../lib/permissoesNiveis.js'

const render = (props) => renderToString(<PermissoesCascade permissions={aplicarModelo({}, 'leitura')} onChange={() => {}} {...props} />)

describe('PermissoesCascade (renderização)', () => {
    it('abre no modo Simples, com um nível por ferramenta', () => {
        const html = render({})
        expect(html).toContain('Simples')
        expect(html).toContain('Avançado')
        expect(html).toContain('Sem acesso')
        expect(html).toContain('>Ver<')
        expect(html).toContain('>Editar<')
        expect(html).toContain('>Total<')
        // matriz CRUD só aparece no modo Avançado
        expect(html).not.toContain('permissoes_cascade_legenda')
    })

    it('ao editar a si mesmo avisa que não pode tirar Gerenciar acessos', () => {
        const html = render({ usuarioId: 'x', usuarioAtualId: 'x' })
        expect(html).toContain('Você não pode tirar este acesso de si mesmo.')
    })

    it('mostra quantas ferramentas de cada grupo têm acesso', () => {
        // o SSR separa os números com comentários HTML; remove antes de procurar «1/1»
        expect(render({}).replace(/<!-- -->/g, '')).toMatch(/>\d+\/\d+</)
    })
})
