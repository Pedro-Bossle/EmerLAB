import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Combina classNames com merge inteligente do Tailwind. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
