import { postServerApiJson } from '../api/serverBackend.js'

/** Dispara geocodificação no servidor após salvar endereço (não bloqueia a UI). */
export function solicitarGeocodePrestador(prestadorId) {
    const id = Number(prestadorId)
    if (!id) return
    void postServerApiJson('geocode-prestador', { prestadorId: id }).catch(() => {})
}
