import { cn } from '../../lib/cn'
import { Button } from './Button'

export function LoadingState({ className, label = 'Carregando…' }) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface-tint/60 p-8 text-ink-soft dark:border-white/10 dark:bg-white/5',
        className,
      )}
      role="status"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  )
}

export function EmptyState({ className, title, description, action }) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-tint/50 p-8 text-center dark:border-white/10 dark:bg-white/5',
        className,
      )}
    >
      <h3 className="font-display text-lg font-bold text-ink dark:text-[#e8f1f8]">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-ink-soft dark:text-[#9eb4c8]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ className, title = 'Algo deu errado', description, onRetry }) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-status-erro/25 bg-status-erro-bg p-8 text-center',
        className,
      )}
      role="alert"
    >
      <h3 className="font-display text-lg font-bold text-status-erro">{title}</h3>
      {description ? <p className="max-w-md text-sm text-status-erro/90">{description}</p> : null}
      {onRetry ? (
        <Button variant="danger" className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  )
}
