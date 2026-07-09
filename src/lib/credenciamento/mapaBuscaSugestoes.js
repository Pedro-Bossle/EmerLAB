import { normalizarTextoBusca, blobContemTermoBusca } from '../prestadorCadastroHelpers.js'
import { sugerirPrestadoresPorNome } from '../pagamentosPrestador.js'

export function formatarLocalidadeMarcador(m) {
    const bairro = String(m.bairro || '').trim()
    const cidade = String(m.cidade || '').trim()
    const uf = String(m.uf || '').trim()
    if (bairro && cidade && uf) return `${bairro} de ${cidade}/${uf}`
    if (cidade && uf) return `${cidade}/${uf}`
    if (bairro && cidade) return `${bairro} de ${cidade}`
    return bairro || cidade || uf || ''
}

function textoMarcadorParaBusca(m) {
    return [
        m.nome,
        m.especialidadeNome,
        m.cidade,
        m.uf,
        m.bairro,
        m.logradouro,
        m.numero,
        m.raw?.cep,
    ]
        .filter(Boolean)
        .join(' ')
}

function marcadorCombinaBusca(m, termoNorm) {
    if (!termoNorm) return false
    return blobContemTermoBusca(normalizarTextoBusca(textoMarcadorParaBusca(m)), termoNorm)
}

/** Índice de bairros/cidades presentes nos credenciados do mapa. */
export function montarIndiceLocalidadesMarcadores(marcadores) {
    const porChave = new Map()

    const add = (rotulo, m) => {
        const r = String(rotulo || '').trim()
        if (!r) return
        const chave = normalizarTextoBusca(r)
        if (!chave) return
        const prev = porChave.get(chave)
        if (!prev) {
            porChave.set(chave, { rotulo: r, latSum: m.lat, lngSum: m.lng, n: 1 })
            return
        }
        prev.latSum += m.lat
        prev.lngSum += m.lng
        prev.n += 1
    }

    for (const m of marcadores || []) {
        const bairro = String(m.bairro || '').trim()
        const cidade = String(m.cidade || '').trim()
        const uf = String(m.uf || '').trim()
        if (bairro && cidade && uf) add(`${bairro} de ${cidade}/${uf}`, m)
        if (cidade && uf) add(`${cidade}/${uf}`, m)
        if (bairro && cidade) add(`${bairro}, ${cidade}`, m)
    }

    return [...porChave.values()].map((x) => ({
        rotulo: x.rotulo,
        lat: x.latSum / x.n,
        lng: x.lngSum / x.n,
    }))
}

export function sugerirEstabelecimentosMapa(marcadores, termoBruto, { limite = 6, especialidadeAtiva = '' } = {}) {
    const termo = normalizarTextoBusca(termoBruto)
    if (!termo || termo.length < 2) return []

    let base = marcadores || []
    if (especialidadeAtiva) {
        base = base.filter((m) => String(m.especialidadeId) === String(especialidadeAtiva))
    }

    const diretos = []
    const vistos = new Set()
    for (const m of base) {
        if (!marcadorCombinaBusca(m, termo)) continue
        const id = Number(m.id)
        if (vistos.has(id)) continue
        vistos.add(id)
        const n = normalizarTextoBusca(m.nome)
        let score = 50
        if (n === termo) score = 100
        else if (n.startsWith(termo)) score = 90
        else if (n.includes(termo)) score = 75
        diretos.push({ m, score })
    }
    diretos.sort((a, b) => b.score - a.score || a.m.nome.localeCompare(b.m.nome, 'pt-BR'))

    const out = diretos.map((x) => x.m)
    if (out.length >= limite) return out.slice(0, limite)

    const fuzzy = sugerirPrestadoresPorNome(
        base.map((m) => ({ id: m.id, nome: m.nome })),
        termoBruto,
        { limite },
    )
    for (const p of fuzzy) {
        const m = base.find((x) => Number(x.id) === Number(p.id))
        if (!m || vistos.has(Number(m.id))) continue
        vistos.add(Number(m.id))
        out.push(m)
        if (out.length >= limite) break
    }
    return out
}

export function sugerirLocalidadesCadastroMapa(indiceLocalidades, termoBruto, { limite = 5 } = {}) {
    const termo = normalizarTextoBusca(termoBruto)
    if (!termo || termo.length < 2) return []

    const scored = []
    for (const loc of indiceLocalidades || []) {
        const n = normalizarTextoBusca(loc.rotulo)
        if (!blobContemTermoBusca(n, termo)) continue
        let score = 60
        if (n === termo) score = 100
        else if (n.startsWith(termo)) score = 85
        scored.push({ loc, score })
    }
    scored.sort((a, b) => b.score - a.score || a.loc.rotulo.localeCompare(b.loc.rotulo, 'pt-BR'))
    return scored.slice(0, limite).map((x) => x.loc)
}
