import { cn } from '../../lib/cn'

const variants = {
  primary:
    'bg-brand text-white shadow-soft hover:bg-brand-deep disabled:opacity-60',
  secondary:
    'border border-line bg-white text-ink hover:bg-surface-tint dark:border-white/15 dark:bg-[#152433] dark:text-[#e8f1f8]',
  ghost:
    'bg-transparent text-ink-soft hover:bg-brand-pale/60 dark:text-[#9eb4c8] dark:hover:bg-white/5',
  danger:
    'border border-status-erro/30 bg-status-erro-bg text-status-erro hover:bg-red-100',
  success:
    'border border-status-ok/30 bg-status-ok-bg text-status-ok hover:bg-emerald-100',
}

const sizes = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-touch px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
  icon: 'h-11 w-11 p-0',
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed',
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** Classes partilhadas do Button para usar em <Link> / <a> sem aninhar botões. */
export function buttonClassName({ className, variant = 'primary', size = 'md' } = {}) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed',
    variants[variant] || variants.primary,
    sizes[size] || sizes.md,
    className,
  )
}
