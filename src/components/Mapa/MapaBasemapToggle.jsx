import React, { useCallback, useState } from 'react'
import { TileLayer } from 'react-leaflet'
import {
    MAPA_ESTILO_DETALHADO,
    MAPA_ESTILO_SIMPLIFICADO,
    leafletBasemapLayers,
    lerEstiloBasemapSalvo,
    salvarEstiloBasemap,
    normalizarEstiloBasemap,
} from '../../lib/mapaBasemap.js'
import './MapaBasemapToggle.css'

/** Camadas de fundo conforme o estilo escolhido. */
export function MapaBasemapLayers({ estilo }) {
    const layers = leafletBasemapLayers(estilo)
    return layers.map((layer, i) => (
        <TileLayer
            key={`${estilo}-${i}-${layer.url}`}
            attribution={layer.attribution}
            url={layer.url}
            maxZoom={layer.maxZoom}
            opacity={layer.opacity}
            zIndex={layer.zIndex}
        />
    ))
}

/**
 * Toggle Detalhado / Simplificado (persiste em localStorage).
 * @param {{ estilo?: string, onChange?: (estilo: string) => void, className?: string }} props
 */
export function MapaBasemapToggle({ estilo: estiloCtrl, onChange, className = '' }) {
    const controlado = estiloCtrl != null && typeof onChange === 'function'
    const [interno, setInterno] = useState(() => lerEstiloBasemapSalvo())
    const estilo = normalizarEstiloBasemap(controlado ? estiloCtrl : interno)

    const escolher = useCallback(
        (next) => {
            const n = normalizarEstiloBasemap(next)
            salvarEstiloBasemap(n)
            if (!controlado) setInterno(n)
            onChange?.(n)
        },
        [controlado, onChange],
    )

    return (
        <div
            className={`mapa_basemap_toggle${className ? ` ${className}` : ''}`}
            role="group"
            aria-label="Estilo do mapa"
        >
            <button
                type="button"
                className={estilo === MAPA_ESTILO_DETALHADO ? 'is-active' : ''}
                aria-pressed={estilo === MAPA_ESTILO_DETALHADO}
                onClick={() => escolher(MAPA_ESTILO_DETALHADO)}
                title="Mapa completo (ruas, vegetação, relevo)"
            >
                Detalhado
            </button>
            <button
                type="button"
                className={estilo === MAPA_ESTILO_SIMPLIFICADO ? 'is-active' : ''}
                aria-pressed={estilo === MAPA_ESTILO_SIMPLIFICADO}
                onClick={() => escolher(MAPA_ESTILO_SIMPLIFICADO)}
                title="Mapa claro só com nomes de ruas, bairros, cidades e estados"
            >
                Simplificado
            </button>
        </div>
    )
}

export function useEstiloBasemap() {
    const [estilo, setEstilo] = useState(() => lerEstiloBasemapSalvo())
    const set = useCallback((next) => {
        const n = normalizarEstiloBasemap(next)
        salvarEstiloBasemap(n)
        setEstilo(n)
    }, [])
    return [estilo, set]
}
