import { carregarPortesDb, mapaLetraPorPorteId } from '../prestadorProcedimentos.js'
import { resolverVeterinarioIdsParaPrestador } from '../prestadorNomeAlternativo.js'
import { normalizarNomeExame } from './conferenciaLaboratorio.js'
import { supabase } from '../supabase.js'

async function buscarPaginado(montarQuery, tamanho = 500) {
    const acumulado = []
    let pagina = 0
    while (true) {
        const inicio = pagina * tamanho
        const fim = inicio + tamanho - 1
        const resp = await montarQuery().range(inicio, fim)
        if (resp.error) return { data: acumulado, error: resp.error }
        const lote = resp.data || []
        acumulado.push(...lote)
        if (lote.length < tamanho) break
        pagina += 1
        if (pagina > 200) break
    }
    return { data: acumulado, error: null }
}

function precoEhUtil(valor) {
    return Number.isFinite(Number(valor)) && Number(valor) !== 0
}

function indexarPreco(mapas, chaveNorm, valor, codigo, nomeSistema) {
    if (!chaveNorm) return
    const { precosPorNomeNorm, codigoPorNomeNorm, nomeSistemaPorNorm } = mapas
    const novo = Number(valor)
    const atual = precosPorNomeNorm.has(chaveNorm) ? Number(precosPorNomeNorm.get(chaveNorm)) : null
    const atualInutil = atual == null || !Number.isFinite(atual) || atual === 0
    if (atualInutil && Number.isFinite(novo)) {
        precosPorNomeNorm.set(chaveNorm, novo)
    }
    if (codigo && !codigoPorNomeNorm.has(chaveNorm)) {
        codigoPorNomeNorm.set(chaveNorm, codigo)
    }
    if (nomeSistema && !nomeSistemaPorNorm.has(chaveNorm)) {
        nomeSistemaPorNorm.set(chaveNorm, nomeSistema)
    }
}

/** Primeiro preço > 0 no mapa, por nome/código (0 e vazio não contam). */
export function precoNegociacaoUtil(precosPorNomeNorm, ...nomesOuCodigos) {
    if (!precosPorNomeNorm) return null
    for (const bruto of nomesOuCodigos) {
        const chave = normalizarNomeExame(bruto)
        if (!chave || !precosPorNomeNorm.has(chave)) continue
        const v = Number(precosPorNomeNorm.get(chave))
        if (precoEhUtil(v)) return v
    }
    return null
}

/**
 * Carrega preços e catálogo da negociação do laboratório.
 * Indexa por nome de sistema, código e nome_alternativo (evita valor zerado/ausente).
 */
export async function carregarPrecosNegociacaoLaboratorio(laboratorioId) {
    const vazio = {
        precosPorNomeNorm: new Map(),
        codigoPorNomeNorm: new Map(),
        nomeSistemaPorNorm: new Map(),
        catalogo: [],
        aviso: '',
    }
    const pid = Number(laboratorioId)
    if (!pid) {
        return { ...vazio, aviso: 'Laboratório inválido.' }
    }

    const vetIds = await resolverVeterinarioIdsParaPrestador(pid)
    if (!vetIds.length) {
        return { ...vazio, aviso: 'Nenhuma negociação encontrada para este laboratório.' }
    }

    const { data: negociacoes, error } = await buscarPaginado(() =>
        supabase
            .from('negociacoes_vet')
            .select('procedimento_id, porte_id, valor, nome_alternativo')
            .in('veterinario_id', vetIds),
    )
    if (error) {
        // Coluna nome_alternativo pode não existir em ambientes antigos
        if (/nome_alternativo|column/i.test(error.message || '')) {
            const retry = await buscarPaginado(() =>
                supabase
                    .from('negociacoes_vet')
                    .select('procedimento_id, porte_id, valor')
                    .in('veterinario_id', vetIds),
            )
            if (retry.error) throw new Error(retry.error.message)
            return montarCatalogoPrecos(retry.data || [], false)
        }
        throw new Error(error.message)
    }
    if (!(negociacoes || []).length) {
        return { ...vazio, aviso: 'Negociações vazias para este laboratório.' }
    }

    return montarCatalogoPrecos(negociacoes || [], true)
}

async function montarCatalogoPrecos(negociacoes, comAlt) {
    const procedimentoIds = [
        ...new Set(
            (negociacoes || [])
                .map((n) => Number(n.procedimento_id))
                .filter((id) => Number.isFinite(id)),
        ),
    ]

    const procedimentos = []
    const chunk = 80
    for (let i = 0; i < procedimentoIds.length; i += chunk) {
        const lote = procedimentoIds.slice(i, i + chunk)
        const { data, error: errProc } = await supabase
            .from('procedimentos')
            .select('id, codigo, nome')
            .in('id', lote)
        if (errProc) throw new Error(errProc.message)
        procedimentos.push(...(data || []))
    }

    const portes = await carregarPortesDb()
    const letraPorId = mapaLetraPorPorteId(portes)
    const porProc = new Map()
    const altPorProc = new Map()

    for (const item of negociacoes || []) {
        const procId = Number(item.procedimento_id)
        if (!Number.isFinite(procId)) continue
        if (!porProc.has(procId)) porProc.set(procId, { P: null, M: null, G: null })
        const letra = letraPorId.get(Number(item.porte_id))
        const valor = Number(item.valor)
        if ((letra === 'P' || letra === 'M' || letra === 'G') && Number.isFinite(valor)) {
            porProc.get(procId)[letra] = valor
        }
        if (comAlt) {
            const alt = String(item.nome_alternativo ?? '').trim()
            if (alt && !altPorProc.has(procId)) altPorProc.set(procId, alt)
        }
    }

    const precosPorNomeNorm = new Map()
    const codigoPorNomeNorm = new Map()
    const nomeSistemaPorNorm = new Map()
    const mapas = { precosPorNomeNorm, codigoPorNomeNorm, nomeSistemaPorNorm }
    const catalogo = []

    for (const proc of procedimentos) {
        const portesVal = porProc.get(Number(proc.id)) || { P: null, M: null, G: null }
        const candidatos = [portesVal.M, portesVal.P, portesVal.G].filter(
            (v) => v != null && Number.isFinite(Number(v)),
        )
        if (!candidatos.length) continue
        const valor = Number(candidatos[0])
        // Evita indexar preço 0 se outro porte tiver valor > 0
        const valorUtil =
            valor === 0
                ? candidatos.find((v) => Number(v) > 0) != null
                    ? Number(candidatos.find((v) => Number(v) > 0))
                    : valor
                : valor

        const nome = String(proc.nome || '').trim()
        const codigo = String(proc.codigo || '').trim()
        const nomeAlternativo = String(altPorProc.get(Number(proc.id)) || '').trim()
        const nomeNorm = normalizarNomeExame(nome)
        const codigoNorm = normalizarNomeExame(codigo)
        const altNorm = normalizarNomeExame(nomeAlternativo)

        indexarPreco(mapas, nomeNorm, valorUtil, codigo, nome)
        indexarPreco(mapas, codigoNorm, valorUtil, codigo, nome)
        indexarPreco(mapas, altNorm, valorUtil, codigo, nome)

        const nomeExibicao = nomeAlternativo || nome
        const partesRotulo = [codigo || null, nomeExibicao || null]
        if (Number.isFinite(valorUtil)) {
            partesRotulo.push(
                valorUtil.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
            )
        }

        catalogo.push({
            id: Number(proc.id),
            nome,
            codigo,
            nomeNorm,
            nomeAlternativo: nomeAlternativo || null,
            nomeExibicao,
            valor: valorUtil,
            rotulo: partesRotulo.filter(Boolean).join(' - '),
        })
    }

    catalogo.sort((a, b) => {
        const ca = String(a.codigo || '')
        const cb = String(b.codigo || '')
        if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
        return String(a.nomeExibicao || a.nome).localeCompare(
            String(b.nomeExibicao || b.nome),
            'pt-BR',
        )
    })

    return {
        precosPorNomeNorm,
        codigoPorNomeNorm,
        nomeSistemaPorNorm,
        catalogo,
        aviso: '',
    }
}

/**
 * Resolve nome do relatório/alias para o nome de sistema da negociação + preço.
 */
export function resolverExameNegociacao(nomeOuNorm, opts = {}) {
    const {
        precosPorNomeNorm = new Map(),
        codigoPorNomeNorm = new Map(),
        nomeSistemaPorNorm = new Map(),
        catalogo = [],
    } = opts
    const norm = normalizarNomeExame(nomeOuNorm)
    if (!norm) {
        return { nomeSistema: null, nomeAlternativo: null, codigo: '', valor: null, norm: '' }
    }

    let nomeSistema = nomeSistemaPorNorm.get(norm) || null
    let valor = precosPorNomeNorm.has(norm) ? Number(precosPorNomeNorm.get(norm)) : null
    if (!precoEhUtil(valor)) valor = null
    let codigo = codigoPorNomeNorm.get(norm) || ''

    if (!nomeSistema) {
        const hit = (catalogo || []).find(
            (c) =>
                c.nomeNorm === norm ||
                normalizarNomeExame(c.nomeAlternativo) === norm ||
                normalizarNomeExame(c.codigo) === norm,
        )
        if (hit) {
            nomeSistema = hit.nome
            codigo = hit.codigo || codigo
            if (!Number.isFinite(valor)) valor = hit.valor
        }
    }

    const itemCat = (catalogo || []).find(
        (c) => normalizarNomeExame(c.nome) === normalizarNomeExame(nomeSistema || ''),
    )
    const nomeAlternativo = itemCat?.nomeAlternativo || null

    if (!precoEhUtil(valor) && nomeSistema) {
        valor = precoNegociacaoUtil(precosPorNomeNorm, nomeSistema, codigo, itemCat?.codigo)
    }
    if (!precoEhUtil(valor) && itemCat && precoEhUtil(itemCat.valor)) {
        valor = Number(itemCat.valor)
    }

    return {
        nomeSistema: nomeSistema || null,
        nomeAlternativo,
        codigo: codigo || itemCat?.codigo || '',
        valor: precoEhUtil(valor) ? Number(valor) : null,
        norm,
    }
}

export function formatarValorConferencia(valor) {
    if (valor == null || valor === '') return '—'
    const n = Number(valor)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Formata data ISO/AAAA-MM-DD para DD/MM/AAAA. */
export function formatarDataConferencia(valor) {
    const raw = String(valor || '').trim()
    if (!raw || raw === '—') return '—'
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
    const br = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (br) {
        const d = String(br[1]).padStart(2, '0')
        const m = String(br[2]).padStart(2, '0')
        let y = br[3]
        if (y.length === 2) y = `20${y}`
        return `${d}/${m}/${y}`
    }
    return raw
}

/** Filtra catálogo da negociação por termo de busca. */
export function filtrarCatalogoNegociacao(catalogo, termo) {
    const t = normalizarNomeExame(termo)
    if (!t) return catalogo || []
    return (catalogo || []).filter((item) => {
        const nome = item.nomeNorm || normalizarNomeExame(item.nome)
        const alt = normalizarNomeExame(item.nomeAlternativo)
        const codigo = normalizarNomeExame(item.codigo)
        return nome.includes(t) || alt.includes(t) || codigo.includes(t)
    })
}
