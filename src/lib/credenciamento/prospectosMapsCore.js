/**
 * Núcleo PURO do catálogo de prospectos do Maps (sem Supabase, sem browser).
 * Usado pelo navegador (prospectosMapsRepo.js) e pelo servidor (api/_lib/emerRadarRunsHandler.js),
 * para que a coleta do Prospect Maps e o pipeline gravem exatamente o mesmo formato.
 */
import {
    categoriaMapsIrrelevante,
    formatarNotaMaps,
    resolverCidadeProspectoMaps,
    ufFromEndereco,
    unifyContato,
} from './emerRadarUi.js'

/** Hash estável quando o worker não manda `id`. */
export function mapsIdDeEstabelecimento(est) {
    const direto = String(est?.id || est?.maps_id || '').trim()
    if (direto) return direto
    const base = [est?.nome, est?.endereco, est?.cidade, est?.uf, est?.link_maps, est?.telefone]
        .map((s) => String(s || '').trim().toLowerCase())
        .join('|')
    let h = 0
    for (let i = 0; i < base.length; i += 1) {
        h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
    }
    return `gen_${(h >>> 0).toString(16)}`
}

function parseCoord(v) {
    if (v == null || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

/** Só URLs de foto de fachada do Maps (nunca tiles, avatares de avaliação ou street view). */
export function pareceUrlFachadaMaps(url) {
    const u = String(url || '').trim().toLowerCase()
    if (!u.startsWith('http')) return false
    if (/maps\.gstatic|\/maps\/vt|staticmap|mt[0-3]\.google|khms|tile\.openstreetmap|streetviewpixels/i.test(u)) {
        return false
    }
    if (u.includes('googleusercontent.com/a/')) return false
    return u.includes('googleusercontent.com') || u.includes('ggpht.com')
}

/** Rua/Av. com número costuma ser scrape completo; "Bairro, Cidade - UF" é parcial. */
export function enderecoMapsMaisEspecifico(candidato, atual) {
    const a = String(candidato || '').trim()
    const b = String(atual || '').trim()
    if (!a) return false
    if (!b) return true
    if (a === b) return false
    const temVia = (s) =>
        /\b(rua|r\.|av\.|avenida|travessa|alameda|estrada|rodovia|praça|praca)\b/i.test(s) || /\d{1,5}\b/.test(s)
    const score = (s) => (temVia(s) ? 2 : 0) + Math.min(s.length, 120) / 120
    return score(a) > score(b) + 0.15
}

/**
 * Mapeia resultado do worker/pipeline → linha do catálogo.
 * A URL da fachada (se for do Maps) e os vínculos com planos ficam em `tags` (jsonb).
 */
export function mapearEstabelecimentoMapsParaRow(est, { cidadePadrao = '', ufPadrao = '' } = {}) {
    const mapsId = mapsIdDeEstabelecimento(est)
    const lat = parseCoord(est?.latitude ?? est?.lat)
    const lng = parseCoord(est?.longitude ?? est?.lng ?? est?.lon)
    const website = String(est?.website || est?.site || '').trim()
    const telRaw = String(est?.telefone || '').trim()
    const waRaw = String(est?.whatsapp || '').trim()
    const telefoneUnificado = unifyContato(telRaw, waRaw) || telRaw || waRaw || ''
    const endereco = String(est?.endereco || '').trim()
    const cidade = resolverCidadeProspectoMaps(est, { cidadePadrao })
    const ufWorker = String(est?.uf || '')
        .trim()
        .toUpperCase()
        .slice(0, 2)
    const uf = ufWorker || ufFromEndereco(endereco, ufPadrao)
    let categoria = String(est?.categoria || est?.tipo || est?.especialidade || '').trim()
    if (categoriaMapsIrrelevante(categoria)) categoria = ''
    const notaBruta = est?.nota != null ? String(est.nota).trim() : ''
    const tags = { fonte: 'emer_radar_maps' }
    if (Array.isArray(est?.planos) && est.planos.length) tags.planos = est.planos
    if (Array.isArray(est?.origens) && est.origens.length) tags.origens = est.origens
    if (est?.match_status) tags.match_status = String(est.match_status)
    if (est?.credenciada === true) tags.credenciada = true
    if (pareceUrlFachadaMaps(est?.imagem)) tags.imagem = String(est.imagem).trim()
    return {
        maps_id: mapsId,
        nome: String(est?.nome || '').trim() || 'Sem nome',
        endereco,
        cidade,
        uf,
        telefone: telefoneUnificado,
        whatsapp: waRaw || (telefoneUnificado && telefoneUnificado !== telRaw ? telefoneUnificado : ''),
        horario: String(est?.horario || '').trim(),
        horario_detalhado: String(est?.horario_detalhado || '').trim(),
        nota: formatarNotaMaps(notaBruta) || notaBruta,
        num_avaliacoes: est?.num_avaliacoes != null ? String(est.num_avaliacoes).trim() : '',
        categoria,
        lat,
        lng,
        link_maps: String(est?.link_maps || '').trim(),
        website,
        termo_busca: String(est?.termo_busca || '').trim(),
        tags,
        atualizado_em: new Date().toISOString(),
    }
}

/** Shape de card da UI a partir da linha salva. */
export function rowMapsParaCardUi(row) {
    if (!row) return null
    const telefone = unifyContato(row.telefone, row.whatsapp) || row.telefone || row.whatsapp || ''
    const categoria = categoriaMapsIrrelevante(row.categoria) ? '' : row.categoria || ''
    const tags = row.tags && typeof row.tags === 'object' ? row.tags : {}
    return {
        id: row.maps_id || row.id,
        maps_db_id: row.id,
        maps_id: row.maps_id,
        nome: row.nome,
        endereco: row.endereco,
        cidade: row.cidade,
        uf: row.uf,
        telefone,
        whatsapp: row.whatsapp || '',
        horario: row.horario || '',
        horario_detalhado: row.horario_detalhado || '',
        nota: formatarNotaMaps(row.nota) || row.nota || '',
        num_avaliacoes: row.num_avaliacoes || '',
        categoria,
        latitude: row.lat != null ? String(row.lat) : '',
        longitude: row.lng != null ? String(row.lng) : '',
        link_maps: row.link_maps || '',
        website: row.website || '',
        site: row.website || '',
        termo_busca: row.termo_busca || '',
        status_prospeccao: row.status_prospeccao || 'novo',
        observacao: row.observacao || '',
        planos: Array.isArray(tags.planos) ? tags.planos : [],
        match_status: tags.match_status || '',
        imagem: pareceUrlFachadaMaps(tags.imagem) ? tags.imagem : null,
        coletado_em: row.coletado_em || '',
        atualizado_em: row.atualizado_em || '',
        _salvo: true,
    }
}

const CAMPOS_PRESERVAR = [
    'telefone',
    'whatsapp',
    'horario',
    'horario_detalhado',
    'endereco',
    'nota',
    'num_avaliacoes',
    'categoria',
    'link_maps',
    'website',
    'cidade',
    'uf',
]

const vazio = (v) =>
    v == null || (typeof v === 'string' && !String(v).trim()) || (typeof v === 'number' && !Number.isFinite(v))

/**
 * Funde as linhas novas com o que já está salvo: não sobrescreve dado existente com vazio,
 * nunca rebaixa o status (contactado/credenciado) e mantém tags antigas que a coleta nova não trouxe.
 * Altera `rows` no lugar.
 * @param {object[]} rows linhas mapeadas (mapearEstabelecimentoMapsParaRow)
 * @param {object[]} existentes linhas já salvas
 * @param {{ preferirNovos?: boolean }} [opts]
 */
export function mesclarComExistentes(rows, existentes, { preferirNovos = false } = {}) {
    const porId = new Map((existentes || []).map((r) => [String(r.maps_id), r]))
    for (const row of rows) {
        const ant = porId.get(String(row.maps_id))
        if (!ant) continue
        for (const campo of CAMPOS_PRESERVAR) {
            const novo = row[campo]
            const velho = ant[campo]
            const novoVazio = vazio(novo)
            const velhoTem = !vazio(velho)
            // Não reaproveitar categoria absurda (ex.: escritório do governo) de scrape antigo
            if (campo === 'categoria' && novoVazio && categoriaMapsIrrelevante(velho)) {
                row.categoria = ''
                continue
            }
            // Atualização intencional: valor novo não-vazio sempre vence
            if (preferirNovos && !novoVazio) continue
            if (novoVazio && velhoTem) row[campo] = velho
        }
        // Endereço novo mais específico (rua/av.) substitui vago "Bairro, Cidade - UF"
        const endNovo = String(row.endereco || '').trim()
        const endVelho = String(ant.endereco || '').trim()
        if (endNovo && (preferirNovos || enderecoMapsMaisEspecifico(endNovo, endVelho))) {
            row.endereco = endNovo
            if (preferirNovos || !String(row.cidade || '').trim() || String(row.cidade) === String(ant.cidade)) {
                row.cidade = resolverCidadeProspectoMaps(
                    { endereco: endNovo, cidade: row.cidade },
                    { cidadePadrao: ant.cidade },
                )
            }
        }
        if (row.lat == null && ant.lat != null) row.lat = ant.lat
        if (row.lng == null && ant.lng != null) row.lng = ant.lng
        if (!String(row.telefone || '').trim()) {
            row.telefone = unifyContato(ant.telefone, ant.whatsapp) || ant.telefone || ant.whatsapp || ''
        }
        // tags: a coleta nova só acrescenta; o que já existia (ex.: fachada, planos) permanece se não veio de novo
        const tagsAnt = ant.tags && typeof ant.tags === 'object' ? ant.tags : {}
        row.tags = { ...tagsAnt, ...row.tags }
        // Nunca rebaixar contactado/credenciado para o default do insert
        if (ant.status_prospeccao && ant.status_prospeccao !== 'novo') {
            row.status_prospeccao = ant.status_prospeccao
        }
    }
    return rows
}

/** Remove duplicados por maps_id (a primeira ocorrência vence) e descarta o que não tem id. */
export function linhasUnicasDeColeta(estabelecimentos, ctx = {}) {
    const rows = []
    const visto = new Set()
    for (const est of Array.isArray(estabelecimentos) ? estabelecimentos : []) {
        const row = mapearEstabelecimentoMapsParaRow(est, { cidadePadrao: ctx.cidade, ufPadrao: ctx.uf })
        if (!row.maps_id || visto.has(row.maps_id)) continue
        visto.add(row.maps_id)
        rows.push(row)
    }
    return rows
}
