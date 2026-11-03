import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
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

/** Trava a rolagem da página enquanto houver sobreposição aberta (contador: suporta modais empilhados). */
let travasRolagem = 0
function useTravaRolagem(ativo) {
  useEffect(() => {
    if (!ativo || typeof document === 'undefined') return undefined
    const { body } = document
    if (travasRolagem === 0) body.dataset.elOverflowAnterior = body.style.overflow || ''
    travasRolagem += 1
    body.style.overflow = 'hidden'
    return () => {
      travasRolagem = Math.max(0, travasRolagem - 1)
      if (travasRolagem === 0) {
        body.style.overflow = body.dataset.elOverflowAnterior || ''
        delete body.dataset.elOverflowAnterior
      }
    }
  }, [ativo])
}

function IconeFechar() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  )
}

/**
 * Modal padrão. Desktop/tablet: diálogo centralizado. Telefone: bottom sheet (cantos superiores
 * arredondados, altura máx. 92dvh, rodapé respeitando a área segura).
 *
 * Props: open, onClose, title, description, footer (ações; escreva na ordem Cancelar, Principal: a principal fica à direita no desktop e no topo no telefone), size (sm|md|lg|xl|full), busy (bloqueia fechar enquanto salva),
 * dismissOnBackdrop (padrão true), bodyClassName, className.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
  busy = false,
  dismissOnBackdrop = true,
  bodyClassName,
}) {
  const panelRef = useRef(null)
  const titleId = useId()
  const fechar = busy ? undefined : onClose
  useDialogFocus({ open, onClose: fechar, panelRef })
  useTravaRolagem(open)

  if (!open) return null
  if (typeof document === 'undefined') return null

  const larguras = { sm: 'ek-modal--sm', md: '', lg: 'ek-modal--lg', xl: 'ek-modal--xl', full: 'ek-modal--xl' }

  return createPortal(
    <div
      className="ek-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissOnBackdrop) fechar?.()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Diálogo'}
        className={cn('ek-modal', larguras[size] ?? '', className)}
      >
        <span aria-hidden="true" className="ek-modal__handle" />
        {(title || onClose) && (
          <div className="ek-modal__head">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="ek-modal__title">
                  {title}
                </h2>
              ) : null}
              {description ? <p className="ek-modal__desc">{description}</p> : null}
            </div>
            {onClose ? (
              <Button variant="ghost" size="icon" onClick={fechar} disabled={busy} aria-label="Fechar" className="shrink-0">
                <IconeFechar />
              </Button>
            ) : null}
          </div>
        )}
        <div className={cn('ek-modal__body', bodyClassName)}>{children}</div>
        {footer ? <div className="ek-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, children, side = 'bottom', className }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus({ open, onClose, panelRef })

  useEffect(() => {
    if (!open) return undefined
    document.body.classList.add('el-nav-drawer-open')
    return () => document.body.classList.remove('el-nav-drawer-open')
  }, [open])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const sideClass = side === 'right' ? 'ek-drawer--right' : 'ek-drawer--bottom'

  return createPortal(
    <div className="ek-drawer-overlay">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Fechar" tabIndex={-1} onClick={onClose} />
      <div
        ref={panelRef}
        className={cn('ek-drawer', sideClass, className)}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Painel'}
      >
        <div className="ek-modal__head">
          {title ? (
            <h2 id={titleId} className="ek-modal__title">
              {title}
            </h2>
          ) : (
            <span className="sr-only">Painel</span>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <IconeFechar />
          </Button>
        </div>
        <div className="ek-modal__body min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
