import React, { useCallback, useEffect, useRef, useState } from 'react'

const ALTURA_ITEM = 40

/**
 * Lista com janela virtual simples (scroll) para muitas cidades.
 */
export default function CidadesAtendeVirtualList({ itens, onRemover, somenteLeitura }) {
    const [scrollTop, setScrollTop] = useState(0)
    const [alturaViewport, setAlturaViewport] = useState(240)
    const ref = useRef(null)

    const medir = useCallback(() => {
        if (ref.current) setAlturaViewport(ref.current.clientHeight || 240)
    }, [])

    useEffect(() => {
        medir()
        window.addEventListener('resize', medir)
        return () => window.removeEventListener('resize', medir)
    }, [medir, itens.length])

    const total = itens.length
    const inicio = Math.max(0, Math.floor(scrollTop / ALTURA_ITEM) - 2)
    const fim = Math.min(total, inicio + Math.ceil(alturaViewport / ALTURA_ITEM) + 4)
    const visiveis = itens.slice(inicio, fim)
    const alturaTotal = total * ALTURA_ITEM

    if (total === 0) {
        return (
            <div className="pcad_cidades_virtual pcad_cidades_virtual--empty" aria-label="Lista de cidades">
                <p className="pcad_muted">Nenhuma cidade cadastrada.</p>
            </div>
        )
    }

    return (
        <div
            ref={ref}
            className="pcad_cidades_virtual"
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            role="list"
        >
            <div style={{ height: alturaTotal, position: 'relative' }}>
                {visiveis.map((c, idx) => {
                    const i = inicio + idx
                    return (
                        <div
                            key={`${c.cidadeId}-${c.uf}`}
                            className={`pcad_cidades_virtual_item${i % 2 === 1 ? ' is-alt' : ''}`}
                            style={{ top: i * ALTURA_ITEM, height: ALTURA_ITEM }}
                            role="listitem"
                        >
                            <span className="pcad_cidades_virtual_nome">
                                <strong>{c.nome}</strong>
                                {c.uf ? <span className="pcad_cidades_virtual_uf"> · {c.uf}</span> : null}
                            </span>
                            {!somenteLeitura && (
                                <button type="button" className="pcad_link_btn danger" onClick={() => onRemover(c.cidadeId)}>
                                    Remover
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
