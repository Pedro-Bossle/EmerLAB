import { useRef, useState } from 'react'
import { VARIAVEIS } from '../variaveis.js'

// Formatação do WhatsApp: a marca envolve o texto
const FORMATOS = [
    ['*', 'Negrito', '*texto*'],
    ['_', 'Itálico', '_texto_'],
    ['~', 'Tachado', '~texto~'],
    ['```', 'Monoespaçado', '```texto```'],
]

// O que está sendo digitado antes do cursor pede sugestão?
function detectar(texto, pos) {
    const antes = texto.slice(0, pos)
    const v = antes.match(/\{\{?\s*([a-z_]*)$/i)
    if (v) return { tipo: 'var', inicio: pos - v[0].length, termo: v[1].toLowerCase() }
    // marca de formatação no começo de uma palavra (depois de espaço ou no início)
    const f = antes.match(/(^|\s)(\*|_|~|`{1,3})$/)
    if (f) return { tipo: 'fmt', inicio: pos - f[2].length, marca: f[2] }
    return null
}

function opcoesPara(g) {
    if (!g) return []
    if (g.tipo === 'var') {
        return VARIAVEIS.filter(([k, d]) => k.includes(g.termo) || d.toLowerCase().includes(g.termo)).map(([k, d]) => ({
            chave: k,
            rotulo: `{{${k}}}`,
            descricao: d,
            inserir: `{{${k}}}`,
            cursor: 0,
        }))
    }
    // a marca digitada vem primeiro; as outras continuam disponíveis
    const marca = g.marca.startsWith('`') ? '```' : g.marca
    return [...FORMATOS]
        .sort((a, b) => (b[0] === marca) - (a[0] === marca))
        .map(([m, nome, exemplo]) => ({ chave: m, rotulo: exemplo, descricao: nome, inserir: m + m, cursor: m.length }))
}

// Textarea com autocompletar de variáveis ({) e formatação do WhatsApp (* _ ~ `)
export default function TextoComSugestoes({ value, onChange, ...props }) {
    const campo = useRef(null)
    const [gatilho, setGatilho] = useState(null)
    const [indice, setIndice] = useState(0)
    const opcoes = opcoesPara(gatilho)

    const reavaliar = (texto, pos) => {
        const g = detectar(texto, pos)
        setGatilho(g)
        setIndice(0)
    }

    const aplicar = (op) => {
        const el = campo.current
        const pos = el.selectionStart
        const novo = value.slice(0, gatilho.inicio) + op.inserir + value.slice(pos)
        const cursor = gatilho.inicio + op.inserir.length - op.cursor
        onChange(novo)
        setGatilho(null)
        requestAnimationFrame(() => {
            el.focus()
            el.setSelectionRange(cursor, cursor)
        })
    }

    const aoTeclar = (e) => {
        if (!opcoes.length) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const passo = e.key === 'ArrowDown' ? 1 : -1
            setIndice((i) => (i + passo + opcoes.length) % opcoes.length)
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            aplicar(opcoes[indice])
        } else if (e.key === 'Escape') {
            // fecha só a sugestão, não o modal em volta
            e.preventDefault()
            e.stopPropagation()
            setGatilho(null)
        }
    }

    return (
        <div className="texto-sugestoes">
            <textarea
                {...props}
                ref={campo}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value)
                    reavaliar(e.target.value, e.target.selectionStart)
                }}
                onKeyDown={aoTeclar}
                onClick={(e) => reavaliar(value, e.target.selectionStart)}
                onBlur={() => setGatilho(null)}
                aria-autocomplete="list"
                aria-expanded={opcoes.length > 0}
            />
            {opcoes.length ? (
                <ul className="sugestoes sugestoes-abaixo" role="listbox" aria-label={gatilho.tipo === 'var' ? 'Variáveis' : 'Formatação'}>
                    {opcoes.map((op, i) => (
                        <li key={op.chave} role="option" aria-selected={i === indice}>
                            {/* mousedown para não perder o foco do campo antes de aplicar */}
                            <button
                                type="button"
                                className={i === indice ? 'ativo' : ''}
                                onMouseEnter={() => setIndice(i)}
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    aplicar(op)
                                }}
                            >
                                <strong>{op.rotulo}</strong>
                                <span className="sug-texto">{op.descricao}</span>
                            </button>
                        </li>
                    ))}
                    <li className="sugestoes-dica" aria-hidden="true">
                        ↑↓ navegar · Enter inserir · Esc fechar
                    </li>
                </ul>
            ) : null}
        </div>
    )
}
