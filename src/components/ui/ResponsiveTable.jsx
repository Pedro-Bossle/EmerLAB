import { cn } from '../../lib/cn'

/**
 * Tabela com scroll horizontal no mobile; cards opcionais via `mobileCards`.
 */
export function ResponsiveTable({ className, children, ...props }) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-xl border border-line dark:border-white/10', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm" {...props}>
        {children}
      </table>
    </div>
  )
}

export function ResponsiveList({ className, children }) {
  return <ul className={cn('flex flex-col gap-3', className)}>{children}</ul>
}

export function ListCard({ className, title, subtitle, meta, actions, onClick, children }) {
  const body = (
    <div className="min-w-0">
      {title ? <p className="truncate font-bold text-ink dark:text-[#e8f1f8]">{title}</p> : null}
      {subtitle ? (
        <p className="mt-0.5 truncate text-sm text-ink-soft dark:text-[#9eb4c8]">{subtitle}</p>
      ) : null}
      {meta ? <div className="mt-2 flex flex-wrap gap-2">{meta}</div> : null}
    </div>
  )

  return (
    <li
      className={cn(
        'w-full rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-brand/40 dark:border-white/10 dark:bg-[#1a2838]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="min-w-0 flex-1 cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {body}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{body}</div>
        )}
        {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 border-t border-line/70 pt-3 dark:border-white/10">{children}</div> : null}
    </li>
  )
}
