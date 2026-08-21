import React from 'react'
import './FloatingToolsDock.css'

/**
 * Dock mobile acima da BottomNav: seta recolhida → chips de ferramentas.
 * Uma gaveta aberta de cada vez (controlado pelo Layout2 via activeToolId).
 */
export default function FloatingToolsDock({
  expanded,
  onExpandedChange,
  tools = [],
  activeToolId,
  onSelectTool,
}) {
  if (!tools.length) return null

  return (
    <div className={`floating_tools_dock${expanded ? ' is-expanded' : ''}${activeToolId ? ' has-open-tool' : ''}`}>
      <button
        type="button"
        className="floating_tools_dock_toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Recolher ferramentas' : 'Expandir ferramentas'}
        onClick={() => onExpandedChange?.(!expanded)}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▴'}</span>
      </button>

      {expanded ? (
        <div className="floating_tools_dock_chips" role="toolbar" aria-label="Ferramentas">
          {tools.map((t) => {
            const ativo = activeToolId === t.id
            const badge = Number(t.badge) || 0
            return (
              <button
                key={t.id}
                type="button"
                className={`floating_tools_dock_chip${ativo ? ' is-active' : ''}`}
                aria-pressed={ativo}
                onClick={() => onSelectTool?.(ativo ? null : t.id)}
              >
                <span className="floating_tools_dock_chip_label">{t.label}</span>
                {badge > 0 ? (
                  <span className="floating_tools_dock_chip_badge">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
