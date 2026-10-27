import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icone from './Icone.jsx'

// Filtro de departamento da lista: pill que abre um menu com a cor e a contagem de cada departamento.
// O menu fica em position: fixed porque a faixa de pills rola para o lado (overflow) e cortaria um menu absoluto.
export default function SeletorDepartamento({ departamentos, valor, aoMudar, contagem }) {
    const [aberto, setAberto] = useState(false)
    const [pos, setPos] = useState(null)
    const botao = useRef(null)
    const menu = useRef(null)

    // filtro pelo setor do atendente da conversa (não pelo departamento_id gravado nela)
    const opcoes = [
        { id: '', nome: 'Todos os setores', cor: null },
        ...departamentos.map((d) => ({ id: d.id, nome: d.nome, cor: d.cor })),
        { id: 'sem', nome: 'Sem atendente / sem setor', cor: null },
    ]
    const atual = opcoes.find((o) => o.id === valor) || opcoes[0]

    useLayoutEffect(() => {
        if (!aberto) return
        const r = botao.current.getBoundingClientRect()
        const largura = 260
        setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, innerWidth - largura - 8)), width: largura })
    }, [aberto])

    useEffect(() => {
        if (!aberto) return
        const fora = (e) => {
            if (!menu.current?.contains(e.target) && !botao.current?.contains(e.target)) setAberto(false)
        }
        const tecla = (e) => {
            if (e.key === 'Escape') {
                setAberto(false)
                botao.current?.focus()
            }
        }
        // a faixa rolou ou a janela mudou: o menu fixo ficaria solto
        const fechar = () => setAberto(false)
        document.addEventListener('mousedown', fora)
        document.addEventListener('keydown', tecla)
        const faixa = botao.current?.closest('.filtros')
        window.addEventListener('resize', fechar)
        faixa?.addEventListener('scroll', fechar)
        menu.current?.querySelector('[aria-checked="true"]')?.focus()
        return () => {
            document.removeEventListener('mousedown', fora)
            document.removeEventListener('keydown', tecla)
            window.removeEventListener('resize', fechar)
            faixa?.removeEventListener('scroll', fechar)
        }
    }, [aberto, pos])

    const escolher = (id) => {
        aoMudar(id)
        setAberto(false)
        botao.current?.focus()
    }

    // setas sobem e descem entre as opções
    const navegar = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const itens = [...menu.current.querySelectorAll('[role="menuitemradio"]')]
        const i = itens.indexOf(document.activeElement)
        itens[(i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length]?.focus()
    }

    return (
        <>
            <button
                ref={botao}
                type="button"
                className={`chip seletor-depto ${valor ? 'ativo' : ''}`}
                aria-haspopup="menu"
                aria-expanded={aberto}
                aria-label={`Filtrar por setor do atendente: ${atual.nome}`}
                onClick={() => setAberto((v) => !v)}
            >
                {atual.cor ? <span className="depto-ponto" style={{ '--tag': atual.cor }} /> : <Icone nome="filtro" tamanho={14} />}
                {valor ? atual.nome : 'Setores'}
                <Icone nome="baixo" tamanho={14} className={`seletor-depto-seta ${aberto ? 'aberto' : ''}`} />
            </button>
            {aberto && pos ? (
                <ul ref={menu} className="menu-depto" role="menu" aria-label="Setores do atendente" style={pos} onKeyDown={navegar}>
                    {opcoes.map((o, i) => (
                        <li key={o.id || 'todos'} role="none" className={i === 1 || i === opcoes.length - 1 ? 'separado' : ''}>
                            <button type="button" role="menuitemradio" aria-checked={o.id === valor} onClick={() => escolher(o.id)}>
                                <span className={`depto-ponto ${o.cor ? '' : 'vazio'}`} style={o.cor ? { '--tag': o.cor } : undefined} />
                                <span className="menu-depto-nome">{o.nome}</span>
                                {contagem?.[o.id] !== undefined ? <span className="menu-depto-qtd">{contagem[o.id]}</span> : null}
                                {o.id === valor ? <Icone nome="check" tamanho={16} className="menu-depto-check" /> : <span className="menu-depto-check" />}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </>
    )
}
