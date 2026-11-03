import React from 'react'
import './CampoBuscaComLimpar.css'

/**
 * Searchbar padrão do EmerLab: ícone de lupa, botão «limpar», altura/raio/foco unificados
 * (ver CampoBuscaComLimpar.css). Mantém a API original para não alterar nenhuma tela:
 * o consumidor continua dono de `value`, `onChange`, debounce e submit.
 */
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
    comIcone = true,
}) {
    const temValor = String(value ?? '').length > 0
    const inputCls = inputClassName || className

    return (
        <div
            className={`campo_busca_limpar${disabled ? ' is-disabled' : ''}${comIcone ? ' has-icon' : ''}`}
        >
            {comIcone ? (
                <svg
                    className="campo_busca_limpar_icone"
                    viewBox="0 0 20 20"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                    focusable="false"
                >
                    <circle cx="9" cy="9" r="5.5" />
                    <path d="m13.2 13.2 4 4" />
                </svg>
            ) : null}
            <input
                id={id}
                type={type}
                className={inputCls}
                placeholder={placeholder}
                value={value}
                disabled={disabled}
                aria-label={ariaLabel || placeholder || undefined}
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
                    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                        <path d="m5 5 10 10M15 5 5 15" />
                    </svg>
                </button>
            ) : null}
        </div>
    )
}
