import { cn } from '../../lib/cn'

/** Variantes e tamanhos do Button: classes do UI Kit (src/styles/emerlab-kit.css, docs/ui-kit.md). */
export const buttonVariants = {
  primary: '',
  secondary: 'ek-btn--secondary',
  ghost: 'ek-btn--ghost',
  danger: 'ek-btn--danger',
  /** Ação destrutiva confirmada (ex.: «Excluir prestador»). */
  dangerSolid: 'ek-btn--danger-solid',
  success: 'ek-btn--success',
  soft: 'ek-btn--soft',
}

/* Altura 40 px (44 px em tela de toque, pelo próprio kit). sm = ações dentro de tabela. */
export const buttonSizes = {
  sm: 'ek-btn--sm',
  md: '',
  lg: 'ek-btn--lg',
  icon: 'ek-btn--icon',
}

/** Classes compartilhadas do Button para usar em <Link> / <a> sem aninhar botões. */
export function buttonClassName({ className, variant = 'primary', size = 'md' } = {}) {
  return cn(
    'ek-btn',
    buttonVariants[variant] ?? buttonVariants.primary,
    buttonSizes[size] ?? buttonSizes.md,
    className,
  )
}
