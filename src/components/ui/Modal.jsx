import { useEffect, useId, useRef } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function useDialogFocus({ open, onClose, panelRef }) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    const panel = panelRef.current
    if (!panel) return undefined

    const previouslyFocused = document.activeElement
    const focusables = () => [...panel.querySelectorAll(FOCUSABLE)].filter(
      (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
    )

    const focusFirst = () => {
      const list = focusables()
      const target = list[0] || panel
      if (typeof target.focus === 'function') target.focus()
    }

    const frame = window.requestAnimationFrame(focusFirst)

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [open, panelRef])
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
}) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus({ open, onClose, panelRef })

  if (!open) return null

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[min(96vw,56rem)]',
  }

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Diálogo'}
        className={cn(
          'relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-lift dark:border-white/10 dark:bg-[#1a2838] sm:rounded-2xl',
          widths[size] || widths.md,
          className,
        )}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="font-display text-lg font-bold text-ink dark:text-[#e8f1f8]">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="mt-0.5 text-sm text-ink-soft dark:text-[#9eb4c8]">{description}</p>
              ) : null}
            </div>
            {onClose ? (
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
                ×
              </Button>
            ) : null}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 dark:border-white/10 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, side = 'bottom', className }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus({ open, onClose, panelRef })

  if (!open) return null

  const sideClass =
    side === 'right'
      ? 'inset-y-0 right-0 h-full w-[min(100%,24rem)] rounded-l-2xl'
      : 'inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-2xl'

  return (
    <div className="fixed inset-0 z-drawer">
      <button
        type="button"
        className="absolute inset-0 bg-ink/45"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          'absolute flex flex-col overflow-hidden border border-line bg-white shadow-lift dark:border-white/10 dark:bg-[#1a2838]',
          sideClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Painel'}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-white/10">
          {title ? (
            <h2 id={titleId} className="font-display text-base font-bold text-ink dark:text-[#e8f1f8]">
              {title}
            </h2>
          ) : (
            <span className="sr-only">Painel</span>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            ×
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
