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
        criadorNome: nomesPorId.get(row.criado_por) || '—',
        atribuidoNome: nomesPorId.get(row.atribuido_a) || '—',
    }
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
        const blob = [
            t.titulo,
            t.observacoes,
            t.atribuidoNome,
            t.criadorNome,
            t.status,
            t.prioridade,
            formatarPrazoTarefa(t.prazo),
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

    const { data, error } = await supabase
        .from('home_tarefas')
        .select(
            'id, titulo, observacoes, prazo, status, prioridade, criado_por, atribuido_a, criado_em, atualizado_em, concluido_em',
        )
        // Privacidade: somente criador ou destinatário (reforçado também no RLS).
        .or(`criado_por.eq.${uid},atribuido_a.eq.${uid}`)
        .order('prazo', { ascending: true, nullsFirst: false })
        .order('criado_em', { ascending: false })

    if (error) {
        if (/home_tarefas|does not exist|schema cache/i.test(error.message)) {
            return { tarefas: [], aviso: 'Tabela home_tarefas não configurada. Execute scripts/sql/home_tarefas.sql.' }
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
}) {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) throw new Error('Sessão ausente.')
    const tit = String(titulo || '').trim()
    if (!tit) throw new Error('Informe o título da tarefa.')
    const dest = atribuidoA || uid

    const { data, error } = await supabase
        .from('home_tarefas')
        .insert({
            titulo: tit,
            observacoes: String(observacoes || '').trim() || null,
            prazo: prazo || null,
            prioridade: prioridade || 'normal',
            status: 'pendente',
            criado_por: uid,
            atribuido_a: dest,
            atualizado_em: new Date().toISOString(),
        })
        .select(
            'id, titulo, observacoes, prazo, status, prioridade, criado_por, atribuido_a, criado_em, atualizado_em, concluido_em',
        )
        .single()

    if (error) throw new Error(error.message)
    return mapRowTarefa(data)
}

export async function atualizarTarefaHome(id, patch) {
    const payload = {
        atualizado_em: new Date().toISOString(),
    }
    if (patch.titulo !== undefined) payload.titulo = String(patch.titulo || '').trim()
    if (patch.observacoes !== undefined) payload.observacoes = String(patch.observacoes || '').trim() || null
    if (patch.prazo !== undefined) payload.prazo = patch.prazo || null
    if (patch.prioridade !== undefined) payload.prioridade = patch.prioridade
    if (patch.atribuidoA !== undefined) payload.atribuido_a = patch.atribuidoA
    if (patch.status !== undefined) {
        payload.status = patch.status
        payload.concluido_em =
            patch.status === 'concluida' ? new Date().toISOString() : null
    }

    const { data, error } = await supabase
        .from('home_tarefas')
        .update(payload)
        .eq('id', id)
        .select(
            'id, titulo, observacoes, prazo, status, prioridade, criado_por, atribuido_a, criado_em, atualizado_em, concluido_em',
        )
        .single()

    if (error) throw new Error(error.message)
    return mapRowTarefa(data)
}

export async function excluirTarefaHome(id) {
    const { error } = await supabase.from('home_tarefas').delete().eq('id', id)
    if (error) throw new Error(error.message)
}
