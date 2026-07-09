import L from 'leaflet'

const cacheIcones = new Map()

export function iconeLeafletEmojiMapa(emoji, cor, { destaque = false } = {}) {
    const key = `${emoji}|${cor}|${destaque ? 1 : 0}`
    const cached = cacheIcones.get(key)
    if (cached) return cached

    const size = destaque ? 36 : 30
    const fontSize = destaque ? 18 : 15
    const border = destaque ? 3 : 2
    const icon = L.divIcon({
        className: 'cred_mapa_pin_emoji_leaflet',
        html: `<div class="cred_mapa_pin_emoji_bubble" style="width:${size}px;height:${size}px;border-width:${border}px;border-color:${cor};font-size:${fontSize}px" role="img" aria-hidden="true">${emoji}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -Math.round(size / 2)],
    })
    cacheIcones.set(key, icon)
    return icon
}
