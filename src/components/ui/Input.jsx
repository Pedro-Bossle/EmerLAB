import { cn } from '../../lib/cn'

export function Input({ className, label, hint, error, id, ...props }) {
  const inputId = id || props.name
  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <input
        id={inputId}
        className={cn(
          'min-h-touch w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[1rem] font-medium leading-normal text-ink placeholder:text-ink-muted/65 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro focus:ring-status-erro/20',
        )}
        {...props}
      />
      {hint && !error ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      {error ? <span className="text-xs font-semibold text-status-erro">{error}</span> : null}
    </label>
  )
}

export function Select({ className, label, hint, error, id, children, ...props }) {
  const selectId = id || props.name
  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <select
        id={selectId}
        className={cn(
          'min-h-touch w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[1rem] font-medium leading-normal text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro',
        )}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      {error ? <span className="text-xs font-semibold text-status-erro">{error}</span> : null}
    </label>
  )
}

export function Textarea({ className, label, hint, error, id, ...props }) {
  const areaId = id || props.name
  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-[#9eb4c8]">
          {label}
        </span>
      ) : null}
      <textarea
        id={areaId}
        className={cn(
          'min-h-24 w-full rounded-xl border border-line bg-white px-3 py-2 text-base font-medium text-ink placeholder:text-ink-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 dark:border-white/15 dark:bg-[#0f1e2e] dark:text-[#e8f1f8]',
          error && 'border-status-erro',
        )}
        {...props}
      />
      {hint && !error ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      {error ? <span className="text-xs font-semibold text-status-erro">{error}</span> : null}
    </label>
  )
}
