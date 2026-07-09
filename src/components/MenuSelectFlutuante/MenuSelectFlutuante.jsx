import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import './MenuSelectFlutuante.css'

/**
 * Seletor com painel flutuante (padrão row_add_suggest do projeto).
 */
export default function MenuSelectFlutuante({
    label,
    value = '',
    placeholder = '—',
    options = [],
    disabled = false,
    onChange,
    listMaxHeight = 240,
    className = '',
}) {
    const [aberto, setAberto] = useState(false)
    const wrapRef = useRef(null)
    const listId = useId()

    const rotuloAtual = useMemo(() => {
        const hit = options.find((o) => String(o.value) === String(value))
        return hit?.label ?? ''
    }, [options, value])

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            if (!wrapRef.current?.contains(e.target)) setAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [aberto])

    const escolher = (val) => {
        onChange?.(val)
        setAberto(false)
    }

    return (
        <div className={`menu_select_flutuante pcad_field ${className}`.trim()}>
            {label ? <span className="menu_select_flutuante_label">{label}</span> : null}
            <div ref={wrapRef} className="menu_select_flutuante_wrap row_add_suggest_wrap">
                <button
                    type="button"
                    className="menu_select_flutuante_trigger row_add_input"
                    disabled={disabled}
                    aria-haspopup="listbox"
                    aria-expanded={aberto}
                    aria-controls={listId}
                    onClick={() => {
                        if (disabled) return
                        setAberto((v) => !v)
                    }}
                >
                    <span className={rotuloAtual ? '' : 'is-placeholder'}>
                        {rotuloAtual || placeholder}
                    </span>
                    <span className="menu_select_flutuante_chevron" aria-hidden />
                </button>
                {aberto && !disabled ? (
                    <div
                        id={listId}
                        className="row_add_suggest_list menu_select_flutuante_list"
                        role="listbox"
                        style={{ maxHeight: listMaxHeight }}
                    >
                        <button
                            type="button"
                            className="row_add_suggest_item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => escolher('')}
                        >
                            <span>{placeholder}</span>
                        </button>
                        {options.length === 0 ? (
                            <div className="row_add_suggest_empty">Nenhuma opção</div>
                        ) : (
                            options.map((o) => (
                                <button
                                    key={String(o.value)}
                                    type="button"
                                    role="option"
                                    aria-selected={String(o.value) === String(value)}
                                    className={`row_add_suggest_item${
                                        String(o.value) === String(value) ? ' is-active' : ''
                                    }`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => escolher(o.value)}
                                >
                                    <span>{o.label}</span>
                                </button>
                            ))
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
