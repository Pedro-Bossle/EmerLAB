import { cn } from '../../lib/cn'

const tones = {
  ok: 'bg-status-ok-bg text-status-ok border-status-ok/20',
  warn: 'bg-status-warn-bg text-status-warn border-status-warn/20',
  erro: 'bg-status-erro-bg text-status-erro border-status-erro/20',
  pendente: 'bg-status-pendente-bg text-status-pendente border-status-pendente/20',
  neutral: 'bg-surface-tint text-ink-soft border-line dark:bg-white/5 dark:text-[#9eb4c8]',
}

export function Badge({ className, tone = 'neutral', children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold',
        tones[tone] || tones.neutral,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
