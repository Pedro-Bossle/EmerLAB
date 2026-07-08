/** Dispara geocodificação no servidor após salvar endereço (não bloqueia a UI). */
export function solicitarGeocodePrestador(prestadorId) {
    const id = Number(prestadorId)
    if (!id) return
    void fetch('/api/geocode-prestador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prestadorId: id }),
    }).catch(() => {})
}
