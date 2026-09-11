import React from 'react'
import './CredenciamentoEmerRadar.css'

/**
 * Loading temático Emer-Radar (varredura + marca E).
 */
export default function EmerRadarLoader({
  label = 'Varrendo a região…',
  detail,
  size = 'md',
}) {
  return (
    <div className="emer-radar-loader" role="status" aria-live="polite" aria-label={label}>
      <div className={`emer-radar-loader__stage emer-radar-loader__stage--${size}`}>
        <div className="emer-radar-loader__disc" />
        <div className="emer-radar-loader__ring" />
        <div className="emer-radar-loader__ring emer-radar-loader__ring--delayed" />
        <div className="emer-radar-loader__sweep" />
        <div className="emer-radar-loader__blip emer-radar-loader__blip--a" />
        <div className="emer-radar-loader__blip emer-radar-loader__blip--b" />
        <div className="emer-radar-loader__blip emer-radar-loader__blip--c" />
        <div className="emer-radar-loader__mark">
          <img src={`${import.meta.env.BASE_URL}emerdog-mark.png`} alt="" draggable={false} />
        </div>
      </div>
      {(label || detail) && (
        <div className="emer-radar-loader__label">
          {label ? <strong>{label}</strong> : null}
          {detail ? <span>{detail}</span> : null}
        </div>
      )}
    </div>
  )
}
