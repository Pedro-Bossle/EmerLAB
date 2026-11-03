import { cn } from '../../lib/cn'

/** Tabela do UI Kit: rola na horizontal dentro do próprio quadro; `stack` vira lista de cartões no celular (td[data-label]). */
export function ResponsiveTable({ className, children, stack = false, ...props }) {
  return (
    <div className={cn('ek-table-wrap', className)}>
      <table className={cn('ek-table', stack && 'ek-table--stack')} style={stack ? undefined : { minWidth: 640 }} {...props}>
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
      {title ? <p className="truncate font-bold" style={{ color: 'var(--ek-ink)' }}>{title}</p> : null}
      {subtitle ? <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--ek-ink-muted)' }}>{subtitle}</p> : null}
      {meta ? <div className="mt-2 flex flex-wrap gap-2">{meta}</div> : null}
    </div>
  )

  return (
    <li className={cn('ek-list-card', className)}>
      <div className="flex items-start justify-between gap-3">
        {onClick ? (
          <button type="button" onClick={onClick} className="min-w-0 flex-1 cursor-pointer rounded-lg text-left">
            {body}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{body}</div>
        )}
        {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--ek-line)' }}>{children}</div> : null}
    </li>
  )
}
