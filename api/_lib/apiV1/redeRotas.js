/**
 * Rotas da rede credenciada (escopo rede:ler). Handlers finos: as regras estão em src/lib/apiV1/redeRegras.js.
 */
import {
    ErroValidacao,
    filtrarCredenciados,
    montarCredenciados,
    normalizarMunicipio,
    paraPublico,
} from '../../../src/lib/apiV1/redeRegras.js'
import { mapearPlanos, ORDEM_PLANOS, ROTULO_PLANO } from '../../../src/lib/planosHierarquia.js'
import { carregarBaseRede } from './redeDados.js'
import { ErroApi, registrarRota } from './roteador.js'

const ESCOPO = 'rede:ler'
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600'
const POR_PAGINA_PADRAO = 18
const POR_PAGINA_MAX = 100

function inteiroPositivo(v, padrao) {
    const s = String(v ?? '').trim()
    if (!/^\d+$/.test(s)) return padrao
    const n = Number(s)
    return n >= 1 ? n : padrao
}

async function comValidacao(fn) {
    try {
        return await fn()
    } catch (e) {
        if (e instanceof ErroValidacao) throw new ErroApi(400, e.codigo, e.message)
        throw e
    }
}

const textoQuery = (v) => (Array.isArray(v) ? v[0] : v)

registrarRota('GET', '/rede/credenciados', ESCOPO, async ({ admin, query }) =>
    comValidacao(async () => {
        const base = await carregarBaseRede(admin)
        const filtros = {}
        for (const k of ['uf', 'cidade', 'especialidade', 'tipo', 'plano', 'q']) filtros[k] = textoQuery(query?.[k])
        const lista = filtrarCredenciados(montarCredenciados(base), filtros)
        const porPagina = Math.min(inteiroPositivo(query?.por_pagina, POR_PAGINA_PADRAO), POR_PAGINA_MAX)
        const pagina = inteiroPositivo(query?.pagina, 1)
        const fatia = lista.slice((pagina - 1) * porPagina, pagina * porPagina)
        const opcoes = filtros.plano ? { planoId: filtros.plano } : {}
        return {
            corpo: fatia.map((c) => paraPublico(c, opcoes)),
            headers: { 'X-Total-Count': String(lista.length), 'Cache-Control': CACHE_CONTROL },
        }
    }),
)

registrarRota('GET', '/rede/credenciados/{id}', ESCOPO, async ({ admin, params }) => {
    const base = await carregarBaseRede(admin)
    const id = /^\d+$/.test(params.id) ? Number(params.id) : null
    const c = id === null ? null : montarCredenciados(base).find((x) => x.id === id)
    if (!c) throw new ErroApi(404, 'credenciado_nao_encontrado', 'Credenciado não encontrado.')
    return { corpo: paraPublico(c), headers: { 'Cache-Control': CACHE_CONTROL } }
})

registrarRota('GET', '/rede/filtros', ESCOPO, async ({ admin }) => {
    const base = await carregarBaseRede(admin)
    const lista = montarCredenciados(base)

    const cidadesPorUf = new Map()
    const especialidadesUsadas = new Map()
    for (const c of lista) {
        for (const cid of [...(c.cidadePrincipal ? [c.cidadePrincipal] : []), ...c.cidadesAtende]) {
            if (!cid.uf) continue
            if (!cidadesPorUf.has(cid.uf)) cidadesPorUf.set(cid.uf, new Map())
            const porNome = cidadesPorUf.get(cid.uf)
            const chave = normalizarMunicipio(cid.nome)
            if (chave && !porNome.has(chave)) porNome.set(chave, cid.nome)
        }
        for (const e of [c.especialidadePrincipalId, ...c.especialidadesSecundariasIds]) {
            const esp = e && c._especialidades.get(e)
            if (esp) especialidadesUsadas.set(Number(esp.id), { id: Number(esp.id), nome: esp.nome, tipo: esp.tipo })
        }
    }
    const ordenar = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' })
    const ufs = [...cidadesPorUf.keys()].sort(ordenar)
    const mapa = mapearPlanos(base.planos || [])
    return {
        corpo: {
            ufs,
            cidades: Object.fromEntries(ufs.map((uf) => [uf, [...cidadesPorUf.get(uf).values()].sort(ordenar)])),
            especialidades: [...especialidadesUsadas.values()].sort((a, b) => ordenar(a.nome, b.nome)),
            planos: ORDEM_PLANOS.filter((k) => mapa[k]).map((k) => ({
                id: Number(mapa[k].id),
                chave: k,
                nome: mapa[k].nome || ROTULO_PLANO[k],
            })),
        },
        headers: { 'Cache-Control': CACHE_CONTROL },
    }
})
