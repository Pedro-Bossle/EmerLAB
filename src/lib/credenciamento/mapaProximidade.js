/**
 * Busca e proximidade do mapa de credenciados (funções puras, sem React nem rede).
 *
 * Regras da busca por texto:
 *  - ignora acentos, pontuação e conectivos («de», «da»…);
 *  - cada palavra digitada precisa ser o COMEÇO de uma palavra do cadastro («pet» acha «Petrópolis», mas
 *    «av» não acha «Clavel»); palavras de até 2 letras e números pequenos (nº da casa) valem só inteiros.
 */
import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'
import { distanciaKm } from '../municipiosCoordenadas.js'

export { distanciaKm }

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o'])

/** Palavras úteis do termo (sem conectivos, a menos que sobrem só eles). */
export function tokensDaBusca(termoNorm) {
    const todos = String(termoNorm || '').split(' ').filter(Boolean)
    const uteis = todos.filter((t) => !CONECTIVOS.has(t))
    return uteis.length ? uteis : todos
}

function palavraCombina(palavras, token) {
    const numerico = /^\d+$/.test(token)
    if (numerico) {
        // Número de casa/CEP: inteiro; de 5+ dígitos aceita começo (início de CEP).
        return palavras.some((w) => w === token || (token.length >= 5 && w.startsWith(token)))
    }
    if (token.length <= 2) return palavras.includes(token)
    return palavras.some((w) => w.startsWith(token))
}

/** @param {string} blobNorm texto já normalizado  @param {string} termoNorm busca já normalizada */
export function textoCombinaBusca(blobNorm, termoNorm) {
    const tokens = tokensDaBusca(termoNorm)
    if (!tokens.length) return true
    const palavras = String(blobNorm || '').split(' ').filter(Boolean)
    return tokens.every((t) => palavraCombina(palavras, t))
}

const cacheBlob = new WeakMap()

function blobDoMarcador(m) {
    let b = cacheBlob.get(m)
    if (b === undefined) {
        b = normalizarTextoBusca(
            [
                m.nome,
                m.especialidadeNome,
                m.especialidadeNomesTodas,
                m.cidade,
                m.uf,
                m.bairro,
                m.logradouro,
                m.numero,
                String(m.raw?.cep || '').replace(/\D/g, ''),
            ]
                .filter(Boolean)
                .join(' '),
        )
        cacheBlob.set(m, b)
    }
    return b
}

export function marcadorCombinaTermo(m, termoNorm) {
    if (!termoNorm) return true
    return textoCombinaBusca(blobDoMarcador(m), termoNorm)
}

/** 100 = nome idêntico … 0 = não combina. Serve para ordenar sugestões. */
export function pontuarMarcador(m, termoNorm) {
    if (!termoNorm || !marcadorCombinaTermo(m, termoNorm)) return 0
    const nome = normalizarTextoBusca(m.nome)
    if (nome === termoNorm) return 100
    if (nome.startsWith(termoNorm)) return 90
    if (textoCombinaBusca(nome, termoNorm)) return 75
    return 50
}

/**
 * Filtra sugestões do OpenStreetMap pelo que o usuário digitou. O número da casa não conta (o rótulo do
 * OSM quase nunca traz o número, e descartar por isso escondia o endereço certo).
 */
export function filtrarSugestoesPorTermo(itens, termoBruto) {
    const termo = normalizarTextoBusca(termoBruto)
    const tokens = tokensDaBusca(termo).filter((t) => !/^\d{1,5}$/.test(t))
    if (!tokens.length) return itens || []
    return (itens || []).filter((item) => {
        const blob = normalizarTextoBusca(
            [item.nome, item.rotulo, item.rotuloCompleto, item.enderecoLinha].filter(Boolean).join(' '),
        )
        return textoCombinaBusca(blob, tokens.join(' '))
    })
}

/** Texto parece um CEP? (8 dígitos, com ou sem hífen/«CEP»). */
export function classificarBusca(bruto) {
    const t = String(bruto || '').trim()
    const digitos = t.replace(/\D/g, '')
    if (digitos.length === 8 && (/^\d{5}-?\d{3}$/.test(t.replace(/\s/g, '')) || /\bcep\b/i.test(t))) return 'cep'
    return 'texto'
}

/** Retângulo que contém os pontos (null sem pontos). Um ponto só vira retângulo mínimo. */
export function enquadramentoDe(marcadores) {
    const lista = (marcadores || []).filter((m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng))
    if (!lista.length) return null
    let south = Infinity
    let north = -Infinity
    let west = Infinity
    let east = -Infinity
    for (const m of lista) {
        south = Math.min(south, m.lat)
        north = Math.max(north, m.lat)
        west = Math.min(west, m.lng)
        east = Math.max(east, m.lng)
    }
    return { south, west, north, east, n: lista.length }
}

/** «oeste,norte,leste,sul» para o parâmetro viewbox do Nominatim (viés para a área da rede). */
export function viewboxDaRede(marcadores, { margemGraus = 0.8, minimo = 3 } = {}) {
    const b = enquadramentoDe(marcadores)
    if (!b || b.n < minimo) return ''
    const f = (n) => n.toFixed(4)
    return [f(b.west - margemGraus), f(b.north + margemGraus), f(b.east + margemGraus), f(b.south - margemGraus)].join(',')
}

/**
 * Entre os resultados do OSM para o que foi digitado, escolhe o melhor: respeita a ordem de relevância
 * do Nominatim, mas prefere o que está perto da rede de credenciados (evita «Centro» em outro estado).
 */
export function escolherMelhorResultado(candidatos, marcadores, { raioRedeKm = 150 } = {}) {
    const lista = (candidatos || []).filter((c) => Number.isFinite(c?.lat ?? c?.latitude))
    if (!lista.length) return null
    const lat = (c) => c.lat ?? c.latitude
    const lng = (c) => c.lng ?? c.longitude
    const pontos = (marcadores || []).filter((m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng))
    if (!pontos.length) return lista[0]
    const pertoDaRede = (c) => pontos.some((m) => distanciaKm(lat(c), lng(c), m.lat, m.lng) <= raioRedeKm)
    return lista.find(pertoDaRede) || lista[0]
}

/**
 * Credenciados mais próximos de um ponto. Procura num raio pequeno e vai alargando (5 → 100 km) até achar
 * pelo menos `minimo`; se nem assim houver, devolve os mais próximos mesmo fora do raio.
 * @returns {{ itens: (object & { distanciaKm: number })[], raioKm: number, alemDoRaio: boolean }}
 */
export function proximosDe(marcadores, ref, { max = 10, minimo = 3, raios = [5, 10, 25, 50, 100] } = {}) {
    if (!ref || !Number.isFinite(ref.lat) || !Number.isFinite(ref.lng)) return { itens: [], raioKm: 0, alemDoRaio: false }
    const ordenados = (marcadores || [])
        .filter((m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng))
        .map((m) => ({ ...m, distanciaKm: distanciaKm(ref.lat, ref.lng, m.lat, m.lng) }))
        .sort((a, b) => a.distanciaKm - b.distanciaKm || String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
    if (!ordenados.length) return { itens: [], raioKm: 0, alemDoRaio: false }

    for (const r of raios) {
        const dentro = ordenados.filter((m) => m.distanciaKm <= r)
        if (dentro.length >= minimo || r === raios[raios.length - 1]) {
            if (dentro.length) return { itens: dentro.slice(0, max), raioKm: r, alemDoRaio: false }
        }
    }
    const proximos = ordenados.slice(0, minimo)
    return { itens: proximos, raioKm: Math.ceil(proximos[proximos.length - 1].distanciaKm), alemDoRaio: true }
}
