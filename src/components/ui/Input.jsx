import { createElement, useId } from 'react'
import { SelectDropdown } from './Dropdown'
import { cn } from '../../lib/cn'

/** Campos do UI Kit (ek-field / ek-label / ek-input / ek-select / ek-textarea). Ver docs/ui-kit.md. */
function composeDescribedBy(existing, ...ids) {
  const parts = [existing, ...ids].flatMap((v) => String(v || '').split(/\s+/)).filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

function Campo({ tag, sufixoId, controlClass, className, label, hint, error, id, 'aria-describedby': ariaDescribedBy, children, ...props }) {
  const reactId = useId()
  const controlId = id || props.name || `${reactId}-${sufixoId}`
  const errorId = `${reactId}-error`
  const hintId = `${reactId}-hint`
  const describedBy = composeDescribedBy(ariaDescribedBy, hint && !error ? hintId : null, error ? errorId : null)

  return (
    <label className={cn('ek-field', className)}>
      {label ? <span className="ek-label">{label}</span> : null}
      {createElement(
        tag === 'select' ? SelectDropdown : tag,
        {
          id: controlId,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          'aria-errormessage': error ? errorId : undefined,
          className: controlClass,
          ...props,
        },
        children,
      )}
      {hint && !error ? (
        <span id={hintId} className="ek-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="ek-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}

export function Input(props) {
  return <Campo tag="input" sufixoId="input" controlClass="ek-input" {...props} />
}

export function Select({ children, ...props }) {
  return (
    <Campo tag="select" sufixoId="select" controlClass="ek-select" {...props}>
      {children}
    </Campo>
  )
}

export function Textarea(props) {
  return <Campo tag="textarea" sufixoId="textarea" controlClass="ek-textarea" {...props} />
}
