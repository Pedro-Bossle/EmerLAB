import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createPortal } from 'react-dom'

import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'



/**

 * Campo de pesquisa com sugestões de prestadores/clínicas credenciados.

 * `usePortal`: lista fixa no body (recomendado em tabelas).

 */

export default function PrestadorVinculoBusca({

    prestadores = [],

    prestadorId = '',

    onChange,

    disabled = false,

    rotuloFn,

    placeholder = 'Digite para buscar clínica ou prestador…',

    usePortal = false,

    titleValor,

}) {

    const [texto, setTexto] = useState('')

    const [aberto, setAberto] = useState(false)

    const [popupStyle, setPopupStyle] = useState(null)

    const wrapRef = useRef(null)



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



    const atualizarPosicaoPortal = useCallback(() => {

        const input = wrapRef.current?.querySelector('input')

        if (!input) return

        const rect = input.getBoundingClientRect()

        setPopupStyle({

            top: rect.bottom + 4,

            left: rect.left,

            width: Math.max(rect.width, 220),

        })

    }, [])



    useEffect(() => {

        if (!aberto || !usePortal) return

        atualizarPosicaoPortal()

        const onReposicionar = () => atualizarPosicaoPortal()

        window.addEventListener('resize', onReposicionar)

        window.addEventListener('scroll', onReposicionar, true)

        return () => {

            window.removeEventListener('resize', onReposicionar)

            window.removeEventListener('scroll', onReposicionar, true)

        }

    }, [aberto, usePortal, atualizarPosicaoPortal, sugestoes.length])



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



    const abrirSugestoes = () => {
        if (disabled) return
        if (usePortal) atualizarPosicaoPortal()
        setAberto(true)
    }



    const listaSugestoes = (

        <>

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

        </>

    )



    const painelPortal =
        usePortal &&
        aberto &&
        !disabled &&
        popupStyle &&
        typeof document !== 'undefined'
            ? createPortal(
                  <div
                      className='row_add_suggest_list is-portal prestador_vinculo_busca_portal'
                      role='listbox'
                      onMouseDown={(event) => event.preventDefault()}
                      style={{
                          position: 'fixed',
                          top: `${popupStyle.top}px`,
                          left: `${popupStyle.left}px`,
                          width: `${popupStyle.width}px`,
                      }}
                  >
                      {listaSugestoes}
                  </div>,
                  document.body,
              )
            : null



    return (

        <div ref={wrapRef} className='row_add_suggest_wrap prestador_vinculo_busca'>

            <input

                type='text'

                className='row_add_input prestador_vinculo_busca_input'

                value={texto}

                disabled={disabled}

                placeholder={placeholder}

                title={titleValor ?? (texto || placeholder)}

                autoComplete='off'

                onChange={(event) => {

                    setTexto(event.target.value)

                    abrirSugestoes()

                }}

                onFocus={abrirSugestoes}

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

            {!usePortal && aberto && !disabled && (
                <div className='row_add_suggest_list' role='listbox'>
                    {listaSugestoes}
                </div>
            )}
            {painelPortal}

        </div>

    )

}


