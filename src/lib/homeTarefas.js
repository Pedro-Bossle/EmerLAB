import { supabase } from './supabase.js'

export const STATUS_TAREFA = [
    { value: 'pendente', label: 'Pendente' },
    { value: 'em_andamento', label: 'Em andamento' },
    { value: 'concluida', label: 'Concluída' },
    { value: 'cancelada', label: 'Cancelada' },
]

export const PRIORIDADES_TAREFA = [
    { value: 'baixa', label: 'Baixa' },
    { value: 'normal', label: 'Normal' },
    { value: 'alta', label: 'Alta' },
]

export const BUCKET_HOME_TAREFAS_ANEXOS = 'home-tarefas-anexos'
export const MAX_ANEXOS_TAREFA = 5
export const MAX_TAMANHO_ANEXO_TAREFA_BYTES = 10 * 1024 * 1024

const COLS_TAREFA_BASE =
    'id, titulo, observacoes, prazo, status, prioridade, criado_por, atribuido_a, criado_em, atualizado_em, concluido_em'
const COLS_TAREFA_COM_ANEXOS = `${COLS_TAREFA_BASE}, anexos`

/** @type {boolean | null} */
let homeTarefasTemAnexos = null

function isErroColunaAnexos(error) {
    if (!error) return false
    const blob = `${error.message || ''} ${error.details || ''} ${error.hint || ''} ${error.code || ''}`.toLowerCase()
    return (
        blob.includes('anexos') &&
        (blob.includes('does not exist') ||
            blob.includes('schema cache') ||
            blob.includes('could not find') ||
            blob.includes('column') ||
            error.code === '42703' ||
            error.code === 'PGRST204')
    )
}

export function normalizarAnexosTarefa(raw) {
    if (!Array.isArray(raw)) return []
    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') return null
            const storage_path = String(item.storage_path || '').trim()
            if (!storage_path) return null
            return {
                storage_path,
                nome_arquivo: String(item.nome_arquivo || 'arquivo').trim() || 'arquivo',
                mime_type: item.mime_type ? String(item.mime_type) : null,
                tamanho: Number.isFinite(Number(item.tamanho)) ? Number(item.tamanho) : null,
            }
        })
        .filter(Boolean)
}

export function mapRowTarefa(row, nomesPorId = new Map()) {
    if (!row) return null
    return {
        id: row.id,
        titulo: row.titulo || '',
        observacoes: row.observacoes || '',
        prazo: row.prazo || null,
        status: row.status || 'pendente',
        prioridade: row.prioridade || 'normal',
        criadoPor: row.criado_por,
        atribuidoA: row.atribuido_a,
        criadoEm: row.criado_em,
        atualizadoEm: row.atualizado_em,
        concluidoEm: row.concluido_em,
        anexos: normalizarAnexosTarefa(row.anexos),
        criadorNome: nomesPorId.get(row.criado_por) || '—',
        atribuidoNome: nomesPorId.get(row.atribuido_a) || '—',
    }
}

function sanitizarNomeArquivoAnexo(nome) {
    return (
        String(nome || 'arquivo')
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120) || 'arquivo'
    )
}

export function validarArquivoAnexoTarefa(file) {
    if (!file) return { ok: false, erro: 'Arquivo inválido.' }
    if (file.size > MAX_TAMANHO_ANEXO_TAREFA_BYTES) {
        return { ok: false, erro: `«${file.name}» excede 10 MB.` }
    }
    if (file.size <= 0) return { ok: false, erro: `«${file.name}» está vazio.` }
    return { ok: true }
}

function montarStoragePathAnexoTarefa(tarefaId, nomeArquivo) {
    const safe = sanitizarNomeArquivoAnexo(nomeArquivo)
    const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return `${tarefaId}/${id}-${safe}`
}

async function selectTarefaPorId(id) {
    if (homeTarefasTemAnexos !== false) {
        const res = await supabase.from('home_tarefas').select(COLS_TAREFA_COM_ANEXOS).eq('id', id).single()
        if (!res.error) {
            homeTarefasTemAnexos = true
            return res
        }
        if (isErroColunaAnexos(res.error)) {
            homeTarefasTemAnexos = false
        } else {
            return res
        }
    }
    return supabase.from('home_tarefas').select(COLS_TAREFA_BASE).eq('id', id).single()
}

async function atualizarAnexosNaTarefa(tarefaId, anexos) {
    if (homeTarefasTemAnexos === false) {
        throw new Error('Coluna anexos ausente. Execute scripts/sql/home_tarefas.sql no Supabase.')
    }
    const { data, error } = await supabase
        .from('home_tarefas')
        .update({
            anexos,
            atualizado_em: new Date().toISOString(),
        })
        .eq('id', tarefaId)
        .select(COLS_TAREFA_COM_ANEXOS)
        .single()
    if (error) {
        if (isErroColunaAnexos(error)) {
            homeTarefasTemAnexos = false
            throw new Error('Coluna anexos ausente. Execute scripts/sql/home_tarefas.sql no Supabase.')
        }
        throw new Error(error.message)
    }
    homeTarefasTemAnexos = true
    return data
}

async function removerArquivosStorage(paths) {
    const lista = (paths || []).map((p) => String(p || '').trim()).filter(Boolean)
    if (!lista.length) return
    const { error } = await supabase.storage.from(BUCKET_HOME_TAREFAS_ANEXOS).remove(lista)
    if (error) throw new Error(error.message)
}

export async function urlAssinadaAnexoTarefa(storagePath) {
    const path = String(storagePath || '').trim()
    if (!path) throw new Error('Anexo sem caminho.')
    const { data, error } = await supabase.storage
        .from(BUCKET_HOME_TAREFAS_ANEXOS)
        .createSignedUrl(path, 3600)
    if (error) throw new Error(error.message)
    return data?.signedUrl || ''
}

/**
 * Envia arquivos ao storage e grava metadados em home_tarefas.anexos.
 */
export async function anexarArquivosTarefa(tarefaId, files) {
    const tid = String(tarefaId || '').trim()
    if (!tid) throw new Error('Tarefa inválida.')
    const lista = Array.from(files || []).filter(Boolean)
    if (!lista.length) {
        const { data, error } = await selectTarefaPorId(tid)
        if (error) throw new Error(error.message)
        return mapRowTarefa(data)
    }

    for (const file of lista) {
        const check = validarArquivoAnexoTarefa(file)
        if (!check.ok) throw new Error(check.erro)
    }

    const { data: atual, error: errAtual } = await selectTarefaPorId(tid)
    if (errAtual) throw new Error(errAtual.message)
    const anexosAtuais = normalizarAnexosTarefa(atual?.anexos)
    if (anexosAtuais.length + lista.length > MAX_ANEXOS_TAREFA) {
        throw new Error(`Máximo de ${MAX_ANEXOS_TAREFA} anexos por tarefa.`)
    }

    const novos = []
    for (const file of lista) {
        const storagePath = montarStoragePathAnexoTarefa(tid, file.name)
        const { error: errUp } = await supabase.storage
            .from(BUCKET_HOME_TAREFAS_ANEXOS)
            .upload(storagePath, file, {
                upsert: false,
                contentType: file.type || undefined,
            })
        if (errUp) {
            const msg = String(errUp.message || '')
            if (/bucket|not found|does not exist/i.test(msg)) {
                throw new Error(
                    'Bucket de anexos ausente. Execute scripts/sql/home_tarefas.sql no Supabase.',
                )
            }
            throw new Error(msg)
        }
        novos.push({
            storage_path: storagePath,
            nome_arquivo: sanitizarNomeArquivoAnexo(file.name),
            mime_type: file.type || null,
            tamanho: file.size || null,
        })
    }

    const data = await atualizarAnexosNaTarefa(tid, [...anexosAtuais, ...novos])
    return mapRowTarefa(data)
}

export async function removerAnexoTarefa(tarefaId, storagePath) {
    const tid = String(tarefaId || '').trim()
    const path = String(storagePath || '').trim()
    if (!tid || !path) {
        const { data } = await selectTarefaPorId(tid)
        return mapRowTarefa(data)
    }

    const { data: atual, error } = await selectTarefaPorId(tid)
    if (error) throw new Error(error.message)
    const restantes = normalizarAnexosTarefa(atual?.anexos).filter((a) => a.storage_path !== path)
    const data = await atualizarAnexosNaTarefa(tid, restantes)
    try {
        await removerArquivosStorage([path])
    } catch {
        /* metadados já atualizados */
    }
    return mapRowTarefa(data)
}

export function formatarPrazoTarefa(prazo) {
    if (!prazo) return 'Sem prazo'
    const d = new Date(`${prazo}T12:00:00`)
    if (Number.isNaN(d.getTime())) return String(prazo)
    return d.toLocaleDateString('pt-BR')
}

export function tarefaAtrasada(tarefa) {
    if (!tarefa?.prazo) return false
    if (tarefa.status === 'concluida' || tarefa.status === 'cancelada') return false
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const p = new Date(`${tarefa.prazo}T12:00:00`)
    return p < hoje
}

/** Só criador ou destinatário enxergam a tarefa. */
export function usuarioPodeVerTarefa(tarefa, userId) {
    if (!tarefa || !userId) return false
    return tarefa.criadoPor === userId || tarefa.atribuidoA === userId
}

export function filtrarTarefasPorAba(tarefas, filtro, userId) {
    const uid = userId || ''
    return (tarefas || []).filter((t) => {
        if (!usuarioPodeVerTarefa(t, uid)) return false
        if (filtro === 'minhas') return t.atribuidoA === uid
        if (filtro === 'criadas') return t.criadoPor === uid
        if (filtro === 'abertas') {
            return t.status === 'pendente' || t.status === 'em_andamento'
        }
        if (filtro === 'em_andamento') return t.status === 'em_andamento'
        if (filtro === 'concluidas') return t.status === 'concluida'
        return true
    })
}

export function contarTarefasPorAba(tarefas, userId) {
    const visiveis = (tarefas || []).filter((t) => usuarioPodeVerTarefa(t, userId))
    return {
        abertas: visiveis.filter((t) => t.status === 'pendente' || t.status === 'em_andamento')
            .length,
        em_andamento: visiveis.filter((t) => t.status === 'em_andamento').length,
        concluidas: visiveis.filter((t) => t.status === 'concluida').length,
        minhas: visiveis.filter((t) => t.atribuidoA === userId).length,
        criadas: visiveis.filter((t) => t.criadoPor === userId).length,
        todas: visiveis.length,
    }
}

export function buscarTarefasTexto(tarefas, termo) {
    const q = String(termo || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
    if (!q) return tarefas || []
    const norm = (s) =>
        String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
    return (tarefas || []).filter((t) => {
        const anexosNomes = (t.anexos || []).map((a) => a.nome_arquivo).join(' ')
        const blob = [
            t.titulo,
            t.observacoes,
            t.atribuidoNome,
            t.criadorNome,
            t.status,
            t.prioridade,
            formatarPrazoTarefa(t.prazo),
            anexosNomes,
        ]
            .map(norm)
            .join(' ')
        return blob.includes(q)
    })
}

export const TAREFAS_POR_PAGINA = 8

const ORDEM_TAREFAS_KEY = 'sfsc_home_tarefas_ordem_v1'

export function lerOrdemTarefasHome(userId) {
    if (!userId || typeof window === 'undefined') return []
    try {
        const raw = window.localStorage.getItem(`${ORDEM_TAREFAS_KEY}:${userId}`)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.map((id) => String(id)).filter(Boolean)
    } catch {
        return []
    }
}

export function salvarOrdemTarefasHome(userId, ids) {
    if (!userId || typeof window === 'undefined') return
    try {
        const lista = (ids || []).map((id) => String(id)).filter(Boolean)
        window.localStorage.setItem(`${ORDEM_TAREFAS_KEY}:${userId}`, JSON.stringify(lista))
    } catch {
        /* ignore */
    }
}

export function ordenarTarefasPorPreferencia(tarefas, ordemIds) {
    const lista = Array.isArray(tarefas) ? [...tarefas] : []
    if (!ordemIds?.length) return lista
    const rank = new Map(ordemIds.map((id, index) => [String(id), index]))
    return lista.sort((a, b) => {
        const ia = rank.has(String(a.id)) ? rank.get(String(a.id)) : Number.MAX_SAFE_INTEGER
        const ib = rank.has(String(b.id)) ? rank.get(String(b.id)) : Number.MAX_SAFE_INTEGER
        if (ia !== ib) return ia - ib
        return 0
    })
}

/** Move `dragId` para a posição de `dropId` na lista de ids. */
export function reordenarIdsTarefas(ids, dragId, dropId) {
    const next = (ids || []).map((id) => String(id))
    const from = next.indexOf(String(dragId))
    const to = next.indexOf(String(dropId))
    if (from < 0 || to < 0 || from === to) return next
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
}

export async function listarUsuariosParaAtribuicao() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name')
        .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data || []).map((u) => ({
        id: u.id,
        nome: u.name || u.id,
    }))
}

export async function listarTarefasHome({ userId } = {}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')

    let data
    let error
    if (homeTarefasTemAnexos !== false) {
        const res = await supabase
            .from('home_tarefas')
            .select(COLS_TAREFA_COM_ANEXOS)
            .or(`criado_por.eq.${uid},atribuido_a.eq.${uid}`)
            .order('prazo', { ascending: true, nullsFirst: false })
            .order('criado_em', { ascending: false })
        data = res.data
        error = res.error
        if (!error) homeTarefasTemAnexos = true
        else if (isErroColunaAnexos(error)) {
            homeTarefasTemAnexos = false
            error = null
            data = null
        }
    }
    if (homeTarefasTemAnexos === false || (data == null && !error)) {
        const res = await supabase
            .from('home_tarefas')
            .select(COLS_TAREFA_BASE)
            .or(`criado_por.eq.${uid},atribuido_a.eq.${uid}`)
            .order('prazo', { ascending: true, nullsFirst: false })
            .order('criado_em', { ascending: false })
        data = res.data
        error = res.error
    }

    if (error) {
        if (/home_tarefas|does not exist|schema cache/i.test(error.message)) {
            return {
                tarefas: [],
                aviso: 'Tabela home_tarefas não configurada. Execute scripts/sql/home_tarefas.sql.',
            }
        }
        throw new Error(error.message)
    }

    const ids = new Set()
    for (const row of data || []) {
        if (row.criado_por) ids.add(row.criado_por)
        if (row.atribuido_a) ids.add(row.atribuido_a)
    }

    let nomesPorId = new Map()
    if (ids.size) {
        const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', [...ids])
        nomesPorId = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
    }

    const tarefas = (data || [])
        .map((r) => mapRowTarefa(r, nomesPorId))
        .filter((t) => usuarioPodeVerTarefa(t, uid))

    return {
        tarefas,
        aviso: '',
    }
}

export async function criarTarefaHome({
    titulo,
    observacoes = '',
    prazo = null,
    prioridade = 'normal',
    atribuidoA,
    anexosFiles = [],
}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')
    const tit = String(titulo || '').trim()
    if (!tit) throw new Error('Informe o título da tarefa.')
    const dest = atribuidoA || uid
    const files = Array.from(anexosFiles || []).filter(Boolean)
    if (files.length > MAX_ANEXOS_TAREFA) {
        throw new Error(`Máximo de ${MAX_ANEXOS_TAREFA} anexos por tarefa.`)
    }
    for (const file of files) {
        const check = validarArquivoAnexoTarefa(file)
        if (!check.ok) throw new Error(check.erro)
    }

    const insertPayload = {
        titulo: tit,
        observacoes: String(observacoes || '').trim() || null,
        prazo: prazo || null,
        prioridade: prioridade || 'normal',
        status: 'pendente',
        criado_por: uid,
        atribuido_a: dest,
        atualizado_em: new Date().toISOString(),
    }
    if (homeTarefasTemAnexos !== false) {
        insertPayload.anexos = []
    }

    let data
    let error
    {
        const res = await supabase
            .from('home_tarefas')
            .insert(insertPayload)
            .select(homeTarefasTemAnexos === false ? COLS_TAREFA_BASE : COLS_TAREFA_COM_ANEXOS)
            .single()
        data = res.data
        error = res.error
        if (error && isErroColunaAnexos(error) && insertPayload.anexos !== undefined) {
            homeTarefasTemAnexos = false
            delete insertPayload.anexos
            const retry = await supabase
                .from('home_tarefas')
                .insert(insertPayload)
                .select(COLS_TAREFA_BASE)
                .single()
            data = retry.data
            error = retry.error
        } else if (!error) {
            homeTarefasTemAnexos = homeTarefasTemAnexos === false ? false : true
        }
    }

    if (error) throw new Error(error.message)

    let mapped = mapRowTarefa(data)
    if (files.length) {
        mapped = await anexarArquivosTarefa(mapped.id, files)
    }
    return mapped
}

export async function atualizarTarefaHome(id, patch) {
    const payload = {
        atualizado_em: new Date().toISOString(),
    }
    if (patch.titulo !== undefined) payload.titulo = String(patch.titulo || '').trim()
    if (patch.observacoes !== undefined) {
        payload.observacoes = String(patch.observacoes || '').trim() || null
    }
    if (patch.prazo !== undefined) payload.prazo = patch.prazo || null
    if (patch.prioridade !== undefined) payload.prioridade = patch.prioridade
    if (patch.atribuidoA !== undefined) payload.atribuido_a = patch.atribuidoA
    if (patch.status !== undefined) {
        payload.status = patch.status
        payload.concluido_em = patch.status === 'concluida' ? new Date().toISOString() : null
    }

    const cols = homeTarefasTemAnexos === false ? COLS_TAREFA_BASE : COLS_TAREFA_COM_ANEXOS
    const { data, error } = await supabase
        .from('home_tarefas')
        .update(payload)
        .eq('id', id)
        .select(cols)
        .single()

    if (error) {
        if (isErroColunaAnexos(error)) {
            homeTarefasTemAnexos = false
            const retry = await supabase
                .from('home_tarefas')
                .update(payload)
                .eq('id', id)
                .select(COLS_TAREFA_BASE)
                .single()
            if (retry.error) throw new Error(retry.error.message)
            return mapRowTarefa(retry.data)
        }
        throw new Error(error.message)
    }
    return mapRowTarefa(data)
}

export async function excluirTarefaHome(id) {
    const tid = String(id || '').trim()
    if (!tid) return

    let paths = []
    try {
        const { data } = await selectTarefaPorId(tid)
        paths = normalizarAnexosTarefa(data?.anexos).map((a) => a.storage_path)
    } catch {
        /* segue com delete da linha */
    }

    const { error } = await supabase.from('home_tarefas').delete().eq('id', tid)
    if (error) throw new Error(error.message)

    if (paths.length) {
        try {
            await removerArquivosStorage(paths)
        } catch {
            /* ignore */
        }
    }
}

function mapRowMensagem(row, nomesPorId = new Map()) {
    if (!row) return null
    return {
        id: row.id,
        tarefaId: row.tarefa_id,
        autorId: row.autor_id,
        corpo: String(row.corpo || '').trim(),
        criadoEm: row.criado_em,
        lidaEm: row.lida_em || null,
        autorNome: nomesPorId.get(row.autor_id) || 'Usuário',
    }
}

export function previewMensagemTarefa(texto, max = 90) {
    const limpo = String(texto || '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!limpo) return ''
    if (limpo.length <= max) return limpo
    return `${limpo.slice(0, max - 1)}…`
}

export async function listarMensagensTarefa(tarefaId) {
    const tid = String(tarefaId || '').trim()
    if (!tid) return []

    const { data, error } = await supabase
        .from('home_tarefas_mensagens')
        .select('id, tarefa_id, autor_id, corpo, criado_em, lida_em')
        .eq('tarefa_id', tid)
        .order('criado_em', { ascending: true })

    if (error) {
        if (/home_tarefas_mensagens|does not exist|schema cache/i.test(error.message)) {
            return []
        }
        throw new Error(error.message)
    }

    const ids = new Set((data || []).map((r) => r.autor_id).filter(Boolean))
    let nomesPorId = new Map()
    if (ids.size) {
        const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', [...ids])
        nomesPorId = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
    }

    return (data || []).map((r) => mapRowMensagem(r, nomesPorId)).filter(Boolean)
}

export async function enviarMensagemTarefa(tarefaId, texto) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')
    const tid = String(tarefaId || '').trim()
    const corpo = String(texto || '').trim()
    if (!tid) throw new Error('Tarefa inválida.')
    if (!corpo) throw new Error('Digite uma mensagem.')

    const { data, error } = await supabase
        .from('home_tarefas_mensagens')
        .insert({
            tarefa_id: tid,
            autor_id: uid,
            corpo,
        })
        .select('id, tarefa_id, autor_id, corpo, criado_em, lida_em')
        .single()

    if (error) {
        if (/home_tarefas_mensagens|does not exist|schema cache/i.test(error.message)) {
            throw new Error(
                'Tabela de mensagens ausente. Execute scripts/sql/home_tarefas.sql no Supabase.',
            )
        }
        throw new Error(error.message)
    }

    const { data: perfil } = await supabase.from('profiles').select('id, name').eq('id', uid).maybeSingle()
    const nomes = new Map([[uid, perfil?.name || 'Você']])
    return mapRowMensagem(data, nomes)
}

export async function marcarMensagensTarefaComoLidas(tarefaId) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return
    const tid = String(tarefaId || '').trim()
    if (!tid) return

    const { error } = await supabase
        .from('home_tarefas_mensagens')
        .update({ lida_em: new Date().toISOString() })
        .eq('tarefa_id', tid)
        .neq('autor_id', uid)
        .is('lida_em', null)

    if (error && !/home_tarefas_mensagens|does not exist|schema cache/i.test(error.message)) {
        throw new Error(error.message)
    }
}

/**
 * Notificações de mensagens não lidas (agrupadas por tarefa + remetente).
 * @returns {Promise<Array<{ tarefaId, tarefaTitulo, deUserId, deNome, preview, quantidade, ultimaEm }>>}
 */
export async function listarNotificacoesMensagensTarefas({ userId } = {}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userId || userData?.user?.id
    if (!uid) return []

    const { data: msgs, error } = await supabase
        .from('home_tarefas_mensagens')
        .select('id, tarefa_id, autor_id, corpo, criado_em')
        .neq('autor_id', uid)
        .is('lida_em', null)
        .order('criado_em', { ascending: false })
        .limit(80)

    if (error) {
        if (/home_tarefas_mensagens|does not exist|schema cache/i.test(error.message)) {
            return []
        }
        throw new Error(error.message)
    }
    if (!msgs?.length) return []

    const tarefaIds = [...new Set(msgs.map((m) => m.tarefa_id).filter(Boolean))]
    const { data: tarefas, error: errT } = await supabase
        .from('home_tarefas')
        .select('id, titulo, criado_por, atribuido_a')
        .in('id', tarefaIds)
        .or(`criado_por.eq.${uid},atribuido_a.eq.${uid}`)

    if (errT) throw new Error(errT.message)
    const mapaTarefa = new Map((tarefas || []).map((t) => [t.id, t]))

    const autorIds = [...new Set(msgs.map((m) => m.autor_id).filter(Boolean))]
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', autorIds)
    const nomes = new Map((perfis || []).map((p) => [p.id, p.name || 'Usuário']))

    const grupos = new Map()
    for (const msg of msgs) {
        const tarefa = mapaTarefa.get(msg.tarefa_id)
        if (!tarefa) continue
        const chave = `${msg.tarefa_id}:${msg.autor_id}`
        if (!grupos.has(chave)) {
            grupos.set(chave, {
                tarefaId: msg.tarefa_id,
                tarefaTitulo: String(tarefa.titulo || 'Tarefa').trim() || 'Tarefa',
                deUserId: msg.autor_id,
                deNome: nomes.get(msg.autor_id) || 'Usuário',
                preview: previewMensagemTarefa(msg.corpo),
                quantidade: 1,
                ultimaEm: msg.criado_em,
            })
        } else {
            const g = grupos.get(chave)
            g.quantidade += 1
        }
    }

    return [...grupos.values()].sort((a, b) => {
        const ta = a.ultimaEm ? new Date(a.ultimaEm).getTime() : 0
        const tb = b.ultimaEm ? new Date(b.ultimaEm).getTime() : 0
        return tb - ta
    })
}
