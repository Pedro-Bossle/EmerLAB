import { supabase } from './supabase.js'

export const ACOES_AUDITORIA = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE']

export const SEVERIDADES_AUDITORIA = [
    { value: '', label: 'Todas' },
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Atenção' },
    { value: 'critical', label: 'Crítica' },
]

/** Presets de relatório operacional (filtro multi-tabela). */
export const PRESETS_AUDITORIA_OPERACIONAL = [
    {
        id: 'cadastros',
        label: 'Cadastros',
        tabelas: ['prestadores', 'prestador_cidades', 'prestador_especialidades'],
    },
    {
        id: 'pagamentos',
        label: 'Pagamentos',
        tabelas: ['pagamentos_registros'],
    },
    {
        id: 'valores',
        label: 'Valores',
        tabelas: ['repasses', 'negociacoes_vet'],
    },
    {
        id: 'acessos',
        label: 'Acessos',
        tabelas: ['auth', 'profiles'],
    },
]

/** Tabelas do resumo semanal “cidades / prestadores” (sem IA — só agregação). */
export const TABELAS_RESUMO_SEMANA_FOCO = [
    'cidades',
    'cidades_municipios_vinculo',
    'prestadores',
    'prestador_cidades',
    'prestador_especialidades',
    'prestador_estabelecimentos',
    'prestador_beneficios',
    'prestador_procedimentos',
]

const LIMIARES_SUSPEITO = {
    deletesSemana: 25,
    deletesHoraUsuario: 15,
    massaHoraUsuarioTabela: 40,
    rajada15minUsuario: 60,
    loginsHoraUsuario: 20,
    permissionChangesSemana: 15,
    logoutsHoraUsuario: 30,
}

function inicioSemanaIso(agora = new Date()) {
    const d = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000)
    return d.toISOString()
}

function contarPor(lista, keyFn) {
    const mapa = new Map()
    for (const item of lista) {
        const k = keyFn(item)
        if (!k) continue
        mapa.set(k, (mapa.get(k) || 0) + 1)
    }
    return [...mapa.entries()]
        .map(([chave, total]) => ({ chave, total }))
        .sort((a, b) => b.total - a.total || String(a.chave).localeCompare(String(b.chave)))
}

/**
 * Agrega logs leves (sem valor_antigo/novo) em resumo textual + totais.
 * Determinístico — sem modelo de linguagem / créditos de IA.
 */
export function montarResumoAuditoriaSemanal(logs = [], { agora = new Date() } = {}) {
    const desde = inicioSemanaIso(agora)
    const naSemana = (logs || []).filter((l) => l?.data_hora && String(l.data_hora) >= desde)
    const foco = naSemana.filter((l) => TABELAS_RESUMO_SEMANA_FOCO.includes(String(l.tabela || '')))

    const porAcao = contarPor(foco, (l) => String(l.acao || '').toUpperCase())
    const porTabela = contarPor(foco, (l) => String(l.tabela || ''))
    const porUsuario = contarPor(
        foco.filter((l) => l.usuario_nome || l.usuario_id),
        (l) => l.usuario_nome || l.usuario_id,
    )

    const cidades = foco.filter((l) =>
        ['cidades', 'cidades_municipios_vinculo'].includes(String(l.tabela || '')),
    )
    const prestadores = foco.filter((l) => String(l.tabela || '').startsWith('prestador'))

    const fmtLista = (arr, max = 4) =>
        arr
            .slice(0, max)
            .map((x) => `${x.chave} (${x.total})`)
            .join(', ') || 'nenhum'

    const frases = []
    if (!foco.length) {
        frases.push('Nenhuma alteração em cidades/prestadores nos últimos 7 dias.')
    } else {
        frases.push(
            `Últimos 7 dias: ${foco.length} evento(s) em cidades/prestadores` +
                ` (${cidades.length} em cidades/vínculos, ${prestadores.length} em prestadores/filhos).`,
        )
        const acoes = contarPor(foco, (l) => String(l.acao || '').toUpperCase())
        const c = acoes.find((a) => a.chave === 'CREATE')?.total || 0
        const u = acoes.find((a) => a.chave === 'UPDATE')?.total || 0
        const d = acoes.find((a) => a.chave === 'DELETE')?.total || 0
        frases.push(`Ações: ${c} criações, ${u} atualizações, ${d} exclusões.`)
        if (porTabela.length) frases.push(`Tabelas mais alteradas: ${fmtLista(porTabela)}.`)
        if (porUsuario.length) frases.push(`Quem mais alterou: ${fmtLista(porUsuario)}.`)
    }

    return {
        desde,
        ate: agora.toISOString(),
        totalGeral: naSemana.length,
        totalFoco: foco.length,
        totalCidades: cidades.length,
        totalPrestadores: prestadores.length,
        porAcao,
        porTabela,
        porUsuario,
        texto: frases.join(' '),
        frases,
    }
}

/**
 * Heurísticas locais de padrão suspeito (DELETE em massa, rajadas).
 * Sem IA — só contagens por janela de tempo.
 */
export function detectarPadroesSuspeitosAuditoria(logs = [], { agora = new Date() } = {}) {
    const desde = inicioSemanaIso(agora)
    const naSemana = (logs || []).filter((l) => l?.data_hora && String(l.data_hora) >= desde)
    const alertas = []

    const deletes = naSemana.filter((l) => String(l.acao || '').toUpperCase() === 'DELETE')
    if (deletes.length >= LIMIARES_SUSPEITO.deletesSemana) {
        alertas.push({
            id: 'muitos-delete-semana',
            severidade: 'critical',
            titulo: 'Muitos DELETE na semana',
            detalhe: `${deletes.length} exclusões nos últimos 7 dias (limite ${LIMIARES_SUSPEITO.deletesSemana}).`,
        })
    }

    const porUsuarioHora = new Map()
    const porUsuarioTabelaHora = new Map()
    const porUsuario15 = new Map()

    for (const l of naSemana) {
        const uid = l.usuario_id || l.usuario_nome || 'desconhecido'
        const nome = l.usuario_nome || uid
        const t = new Date(l.data_hora).getTime()
        if (!Number.isFinite(t)) continue
        const horaKey = `${uid}|${Math.floor(t / (60 * 60 * 1000))}`
        const min15Key = `${uid}|${Math.floor(t / (15 * 60 * 1000))}`
        const tabHoraKey = `${horaKey}|${l.tabela || '?'}`

        if (String(l.acao || '').toUpperCase() === 'DELETE') {
            const cur = porUsuarioHora.get(horaKey) || { nome, n: 0 }
            cur.n += 1
            porUsuarioHora.set(horaKey, cur)
        }

        const massa = porUsuarioTabelaHora.get(tabHoraKey) || {
            nome,
            tabela: l.tabela || '?',
            n: 0,
        }
        massa.n += 1
        porUsuarioTabelaHora.set(tabHoraKey, massa)

        const rajada = porUsuario15.get(min15Key) || { nome, n: 0 }
        rajada.n += 1
        porUsuario15.set(min15Key, rajada)
    }

    for (const { nome, n } of porUsuarioHora.values()) {
        if (n >= LIMIARES_SUSPEITO.deletesHoraUsuario) {
            alertas.push({
                id: `delete-hora-${nome}-${n}`,
                severidade: 'critical',
                titulo: 'DELETE em rajada (1 h)',
                detalhe: `${nome}: ${n} exclusões em cerca de 1 hora.`,
            })
        }
    }

    for (const { nome, tabela, n } of porUsuarioTabelaHora.values()) {
        if (n >= LIMIARES_SUSPEITO.massaHoraUsuarioTabela) {
            alertas.push({
                id: `massa-${nome}-${tabela}-${n}`,
                severidade: 'warning',
                titulo: 'Alteração em massa',
                detalhe: `${nome} em «${tabela}»: ${n} eventos em cerca de 1 hora.`,
            })
        }
    }

    for (const { nome, n } of porUsuario15.values()) {
        if (n >= LIMIARES_SUSPEITO.rajada15minUsuario) {
            alertas.push({
                id: `rajada15-${nome}-${n}`,
                severidade: 'warning',
                titulo: 'Rajada de eventos (15 min)',
                detalhe: `${nome}: ${n} eventos em ~15 minutos.`,
            })
        }
    }

    const porLoginHora = new Map()
    const porLogoutHora = new Map()
    let permissionChanges = 0
    for (const l of naSemana) {
        const acao = String(l.acao || '').toUpperCase()
        const uid = l.usuario_id || l.usuario_nome || 'desconhecido'
        const nome = l.usuario_nome || uid
        const t = new Date(l.data_hora).getTime()
        if (!Number.isFinite(t)) continue
        const horaKey = `${uid}|${Math.floor(t / (60 * 60 * 1000))}`
        if (acao === 'LOGIN') {
            const cur = porLoginHora.get(horaKey) || { nome, n: 0 }
            cur.n += 1
            porLoginHora.set(horaKey, cur)
        }
        if (acao === 'LOGOUT') {
            const cur = porLogoutHora.get(horaKey) || { nome, n: 0 }
            cur.n += 1
            porLogoutHora.set(horaKey, cur)
        }
        if (acao === 'PERMISSION_CHANGE') permissionChanges += 1
    }

    for (const { nome, n } of porLoginHora.values()) {
        if (n >= LIMIARES_SUSPEITO.loginsHoraUsuario) {
            alertas.push({
                id: `login-hora-${nome}-${n}`,
                severidade: 'warning',
                titulo: 'Muitos logins em 1 h',
                detalhe: `${nome}: ${n} logins em cerca de 1 hora (possível partilha de conta ou script).`,
            })
        }
    }
    for (const { nome, n } of porLogoutHora.values()) {
        if (n >= LIMIARES_SUSPEITO.logoutsHoraUsuario) {
            alertas.push({
                id: `logout-hora-${nome}-${n}`,
                severidade: 'info',
                titulo: 'Muitos logouts em 1 h',
                detalhe: `${nome}: ${n} logouts em cerca de 1 hora.`,
            })
        }
    }
    if (permissionChanges >= LIMIARES_SUSPEITO.permissionChangesSemana) {
        alertas.push({
            id: 'permissoes-semana',
            severidade: 'warning',
            titulo: 'Muitas alterações de permissão',
            detalhe: `${permissionChanges} mudanças de permissão nos últimos 7 dias (limite ${LIMIARES_SUSPEITO.permissionChangesSemana}).`,
        })
    }

    // Dedup por titulo+detalhe
    const vistos = new Set()
    const unicos = []
    for (const a of alertas) {
        const k = `${a.titulo}|${a.detalhe}`
        if (vistos.has(k)) continue
        vistos.add(k)
        unicos.push(a)
    }

    return unicos.slice(0, 12)
}

async function authHeader() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return { Authorization: `Bearer ${token}` }
}

export async function chamarApiAuditoria(payload) {
    const headers = {
        'Content-Type': 'application/json',
        ...(await authHeader()),
    }
    const resp = await fetch('/api/audit-logs', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload || {}),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || `Falha na API de auditoria (${resp.status}).`)
    }
    return json
}

/** Registra LOGIN/LOGOUT (best-effort; não bloqueia o fluxo). */
export async function registrarEventoAuthAuditoria(tipo, extras = {}) {
    try {
        await chamarApiAuditoria({
            action: 'recordAuth',
            tipo,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            ...extras,
        })
    } catch {
        /* ignore */
    }
}

export function formatarDataHoraAuditoria(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString('pt-BR')
}

export function resumirAlteracaoAuditoria(log) {
    if (!log) return '—'
    if (log.acao === 'LOGIN') return 'Login no sistema'
    if (log.acao === 'LOGOUT') return 'Logout do sistema'
    if (log.acao === 'CREATE') {
        const nome = log.valor_novo?.nome || log.valor_novo?.name
        return nome ? `Criou registro «${nome}»` : 'Criou registro'
    }
    if (log.acao === 'DELETE') {
        const nome = log.valor_antigo?.nome || log.valor_antigo?.name
        return nome ? `Removeu «${nome}»` : 'Removeu registro'
    }
    const diffs = listarDiffCampos(log.valor_antigo, log.valor_novo)
    if (!diffs.length) return 'Atualizou registro'
    if (diffs.length <= 3) {
        return diffs.map((d) => `${d.campo}: ${fmtCurto(d.antes)} → ${fmtCurto(d.depois)}`).join('; ')
    }
    return `${diffs.length} campos alterados (${diffs
        .slice(0, 3)
        .map((d) => d.campo)
        .join(', ')}…)`
}

function fmtCurto(v) {
    if (v == null || v === '') return '—'
    if (typeof v === 'object') {
        try {
            return JSON.stringify(v).slice(0, 40)
        } catch {
            return '[obj]'
        }
    }
    const s = String(v)
    return s.length > 40 ? `${s.slice(0, 37)}…` : s
}

export function listarDiffCampos(antes, depois) {
    const a = antes && typeof antes === 'object' ? antes : {}
    const b = depois && typeof depois === 'object' ? depois : {}
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    const ignorar = new Set(['data_atualizacao', 'atualizado_em', 'updated_at', 'geocoded_at'])
    const out = []
    for (const key of [...keys].sort()) {
        if (ignorar.has(key)) continue
        const va = a[key]
        const vb = b[key]
        if (JSON.stringify(va) === JSON.stringify(vb)) continue
        out.push({ campo: key, antes: va ?? null, depois: vb ?? null })
    }
    return out
}

/** Rótulos amigáveis dos campos mais comuns na auditoria. */
export const ROTULOS_CAMPOS_AUDITORIA = {
    id: 'ID do registro',
    nome: 'Nome',
    valor: 'Valor',
    veterinario_id: 'Veterinário',
    procedimento_id: 'Procedimento',
    porte_id: 'Porte',
    cidade_id: 'Cidade',
    prestador_id: 'Prestador',
    especialidade_id: 'Especialidade',
    situacao_id: 'Situação',
    nome_alternativo: 'Nome alternativo',
    usuario_id: 'Usuário',
    cpf_cnpj: 'CPF/CNPJ',
    email: 'E-mail',
    telefone: 'Telefone',
    celular: 'Celular',
    crmv: 'CRMV',
    ativo: 'Ativo',
}

export function rotuloCampoAuditoria(campo) {
    return ROTULOS_CAMPOS_AUDITORIA[campo] || String(campo || '')
}

const CAMPOS_FK = {
    veterinario_id: 'veterinario',
    procedimento_id: 'procedimento',
    porte_id: 'porte',
    cidade_id: 'cidade',
    prestador_id: 'prestador',
    especialidade_id: 'especialidade',
    situacao_id: 'situacao',
}

function coletarDePayload(payload, buckets) {
    if (!payload || typeof payload !== 'object') return
    for (const [campo, tipo] of Object.entries(CAMPOS_FK)) {
        if (!(campo in payload) || payload[campo] == null || payload[campo] === '') continue
        const v = payload[campo]
        if (tipo === 'procedimento') {
            const s = String(v).trim()
            if (/^\d+$/.test(s)) buckets.procedimentoIds.add(Number(s))
            else buckets.procedimentoCodigos.add(s)
        } else {
            const n = Number(v)
            if (Number.isFinite(n)) buckets[`${tipo}Ids`].add(n)
        }
    }
}

/**
 * Carrega mapas id→rótulo para enriquecer diffs de auditoria.
 * @returns {Promise<{
 *   veterinario: Map<number,string>,
 *   procedimento: Map<string,string>,
 *   porte: Map<number,string>,
 *   cidade: Map<number,string>,
 *   prestador: Map<number,string>,
 *   especialidade: Map<number,string>,
 *   situacao: Map<number,string>,
 * }>}
 */
export async function carregarMapasReferenciasAuditoria(...payloads) {
    const buckets = {
        veterinarioIds: new Set(),
        procedimentoIds: new Set(),
        procedimentoCodigos: new Set(),
        porteIds: new Set(),
        cidadeIds: new Set(),
        prestadorIds: new Set(),
        especialidadeIds: new Set(),
        situacaoIds: new Set(),
    }
    for (const p of payloads) coletarDePayload(p, buckets)

    const mapas = {
        veterinario: new Map(),
        procedimento: new Map(),
        porte: new Map(),
        cidade: new Map(),
        prestador: new Map(),
        especialidade: new Map(),
        situacao: new Map(),
    }

    const jobs = []

    if (buckets.veterinarioIds.size) {
        jobs.push(
            supabase
                .from('veterinarios')
                .select('id, nome')
                .in('id', [...buckets.veterinarioIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        mapas.veterinario.set(Number(r.id), String(r.nome || '').trim() || `#${r.id}`)
                    }
                }),
        )
    }
    if (buckets.procedimentoIds.size) {
        jobs.push(
            supabase
                .from('procedimentos')
                .select('id, codigo, nome')
                .in('id', [...buckets.procedimentoIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        const label = [r.codigo, r.nome].filter(Boolean).join(' · ') || `Procedimento #${r.id}`
                        mapas.procedimento.set(String(r.id), label)
                        if (r.codigo) mapas.procedimento.set(String(r.codigo), label)
                    }
                }),
        )
    }
    if (buckets.procedimentoCodigos.size) {
        jobs.push(
            supabase
                .from('procedimentos')
                .select('id, codigo, nome')
                .in('codigo', [...buckets.procedimentoCodigos])
                .then(({ data }) => {
                    for (const r of data || []) {
                        const label = [r.codigo, r.nome].filter(Boolean).join(' · ') || `Procedimento #${r.id}`
                        mapas.procedimento.set(String(r.id), label)
                        if (r.codigo) mapas.procedimento.set(String(r.codigo), label)
                    }
                }),
        )
    }
    if (buckets.porteIds.size) {
        jobs.push(
            supabase
                .from('portes')
                .select('id, nome')
                .in('id', [...buckets.porteIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        mapas.porte.set(Number(r.id), String(r.nome || '').trim() || `#${r.id}`)
                    }
                }),
        )
    }
    if (buckets.cidadeIds.size) {
        jobs.push(
            supabase
                .from('cidades')
                .select('id, nome, uf')
                .in('id', [...buckets.cidadeIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        const nome = String(r.nome || '').trim()
                        const uf = String(r.uf || '').trim()
                        mapas.cidade.set(Number(r.id), uf ? `${nome}/${uf}` : nome || `#${r.id}`)
                    }
                }),
        )
    }
    if (buckets.prestadorIds.size) {
        jobs.push(
            supabase
                .from('prestadores')
                .select('id, nome')
                .in('id', [...buckets.prestadorIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        mapas.prestador.set(Number(r.id), String(r.nome || '').trim() || `#${r.id}`)
                    }
                }),
        )
    }
    if (buckets.especialidadeIds.size) {
        jobs.push(
            supabase
                .from('especialidades')
                .select('id, nome')
                .in('id', [...buckets.especialidadeIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        mapas.especialidade.set(Number(r.id), String(r.nome || '').trim() || `#${r.id}`)
                    }
                }),
        )
    }
    if (buckets.situacaoIds.size) {
        jobs.push(
            supabase
                .from('situacoes')
                .select('id, descricao')
                .in('id', [...buckets.situacaoIds])
                .then(({ data }) => {
                    for (const r of data || []) {
                        mapas.situacao.set(Number(r.id), String(r.descricao || '').trim() || `#${r.id}`)
                    }
                }),
        )
    }

    await Promise.all(jobs)
    return mapas
}

/** Formata valor de campo com ID + nome quando for FK conhecida. */
export function formatarValorAuditoriaAmigavel(campo, valor, mapas = null) {
    if (valor == null || valor === '') return '—'
    const tipo = CAMPOS_FK[campo]
    if (!tipo || !mapas) {
        if (typeof valor === 'object') {
            try {
                return JSON.stringify(valor, null, 2)
            } catch {
                return String(valor)
            }
        }
        return String(valor)
    }

    if (tipo === 'procedimento') {
        const chave = String(valor).trim()
        const nome = mapas.procedimento?.get(chave)
        if (!nome) return chave
        return nome.includes(chave) ? nome : `${chave} — ${nome}`
    }

    const id = Number(valor)
    if (!Number.isFinite(id)) return String(valor)
    const nome = mapas[tipo]?.get(id)
    return nome ? `${id} — ${nome}` : String(id)
}

/** Linhas de contexto (onde mudou) a partir do payload. */
export function montarContextoAuditoriaAmigavel(payload, mapas) {
    if (!payload || typeof payload !== 'object') return []
    const linhas = []
    const add = (campo) => {
        if (!(campo in payload) || payload[campo] == null || payload[campo] === '') return
        linhas.push({
            campo,
            rotulo: rotuloCampoAuditoria(campo),
            texto: formatarValorAuditoriaAmigavel(campo, payload[campo], mapas),
        })
    }
    add('veterinario_id')
    add('prestador_id')
    add('procedimento_id')
    add('porte_id')
    add('cidade_id')
    add('especialidade_id')
    add('situacao_id')
    if (payload.nome) {
        linhas.push({ campo: 'nome', rotulo: 'Nome', texto: String(payload.nome) })
    }
    if (payload.valor != null && payload.valor !== '') {
        linhas.push({ campo: 'valor', rotulo: 'Valor', texto: String(payload.valor) })
    }
    return linhas
}

export function escaparCsv(valor) {
    const s = valor == null ? '' : String(valor)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
}

export function montarCsvAuditoria(logs) {
    const header = [
        'id',
        'data_hora',
        'usuario_id',
        'usuario_nome',
        'acao',
        'tabela',
        'registro_id',
        'severidade',
        'resumo',
        'ip_usuario',
        'valor_antigo',
        'valor_novo',
    ]
    const lines = [header.join(',')]
    for (const log of logs || []) {
        lines.push(
            [
                log.id,
                log.data_hora,
                log.usuario_id,
                log.usuario_nome,
                log.acao,
                log.tabela,
                log.registro_id,
                log.severidade,
                resumirAlteracaoAuditoria(log),
                log.ip_usuario,
                JSON.stringify(log.valor_antigo ?? null),
                JSON.stringify(log.valor_novo ?? null),
            ]
                .map(escaparCsv)
                .join(','),
        )
    }
    return lines.join('\n')
}

export function baixarTextoComoArquivo(nome, conteudo, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([conteudo], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
}
