import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'

/**
 * Barra de filtros do UI Kit (ek-toolbar). Com `sticky`, gruda no topo e ganha `.is-stuck`
 * (sombra, mais baixa) quando encosta — via IntersectionObserver, sem listener de scroll.
 * Filhos: `ek-field` (+ `ek-label`), `ek-btn`, `ek-check`, `ek-segmented`; ações agrupadas em
 * <div className="ek-toolbar__actions">. Ver docs/ui-kit.md §5.
 */
export function Toolbar({ title = 'Filtros', sticky = true, stickyTop, className, children, ...props }) {
  const barraRef = useRef(null)

  useEffect(() => {
    const barra = barraRef.current
    if (!sticky || !barra || typeof IntersectionObserver === 'undefined') return undefined
    const sentinela = document.createElement('div')
    sentinela.setAttribute('aria-hidden', 'true')
    sentinela.style.cssText = 'height:1px;margin-bottom:-1px;pointer-events:none'
    barra.before(sentinela)
    const obs = new IntersectionObserver(([e]) => barra.classList.toggle('is-stuck', !e.isIntersecting))
    obs.observe(sentinela)
    return () => {
      obs.disconnect()
      sentinela.remove()
    }
  }, [sticky])

  return (
    <section
      ref={barraRef}
      className={cn('ek-toolbar', sticky && 'ek-toolbar--sticky', className)}
      style={stickyTop != null ? { '--ek-sticky-top': stickyTop } : undefined}
      aria-label={title}
      {...props}
    >
      {title ? <h2 className="ek-toolbar__title">{title}</h2> : null}
      <div className="ek-toolbar__row">{children}</div>
    </section>
  )
}
