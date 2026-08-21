import { createPortal } from 'react-dom'

/**
 * Renderiza FABs / gavetas flutuantes em document.body para escapar
 * overflow/stacking do layout (sidebar, overflow-x-clip).
 */
export default function FloatingLayerPortal({ children }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
