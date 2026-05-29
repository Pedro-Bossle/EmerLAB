import React, { useEffect, useMemo, useState } from 'react'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'

/**
 * Campo de pesquisa com sugestões de prestadores/clínicas credenciados.
 */
export default function PrestadorVinculoBusca({
    prestadores = [],
    prestadorId = '',
    onChange,
    disabled = false,
    rotuloFn,
    placeholder = 'Digite para buscar clínica ou prestador…',
}) {
    const [texto, setTexto] = useState('')
    const [aberto, setAberto] = useState(false)

    const selecionado = useMemo(
        () => (prestadores || []).find((p) => String(p.id) === String(prestadorId)) || null,
        [prestadores, prestadorId],
    )

    useEffect(() => {
        if (aberto) return
        if (selecionado && rotuloFn) setTexto(rotuloFn(selecionado))
        else if (!prestadorId) setTexto('')
    }, [selecionado, prestadorId, aberto, rotuloFn])

    const sugestoes = useMemo(() => {
        const termo = normalizarTextoBusca(texto)
        let lista = [...(prestadores || [])]
        if (termo) {
            lista = lista.filter((p) => {
                const nome = normalizarTextoBusca(p.nome)
                const rotulo = rotuloFn ? normalizarTextoBusca(rotuloFn(p)) : nome
                return nome.includes(termo) || rotulo.includes(termo)
            })
        }
        return lista.slice(0, 35)
    }, [texto, prestadores, rotuloFn])

    const escolher = (p) => {
        onChange(p)
        setTexto(p && rotuloFn ? rotuloFn(p) : '')
        setAberto(false)
    }

    const limparVinculo = () => {
        onChange(null)
        setTexto('')
        setAberto(false)
    }

    return (
        <div className='row_add_suggest_wrap prestador_vinculo_busca'>
            <input
                type='text'
                className='row_add_input prestador_vinculo_busca_input'
                value={texto}
                disabled={disabled}
                placeholder={placeholder}
                autoComplete='off'
                onChange={(event) => {
                    setTexto(event.target.value)
                    setAberto(true)
                    if (prestadorId) onChange(null)
                }}
                onFocus={() => {
                    if (!disabled) setAberto(true)
                }}
                onBlur={() => {
                    setTimeout(() => setAberto(false), 180)
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && sugestoes[0]) {
                        event.preventDefault()
                        escolher(sugestoes[0])
                    }
                    if (event.key === 'Escape') setAberto(false)
                }}
            />
            {aberto && !disabled && (
                <div className='row_add_suggest_list' role='listbox'>
                    <button
                        type='button'
                        className='row_add_suggest_item'
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={limparVinculo}
                    >
                        <span>—</span>
                        <small>Nenhum vínculo</small>
                    </button>
                    {sugestoes.length === 0 ? (
                        <div className='row_add_suggest_empty'>Nenhum prestador encontrado</div>
                    ) : (
                        sugestoes.map((p) => (
                            <button
                                key={p.id}
                                type='button'
                                className={`row_add_suggest_item${
                                    String(p.id) === String(prestadorId) ? ' is-active' : ''
                                }`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => escolher(p)}
                            >
                                <span>{rotuloFn ? rotuloFn(p) : p.nome}</span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
