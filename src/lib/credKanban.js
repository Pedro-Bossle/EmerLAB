/**
 * Kanban / funil de credenciamento (substitui Processos operacional).
 */

import { supabase } from './supabase.js'
import {
    acharSituacaoCredenciadoId,
    acharSituacaoPreenchendoFormularioId,
    patchCredenciadoEmSeTransicao,
} from './prestadorCadastroHelpers.js'

export const COLUNAS_KANBAN = [
    { id: 'nao_contatado', label: 'Não contatado', etapa: 'contato' },
    { id: 'contatado', label: 'Contatado', etapa: 'contato' },
    { id: 'enviado_tabela', label: 'Enviado Tabela', etapa: 'contato' },
    { id: 'reuniao', label: 'Reunião', etapa: 'contato' },
    { id: 'preenchendo_form', label: 'Preenchendo Form', etapa: 'cadastro' },
    { id: 'aguardando_ok_minuta', label: 'Aguardando OK minuta', etapa: 'cadastro' },
    { id: 'aguardando_assinatura', label: 'Aguardando Assinatura', etapa: 'cadastro' },
    { id: 'credenciado', label: 'Credenciado', etapa: 'cadastro' },
    { id: 'adicionar_site', label: 'Adicionar em SITE', etapa: 'cadastro' },
]

export const COLUNA_IDS = new Set(COLUNAS_KANBAN.map((c) => c.id))

const COLS =
    'id, coluna, ordem, nome, uf, cidade, telefone, tipo, prestador_id, prospecto_osm_id, atribuido_a, corpo, checklist, criado_em, atualizado_em, criado_por'

const META_IMPORT = 'import_situacoes_feito'

function normalizarChecklist(raw) {
    if (!Array.isArray(raw)) return []
    return raw
        .map((item, i) => ({
            id: String(item?.id || `chk-${i}`),
            texto: String(item?.texto || '').trim(),
            feito: Boolean(item?.feito),
        }))
        .filter((item) => item.texto)
}

export function mapearCardRow(row) {
    if (!row) return null
    const especialidade = especialidadeVisivelKanban(row.tipo)
    return {
        id: row.id,
        coluna: row.coluna,
        ordem: Number(row.ordem) || 0,
        nome: row.nome || '',
        uf: row.uf || '',
        cidade: row.cidade || '',
        telefone: row.telefone || '',
        /** @deprecated use especialidade — coluna DB `tipo` guarda nome da especialidade principal */
        tipo: especialidade,
        especialidade,
        prestadorId: row.prestador_id != null ? Number(row.prestador_id) : null,
        prospectoOsmId: row.prospecto_osm_id || null,
        atribuidoA: row.atribuido_a || null,
        corpo: row.corpo || '',
        checklist: normalizarChecklist(row.checklist),
        criadoEm: row.criado_em,
        atualizadoEm: row.atualizado_em,
        criadoPor: row.criado_por || null,
    }
}

/** Rejeita modalidade LOCAL/VOLANTE e o campo tipo da especialidade — só nome legível. */
export function especialidadeVisivelKanban(valor) {
    const s = String(valor || '').trim()
    if (!s) return ''
    const u = s.toUpperCase()
    if (u === 'LOCAL' || u === 'VOLANTE' || u === 'ESTABELECIMENTO') return ''
    if (/^(local|volante)\b/i.test(s) && s.length <= 12) return ''
    if (/^especialidade$/i.test(s)) return ''
    return s
}

/**
 * Completa especialidade vazia a partir do prestador vinculado (nome, nunca modalidade).
 * Se o card já tem especialidade/tipo, esse valor prevalece (não sobrescreve edição no Kanban).
 */
export async function enriquecerCardsKanbanComEspecialidade(cards) {
    const lista = cards || []
    const ids = [
        ...new Set(
            lista
                .map((c) => Number(c.prestadorId))
                .filter((id) => Number.isFinite(id) && id > 0),
        ),
    ]
    if (!ids.length) {
        return lista.map((c) => ({
            ...c,
            especialidade: especialidadeVisivelKanban(c.especialidade || c.tipo),
            tipo: especialidadeVisivelKanban(c.especialidade || c.tipo),
        }))
    }

    const { data: prestadores } = await supabase
        .from('prestadores')
        .select('id, especialidade_id')
        .in('id', ids)
    const espIds = [
        ...new Set(
            (prestadores || [])
                .map((p) => Number(p.especialidade_id))
                .filter((id) => Number.isFinite(id) && id > 0),
        ),
    ]
    const mapaEsp = new Map()
    if (espIds.length) {
        const { data: esps } = await supabase.from('especialidades').select('id, nome').in('id', espIds)
        for (const e of esps || []) {
            const nome = String(e.nome || '').trim()
            if (nome) mapaEsp.set(Number(e.id), nome)
        }
    }
    const mapaPrestEsp = new Map()
    for (const p of prestadores || []) {
        const nome = mapaEsp.get(Number(p.especialidade_id))
        if (nome) mapaPrestEsp.set(Number(p.id), nome)
    }

    return lista.map((c) => {
        const doPrestador = c.prestadorId ? mapaPrestEsp.get(Number(c.prestadorId)) : ''
        // Prefere o que está no card (editável); prestador só preenche se o card estiver vazio
        const doCard = especialidadeVisivelKanban(c.especialidade || c.tipo)
        const especialidade = doCard || especialidadeVisivelKanban(doPrestador) || ''
        return { ...c, especialidade, tipo: especialidade }
    })
}

/** Pode mover card de `de` para `para`? */
export function podeMoverColunaKanban(de, para) {
    if (!COLUNA_IDS.has(de) || !COLUNA_IDS.has(para)) return false
    if (de === para) return true
    if (para === 'credenciado' && de !== 'aguardando_assinatura') return false
    if (para === 'adicionar_site' && de !== 'credenciado' && de !== 'adicionar_site') return false
    return true
}

export async function listarCardsKanban() {
    const { data, error } = await supabase
        .from('cred_kanban_cards')
        .select(COLS)
        .order('ordem', { ascending: true })
        .order('id', { ascending: true })
    if (error) throw new Error(error.message)
    return enriquecerCardsKanbanComEspecialidade((data || []).map(mapearCardRow))
}

export async function criarCardKanban(payload = {}) {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id || null
    const coluna = COLUNA_IDS.has(payload.coluna) ? payload.coluna : 'nao_contatado'
    const maxOrdem = await proximaOrdemColuna(coluna)

    const row = {
        coluna,
        ordem: payload.ordem != null ? Number(payload.ordem) : maxOrdem,
        nome: String(payload.nome || '').trim() || 'Sem nome',
        uf: String(payload.uf || '').trim().toUpperCase().slice(0, 2) || null,
        cidade: String(payload.cidade || '').trim() || null,
        telefone: String(payload.telefone || '').trim() || null,
        tipo: especialidadeVisivelKanban(payload.tipo || payload.especialidade) || null,
        prestador_id: payload.prestadorId != null ? Number(payload.prestadorId) : null,
        prospecto_osm_id: payload.prospectoOsmId ? String(payload.prospectoOsmId) : null,
        atribuido_a: payload.atribuidoA || null,
        corpo: String(payload.corpo || ''),
        checklist: normalizarChecklist(payload.checklist || []),
        criado_por: uid,
    }

    const { data, error } = await supabase.from('cred_kanban_cards').insert(row).select(COLS).maybeSingle()
    if (error) throw new Error(error.message)
    return mapearCardRow(data)
}

async function proximaOrdemColuna(coluna) {
    const { data } = await supabase
        .from('cred_kanban_cards')
        .select('ordem')
        .eq('coluna', coluna)
        .order('ordem', { ascending: false })
        .limit(1)
    return (Number(data?.[0]?.ordem) || 0) + 1
}

export async function atualizarCardKanban(id, patch = {}) {
    const payload = { atualizado_em: new Date().toISOString() }
    if (patch.coluna !== undefined) {
        if (!COLUNA_IDS.has(patch.coluna)) throw new Error('Coluna inválida.')
        payload.coluna = patch.coluna
    }
    if (patch.ordem !== undefined) payload.ordem = Number(patch.ordem) || 0
    if (patch.nome !== undefined) payload.nome = String(patch.nome || '').trim() || 'Sem nome'
    if (patch.uf !== undefined) payload.uf = String(patch.uf || '').trim().toUpperCase().slice(0, 2) || null
    if (patch.cidade !== undefined) payload.cidade = String(patch.cidade || '').trim() || null
    if (patch.telefone !== undefined) payload.telefone = String(patch.telefone || '').trim() || null
    if (patch.tipo !== undefined || patch.especialidade !== undefined) {
        payload.tipo =
            especialidadeVisivelKanban(patch.especialidade ?? patch.tipo) || null
    }
    if (patch.prestadorId !== undefined) {
        payload.prestador_id = patch.prestadorId != null ? Number(patch.prestadorId) : null
    }
    if (patch.prospectoOsmId !== undefined) {
        payload.prospecto_osm_id = patch.prospectoOsmId ? String(patch.prospectoOsmId) : null
    }
    if (patch.atribuidoA !== undefined) payload.atribuido_a = patch.atribuidoA || null
    if (patch.corpo !== undefined) payload.corpo = String(patch.corpo || '')
    if (patch.checklist !== undefined) payload.checklist = normalizarChecklist(patch.checklist)

    const { data, error } = await supabase
        .from('cred_kanban_cards')
        .update(payload)
        .eq('id', Number(id))
        .select(COLS)
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Card não encontrado após atualização.')
    return mapearCardRow(data)
}

/** Atribui responsável a vários cards de uma vez. */
export async function atribuirCardsKanbanEmMassa(ids, atribuidoA) {
    const lista = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
    if (!lista.length) return []
    const uid = atribuidoA || null
    const { data, error } = await supabase
        .from('cred_kanban_cards')
        .update({ atribuido_a: uid, atualizado_em: new Date().toISOString() })
        .in('id', lista)
        .select(COLS)
    if (error) throw new Error(error.message)
    return enriquecerCardsKanbanComEspecialidade((data || []).map(mapearCardRow))
}

export async function excluirCardKanban(id) {
    const { error } = await supabase.from('cred_kanban_cards').delete().eq('id', Number(id))
    if (error) throw new Error(error.message)
}

/**
 * Move card e reordena. Aplica side-effects de coluna (situação / no_site).
 */
export async function moverCardKanban(cardId, colunaDestino, ordemDestino, { situacoes = [] } = {}) {
    const { data: atual, error: errGet } = await supabase
        .from('cred_kanban_cards')
        .select(COLS)
        .eq('id', Number(cardId))
        .maybeSingle()
    if (errGet) throw new Error(errGet.message)
    if (!atual) throw new Error('Card não encontrado.')

    const de = atual.coluna
    const para = colunaDestino
    if (!podeMoverColunaKanban(de, para)) {
        throw new Error('Movimento de coluna não permitido neste funil.')
    }

    const card = await atualizarCardKanban(cardId, { coluna: para, ordem: ordemDestino })
    await aplicarSideEffectsColuna(card, de, para, situacoes)
    return card
}

async function aplicarSideEffectsColuna(card, de, para, situacoes) {
    if (!card?.prestadorId) return
    const pid = Number(card.prestadorId)
    const failures = []

    const registrarUpdate = async (rotulo, resultPromise) => {
        const { error } = await resultPromise
        if (error) failures.push(`${rotulo}: ${error.message}`)
    }

    if (para === 'credenciado' && de === 'aguardando_assinatura') {
        const credId = acharSituacaoCredenciadoId(situacoes)
        if (credId) {
            const { data: prest } = await supabase
                .from('prestadores')
                .select('id, situacao_id')
                .eq('id', pid)
                .maybeSingle()
            const patch = {
                situacao_id: Number(credId),
                ...patchCredenciadoEmSeTransicao(prest?.situacao_id, credId, situacoes),
                data_atualizacao: new Date().toISOString(),
            }
            await registrarUpdate(
                'situação credenciado',
                supabase.from('prestadores').update(patch).eq('id', pid),
            )
        }
    }

    if (para === 'adicionar_site') {
        await registrarUpdate(
            'no_site',
            supabase
                .from('prestadores')
                .update({ no_site: true, data_atualizacao: new Date().toISOString() })
                .eq('id', pid),
        )
    }

    const mapaSituacao = {
        preenchendo_form: (lista) => acharSituacaoPreenchendoFormularioId(lista),
        aguardando_ok_minuta: (lista) =>
            (lista || []).find((s) => /ok.*minuta|minuta/i.test(String(s.descricao || '')))?.id,
        aguardando_assinatura: (lista) =>
            (lista || []).find((s) => /assinatura/i.test(String(s.descricao || '')))?.id,
    }
    const resolver = mapaSituacao[para]
    if (resolver && para !== 'credenciado') {
        const sid = resolver(situacoes)
        if (sid) {
            await registrarUpdate(
                `situação ${para}`,
                supabase
                    .from('prestadores')
                    .update({ situacao_id: Number(sid), data_atualizacao: new Date().toISOString() })
                    .eq('id', pid),
            )
        }
    }

    if (failures.length) {
        throw new Error(`Falha ao atualizar prestador vinculado: ${failures.join('; ')}`)
    }
}

export async function importarSituacoesParaKanban({ forcar = false } = {}) {
    if (!forcar) {
        const { data: meta } = await supabase
            .from('cred_kanban_meta')
            .select('valor')
            .eq('chave', META_IMPORT)
            .maybeSingle()
        if (meta?.valor === '1') {
            return { ok: true, jaFeito: true, criados: 0 }
        }
    }

    const { data: situacoes, error: eSit } = await supabase
        .from('situacoes')
        .select('id, descricao, codigo')
    if (eSit) throw new Error(eSit.message)

    const idPreenchendo = acharSituacaoPreenchendoFormularioId(situacoes)
    const idOk = (situacoes || []).find((s) => /ok.*minuta|aguardando ok/i.test(String(s.descricao || '')))
        ?.id
    const idAss = (situacoes || []).find((s) => /assinatura/i.test(String(s.descricao || '')))?.id

    const mapa = new Map()
    if (idPreenchendo) mapa.set(Number(idPreenchendo), 'preenchendo_form')
    if (idOk) mapa.set(Number(idOk), 'aguardando_ok_minuta')
    if (idAss) mapa.set(Number(idAss), 'aguardando_assinatura')

    if (!mapa.size) {
        return { ok: false, erro: 'Situações de importação não encontradas.', criados: 0 }
    }

    const { data: prestadores, error } = await supabase
        .from('prestadores')
        .select(
            'id, nome, tipo, telefone, celular, endereco_uf, endereco_cidade, especialidade_id, situacao_id, ativo',
        )
        .in('situacao_id', [...mapa.keys()])
        .eq('ativo', true)
    if (error) throw new Error(error.message)

    const espIds = [
        ...new Set(
            (prestadores || [])
                .map((p) => Number(p.especialidade_id))
                .filter((id) => Number.isFinite(id) && id > 0),
        ),
    ]
    const mapaEsp = new Map()
    if (espIds.length) {
        const { data: esps } = await supabase.from('especialidades').select('id, nome').in('id', espIds)
        for (const e of esps || []) mapaEsp.set(Number(e.id), e.nome)
    }

    const { data: existentes } = await supabase
        .from('cred_kanban_cards')
        .select('prestador_id')
        .not('prestador_id', 'is', null)
    const ja = new Set((existentes || []).map((r) => Number(r.prestador_id)))

    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id || null

    const { data: ordensExistentes } = await supabase
        .from('cred_kanban_cards')
        .select('coluna, ordem')
    const maxOrdemPorColuna = Object.fromEntries(COLUNAS_KANBAN.map((c) => [c.id, 0]))
    for (const r of ordensExistentes || []) {
        const col = r.coluna
        if (!(col in maxOrdemPorColuna)) continue
        maxOrdemPorColuna[col] = Math.max(maxOrdemPorColuna[col], Number(r.ordem) || 0)
    }

    const rows = []
    for (const p of prestadores || []) {
        if (ja.has(Number(p.id))) continue
        const coluna = mapa.get(Number(p.situacao_id))
        if (!coluna) continue
        const espNome = especialidadeVisivelKanban(mapaEsp.get(Number(p.especialidade_id)))
        maxOrdemPorColuna[coluna] = (maxOrdemPorColuna[coluna] || 0) + 1
        rows.push({
            coluna,
            ordem: maxOrdemPorColuna[coluna],
            nome: String(p.nome || '').trim() || 'Sem nome',
            uf: String(p.endereco_uf || '').trim().toUpperCase().slice(0, 2) || null,
            cidade: String(p.endereco_cidade || '').trim() || null,
            telefone: String(p.telefone || p.celular || '').trim() || null,
            tipo: espNome || null,
            prestador_id: Number(p.id),
            criado_por: uid,
        })
    }

    let criados = 0
    if (rows.length) {
        const { error: errInsert } = await supabase.from('cred_kanban_cards').insert(rows)
        if (errInsert) throw new Error(errInsert.message)
        criados = rows.length
    }

    await supabase.from('cred_kanban_meta').upsert({
        chave: META_IMPORT,
        valor: '1',
        atualizado_em: new Date().toISOString(),
    })

    return { ok: true, jaFeito: false, criados }
}

export async function importacaoSituacoesJaFeita() {
    const { data } = await supabase
        .from('cred_kanban_meta')
        .select('valor')
        .eq('chave', META_IMPORT)
        .maybeSingle()
    return data?.valor === '1'
}

/** Coluna do funil Contato a partir do status de prospecção OSM. */
export function colunaKanbanParaStatusProspecto(status) {
    const s = String(status || 'novo').toLowerCase().trim()
    if (s === 'contactado' || s === 'credenciado') return 'contatado'
    return 'nao_contatado'
}

function especialidadeDeProspectoOsm(prospecto) {
    return (
        String(prospecto?.categoria_label || '').trim() ||
        String(prospecto?.categoria_nome || '').trim() ||
        String(prospecto?.categoria_id || '').trim() ||
        ''
    )
}

function montarCorpoDeProspectoOsm(prospecto) {
    const linhas = []
    const endereco = String(prospecto?.endereco || '').trim()
    if (endereco) linhas.push(`**Endereço:** ${endereco}`)
    const website = String(prospecto?.website || '').trim()
    if (website) linhas.push(`**Website:** ${website}`)
    const horario = String(prospecto?.horario_atendimento || '').trim()
    if (horario) linhas.push(`**Horário:** ${horario}`)
    const obs = String(prospecto?.observacao || '').trim()
    if (obs) linhas.push(`**Observação:** ${obs}`)
    const lat = Number(prospecto?.lat)
    const lng = Number(prospecto?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        linhas.push(`**Coords:** ${lat}, ${lng}`)
    }
    const cat = especialidadeDeProspectoOsm(prospecto)
    if (cat) linhas.push(`**Categoria OSM:** ${cat}`)
    linhas.push('_Origem: catálogo de prospectos (OSM / prospecção)_')
    return linhas.join('\n\n')
}

/**
 * Cria ou atualiza card no Kanban a partir de um prospecto OSM.
 * - status novo / descartado → Não contatado (salvo forçar)
 * - status contactado / credenciado → Contatado
 */
export async function enviarProspectoOsmParaKanban(prospecto, { forcarColuna } = {}) {
    if (!prospecto?.id) return null

    const colunaAlvo = COLUNA_IDS.has(forcarColuna)
        ? forcarColuna
        : colunaKanbanParaStatusProspecto(prospecto.status_prospeccao)

    const face = {
        nome: String(prospecto.nome || '').trim() || 'Prospecto OSM',
        uf: prospecto.uf,
        cidade: prospecto.cidade,
        telefone: String(prospecto.telefone || '').trim() || '',
        tipo: especialidadeDeProspectoOsm(prospecto) || null,
        corpo: montarCorpoDeProspectoOsm(prospecto),
        prospectoOsmId: String(prospecto.id),
    }

    const { data: existente } = await supabase
        .from('cred_kanban_cards')
        .select(COLS)
        .eq('prospecto_osm_id', String(prospecto.id))
        .maybeSingle()

    if (existente) {
        const patch = {
            nome: face.nome,
            uf: face.uf,
            cidade: face.cidade,
            telefone: face.telefone,
            tipo: face.tipo,
            prospectoOsmId: face.prospectoOsmId,
        }
        if (colunaAlvo === 'contatado' && existente.coluna === 'nao_contatado') {
            patch.coluna = 'contatado'
        }
        if (!String(existente.corpo || '').trim()) {
            patch.corpo = face.corpo
        }
        return atualizarCardKanban(existente.id, patch)
    }

    return criarCardKanban({
        coluna: colunaAlvo,
        ...face,
    })
}

/** @deprecated use enviarProspectoOsmParaKanban */
export async function upsertCardContatadoDeProspectoOsm(prospecto) {
    return enviarProspectoOsmParaKanban(prospecto, { forcarColuna: 'contatado' })
}

export async function criarPrestadorMinimoParaCard(card, { situacoes = [] } = {}) {
    const sitId = acharSituacaoPreenchendoFormularioId(situacoes)
    const agora = new Date().toISOString()
    const espNome = especialidadeVisivelKanban(card.especialidade || card.tipo)
    let especialidadeId = null
    if (espNome) {
        const { data: esp } = await supabase
            .from('especialidades')
            .select('id, nome')
            .ilike('nome', espNome)
            .limit(1)
            .maybeSingle()
        if (esp?.id) especialidadeId = Number(esp.id)
    }
    const { data, error } = await supabase
        .from('prestadores')
        .insert({
            nome: card.nome || 'Novo prestador',
            telefone: card.telefone || null,
            endereco_uf: card.uf || null,
            endereco_cidade: card.cidade || null,
            especialidade_id: especialidadeId,
            situacao_id: sitId ? Number(sitId) : null,
            ativo: true,
            data_cadastro: agora,
            data_atualizacao: agora,
        })
        .select('id')
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error('Prestador não foi criado.')

    const atualizado = await atualizarCardKanban(card.id, {
        prestadorId: data.id,
        coluna: 'preenchendo_form',
        tipo: espNome || null,
    })
    return { prestadorId: data.id, card: atualizado }
}

function dataLocalIso(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

export function filtrarCardsKanban(cards, filtros = {}) {
    const uf = String(filtros.uf || '').trim().toUpperCase()
    const cidade = String(filtros.cidade || '').trim().toLowerCase()
    const tipo = String(filtros.tipo || '').trim().toLowerCase()
    const busca = String(filtros.busca || '').trim().toLowerCase()
    const assignee = filtros.atribuidoA || ''
    const de = filtros.dataDe || ''
    const ate = filtros.dataAte || ''

    return (cards || []).filter((c) => {
        if (uf && String(c.uf || '').toUpperCase() !== uf) return false
        if (cidade && !String(c.cidade || '').toLowerCase().includes(cidade)) return false
        if (tipo) {
            const esp = String(c.especialidade || c.tipo || '').toLowerCase()
            if (!esp.includes(tipo)) return false
        }
        if (assignee && String(c.atribuidoA || '') !== String(assignee)) return false
        const criadoLocal = c.criadoEm ? dataLocalIso(c.criadoEm) : ''
        if (de && criadoLocal && criadoLocal < de) return false
        if (ate && criadoLocal && criadoLocal > ate) return false
        if (busca) {
            const blob = `${c.nome} ${c.telefone} ${c.cidade} ${c.uf} ${c.especialidade || c.tipo} ${c.corpo}`.toLowerCase()
            if (!blob.includes(busca)) return false
        }
        return true
    })
}

export function montarResumoRelatorioKanban(cards = []) {
    const porColuna = {}
    for (const col of COLUNAS_KANBAN) porColuna[col.id] = { label: col.label, total: 0, cards: [] }
    for (const c of cards) {
        if (!porColuna[c.coluna]) continue
        porColuna[c.coluna].total += 1
        porColuna[c.coluna].cards.push(c)
    }

    const agora = Date.now()
    const tempos = {}
    for (const col of COLUNAS_KANBAN) {
        const lista = porColuna[col.id].cards
        if (!lista.length) {
            tempos[col.id] = null
            continue
        }
        const dias = lista.map((c) => {
            const t = new Date(c.atualizadoEm || c.criadoEm).getTime()
            return Number.isFinite(t) ? (agora - t) / (1000 * 60 * 60 * 24) : 0
        })
        tempos[col.id] = dias.reduce((a, b) => a + b, 0) / dias.length
    }

    const sitePendentes = (porColuna.credenciado?.total || 0)
    const porAssignee = new Map()
    for (const c of cards) {
        const k = c.atribuidoA || '(sem assign)'
        porAssignee.set(k, (porAssignee.get(k) || 0) + 1)
    }

    return {
        geradoEm: new Date().toISOString(),
        total: cards.length,
        porColuna,
        tempoMedioDiasNaColuna: tempos,
        siteAposCredenciadoPendentes: sitePendentes,
        adicionarSite: porColuna.adicionar_site?.total || 0,
        porAssignee: [...porAssignee.entries()].map(([id, total]) => ({ id, total })),
    }
}

export function formatarDataRelativaKanban(iso) {
    if (!iso) return '—'
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return '—'
    const diff = Date.now() - t
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'agora'
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    if (h < 48) return `${h} h`
    const d = Math.floor(h / 24)
    return `${d} d`
}

export function assinarCardsKanbanLive(onChange) {
    const channel = supabase
        .channel('cred_kanban_cards_live')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'cred_kanban_cards' },
            (payload) => {
                onChange?.(payload)
            },
        )
        .subscribe()
    return () => {
        void supabase.removeChannel(channel)
    }
}

export async function buscarPrestadoresParaMencao(termo, { limite = 12 } = {}) {
    const q = String(termo || '').trim()
    if (q.length < 4) return []
    const { data, error } = await supabase
        .from('prestadores')
        .select('id, nome, endereco_uf, endereco_cidade, telefone, tipo, especialidade_id')
        .ilike('nome', `%${q}%`)
        .eq('ativo', true)
        .order('nome', { ascending: true })
        .limit(limite)
    if (error) throw new Error(error.message)
    const rows = data || []
    const espIds = [
        ...new Set(rows.map((p) => Number(p.especialidade_id)).filter((id) => Number.isFinite(id) && id > 0)),
    ]
    const mapaEsp = new Map()
    if (espIds.length) {
        const { data: esps } = await supabase.from('especialidades').select('id, nome').in('id', espIds)
        for (const e of esps || []) mapaEsp.set(Number(e.id), e.nome)
    }
    return rows.map((p) => ({
        ...p,
        especialidadePrincipal: mapaEsp.get(Number(p.especialidade_id)) || '',
    }))
}

/** Autocomplete de especialidades (mín. 3 letras). */
export async function buscarEspecialidadesKanban(termo, { limite = 15 } = {}) {
    const q = String(termo || '').trim()
    if (q.length < 3) return []
    const { data, error } = await supabase
        .from('especialidades')
        .select('id, nome')
        .ilike('nome', `%${q}%`)
        .order('nome', { ascending: true })
        .limit(limite)
    if (error) throw new Error(error.message)
    return (data || [])
        .map((e) => ({
            id: e.id,
            nome: especialidadeVisivelKanban(e.nome) || String(e.nome || '').trim(),
        }))
        .filter((e) => e.nome)
}
