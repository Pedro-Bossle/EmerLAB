/**
 * PoC: coleta de prospectos via Gemini + geocode Nominatim.
 */
import { PROSPECTOS_OSM_CATEGORIAS, labelProspectoOsmCategoria } from './prospectosOsmCategorias.js'
import { estabelecimentoIndicaInativo, nomeProspectoEhAmbiguo } from './prospectosOsmQualidade.js'
import { geocodificarEnderecoNominatim } from './geocodeNominatim.js'
import { generateJson, prospectosGeminiMax } from '../gemini/gemini.ts'

function maxItensGemini() {
    return prospectosGeminiMax()
}

function hashEstavelOsmId(chave) {
    const s = String(chave || '')
    let h = 5381
    for (let i = 0; i < s.length; i += 1) {
        h = (Math.imul(33, h) ^ s.charCodeAt(i)) >>> 0
    }
    return h || 1
}

function categoriasPermitidasPrompt() {
    return PROSPECTOS_OSM_CATEGORIAS.map((c) => `${c.id}: ${c.label}`).join('\n')
}

function montarPromptGemini(cidade, uf) {
    const loc = uf ? `${cidade}, ${uf}, Brasil` : `${cidade}, Brasil`
    return `Você apoia prospecção de parceiros veterinários para um plano de saúde pet no Brasil.

Liste estabelecimentos REAIS, ATIVOS e em funcionamento em ${loc}, exclusivamente voltados a animais de companhia e medicina veterinária (clínicas veterinárias, pet shops, banho e tosa, hospedagem pet).

Regras:
- Inclua SOMENTE locais que você tenha alta confiança de estarem abertos e operando hoje (ativos e funcionais).
- NÃO incluir: fechados, desativados, abandonados, demolidos, “antigo …”, apenas histórico/placa, em obras sem atendimento, ou qualquer estabelecimento inexistente / que não opere mais.
- Se houver dúvida se ainda funciona, OMITA (é pior inventar ou listar inativo).
- NÃO incluir hospitais humanos, consultórios médicos humanos, clínicas humanas, laboratórios clínicos humanos ou farmácias humanas.
- Priorize nomes e endereços que existam de fato na cidade (não invente).
- Se não tiver certeza de um endereço exato, omita o estabelecimento.
- categoria_id deve ser exatamente um destes ids:
${categoriasPermitidasPrompt()}
- Máximo ${maxItensGemini()} itens.
- telefone e website só se tiver alta confiança; caso contrário string vazia.
- horario_atendimento: use formato OSM opening_hours quando souber (ex.: "24/7", "Mo-Fr 08:00-18:00"); se for atendimento 24 horas, indique "24/7". Nunca use "closed"/"fechado".
- Campo "ativo" deve ser true apenas se o estabelecimento estiver em operação; se não puder afirmar, omita o item.

Retorne JSON no formato: { "estabelecimentos": [ { "nome", "categoria_id", "endereco", "telefone", "website", "horario_atendimento", "nota", "ativo" } ] }
Campo "nota" opcional: breve observação (ex.: "com laboratório interno").`
}

const SCHEMA_GEMINI = {
    type: 'object',
    properties: {
        estabelecimentos: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    nome: { type: 'string' },
                    categoria_id: { type: 'string' },
                    endereco: { type: 'string' },
                    telefone: { type: 'string' },
                    website: { type: 'string' },
                    horario_atendimento: { type: 'string' },
                    nota: { type: 'string' },
                    ativo: { type: 'boolean' },
                },
                required: ['nome', 'categoria_id', 'endereco'],
            },
        },
    },
    required: ['estabelecimentos'],
}

function normalizarItemGemini(raw, cidade, uf) {
    const nome = String(raw?.nome || '').trim()
    const categoria_id = String(raw?.categoria_id || '').trim()
    const endereco = String(raw?.endereco || '').trim()
    if (!nome || !endereco) return null
    if (!PROSPECTOS_OSM_CATEGORIAS.some((c) => c.id === categoria_id)) return null
    if (nomeProspectoEhAmbiguo(nome, categoria_id)) return null
    if (raw?.ativo === false) return null

    const nota = String(raw?.nota || '').trim()
    const horario = String(raw?.horario_atendimento || '').trim()
    if (estabelecimentoIndicaInativo({ nota }, nome, horario)) return null

    const chave = `${nome}|${endereco}|${cidade}|${uf}|${categoria_id}`
    return {
        osm_type: 'gemini_poc',
        osm_id: hashEstavelOsmId(chave),
        categoria_id,
        categoria_label: labelProspectoOsmCategoria(categoria_id),
        nome,
        endereco,
        cidade,
        uf,
        lat: null,
        lng: null,
        telefone: String(raw?.telefone || '').trim(),
        horario_atendimento: horario,
        website: String(raw?.website || '').trim(),
        tags: {
            fonte: 'gemini_poc',
            nota,
            ativo: true,
        },
        coletado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
    }
}

async function geocodificarLinhas(rows, cidade, uf) {
    const avisos = []
    let fallbackCidade = null
    for (const row of rows) {
        const consulta = [row.nome, row.endereco, row.cidade, row.uf].filter(Boolean).join(', ')
        const g = await geocodificarEnderecoNominatim(consulta)
        if (g.ok && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
            row.lat = g.latitude
            row.lng = g.longitude
            if (g.enderecoLinha && !row.endereco) row.endereco = g.enderecoLinha
            row.tags = { ...(row.tags || {}), aproximado: false }
            continue
        }
        // Fallback: centro da cidade — garante pin no mapa de Credenciamento
        if (!fallbackCidade) {
            const loc = [cidade, uf, 'Brasil'].filter(Boolean).join(', ')
            const gc = await geocodificarEnderecoNominatim(loc)
            if (gc.ok && Number.isFinite(gc.latitude) && Number.isFinite(gc.longitude)) {
                fallbackCidade = { lat: gc.latitude, lng: gc.longitude }
            } else {
                fallbackCidade = false
            }
        }
        if (fallbackCidade) {
            row.lat = fallbackCidade.lat
            row.lng = fallbackCidade.lng
            row.tags = { ...(row.tags || {}), aproximado: true }
            avisos.push(`Coords aproximadas (cidade): ${row.nome}`)
        } else {
            avisos.push(`Sem coordenadas: ${row.nome}`)
        }
    }
    return avisos
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ cidade: string, uf?: string }} opts
 */
export async function coletarProspectosGeminiCidade(supabaseAdmin, opts) {
    const cidade = String(opts.cidade || '').trim()
    const uf = String(opts.uf || '').trim()
    if (!cidade) {
        return { ok: false, erro: 'Informe a cidade.' }
    }

    const gem = await generateJson({
        prompt: montarPromptGemini(cidade, uf),
        jsonSchema: SCHEMA_GEMINI,
        maxOutputTokens: 8192,
        timeoutMs: 90_000,
    })
    if (!gem.ok) {
        return {
            ok: false,
            erro: gem.erro || 'Falha na consulta Gemini.',
            quotaExceeded: Boolean(gem.quotaExceeded),
            erroOriginal: gem.erroOriginal,
            retryAfterSec: gem.retryAfterSec,
            geminiDescansoAte: gem.geminiDescansoAte,
        }
    }

    const lista = (Array.isArray(gem.data?.estabelecimentos) ? gem.data.estabelecimentos : []).slice(
        0,
        maxItensGemini(),
    )
    const porChave = new Map()
    for (const raw of lista) {
        const row = normalizarItemGemini(raw, cidade, uf)
        if (!row) continue
        porChave.set(`${row.osm_type}|${row.osm_id}`, row)
    }

    const rows = [...porChave.values()]
    if (!rows.length) {
        return {
            ok: true,
            inseridos: 0,
            fonte: 'gemini',
            aviso: 'Gemini não retornou estabelecimentos válidos para esta cidade.',
        }
    }

    const avisosGeo = await geocodificarLinhas(rows, cidade, uf)

    const { error } = await supabaseAdmin.from('cred_prospectos_osm').upsert(rows, {
        onConflict: 'osm_type,osm_id',
        ignoreDuplicates: false,
    })

    if (error) {
        return { ok: false, erro: error.message || String(error) }
    }

    const comCoord = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)).length
    let aviso = `PoC Gemini: ${rows.length} sugestão(ões); ${comCoord} geocodificada(s).`
    if (avisosGeo.length) {
        aviso += ` ${avisosGeo.slice(0, 5).join('; ')}${avisosGeo.length > 5 ? '…' : ''}`
    }

    return {
        ok: true,
        inseridos: rows.length,
        fonte: 'gemini',
        aviso,
    }
}
