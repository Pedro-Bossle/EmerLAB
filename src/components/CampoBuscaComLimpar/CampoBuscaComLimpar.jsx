import React from 'react'
import './CampoBuscaComLimpar.css'

export default function CampoBuscaComLimpar({
    value,
    onChange,
    className = 'credenciamento_main_input',
    inputClassName,
    placeholder,
    type = 'text',
    disabled,
    id,
    'aria-label': ariaLabel,
    onKeyDown,
    onFocus,
    onBlur,
    autoComplete = 'off',
}) {
    const temValor = String(value ?? '').length > 0
    const inputCls = inputClassName || className

    return (
        <div className={`campo_busca_limpar${disabled ? ' is-disabled' : ''}`}>
            <input
                id={id}
                type={type}
                className={inputCls}
                placeholder={placeholder}
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                autoComplete={autoComplete}
                onChange={onChange}
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
            />
            {temValor && !disabled ? (
                <button
                    type="button"
                    className="campo_busca_limpar_btn"
                    aria-label="Limpar busca"
                    title="Limpar"
                    onClick={() => onChange({ target: { value: '' } })}
                >
                    ×
                </button>
            ) : null}
        </div>
    )
}
