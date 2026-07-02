import { supabase } from './supabase'
import {
    acharSituacaoCredenciadoId,
    acharSituacaoPreenchendoFormularioId,
    normalizarCpfCnpjParaSalvar,
    normalizarCrmvParaSalvar,
    somenteDigitosCpfCnpj,
} from './prestadorCadastroHelpers'
import { obterOuCriarCidadeCredenciamento as obterOuCriarCidadeCredenciamentoDb } from './cidadesCredenciamento.js'
import { sincronizarPrestadorProcedimentos } from './prestadorProcedimentos.js'
import { especialidadePermitidaParaPerfil } from './formularioPublicoEspecialidades.js'

export const FORMULARIO_CRED_SLUG_PADRAO = 'parceiros'

/** Disparado no browser quando entradas do formulário público mudam (insert/update). */
export const FORMULARIO_ENTRADAS_CHANGE_EVENT = 'emerdog-formulario-entradas-change'

function emitirMudancaEntradasFormulario() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(FORMULARIO_ENTRADAS_CHANGE_EVENT))
}

const FORM_BELL_LIMPO_EM_KEY = 'emerdog_formulario_bell_limpo_em'

/** Marca no browser que o sininho do formulário foi limpo (inbox continua com todas as entradas). */
export function limparNotificacoesFormularioBell() {
    if (typeof window === 'undefined') return
    try {
        localStorage.setItem(FORM_BELL_LIMPO_EM_KEY, new Date().toISOString())
    } catch {
        /* ignore */
    }
    emitirMudancaEntradasFormulario()
}

function obterFormularioBellLimpoEm() {
    if (typeof window === 'undefined') return null
    try {
        return localStorage.getItem(FORM_BELL_LIMPO_EM_KEY) || null
    } catch {
        return null
    }
}

function aplicarFiltroBellFormulario(query) {
    const limpoEm = obterFormularioBellLimpoEm()
    if (limpoEm) return query.gt('criado_em', limpoEm)
    return query
}

export const CODIGOS_BLOQUEADOS_FORMULARIO = new Set([
    'SERV-004',
    'SERV-007',
    'SERV-008',
    'SERV-009',
    'TAXA-001',
    'TAXA-002',
])

const normCod = (c) => String(c || '').trim().toUpperCase()

export function urlPublicaFormularioCredenciamento(slug = FORMULARIO_CRED_SLUG_PADRAO) {
    const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}${base}credenciamento/cadastro-publico/${encodeURIComponent(slug)}`
}

export function documentoCpfCnpjEstaCompleto(cpfCnpj) {
    const doc = normalizarCpfCnpjParaSalvar(cpfCnpj)
    return doc?.length === 11 || doc?.length === 14
}

const MSG_DOC_OCUPADO =
    'Este CPF/CNPJ já consta no cadastro ou há uma solicitação pendente com o mesmo documento.'

async function documentoOcupadoConsultaDireta(doc) {
    const mascarado =
        doc.length === 11
            ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')

    const { data: prest, error: errP } = await supabase
        .from('prestadores')
        .select('id, cpf_cnpj')
        .or(`cpf_cnpj.eq.${doc},cpf_cnpj.eq.${mascarado}`)
        .limit(5)
    if (errP) return { erro: errP.message }
    const hitPrest = (prest || []).some(
        (p) => somenteDigitosCpfCnpj(p.cpf_cnpj) === doc,
    )
    if (hitPrest) return { ocupado: true }

    const filtroEntrada = async (valor) => {
        if (!valor) return false
        const { data, error } = await supabase
            .from('formulario_cred_entradas')
            .select('id')
            .eq('cpf_cnpj', valor)
            .in('status', ['pendente', 'em_analise'])
            .limit(1)
        if (error) throw error
        return (data || []).length > 0
    }
    try {
        if (await filtroEntrada(doc)) return { ocupado: true }
        if (mascarado !== doc && (await filtroEntrada(mascarado))) return { ocupado: true }
    } catch (errE) {
        return { erro: errE.message }
    }
    return { ocupado: false }
}

async function documentoTemEntradaFormularioAberta(doc) {
    const mascarado =
        doc.length === 11
            ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')

    const filtroEntrada = async (valor) => {
        if (!valor) return false
        const { data, error } = await supabase
            .from('formulario_cred_entradas')
            .select('id')
            .eq('cpf_cnpj', valor)
            .in('status', ['pendente', 'em_analise'])
            .limit(1)
        if (error) throw error
        return (data || []).length > 0
    }
    if (await filtroEntrada(doc)) return true
    if (mascarado !== doc && (await filtroEntrada(mascarado))) return true
    return false
}

export async function buscarPrestadorIdPorDocumento(cpfCnpj) {
    const doc = normalizarCpfCnpjParaSalvar(cpfCnpj)
    if (!doc) return null
    const mascarado =
        doc.length === 11
            ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')

    const { data, error } = await supabase
        .from('prestadores')
        .select('id, cpf_cnpj')
        .or(`cpf_cnpj.eq.${doc},cpf_cnpj.eq.${mascarado}`)
        .limit(5)
    if (error) throw new Error(error.message)
    const hit = (data || []).find((p) => somenteDigitosCpfCnpj(p.cpf_cnpj) === doc)
    return hit?.id ? Number(hit.id) : null
}

/**
 * Valida CPF/CNPJ para envio do formulário público (novo cadastro ou atualização de credenciado).
 * @returns {{ ok: boolean, documento?: string, modo?: 'novo'|'atualizacao', prestadorId?: number, motivo?: string, erro?: string }}
 */
export async function verificarDocumentoParaEnvioFormulario(cpfCnpj) {
    const doc = normalizarCpfCnpjParaSalvar(cpfCnpj)
    if (!documentoCpfCnpjEstaCompleto(doc)) {
        return { ok: false, motivo: 'incompleto', erro: 'Informe um CPF ou CNPJ válido e completo.' }
    }

    try {
        if (await documentoTemEntradaFormularioAberta(doc)) {
            return {
                ok: false,
                motivo: 'entrada_pendente',
                erro: 'Já existe uma solicitação pendente ou em análise com este documento.',
            }
        }
    } catch (errE) {
        return { ok: false, motivo: 'erro', erro: errE.message }
    }

    const prestadorId = await buscarPrestadorIdPorDocumento(doc)
    if (prestadorId) {
        return { ok: true, documento: doc, modo: 'atualizacao', prestadorId }
    }

    const { data, error } = await supabase.rpc('credenciamento_documento_disponivel', { doc })
    if (!error && data === true) {
        return { ok: true, documento: doc, modo: 'novo' }
    }
    if (!error && data === false) {
        return { ok: false, motivo: 'duplicado', erro: MSG_DOC_OCUPADO }
    }

    const direto = await documentoOcupadoConsultaDireta(doc)
    if (direto.erro) {
        return { ok: false, motivo: 'erro', erro: direto.erro }
    }
    if (direto.ocupado) {
        return { ok: false, motivo: 'duplicado', erro: MSG_DOC_OCUPADO }
    }
    return { ok: true, documento: doc, modo: 'novo' }
}

export async function verificarDocumentoDisponivel(cpfCnpj) {
    const doc = normalizarCpfCnpjParaSalvar(cpfCnpj)
    if (!documentoCpfCnpjEstaCompleto(doc)) {
        return { ok: false, motivo: 'incompleto', erro: 'Informe um CPF ou CNPJ válido e completo.' }
    }

    const { data, error } = await supabase.rpc('credenciamento_documento_disponivel', { doc })
    if (!error && data === true) {
        return { ok: true, documento: doc }
    }
    if (!error && data === false) {
        return { ok: false, motivo: 'duplicado', erro: MSG_DOC_OCUPADO }
    }

    const direto = await documentoOcupadoConsultaDireta(doc)
    if (direto.erro) {
        return { ok: false, motivo: 'erro', erro: direto.erro }
    }
    if (direto.ocupado) {
        return { ok: false, motivo: 'duplicado', erro: MSG_DOC_OCUPADO }
    }
    return { ok: true, documento: doc }
}

/** Especialidades para o cadastro público (RPC com security definer; fallback se já existir policy anon). */
export async function carregarEspecialidadesFormularioPublico() {
    const { data: rpcData, error: rpcError } = await supabase.rpc('credenciamento_listar_especialidades')
    if (!rpcError && Array.isArray(rpcData)) {
        return rpcData.map((e) => ({
            id: Number(e.id),
            nome: String(e.nome || ''),
            tipo: e.tipo != null ? String(e.tipo) : '',
        }))
    }

    const { data, error } = await supabase.from('especialidades').select('id, nome, tipo').order('nome')
    if (!error && (data || []).length > 0) {
        return data
    }

    const rpcMsg = String(rpcError?.message || '')
    const fnMissing =
        rpcMsg.includes('credenciamento_listar_especialidades') ||
        rpcMsg.toLowerCase().includes('could not find the function')
    if (fnMissing) {
        throw new Error(
            'Lista de especialidades indisponível no formulário público. Peça à equipe técnica para executar o script SQL credenciamento_listar_especialidades no Supabase.',
        )
    }
    if (error) throw new Error(error.message)
    throw new Error('Não foi possível carregar especialidades para o formulário público.')
}

export async function carregarConfigFormularioCredenciamento() {
    const [
        { data: config, error: errConfig },
        { data: paginas, error: errPag },
        { data: links, error: errLinks },
        { data: categorias, error: errCat },
    ] = await Promise.all([
        supabase
            .from('formulario_cred_config')
            .select('id, slug, titulo, ativo, updated_at')
            .eq('id', 1)
            .maybeSingle(),
        supabase.from('formulario_cred_paginas').select('id, ordem, titulo').order('ordem', { ascending: true }),
        supabase.from('formulario_cred_pagina_categorias').select('id, pagina_id, categoria_id, ordem').order('ordem'),
        supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id'),
    ])

    let configFinal = config
    if (errConfig && String(errConfig.message || '').includes('updated_at')) {
        const { data: cfg2, error: err2 } = await supabase
            .from('formulario_cred_config')
            .select('id, slug, titulo, ativo')
            .eq('id', 1)
            .maybeSingle()
        if (err2) throw new Error(err2.message)
        configFinal = cfg2
    }

    const err = (errConfig && !configFinal ? errConfig : null) || errPag || errLinks || errCat
    if (err) throw new Error(err.message)

    const mapaCat = new Map((categorias || []).map((c) => [Number(c.id), c]))
    const porPagina = new Map()
    ;(links || []).forEach((row) => {
        const pid = Number(row.pagina_id)
        if (!porPagina.has(pid)) porPagina.set(pid, [])
        const cat = mapaCat.get(Number(row.categoria_id))
        porPagina.get(pid).push({
            linkId: row.id,
            categoriaId: Number(row.categoria_id),
            ordem: Number(row.ordem) || 0,
            nome: cat?.nome || `Categoria #${row.categoria_id}`,
        })
    })
    porPagina.forEach((lista) => lista.sort((a, b) => a.ordem - b.ordem))

    const paginasMontadas = (paginas || []).map((p) => ({
        id: Number(p.id),
        ordem: Number(p.ordem),
        titulo: String(p.titulo || '').trim() || `Página ${p.ordem}`,
        categorias: porPagina.get(Number(p.id)) || [],
    }))

    return {
        config: configFinal || {
            slug: FORMULARIO_CRED_SLUG_PADRAO,
            titulo: 'Cadastro de parceiros',
            ativo: true,
        },
        paginas: paginasMontadas,
        todasCategorias: categorias || [],
    }
}

export async function salvarOrdemPaginasFormulario(paginasOrdenadas) {
    for (let i = 0; i < paginasOrdenadas.length; i++) {
        const p = paginasOrdenadas[i]
        const { error } = await supabase
            .from('formulario_cred_paginas')
            .update({ ordem: i + 1, titulo: p.titulo })
            .eq('id', p.id)
        if (error) throw new Error(error.message)
    }
}

export async function salvarCategoriasDaPagina(paginaId, categoriasOrdenadas) {
    const { error: errDel } = await supabase
        .from('formulario_cred_pagina_categorias')
        .delete()
        .eq('pagina_id', paginaId)
    if (errDel) throw new Error(errDel.message)

    if (!categoriasOrdenadas.length) return

    const rows = categoriasOrdenadas.map((c, idx) => ({
        pagina_id: paginaId,
        categoria_id: c.categoriaId,
        ordem: idx + 1,
    }))
    const { error } = await supabase.from('formulario_cred_pagina_categorias').insert(rows)
    if (error) throw new Error(error.message)
}

export async function criarPaginaFormulario(titulo) {
    const { data: maxRow } = await supabase
        .from('formulario_cred_paginas')
        .select('ordem')
        .order('ordem', { ascending: false })
        .limit(1)
        .maybeSingle()
    const ordem = (Number(maxRow?.ordem) || 0) + 1
    const { data, error } = await supabase
        .from('formulario_cred_paginas')
        .insert({ ordem, titulo: titulo || `Página ${ordem}` })
        .select('id, ordem, titulo')
        .single()
    if (error) throw new Error(error.message)
    return { id: Number(data.id), ordem: Number(data.ordem), titulo: data.titulo, categorias: [] }
}

export async function excluirPaginaFormulario(paginaId) {
    const { error } = await supabase.from('formulario_cred_paginas').delete().eq('id', paginaId)
    if (error) throw new Error(error.message)
}

export async function atualizarConfigFormulario(patch) {
    const { error } = await supabase
        .from('formulario_cred_config')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1)
    if (error) throw new Error(error.message)
}

/** Mapa categoria_id → quantidade de procedimentos visíveis no formulário público. */
export async function contarProcedimentosPublicadosPorCategoria() {
    const { data: categorias, error: errCat } = await supabase
        .from('categorias')
        .select('id')
        .gte('id', 3)
        .lte('id', 25)
    if (errCat) throw new Error(errCat.message)

    const ids = (categorias || []).map((c) => Number(c.id)).filter(Boolean)
    if (!ids.length) return new Map()

    let { data, error } = await supabase
        .from('procedimentos')
        .select('codigo, categoria_id, publicado_formulario')
        .in('categoria_id', ids)
        .eq('publicado_formulario', true)

    if (error && String(error.message || '').includes('publicado_formulario')) {
        const fallback = await supabase.from('procedimentos').select('codigo, categoria_id').in('categoria_id', ids)
        data = fallback.data
        error = fallback.error
    }
    if (error) throw new Error(error.message)

    const mapa = new Map()
    for (const p of data || []) {
        if (CODIGOS_BLOQUEADOS_FORMULARIO.has(normCod(p.codigo))) continue
        const cid = Number(p.categoria_id)
        if (!cid) continue
        mapa.set(cid, (mapa.get(cid) || 0) + 1)
    }
    return mapa
}

export async function carregarProcedimentosPublicadosFormulario(categoriaIds) {
    const ids = [...new Set((categoriaIds || []).map(Number).filter(Boolean))]
    if (!ids.length) return []

    let { data, error } = await supabase
        .from('procedimentos')
        .select('id, codigo, nome, categoria_id, publicado_formulario')
        .in('categoria_id', ids)
        .eq('publicado_formulario', true)
        .order('codigo')

    if (error && String(error.message || '').includes('publicado_formulario')) {
        const fallback = await supabase
            .from('procedimentos')
            .select('id, codigo, nome, categoria_id')
            .in('categoria_id', ids)
            .order('codigo')
        data = fallback.data
        error = fallback.error
    }

    if (error) throw new Error(error.message)

    return (data || []).filter((p) => !CODIGOS_BLOQUEADOS_FORMULARIO.has(normCod(p.codigo)))
}

export async function enviarEntradaFormularioCredenciamento({ cpfCnpj, tipoPerfil, payload }) {
    const check = await verificarDocumentoParaEnvioFormulario(cpfCnpj)
    if (!check.ok) throw new Error(check.erro)

    const payloadFinal = { ...(payload || {}) }
    if (check.modo === 'atualizacao' && check.prestadorId) {
        payloadFinal.atualizacao_credenciado = true
        payloadFinal.prestador_id_sugerido = check.prestadorId
    }

    const { error } = await supabase.from('formulario_cred_entradas').insert({
        cpf_cnpj: check.documento,
        tipo_perfil: tipoPerfil,
        payload: payloadFinal,
        status: 'pendente',
    })
    if (error) throw new Error(error.message)
    emitirMudancaEntradasFormulario()
}

export function documentoSomenteDigitos(valor) {
    return somenteDigitosCpfCnpj(valor)
}

export async function listarEntradasFormulario({ status = null, limite = 100 } = {}) {
    let q = supabase
        .from('formulario_cred_entradas')
        .select('id, cpf_cnpj, tipo_perfil, payload, status, criado_em, prestador_id')
        .order('criado_em', { ascending: false })
        .limit(limite)
    if (status) {
        const lista = Array.isArray(status) ? status : [status]
        q = q.in('status', lista)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data || []
}

export async function contarEntradasFormularioPendentes() {
    const { count, error } = await supabase
        .from('formulario_cred_entradas')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendente', 'em_analise'])
    if (error) throw new Error(error.message)
    return count || 0
}

/** Contagem para o sininho (respeita «Limpar» sem apagar entradas do inbox). */
export async function contarEntradasFormularioPendentesNotificacao() {
    let q = supabase
        .from('formulario_cred_entradas')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendente', 'em_analise'])
    q = aplicarFiltroBellFormulario(q)
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count || 0
}

export async function listarEntradasFormularioNotificacao({ status = null, limite = 100 } = {}) {
    let q = supabase
        .from('formulario_cred_entradas')
        .select('id, cpf_cnpj, tipo_perfil, payload, status, criado_em, prestador_id')
        .order('criado_em', { ascending: false })
        .limit(limite)
    if (status) {
        const lista = Array.isArray(status) ? status : [status]
        q = q.in('status', lista)
    }
    q = aplicarFiltroBellFormulario(q)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data || []
}

export async function obterEntradaFormulario(id) {
    const { data, error } = await supabase
        .from('formulario_cred_entradas')
        .select('id, cpf_cnpj, tipo_perfil, payload, status, criado_em, prestador_id')
        .eq('id', id)
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data
}

export async function atualizarStatusEntradaFormulario(id, status, extras = {}) {
    const patch = { status, ...extras }
    const { error } = await supabase.from('formulario_cred_entradas').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    emitirMudancaEntradasFormulario()
}

function normalizarBuscaEsp(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

async function resolverEspecialidadeIdPorTipoPerfil(tipoPerfil, especialidades) {
    const tipo = String(tipoPerfil || '').toLowerCase()
    const lista = especialidades || []

    if (tipo === 'clinica') {
        const hit =
            lista.find((e) => normalizarBuscaEsp(e.nome).includes('clinic')) ||
            lista.find((e) => normalizarBuscaEsp(e.nome).includes('consult'))
        if (hit) return Number(hit.id)
    }
    if (tipo === 'comercio') {
        const hit =
            lista.find((e) => normalizarBuscaEsp(e.nome).includes('pet')) ||
            lista.find((e) => normalizarBuscaEsp(e.nome).includes('comerc'))
        if (hit) return Number(hit.id)
    }
    const geral = lista.find((e) => normalizarBuscaEsp(e.nome).includes('geral'))
    if (geral && tipo === 'volante') return Number(geral.id)

    const naoEstab = lista.find((e) => !normalizarBuscaEsp(e.nome).includes('laborat') && Number(e.id) > 5)
    return naoEstab ? Number(naoEstab.id) : Number(lista[0]?.id) || null
}

async function obterOuCriarCidadeCredenciamento(nomeCidade) {
    const row = await obterOuCriarCidadeCredenciamentoDb(nomeCidade)
    return row?.id ? Number(row.id) : null
}

function montarEnderecoLegado(payload) {
    const e = payload?.endereco || {}
    const partes = [
        [e.logradouro, e.numero].filter(Boolean).join(', '),
        e.complemento,
        e.bairro,
        [e.cidade, e.uf].filter(Boolean).join('/'),
        payload?.cep ? `CEP ${payload.cep}` : '',
    ].filter(Boolean)
    return partes.join(' — ') || null
}

/**
 * Cria prestador a partir da entrada do formulário e sincroniza procedimentos.
 * @returns {number} prestador_id
 */
export async function converterEntradaFormularioEmPrestador(entradaId) {
    const entrada = await obterEntradaFormulario(entradaId)
    if (!entrada) throw new Error('Entrada não encontrada.')
    if (entrada.prestador_id) {
        return Number(entrada.prestador_id)
    }
    if (entrada.status === 'convertido' || entrada.status === 'descartado') {
        throw new Error(
            entrada.status === 'convertido'
                ? 'Esta entrada já está cadastrada como prestador.'
                : 'Esta entrada foi descartada.',
        )
    }

    const payload = entrada.payload || {}
    const doc = normalizarCpfCnpjParaSalvar(entrada.cpf_cnpj)
    if (!doc) throw new Error('CPF/CNPJ inválido na entrada.')

    const { data: dup } = await supabase
        .from('prestadores')
        .select('id')
        .eq('cpf_cnpj', doc)
        .maybeSingle()
    if (dup?.id) {
        throw new Error('Já existe prestador com este CPF/CNPJ. Abra o cadastro existente.')
    }

    const [{ data: esps }, { data: situacoes }] = await Promise.all([
        supabase.from('especialidades').select('id, nome, tipo').order('nome'),
        supabase.from('situacoes').select('id, descricao').eq('ativo', true),
    ])

    const tipoPerfilEntrada = String(entrada.tipo_perfil || '').toLowerCase()
    const espIdsPayload = (Array.isArray(payload.especialidades_ids) ? payload.especialidades_ids : [])
        .map(Number)
        .filter(Boolean)
        .filter((id) => especialidadePermitidaParaPerfil(tipoPerfilEntrada, id, esps || []))

    let espId = espIdsPayload[0] ? Number(espIdsPayload[0]) : null
    if (!espId) {
        espId = await resolverEspecialidadeIdPorTipoPerfil(entrada.tipo_perfil, esps)
    }
    if (!espId) throw new Error('Não foi possível determinar a especialidade. Ajuste no cadastro manual.')

    const esp = (esps || []).find((e) => Number(e.id) === espId)
    const tipoSalvar = String(esp?.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'

    let situacaoId =
        acharSituacaoPreenchendoFormularioId(situacoes) || acharSituacaoCredenciadoId(situacoes)
    situacaoId = situacaoId ? Number(situacaoId) : null

    const end = payload.endereco || {}
    const tipoPerfil = String(entrada.tipo_perfil || '').toLowerCase()
    const cidadesPayload = Array.isArray(payload.cidadesAtende) ? payload.cidadesAtende : []
    let cidadeId = await obterOuCriarCidadeCredenciamento(end.cidade)
    if (!cidadeId && cidadesPayload[0]?.cidadeId) {
        cidadeId = Number(cidadesPayload[0].cidadeId) || null
    }
    if (!cidadeId && cidadesPayload[0]?.nome) {
        cidadeId = await obterOuCriarCidadeCredenciamento(cidadesPayload[0].nome)
    }

    const crmvPrincipal =
        tipoPerfil === 'volante' || tipoPerfil === 'clinica'
            ? normalizarCrmvParaSalvar(payload.crmv)
            : null

    const row = {
        nome: String(payload.nome || '').trim() || 'Sem nome',
        cpf_cnpj: doc,
        situacao_id: situacaoId,
        telefone: String(payload.telefone || '').trim() || null,
        celular: String(payload.celular || '').trim() || null,
        email: String(payload.email || '').trim().toLowerCase() || null,
        especialidade_id: espId,
        crmv: crmvPrincipal,
        tipo: tipoSalvar,
        cep: String(payload.cep || '').replace(/\D/g, '') || null,
        endereco_logradouro: String(end.logradouro || '').trim() || null,
        endereco_numero: String(end.numero || '').trim() || null,
        endereco_complemento: String(end.complemento || '').trim() || null,
        endereco_pais: String(end.pais || '').trim() || 'Brasil',
        endereco_uf: String(end.uf || '').trim() || null,
        endereco_cidade: String(end.cidade || '').trim() || null,
        endereco_bairro: String(end.bairro || '').trim() || null,
        endereco: montarEnderecoLegado(payload),
        chave_pix: payload.chave_pix
            ? String(payload.chave_pix)
            : null,
        tipo_pix: payload.tipo_pix ? String(payload.tipo_pix).toLowerCase() : null,
        tipo_repasse: payload.tipo_repasse ? String(payload.tipo_repasse) : null,
        modalidade: null,
        cidade_id: cidadeId,
        ativo: true,
        data_cadastro: new Date().toISOString(),
        data_atualizacao: new Date().toISOString(),
    }

    const { data: ins, error: errIns } = await supabase.from('prestadores').insert(row).select('id').single()
    if (errIns) throw new Error(errIns.message)
    const prestadorId = Number(ins.id)

    const linhasCidades = []
    if (tipoPerfil === 'volante' && cidadesPayload.length) {
        for (let i = 0; i < cidadesPayload.length; i++) {
            const item = cidadesPayload[i]
            let cid = item.cidadeId ? Number(item.cidadeId) : null
            if (!cid && item.nome) cid = await obterOuCriarCidadeCredenciamento(item.nome)
            if (!cid) continue
            linhasCidades.push({
                prestador_id: prestadorId,
                cidade_id: cid,
                principal: i === 0 || Number(cid) === Number(cidadeId),
            })
        }
    } else if (cidadeId) {
        linhasCidades.push({ prestador_id: prestadorId, cidade_id: cidadeId, principal: true })
    }
    if (linhasCidades.length) {
        await supabase.from('prestador_cidades').upsert(linhasCidades, {
            onConflict: 'prestador_id,cidade_id',
            ignoreDuplicates: true,
        })
    }

    if (tipoPerfil === 'clinica') {
        const vets = Array.isArray(payload.vetsPendentes) ? payload.vetsPendentes : []
        const credIdVet = acharSituacaoCredenciadoId(situacoes)
        const espVetPadraoId = await resolverEspecialidadeIdPorTipoPerfil('volante', esps)
        const cidadeVet = cidadeId
        const idsVets = []
        for (const v of vets) {
            const nomeV = String(v.nome || '').trim()
            if (!nomeV) continue
            const espIdsV = (
                Array.isArray(v.especialidades_ids) && v.especialidades_ids.length
                    ? v.especialidades_ids
                    : v.especialidade_id
                      ? [v.especialidade_id]
                      : []
            )
                .map(Number)
                .filter(Boolean)
            const espVetId = espIdsV[0] || espVetPadraoId
            const espVet = (esps || []).find((e) => Number(e.id) === Number(espVetId))
            const tipoVet = String(espVet?.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'
            const { data: insV, error: errV } = await supabase
                .from('prestadores')
                .insert({
                    nome: nomeV,
                    crmv: normalizarCrmvParaSalvar(v.crmv),
                    especialidade_id: espVetId,
                    tipo: tipoVet,
                    cidade_id: cidadeVet,
                    situacao_id: credIdVet ? Number(credIdVet) : null,
                    ativo: true,
                    data_cadastro: new Date().toISOString(),
                    data_atualizacao: new Date().toISOString(),
                })
                .select('id')
                .single()
            if (errV) throw new Error(errV.message)
            const vetId = Number(insV.id)
            idsVets.push(vetId)
            const idsEspVetSalvar = espIdsV.length ? espIdsV : [espVetId]
            await supabase.from('prestador_especialidades').insert(
                idsEspVetSalvar.map((eid, idx) => ({
                    prestador_id: vetId,
                    especialidade_id: Number(eid),
                    principal: idx === 0,
                })),
            )
        }
        if (idsVets.length) {
            const rowsEst = idsVets.map((vid) => ({
                veterinario_id: vid,
                estabelecimento_id: prestadorId,
                principal: false,
            }))
            const { error: errEst } = await supabase.from('prestador_estabelecimentos').insert(rowsEst)
            if (errEst) throw new Error(errEst.message)
        }
    }

    const idsEspPrestador = espIdsPayload.length ? espIdsPayload : [espId]
    await supabase.from('prestador_especialidades').insert(
        idsEspPrestador.map((eid, idx) => ({
            prestador_id: prestadorId,
            especialidade_id: Number(eid),
            principal: idx === 0,
        })),
    )

    const codigos = [...new Set((payload.procedimentos || []).map((c) => normCod(c)).filter(Boolean))]
    if (codigos.length) {
        await sincronizarPrestadorProcedimentos(prestadorId, codigos)
    }

    await atualizarStatusEntradaFormulario(entradaId, 'convertido', { prestador_id: prestadorId })

    return prestadorId
}

/**
 * Mescla dados de uma entrada do formulário em prestador já cadastrado (mesmo CPF/CNPJ).
 * @returns {number} prestador_id
 */
export async function aplicarEntradaFormularioEmPrestadorExistente(entradaId, prestadorIdInformado = null) {
    const entrada = await obterEntradaFormulario(entradaId)
    if (!entrada) throw new Error('Entrada não encontrada.')
    if (entrada.prestador_id) {
        return Number(entrada.prestador_id)
    }
    if (entrada.status === 'convertido' || entrada.status === 'descartado') {
        throw new Error(
            entrada.status === 'convertido'
                ? 'Esta entrada já foi aplicada a um prestador.'
                : 'Esta entrada foi descartada.',
        )
    }

    const payload = entrada.payload || {}
    const doc = normalizarCpfCnpjParaSalvar(entrada.cpf_cnpj)
    if (!doc) throw new Error('CPF/CNPJ inválido na entrada.')

    let prestadorId =
        prestadorIdInformado != null && Number(prestadorIdInformado) > 0
            ? Number(prestadorIdInformado)
            : Number(payload.prestador_id_sugerido) > 0
              ? Number(payload.prestador_id_sugerido)
              : await buscarPrestadorIdPorDocumento(doc)
    if (!prestadorId) {
        throw new Error('Não há prestador cadastrado com este CPF/CNPJ para vincular.')
    }

    const { data: existente, error: errExist } = await supabase
        .from('prestadores')
        .select('id, cpf_cnpj')
        .eq('id', prestadorId)
        .maybeSingle()
    if (errExist) throw new Error(errExist.message)
    if (!existente?.id) throw new Error('Prestador não encontrado.')
    if (somenteDigitosCpfCnpj(existente.cpf_cnpj) !== doc) {
        throw new Error('O documento da entrada não confere com o prestador selecionado.')
    }

    const [{ data: esps }, { data: situacoes }] = await Promise.all([
        supabase.from('especialidades').select('id, nome, tipo').order('nome'),
        supabase.from('situacoes').select('id, descricao').eq('ativo', true),
    ])

    const tipoPerfilEntrada = String(entrada.tipo_perfil || '').toLowerCase()
    const espIdsPayload = (Array.isArray(payload.especialidades_ids) ? payload.especialidades_ids : [])
        .map(Number)
        .filter(Boolean)
        .filter((id) => especialidadePermitidaParaPerfil(tipoPerfilEntrada, id, esps || []))

    let espId = espIdsPayload[0] ? Number(espIdsPayload[0]) : null
    if (!espId) {
        const { data: atual } = await supabase
            .from('prestadores')
            .select('especialidade_id')
            .eq('id', prestadorId)
            .maybeSingle()
        espId = atual?.especialidade_id ? Number(atual.especialidade_id) : null
    }
    if (!espId) {
        espId = await resolverEspecialidadeIdPorTipoPerfil(entrada.tipo_perfil, esps)
    }

    const esp = (esps || []).find((e) => Number(e.id) === espId)
    const tipoSalvar = String(esp?.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'

    const end = payload.endereco || {}
    const tipoPerfil = String(entrada.tipo_perfil || '').toLowerCase()
    const cidadesPayload = Array.isArray(payload.cidadesAtende) ? payload.cidadesAtende : []
    let cidadeId = await obterOuCriarCidadeCredenciamento(end.cidade)
    if (!cidadeId && cidadesPayload[0]?.cidadeId) {
        cidadeId = Number(cidadesPayload[0].cidadeId) || null
    }
    if (!cidadeId && cidadesPayload[0]?.nome) {
        cidadeId = await obterOuCriarCidadeCredenciamento(cidadesPayload[0].nome)
    }

    const crmvPrincipal =
        tipoPerfil === 'volante' || tipoPerfil === 'clinica'
            ? normalizarCrmvParaSalvar(payload.crmv)
            : null

    const patch = {
        nome: String(payload.nome || '').trim() || undefined,
        telefone: String(payload.telefone || '').trim() || null,
        celular: String(payload.celular || '').trim() || null,
        email: String(payload.email || '').trim().toLowerCase() || null,
        especialidade_id: espId || undefined,
        tipo: tipoSalvar,
        crmv: crmvPrincipal,
        cep: String(payload.cep || '').replace(/\D/g, '') || null,
        endereco_logradouro: String(end.logradouro || '').trim() || null,
        endereco_numero: String(end.numero || '').trim() || null,
        endereco_complemento: String(end.complemento || '').trim() || null,
        endereco_pais: String(end.pais || '').trim() || 'Brasil',
        endereco_uf: String(end.uf || '').trim() || null,
        endereco_cidade: String(end.cidade || '').trim() || null,
        endereco_bairro: String(end.bairro || '').trim() || null,
        endereco: montarEnderecoLegado(payload),
        chave_pix: payload.chave_pix ? String(payload.chave_pix) : null,
        tipo_pix: payload.tipo_pix ? String(payload.tipo_pix).toLowerCase() : null,
        tipo_repasse: payload.tipo_repasse ? String(payload.tipo_repasse) : null,
        cidade_id: cidadeId || undefined,
        data_atualizacao: new Date().toISOString(),
    }
    Object.keys(patch).forEach((k) => {
        if (patch[k] === undefined) delete patch[k]
    })

    const { error: errUp } = await supabase.from('prestadores').update(patch).eq('id', prestadorId)
    if (errUp) throw new Error(errUp.message)

    const linhasCidades = []
    if (tipoPerfil === 'volante' && cidadesPayload.length) {
        for (let i = 0; i < cidadesPayload.length; i++) {
            const item = cidadesPayload[i]
            let cid = item.cidadeId ? Number(item.cidadeId) : null
            if (!cid && item.nome) cid = await obterOuCriarCidadeCredenciamento(item.nome)
            if (!cid) continue
            linhasCidades.push({
                prestador_id: prestadorId,
                cidade_id: cid,
                principal: i === 0 || Number(cid) === Number(cidadeId),
            })
        }
    } else if (cidadeId) {
        linhasCidades.push({ prestador_id: prestadorId, cidade_id: cidadeId, principal: true })
    }
    if (linhasCidades.length) {
        await supabase.from('prestador_cidades').upsert(linhasCidades, {
            onConflict: 'prestador_id,cidade_id',
            ignoreDuplicates: true,
        })
    }

    const idsEspPrestador = espIdsPayload.length ? espIdsPayload : espId ? [espId] : []
    if (idsEspPrestador.length) {
        await supabase.from('prestador_especialidades').delete().eq('prestador_id', prestadorId)
        await supabase.from('prestador_especialidades').insert(
            idsEspPrestador.map((eid, idx) => ({
                prestador_id: prestadorId,
                especialidade_id: Number(eid),
                principal: idx === 0,
            })),
        )
    }

    const codigos = [...new Set((payload.procedimentos || []).map((c) => normCod(c)).filter(Boolean))]
    if (codigos.length) {
        await sincronizarPrestadorProcedimentos(prestadorId, codigos)
    }

    await atualizarStatusEntradaFormulario(entradaId, 'convertido', { prestador_id: prestadorId })

    return prestadorId
}

export function rotuloTipoPerfil(tipo) {
    const t = String(tipo || '').toLowerCase()
    if (t === 'clinica') return 'Clínica / Consultório'
    if (t === 'volante') return 'Veterinário volante'
    if (t === 'comercio') return 'Comércio / petshop'
    return tipo || '—'
}

export function formatarDataEntrada(iso) {
    if (!iso) return '—'
    try {
        return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    } catch {
        return String(iso)
    }
}
