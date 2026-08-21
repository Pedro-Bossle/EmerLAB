import { useId } from 'react'
import { cn } from '../../lib/cn'

function composeDescribedBy(existing, ...ids) {
  const parts = [existing, ...ids].flatMap((v) => String(v || '').split(/\s+/)).filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

export function Input({ className, label, hint, error, id, 'aria-describedby': ariaDescribedBy, ...props }) {
  const reactId = useId()
  const controlId = id || `${reactId}-input`
  const errorId = `${reactId}-error`
  const hintId = `${reactId}-hint`
  const describedBy = composeDescribedBy(
    ariaDescribedBy,
    hint && !error ? hintId : null,
    error ? errorId : null,
  )

  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <input
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-errormessage={error ? errorId : undefined}
        className={cn(
          'min-h-touch w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[1rem] font-medium leading-normal text-ink placeholder:text-ink-muted/65 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro focus:ring-status-erro/20',
        )}
        {...props}
      />
      {hint && !error ? (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs font-semibold text-status-erro" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}

export function Select({
  className,
  label,
  hint,
  error,
  id,
  children,
  'aria-describedby': ariaDescribedBy,
  ...props
}) {
  const reactId = useId()
  const controlId = id || props.name || `${reactId}-select`
  const errorId = `${reactId}-error`
  const hintId = `${reactId}-hint`
  const describedBy = composeDescribedBy(
    ariaDescribedBy,
    hint && !error ? hintId : null,
    error ? errorId : null,
  )

  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <select
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-errormessage={error ? errorId : undefined}
        className={cn(
          'min-h-touch w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[1rem] font-medium leading-normal text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro',
        )}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs font-semibold text-status-erro" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}

export function Textarea({
  className,
  label,
  hint,
  error,
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}) {
  const reactId = useId()
  const controlId = id || props.name || `${reactId}-textarea`
  const errorId = `${reactId}-error`
  const hintId = `${reactId}-hint`
  const describedBy = composeDescribedBy(
    ariaDescribedBy,
    hint && !error ? hintId : null,
    error ? errorId : null,
  )

  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <textarea
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-errormessage={error ? errorId : undefined}
        className={cn(
          'min-h-24 w-full rounded-xl border border-line bg-white px-3 py-2 text-base font-medium text-ink placeholder:text-ink-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro',
        )}
        {...props}
      />
      {hint && !error ? (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs font-semibold text-status-erro" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
