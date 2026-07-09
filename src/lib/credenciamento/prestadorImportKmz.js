import JSZip from 'jszip'
import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'
import { coordenadasValidasBrasil } from './prestadorEnderecoGeocode.js'

/** Extrai texto KML de um arquivo KMZ (primeiro .kml na raiz ou em subpastas). */
export async function extrairKmlDeKmz(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer)
    const nomes = Object.keys(zip.files).filter((n) => {
        const f = zip.files[n]
        return f && !f.dir && n.toLowerCase().endsWith('.kml')
    })
    if (!nomes.length) {
        throw new Error('O KMZ não contém nenhum arquivo .kml.')
    }
    nomes.sort((a, b) => {
        const pa = a.toLowerCase()
        const pb = b.toLowerCase()
        if (pa.endsWith('doc.kml')) return -1
        if (pb.endsWith('doc.kml')) return 1
        return a.localeCompare(b)
    })
    return zip.file(nomes[0]).async('string')
}

function parsearPrimeiroParCoordenadas(texto) {
    const chunk = String(texto || '')
        .trim()
        .split(/\s+/)[0]
    if (!chunk) return null
    const parts = chunk.split(',').map((s) => s.trim())
    const lon = Number(parts[0])
    const lat = Number(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon }
}

function extrairCoordenadasDePlacemark(placemark) {
    const coordEls = placemark.getElementsByTagName('coordinates')
    for (let j = 0; j < coordEls.length; j += 1) {
        const parsed = parsearPrimeiroParCoordenadas(coordEls[j].textContent)
        if (parsed) return parsed
    }
    return null
}

/** Lista pins do KML (nome + coordenadas do primeiro par em cada Placemark). */
export function parsearKmlPlacemarks(kmlTexto) {
    const doc = new DOMParser().parseFromString(String(kmlTexto || ''), 'text/xml')
    const erro = doc.querySelector('parsererror')
    if (erro) {
        throw new Error('Arquivo KML inválido ou corrompido.')
    }

    const placemarks = doc.getElementsByTagName('Placemark')
    const out = []
    for (let i = 0; i < placemarks.length; i += 1) {
        const pm = placemarks[i]
        const nameEl = pm.getElementsByTagName('name')[0]
        const nome = (nameEl?.textContent || '').trim()
        const coords = extrairCoordenadasDePlacemark(pm)
        if (!coords) continue
        out.push({
            nome,
            latitude: coords.lat,
            longitude: coords.lon,
            indice: i,
        })
    }
    return out
}

export async function parsearKmzParaPlacemarks(arrayBuffer) {
    const kml = await extrairKmlDeKmz(arrayBuffer)
    return parsearKmlPlacemarks(kml)
}

/**
 * Match exato (nome normalizado) → automático; caso contrário revisão com sugestões.
 */
export function classificarVinculoPorNome(prestadores, nomeBruto) {
    const termo = normalizarTextoBusca(nomeBruto)
    if (!termo) {
        return {
            tipo: 'invalido',
            motivo: 'Pin sem nome no KMZ.',
            prestadorId: null,
            sugestoes: [],
        }
    }

    const lista = prestadores || []
    const exatos = lista.filter((p) => normalizarTextoBusca(p.nome) === termo)
    if (exatos.length === 1) {
        return {
            tipo: 'auto',
            motivo: '',
            prestadorId: exatos[0].id,
            prestador: exatos[0],
            sugestoes: [],
        }
    }
    if (exatos.length > 1) {
        return {
            tipo: 'revisar',
            motivo: 'Há mais de um credenciado com este nome exato.',
            prestadorId: null,
            sugestoes: exatos,
        }
    }

    const sugestoes = sugerirPrestadoresPorNome(lista, nomeBruto, { limite: 8 })
    return {
        tipo: 'revisar',
        motivo: 'Nenhum match exato; escolha o credenciado correto.',
        prestadorId: null,
        sugestoes,
    }
}

let _seqLinha = 0
function novaChaveLinha() {
    _seqLinha += 1
    return `kmz-${Date.now()}-${_seqLinha}`
}

/**
 * Converte placemarks + lista de credenciados em linhas para revisão na UI.
 * @returns {{ linhas: object[], resumo: object }}
 */
export function montarLinhasRevisaoImportKmz(placemarks, prestadores) {
    const linhas = []
    let auto = 0
    let revisar = 0
    let invalido = 0

    for (const pm of placemarks || []) {
        const lat = Number(pm.latitude)
        const lng = Number(pm.longitude)
        const coordsOk = coordenadasValidasBrasil(lat, lng)

        if (!coordsOk) {
            invalido += 1
            linhas.push({
                key: novaChaveLinha(),
                nomeArquivo: pm.nome || '(sem nome)',
                latitude: lat,
                longitude: lng,
                tipo: 'invalido',
                motivo: 'Coordenadas inválidas ou fora do Brasil.',
                prestadorId: null,
                sugestoes: [],
            })
            continue
        }

        const vinculo = classificarVinculoPorNome(prestadores, pm.nome)
        if (vinculo.tipo === 'invalido') {
            invalido += 1
            linhas.push({
                key: novaChaveLinha(),
                nomeArquivo: pm.nome || '(sem nome)',
                latitude: lat,
                longitude: lng,
                tipo: 'invalido',
                motivo: vinculo.motivo,
                prestadorId: null,
                sugestoes: [],
            })
            continue
        }

        if (vinculo.tipo === 'auto') {
            auto += 1
            linhas.push({
                key: novaChaveLinha(),
                nomeArquivo: pm.nome,
                latitude: lat,
                longitude: lng,
                tipo: 'auto',
                motivo: '',
                prestadorId: vinculo.prestadorId,
                sugestoes: [],
            })
            continue
        }

        revisar += 1
        linhas.push({
            key: novaChaveLinha(),
            nomeArquivo: pm.nome,
            latitude: lat,
            longitude: lng,
            tipo: 'revisar',
            motivo: vinculo.motivo,
            prestadorId: vinculo.sugestoes[0]?.id ?? null,
            sugestoes: vinculo.sugestoes,
        })
    }

    return {
        linhas,
        resumo: {
            total: linhas.length,
            auto,
            revisar,
            invalido,
            aplicaveis: linhas.filter((l) => l.tipo !== 'invalido' && l.prestadorId).length,
        },
    }
}

export function linhasProntasParaAplicar(linhas) {
    const porId = new Map()
    for (const l of linhas || []) {
        if (l.tipo === 'invalido' || !l.prestadorId) continue
        if (!coordenadasValidasBrasil(l.latitude, l.longitude)) continue
        porId.set(Number(l.prestadorId), l)
    }
    return [...porId.values()]
}
