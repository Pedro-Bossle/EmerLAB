import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    DEFAULT_INVITED_PERMISSIONS,
    PERMISSION_KEYS,
    hasPermission,
    normalizarProfileAcesso,
    resumirAlteracoesPermissoes,
} from '../src/lib/accessControl.js'
import { sanitizarPermissionsParaSalvar } from '../src/lib/permissionCatalog.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const getJsonBody = async (req) => {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
        if (typeof req.body === 'string' && req.body.trim()) {
            try {
                return JSON.parse(req.body)
            } catch {
                return {}
            }
        }
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (!chunks.length) return {}
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    } catch {
        return {}
    }
}

/** Aceita listAudit, list_audit, list-audit, etc. */
const resolveAdminAction = (raw) => {
    const s = String(raw ?? '').trim()
    if (!s) return ''
    const compact = s.toLowerCase().replace(/[-_\s]/g, '')
    const aliases = {
        list: 'list',
        invite: 'invite',
        reset: 'reset',
        updateprofile: 'updateProfile',
        listaudit: 'listAudit',
        deleteuser: 'deleteUser',
    }
    if (aliases[compact]) return aliases[compact]
    const canon = ['list', 'invite', 'reset', 'updateProfile', 'listAudit', 'deleteUser']
    return canon.includes(s) ? s : ''
}

const getHeader = (req, name) => {
    const headers = req.headers || {}
    return headers[name] || headers[name.toLowerCase()] || ''
}

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usar o gerenciamento de acessos.')
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    })
}

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const buscarProfile = async (supabase, userId) => {
    const selectCompleto = await supabase
        .from('profiles')
        .select('id, name, email, credenciamento_read_only, permissions')
        .eq('id', userId)
        .maybeSingle()

    if (!selectCompleto.error) return selectCompleto

    const mensagem = String(selectCompleto.error.message || '')
    if (!mensagem.includes('email')) return selectCompleto

    const fallback = await supabase
        .from('profiles')
        .select('id, name, credenciamento_read_only, permissions')
        .eq('id', userId)
        .maybeSingle()

    return fallback
}

const listarProfiles = async (supabase) => {
    const selectCompleto = await supabase
        .from('profiles')
        .select('id, name, email, credenciamento_read_only, permissions')
        .order('name', { ascending: true })

    if (!selectCompleto.error) return selectCompleto

    const mensagem = String(selectCompleto.error.message || '')
    if (!mensagem.includes('email')) return selectCompleto

    return supabase
        .from('profiles')
        .select('id, name, credenciamento_read_only, permissions')
        .order('name', { ascending: true })
}

const upsertProfile = async (supabase, payload) => {
    const completo = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select().single()
    if (!completo.error) return completo

    const mensagem = String(completo.error.message || '')
    if (!mensagem.includes('email')) return completo

    const semEmail = { ...payload }
    delete semEmail.email
    return supabase.from('profiles').upsert(semEmail, { onConflict: 'id' }).select().single()
}

const encontrarUsuarioPorEmail = async (supabase, email) => {
    const alvo = String(email || '').trim().toLowerCase()
    if (!alvo) return null

    for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error

        const encontrado = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === alvo)
        if (encontrado) return encontrado
        if ((data?.users || []).length < 1000) break
    }

    return null
}

const registrarAuditoria = async (supabase, entrada) => {
    const payload = {
        actor_user_id: entrada.actorUserId || null,
        actor_name: entrada.actorName || null,
        target_user_id: entrada.targetUserId || null,
        action: entrada.action,
        summary: entrada.summary || null,
        details: entrada.details && typeof entrada.details === 'object' ? entrada.details : {},
    }
    const { error } = await supabase.from('access_audit_log').insert(payload)
    if (error) {
        const msg = String(error.message || '')
        if (msg.includes('access_audit_log') || msg.includes('does not exist') || msg.includes('schema cache')) {
            console.warn('[admin-users] Tabela access_audit_log indisponível — execute a migration em supabase/migrations.')
        } else {
            console.warn('[admin-users] Falha ao registrar auditoria:', msg)
        }
    }

    // Espelho no audit_logs unificado (se existir)
    const acao =
        entrada.action === 'update_profile' && entrada.details?.permissionsBefore
            ? 'PERMISSION_CHANGE'
            : String(entrada.action || 'UPDATE').toUpperCase()
    const { error: err2 } = await supabase.from('audit_logs').insert({
        data_hora: new Date().toISOString(),
        usuario_id: entrada.actorUserId || null,
        usuario_nome: entrada.actorName || null,
        acao,
        tabela: 'profiles',
        registro_id: entrada.targetUserId || null,
        valor_antigo: entrada.details?.permissionsBefore
            ? { permissions: entrada.details.permissionsBefore, name: entrada.details.nameBefore }
            : null,
        valor_novo: {
            summary: entrada.summary || null,
            permissions: entrada.details?.permissionsAfter || entrada.details?.permissions || null,
            action: entrada.action,
        },
        severidade: acao === 'PERMISSION_CHANGE' || acao === 'DELETE_USER' ? 'critical' : 'warning',
    })
    if (err2 && !/audit_logs|does not exist|schema cache/i.test(String(err2.message || ''))) {
        console.warn('[admin-users] Falha ao espelhar em audit_logs:', err2.message)
    }
}

const validarAdmin = async (supabase, req) => {
    const authHeader = getHeader(req, 'authorization')
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return { error: 'Sessão ausente.' }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user?.id) return { error: 'Sessão inválida.' }

    const { data: profileData, error: profileError } = await buscarProfile(supabase, userData.user.id)
    if (profileError || !profileData) return { error: 'Perfil administrador não encontrado.' }

    const profile = normalizarProfileAcesso(profileData)
    if (!hasPermission(profile, PERMISSION_KEYS.ACCESS_MANAGE)) {
        return { error: 'Sem permissão para gerenciar acessos.' }
    }

    return { user: userData.user, profile }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (req.method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    try {
        const supabase = getSupabaseAdmin()
        const admin = await validarAdmin(supabase, req)
        if (admin.error) return responderErro(res, 403, admin.error)

        const body = await getJsonBody(req)
        const action = resolveAdminAction(body.action)
        if (!action) {
            const recebida = String(body.action ?? '').trim()
            return responderErro(
                res,
                400,
                recebida
                    ? `Ação inválida: «${recebida}». Use list, listAudit, invite, updateProfile, reset ou deleteUser.`
                    : 'Ação inválida. Informe action no corpo da requisição.',
            )
        }

        if (action === 'list') {
            const { data, error } = await listarProfiles(supabase)
            if (error) return responderErro(res, 500, error.message)

            return res.status(200).json({
                ok: true,
                profiles: (data || []).map((profile) => normalizarProfileAcesso(profile)),
            })
        }

        if (action === 'invite') {
            const email = String(body.email || '').trim().toLowerCase()
            const name = String(body.name || '').trim()
            let permissions = body.permissions && typeof body.permissions === 'object'
                ? body.permissions
                : DEFAULT_INVITED_PERMISSIONS
            permissions = sanitizarPermissionsParaSalvar(permissions)

            if (!email || !email.includes('@')) return responderErro(res, 400, 'Informe um email válido.')
            if (!name) return responderErro(res, 400, 'Informe o nome do usuário.')

            let user = await encontrarUsuarioPorEmail(supabase, email)
            let conviteEnviado = false

            if (!user) {
                const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
                    data: { name },
                    redirectTo: body.redirectTo || process.env.SITE_URL || undefined,
                })
                if (error) return responderErro(res, 500, error.message)
                user = data?.user || null
                conviteEnviado = true
            } else {
                await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: body.redirectTo || process.env.SITE_URL || undefined,
                })
            }

            if (!user?.id) return responderErro(res, 500, 'Não foi possível identificar o usuário criado.')

            const { data: profileData, error: profileError } = await upsertProfile(supabase, {
                id: user.id,
                name,
                email,
                permissions,
                credenciamento_read_only: !permissions[PERMISSION_KEYS.CREDENCIAMENTO_EDIT],
            })

            if (profileError) return responderErro(res, 500, profileError.message)

            const profileNorm = normalizarProfileAcesso(profileData)
            await registrarAuditoria(supabase, {
                actorUserId: admin.user.id,
                actorName: admin.profile.name,
                targetUserId: profileNorm.id,
                action: conviteEnviado ? 'invite' : 'invite_existing_reset',
                summary: conviteEnviado ? `Convite enviado para ${email}` : `Convite/reset para usuário existente ${email}`,
                details: { permissions: profileNorm.permissions },
            })

            return res.status(200).json({
                ok: true,
                conviteEnviado,
                profile: profileNorm,
            })
        }

        if (action === 'listAudit') {
            const targetUserId = String(body.userId || '').trim()
            const limit = Math.min(Math.max(Number(body.limit) || 80, 1), 200)

            let query = supabase
                .from('access_audit_log')
                .select('id, created_at, actor_user_id, actor_name, target_user_id, action, summary, details')
                .order('created_at', { ascending: false })
                .limit(limit)

            if (targetUserId) query = query.eq('target_user_id', targetUserId)

            const { data, error } = await query
            if (error) {
                const msg = String(error.message || '')
                if (msg.includes('access_audit_log') || msg.includes('does not exist')) {
                    return res.status(200).json({ ok: true, logs: [], aviso: 'Tabela de auditoria não configurada.' })
                }
                return responderErro(res, 500, error.message)
            }

            return res.status(200).json({ ok: true, logs: data || [] })
        }

        if (action === 'updateProfile') {
            const userId = String(body.userId || '').trim()
            const name = String(body.name || '').trim()
            let permissions = body.permissions && typeof body.permissions === 'object' ? body.permissions : null

            if (!userId) return responderErro(res, 400, 'Usuário não informado.')
            if (!name) return responderErro(res, 400, 'Informe o nome do usuário.')
            if (!permissions) return responderErro(res, 400, 'Permissões não informadas.')
            permissions = sanitizarPermissionsParaSalvar(permissions)

            if (userId === admin.user.id && !permissions[PERMISSION_KEYS.ACCESS_MANAGE]) {
                return responderErro(res, 400, 'Você não pode remover a permissão de gerenciar acessos do seu próprio usuário.')
            }

            const { data: atual } = await buscarProfile(supabase, userId)
            const perfilAntes = normalizarProfileAcesso(atual || { id: userId })
            const emailNovo = String(body.email || '').trim().toLowerCase()
            const emailAtual = String(atual?.email || perfilAntes.email || '').trim().toLowerCase()
            const emailFinal =
                emailNovo && emailNovo.includes('@') ? emailNovo : emailAtual || null

            if (emailFinal && emailFinal !== emailAtual) {
                const { error: emailError } = await supabase.auth.admin.updateUserById(userId, {
                    email: emailFinal,
                })
                if (emailError) return responderErro(res, 500, emailError.message)
            }

            const { data: profileData, error } = await upsertProfile(supabase, {
                id: userId,
                name,
                email: emailFinal,
                permissions,
                credenciamento_read_only: !permissions[PERMISSION_KEYS.CREDENCIAMENTO_EDIT],
            })

            if (error) return responderErro(res, 500, error.message)

            const profileNorm = normalizarProfileAcesso(profileData)
            const mudancasPerm = resumirAlteracoesPermissoes(perfilAntes.permissions, profileNorm.permissions)
            const partesResumo = []
            if (perfilAntes.name !== profileNorm.name) partesResumo.push(`Nome: «${perfilAntes.name}» → «${profileNorm.name}»`)
            if (emailAtual && emailFinal && emailAtual !== emailFinal) partesResumo.push(`Email: ${emailAtual} → ${emailFinal}`)
            if (mudancasPerm.length) partesResumo.push(mudancasPerm.join('; '))

            await registrarAuditoria(supabase, {
                actorUserId: admin.user.id,
                actorName: admin.profile.name,
                targetUserId: userId,
                action: 'update_profile',
                summary: partesResumo.length ? partesResumo.join(' | ') : 'Perfil atualizado',
                details: {
                    permissionsBefore: perfilAntes.permissions,
                    permissionsAfter: profileNorm.permissions,
                },
            })

            return res.status(200).json({
                ok: true,
                profile: profileNorm,
            })
        }

        if (action === 'reset') {
            const email = String(body.email || '').trim().toLowerCase()
            if (!email || !email.includes('@')) return responderErro(res, 400, 'Email inválido para redefinição.')

            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: body.redirectTo || process.env.SITE_URL || undefined,
            })
            if (error) return responderErro(res, 500, error.message)

            const alvo = await encontrarUsuarioPorEmail(supabase, email)
            await registrarAuditoria(supabase, {
                actorUserId: admin.user.id,
                actorName: admin.profile.name,
                targetUserId: alvo?.id || null,
                action: 'reset_password',
                summary: `Email de redefinição de senha enviado para ${email}`,
                details: { email },
            })

            return res.status(200).json({ ok: true })
        }

        if (action === 'deleteUser') {
            const userId = String(body.userId || '').trim()
            if (!userId) return responderErro(res, 400, 'Usuário não informado.')
            if (userId === admin.user.id) {
                return responderErro(res, 400, 'Você não pode excluir sua própria conta.')
            }

            const { data: alvo, error: errAlvo } = await buscarProfile(supabase, userId)
            if (errAlvo) return responderErro(res, 500, errAlvo.message)
            if (!alvo?.id) return responderErro(res, 404, 'Usuário não encontrado.')

            const nome = String(alvo.name || '').trim() || 'Sem nome'
            const email = String(alvo.email || '').trim()

            await registrarAuditoria(supabase, {
                actorUserId: admin.user.id,
                actorName: admin.profile.name,
                targetUserId: userId,
                action: 'delete_user',
                summary: `Usuário excluído: ${nome}${email ? ` (${email})` : ''}`,
                details: { name: nome, email },
            })

            const { error: authError } = await supabase.auth.admin.deleteUser(userId)
            if (authError) return responderErro(res, 500, authError.message)

            const { error: profileError } = await supabase.from('profiles').delete().eq('id', userId)
            if (profileError) {
                console.warn('[admin-users] Auth removido; falha ao apagar profile:', profileError.message)
            }

            return res.status(200).json({ ok: true, deletedUserId: userId })
        }

        return responderErro(res, 500, `Ação «${action}» não implementada.`)
    } catch (error) {
        return responderErro(res, 500, error?.message || 'Falha na API de usuários.')
    }
}
