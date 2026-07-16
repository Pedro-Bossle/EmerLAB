import { supabase } from './supabase.js'

export const ACOES_AUDITORIA = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE']

export const SEVERIDADES_AUDITORIA = [
    { value: '', label: 'Todas' },
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Atenção' },
    { value: 'critical', label: 'Crítica' },
]

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
