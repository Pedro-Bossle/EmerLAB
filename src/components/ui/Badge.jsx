import { cn } from '../../lib/cn'

/** Status do UI Kit (ek-badge). `pendente` = informação. */
const tones = {
  ok: 'ek-badge--ok',
  warn: 'ek-badge--warn',
  erro: 'ek-badge--erro',
  pendente: 'ek-badge--info',
  info: 'ek-badge--info',
  neutral: '',
}

export function Badge({ className, tone = 'neutral', children, ...props }) {
  return (
    <span className={cn('ek-badge', tones[tone] ?? '', className)} {...props}>
      {children}
    </span>
  )
}
