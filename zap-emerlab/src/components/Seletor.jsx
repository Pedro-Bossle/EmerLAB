import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icone from './Icone.jsx'

// Lista suspensa no visual do painel. O <select> nativo abre a lista do sistema, que não aceita estilo;
// este segue a mesma API de um select controlado: `valor` + `aoMudar(valor)`, com `opcoes` = [{ valor, rotulo, cor? }].
// O menu vai para o <body> (portal) em position: fixed, para não ser cortado por modal, painel ou lista com rolagem.
export default function Seletor({ valor, opcoes, aoMudar, className = 'entrada', ativo = false, id, 'aria-label': ariaLabel }) {
    const [aberto, setAberto] = useState(false)
    const [pos, setPos] = useState(null)
    const botao = useRef(null)
    const menu = useRef(null)
    const listaId = useId()
    const atual = opcoes.find((o) => String(o.valor) === String(valor ?? '')) || opcoes[0]

    // abaixo do campo; sem espaço embaixo, abre para cima
    useLayoutEffect(() => {
        if (!aberto) return
        const r = botao.current.getBoundingClientRect()
        // pelo menos a largura do campo; cresce até caber o maior nome (campo estreito não corta as opções)
        const minimo = Math.max(r.width, 200)
        const maximo = Math.min(Math.max(minimo, 320), innerWidth - 16)
        const abaixo = innerHeight - r.bottom - 12
        const acima = r.top - 12
        const paraCima = abaixo < 220 && acima > abaixo
        setPos({
            left: Math.max(8, Math.min(r.left, innerWidth - maximo - 8)),
            width: 'max-content',
            minWidth: minimo,
            maxWidth: maximo,
            maxHeight: Math.min(320, paraCima ? acima : abaixo),
            ...(paraCima ? { bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
        })
    }, [aberto])

    useEffect(() => {
        if (!aberto) return
        const fechar = () => setAberto(false)
        // como no select nativo, o clique fora só fecha a lista: não chega ao que está embaixo
        // (o fundo do modal fecharia o modal; um card abriria a conversa)
        const fora = (e) => {
            if (menu.current?.contains(e.target) || botao.current?.contains(e.target)) return
            e.stopPropagation()
            e.preventDefault()
            fechar()
            const engolir = (c) => {
                c.stopPropagation()
                c.preventDefault()
            }
            window.addEventListener('click', engolir, { capture: true, once: true })
            setTimeout(() => window.removeEventListener('click', engolir, { capture: true }), 600)
        }
        // captura: o Esc fecha só a lista, sem chegar ao modal nem ao atalho do painel
        const tecla = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                e.preventDefault()
                fechar()
                botao.current?.focus()
            } else if (e.key === 'Tab') fechar()
        }
        // rolou algo que contém o campo (página, modal, painel): o menu fixo ficaria solto. Rolagens alheias,
        // como o chat descendo sozinho com mensagem nova, não fecham.
        const rolou = (e) => {
            const alvo = e.target === document ? document.documentElement : e.target
            if (!menu.current?.contains(alvo) && alvo?.contains?.(botao.current)) fechar()
        }
        window.addEventListener('mousedown', fora, true)
        window.addEventListener('keydown', tecla, true)
        window.addEventListener('scroll', rolou, true)
        window.addEventListener('resize', fechar)
        const marcado = menu.current?.querySelector('[aria-selected="true"]') || menu.current?.querySelector('[role="option"]')
        marcado?.focus({ preventScroll: true })
        marcado?.scrollIntoView({ block: 'nearest' })
        return () => {
            window.removeEventListener('mousedown', fora, true)
            window.removeEventListener('keydown', tecla, true)
            window.removeEventListener('scroll', rolou, true)
            window.removeEventListener('resize', fechar)
        }
    }, [aberto, pos])

    const escolher = (v) => {
        setAberto(false)
        botao.current?.focus()
        if (String(v) !== String(valor ?? '')) aoMudar(v)
    }

    // setas, Home/End e letra inicial, como num select
    const navegar = (e) => {
        const itens = [...menu.current.querySelectorAll('[role="option"]')]
        const i = itens.indexOf(document.activeElement)
        let alvo = null
        if (e.key === 'ArrowDown') alvo = itens[(i + 1) % itens.length]
        else if (e.key === 'ArrowUp') alvo = itens[(i - 1 + itens.length) % itens.length]
        else if (e.key === 'Home') alvo = itens[0]
        else if (e.key === 'End') alvo = itens.at(-1)
        else if (e.key.length === 1 && /\S/.test(e.key)) {
            const letra = e.key.toLowerCase()
            const depois = [...itens.slice(i + 1), ...itens.slice(0, i + 1)]
            alvo = depois.find((b) => b.textContent.trim().toLowerCase().startsWith(letra))
        }
        if (!alvo) return
        e.preventDefault()
        e.stopPropagation()
        alvo.focus({ preventScroll: true })
        alvo.scrollIntoView({ block: 'nearest' })
    }

    const abrirPeloTeclado = (e) => {
        if (aberto || !['ArrowDown', 'ArrowUp'].includes(e.key)) return
        e.preventDefault()
        setAberto(true)
    }

    return (
        <>
            <button
                ref={botao}
                id={id}
                type="button"
                className={`${className} seletor ${ativo ? 'ativo' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={aberto}
                aria-controls={aberto ? listaId : undefined}
                aria-label={ariaLabel}
                onClick={() => setAberto((v) => !v)}
                onKeyDown={abrirPeloTeclado}
            >
                {atual?.cor ? <span className="depto-ponto" style={{ '--tag': atual.cor }} /> : null}
                <span className="seletor-nome">{atual?.rotulo}</span>
                <Icone nome="baixo" tamanho={16} className={`seletor-depto-seta ${aberto ? 'aberto' : ''}`} />
            </button>
            {aberto && pos
                ? createPortal(
                      <ul ref={menu} id={listaId} className="menu-depto menu-seletor" role="listbox" aria-label={ariaLabel} style={pos} onKeyDown={navegar}>
                          {opcoes.map((o) => {
                              const marcado = o === atual
                              return (
                                  <li key={String(o.valor)} role="none">
                                      <button type="button" role="option" aria-selected={marcado} tabIndex={-1} onClick={() => escolher(o.valor)}>
                                          {o.cor !== undefined ? <span className={`depto-ponto ${o.cor ? '' : 'vazio'}`} style={o.cor ? { '--tag': o.cor } : undefined} /> : null}
                                          <span className="menu-depto-nome">{o.rotulo}</span>
                                          {marcado ? <Icone nome="check" tamanho={16} className="menu-depto-check" /> : <span className="menu-depto-check" />}
                                      </button>
                                  </li>
                              )
                          })}
                      </ul>,
                      document.body,
                  )
                : null}
        </>
    )
}
