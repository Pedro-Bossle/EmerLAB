import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    PERMISSION_KEYS,
    hasPermission,
    normalizarProfileAcesso,
} from '../src/lib/accessControl.js'
import {
    getClientIp,
    getRequestHeader,
    readJsonBodyLimited,
    responderSePayloadGrande,
} from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const getHeader = (req, name) => getRequestHeader(req, name) || ''

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para a API de auditoria.')
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    })
}

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const buscarProfile = async (supabase, userId) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, permissions')
        .eq('id', userId)
        .maybeSingle()
    return { data, error }
}

const validarAdminAuditoria = async (supabase, req) => {
    const authHeader = getHeader(req, 'authorization')
    const token = String(authHeader || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    if (!token) return { error: 'Sessão ausente.' }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user?.id) return { error: 'Sessão inválida.' }

    const { data: profileData, error: profileError } = await buscarProfile(supabase, userData.user.id)
    if (profileError || !profileData) return { error: 'Perfil não encontrado.' }

    const profile = normalizarProfileAcesso(profileData)
    if (!hasPermission(profile, PERMISSION_KEYS.ACCESS_MANAGE)) {
        return { error: 'Sem permissão para ver auditoria.' }
    }

    return { user: userData.user, profile }
}

const validarCredenciamentoRelatorioCadastros = async (supabase, req) => {
    const authHeader = getHeader(req, 'authorization')
    const token = String(authHeader || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    if (!token) return { error: 'Sessão ausente.' }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user?.id) return { error: 'Sessão inválida.' }

    const { data: profileData, error: profileError } = await buscarProfile(supabase, userData.user.id)
    if (profileError || !profileData) return { error: 'Perfil não encontrado.' }

    const profile = normalizarProfileAcesso(profileData)
    if (
        !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_CADASTRO_VIEW) &&
        !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_VIEW)
    ) {
        return { error: 'Sem permissão para exportar relatório de cadastros.' }
    }

    return { user: userData.user, profile }
}

async function listarAuditLogsPrestadoresRelatorio(supabase) {
    const pageSize = 1000
    const acumulado = []
    for (let page = 0; page < 30; page += 1) {
        const from = page * pageSize
        const to = from + pageSize - 1
        const { data, error } = await supabase
            .from('audit_logs')
            .select(
                'data_hora, usuario_id, usuario_nome, acao, registro_id, valor_antigo, valor_novo',
            )
            .eq('tabela', 'prestadores')
            .in('acao', ['CREATE', 'UPDATE'])
            .not('usuario_id', 'is', null)
            .order('data_hora', { ascending: false })
            .range(from, to)
        if (error) throw error
        const lote = data || []
        acumulado.push(...lote)
        if (lote.length < pageSize) break
    }
    return acumulado
}

const tabelaIndisponivel = (msg) =>
    /audit_logs|does not exist|schema cache/i.test(String(msg || ''))

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (req.method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    const ip = getClientIp(req)
    if (!aplicarRateLimit(res, `audit-logs:${ip}`, RATE_LIMITS.auditLogs)) return

    try {
        const supabase = getSupabaseAdmin()
        let body
        try {
            body = await readJsonBodyLimited(req)
        } catch (e) {
            if (responderSePayloadGrande(res, e)) return
            throw e
        }
        const action = String(body.action || 'list').trim()

        if (action === 'recordAuth') {
            const authHeader = getHeader(req, 'authorization')
            const token = String(authHeader || '')
                .replace(/^Bearer\s+/i, '')
                .trim()
            if (!token) return responderErro(res, 401, 'Sessão ausente.')

            const { data: userData, error: userError } = await supabase.auth.getUser(token)
            if (userError || !userData?.user?.id) return responderErro(res, 401, 'Sessão inválida.')

            const { data: profileData } = await buscarProfile(supabase, userData.user.id)
            const nome = profileData?.name || userData.user.email || null
            const tipo = String(body.tipo || 'LOGIN').toUpperCase() === 'LOGOUT' ? 'LOGOUT' : 'LOGIN'
            const ua = String(body.userAgent || getHeader(req, 'user-agent') || '').slice(0, 500) || null

            const { error } = await supabase.from('audit_logs').insert({
                data_hora: new Date().toISOString(),
                usuario_id: userData.user.id,
                usuario_nome: nome,
                acao: tipo,
                tabela: 'auth',
                registro_id: userData.user.id,
                valor_antigo: null,
                valor_novo: { event: tipo.toLowerCase(), email: userData.user.email || null },
                ip_usuario: getClientIp(req),
                user_agent: ua,
                severidade: 'info',
            })

            if (error) {
                if (tabelaIndisponivel(error.message)) {
                    return res.status(200).json({ ok: true, aviso: 'Tabela audit_logs não configurada.' })
                }
                return responderErro(res, 500, error.message)
            }
            return res.status(200).json({ ok: true })
        }

        if (action === 'prestadoresResponsaveis') {
            const cred = await validarCredenciamentoRelatorioCadastros(supabase, req)
            if (cred.error) return responderErro(res, 403, cred.error)
            try {
                const logs = await listarAuditLogsPrestadoresRelatorio(supabase)
                return res.status(200).json({ ok: true, logs })
            } catch (e) {
                if (tabelaIndisponivel(e?.message)) {
                    return res.status(200).json({ ok: true, logs: [], aviso: 'Tabela audit_logs não configurada.' })
                }
                return responderErro(res, 500, e?.message || String(e))
            }
        }

        const admin = await validarAdminAuditoria(supabase, req)
        if (admin.error) return responderErro(res, 403, admin.error)

        if (action === 'meta') {
            const [{ data: users }, { data: tabelas }] = await Promise.all([
                supabase
                    .from('audit_logs')
                    .select('usuario_id, usuario_nome')
                    .not('usuario_id', 'is', null)
                    .order('data_hora', { ascending: false })
                    .limit(400),
                supabase.from('audit_logs').select('tabela').order('tabela', { ascending: true }).limit(500),
            ])

            const usuariosMap = new Map()
            for (const row of users || []) {
                if (!row.usuario_id || usuariosMap.has(row.usuario_id)) continue
                usuariosMap.set(row.usuario_id, {
                    id: row.usuario_id,
                    nome: row.usuario_nome || row.usuario_id,
                })
            }
            const tabelasSet = new Set((tabelas || []).map((r) => r.tabela).filter(Boolean))

            return res.status(200).json({
                ok: true,
                usuarios: [...usuariosMap.values()].sort((a, b) =>
                    String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
                ),
                tabelas: [...tabelasSet].sort((a, b) => a.localeCompare(b, 'pt-BR')),
                acoes: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE'],
            })
        }

        // Resumo semanal leve: sem valor_antigo/novo (menos payload; sem IA).
        if (action === 'resumoSemana') {
            const dias = Math.min(30, Math.max(1, Number(body.dias) || 7))
            const dataInicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
            const pageSize = Math.min(5000, Math.max(100, Number(body.pageSize) || 3000))
            const { data, error } = await supabase
                .from('audit_logs')
                .select('id, data_hora, usuario_id, usuario_nome, acao, tabela, registro_id, severidade')
                .gte('data_hora', dataInicio)
                .order('data_hora', { ascending: false })
                .limit(pageSize)

            if (error) {
                if (tabelaIndisponivel(error.message)) {
                    return res.status(200).json({
                        ok: true,
                        logs: [],
                        dias,
                        aviso: 'Tabela audit_logs não configurada.',
                    })
                }
                return responderErro(res, 500, error.message)
            }

            return res.status(200).json({
                ok: true,
                logs: data || [],
                dias,
                geradoEm: new Date().toISOString(),
            })
        }

        if (action !== 'list' && action !== 'export') {
            return responderErro(res, 400, 'Ação inválida. Use list, export, meta, resumoSemana, prestadoresResponsaveis ou recordAuth.')
        }

        const page = Math.max(1, Number(body.page) || 1)
        const pageSize = Math.min(
            action === 'export' ? 5000 : 100,
            Math.max(1, Number(body.pageSize) || (action === 'export' ? 2000 : 50)),
        )
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1

        let query = supabase
            .from('audit_logs')
            .select(
                'id, data_hora, usuario_id, usuario_nome, acao, tabela, registro_id, valor_antigo, valor_novo, ip_usuario, user_agent, severidade',
                { count: 'exact' },
            )
            .order('data_hora', { ascending: false })
            .range(from, to)

        if (body.usuarioId) query = query.eq('usuario_id', String(body.usuarioId).trim())
        if (body.acao) query = query.eq('acao', String(body.acao).trim().toUpperCase())
        const tabelasMulti = Array.isArray(body.tabelas)
            ? body.tabelas.map((t) => String(t || '').trim()).filter(Boolean)
            : []
        if (tabelasMulti.length > 0) {
            query = query.in('tabela', tabelasMulti)
        } else if (body.tabela) {
            query = query.eq('tabela', String(body.tabela).trim())
        }
        if (body.severidade) query = query.eq('severidade', String(body.severidade).trim().toLowerCase())
        if (body.dataInicio) query = query.gte('data_hora', String(body.dataInicio))
        if (body.dataFim) query = query.lte('data_hora', String(body.dataFim))
        if (body.registroId) query = query.eq('registro_id', String(body.registroId).trim())
        if (body.q) {
            const q = String(body.q).trim()
            if (q) {
                query = query.or(
                    `usuario_nome.ilike.%${q}%,tabela.ilike.%${q}%,registro_id.ilike.%${q}%,acao.ilike.%${q}%`,
                )
            }
        }

        const { data, error, count } = await query
        if (error) {
            if (tabelaIndisponivel(error.message)) {
                return res.status(200).json({
                    ok: true,
                    logs: [],
                    total: 0,
                    page,
                    pageSize,
                    aviso: 'Tabela audit_logs não configurada. Execute scripts/sql/audit_logs_e_credenciado_em.sql no Supabase.',
                })
            }
            return responderErro(res, 500, error.message)
        }

        return res.status(200).json({
            ok: true,
            logs: data || [],
            total: count ?? (data || []).length,
            page,
            pageSize,
        })
    } catch (e) {
        return responderErro(res, 500, e?.message || String(e))
    }
}
