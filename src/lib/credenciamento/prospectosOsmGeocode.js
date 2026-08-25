/**
 * Preenche lat/lng de prospectos OSM ainda sem pin (Nominatim + fallback cidade).
 */
import { geocodificarEnderecoNominatim, delayMs } from './geocodeNominatim.js'
import { coordenadasValidasBrasil } from './prestadorEnderecoGeocode.js'
import { atualizarProspectoOsm } from './prospectosOsmRepo.js'

const DELAY_ENTRE_MS = 1100

export function prospectoSemPin(row) {
    const lat = Number(row?.lat)
    const lng = Number(row?.lng)
    return !(Number.isFinite(lat) && Number.isFinite(lng) && coordenadasValidasBrasil(lat, lng))
}

/**
 * @param {Array<Record<string, unknown>>} itens
 * @param {{ onProgress?: (p: { atual: number, total: number, nome?: string, msg?: string }) => void, signal?: AbortSignal }} [opts]
 */
export async function preencherPinsProspectosOsm(itens, opts = {}) {
    const { onProgress, signal } = opts
    const pendentes = (itens || []).filter((row) => row?.id && prospectoSemPin(row))
    const total = pendentes.length
    if (!total) {
        return { ok: true, total: 0, preenchidos: 0, aproximados: 0, falhas: 0, itensAtualizados: [] }
    }

    const centroPorCidade = new Map()
    let preenchidos = 0
    let aproximados = 0
    let falhas = 0
    const itensAtualizados = []

    const assertNaoAbortado = () => {
        if (signal?.aborted) {
            const err = new Error('Preenchimento cancelado.')
            err.name = 'AbortError'
            throw err
        }
    }

    for (let i = 0; i < pendentes.length; i += 1) {
        assertNaoAbortado()
        const row = pendentes[i]
        const nome = String(row.nome || '').trim() || String(row.id)
        onProgress?.({
            atual: i + 1,
            total,
            nome,
            msg: `Geocodificando ${i + 1}/${total}: ${nome}`,
        })

        if (i > 0) await delayMs(DELAY_ENTRE_MS)
        assertNaoAbortado()

        const consulta = [row.nome, row.endereco, row.cidade, row.uf, 'Brasil'].filter(Boolean).join(', ')
        let lat = null
        let lng = null
        let aproximado = false
        let enderecoExtra = ''

        const g = await geocodificarEnderecoNominatim(consulta)
        assertNaoAbortado()
        if (g.ok && coordenadasValidasBrasil(g.latitude, g.longitude)) {
            lat = g.latitude
            lng = g.longitude
            if (g.enderecoLinha) enderecoExtra = g.enderecoLinha
        } else {
            const chaveCidade = `${String(row.cidade || '').trim().toLowerCase()}|${String(row.uf || '')
                .trim()
                .toUpperCase()}`
            let centro = centroPorCidade.get(chaveCidade)
            if (centro === undefined) {
                const loc = [row.cidade, row.uf, 'Brasil'].filter(Boolean).join(', ')
                if (loc) {
                    await delayMs(DELAY_ENTRE_MS)
                    assertNaoAbortado()
                    const gc = await geocodificarEnderecoNominatim(loc)
                    if (gc.ok && coordenadasValidasBrasil(gc.latitude, gc.longitude)) {
                        centro = { lat: gc.latitude, lng: gc.longitude }
                    } else {
                        centro = null
                    }
                } else {
                    centro = null
                }
                centroPorCidade.set(chaveCidade, centro)
            }
            if (centro) {
                lat = centro.lat
                lng = centro.lng
                aproximado = true
            }
        }

        if (lat == null || lng == null) {
            falhas += 1
            continue
        }

        const patch = { lat, lng }
        if (!String(row.endereco || '').trim() && enderecoExtra) {
            patch.endereco = enderecoExtra
        }

        const r = await atualizarProspectoOsm(row.id, patch)
        if (!r.ok) {
            falhas += 1
            continue
        }
        preenchidos += 1
        if (aproximado) aproximados += 1
        itensAtualizados.push(r.item)
    }

    return {
        ok: true,
        total,
        preenchidos,
        aproximados,
        falhas,
        itensAtualizados,
    }
}
