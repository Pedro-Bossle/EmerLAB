import { cn } from '../../lib/cn'
import { Button } from './Button'

export function LoadingState({ className, label = 'Carregando…' }) {
  return (
    <div className={cn('ek-empty', className)} role="status">
      <div className="ek-spinner" aria-hidden="true" />
      <p className="ek-empty__desc">{label}</p>
    </div>
  )
}

export function EmptyState({ className, title, description, action }) {
  return (
    <div className={cn('ek-empty', className)}>
      <h3 className="ek-empty__title">{title}</h3>
      {description ? <p className="ek-empty__desc">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ className, title = 'Algo deu errado', description, onRetry }) {
  return (
    <div className={cn('ek-empty ek-empty--erro', className)} role="alert">
      <h3 className="ek-empty__title">{title}</h3>
      {description ? <p className="ek-empty__desc">{description}</p> : null}
      {onRetry ? (
        <Button variant="danger" className="mt-3" onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  )
}

/** Formato do conteúdo enquanto a rota carrega; o menu continua visível ao redor. */
export function SkeletonPagina({ className, label = 'Carregando a página' }) {
  const bloco = 'ek-skeleton'
  return (
    <div className={cn('flex w-full flex-col gap-3 p-4 sm:p-6', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className={cn(bloco, 'h-8 w-48')} />
      <div className={cn(bloco, 'h-11 w-full max-w-xl')} />
      <div className={cn(bloco, 'h-20 w-full')} />
      <div className={cn(bloco, 'h-20 w-full')} />
      <div className={cn(bloco, 'h-20 w-full')} />
    </div>
  )
}
