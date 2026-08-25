/**
 * Auth de rotas /api (Vercel / Vite) — JWT do utilizador + perfil.
 * Service role só para ler profiles / operar DB depois da validação.
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    hasPermission,
    normalizarProfileAcesso,
    podeLerFerramenta,
    usuarioPodeEditarFerramenta,
} from '../accessControl.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

export function getRequestHeader(req, name) {
    const headers = req.headers || {}
    return headers[name] || headers[name.toLowerCase()] || ''
}

/**
 * IP do cliente: preferir o hop mais recente de x-forwarded-for (anexado pelo proxy),
 * nunca o primeiro hop (spoofável pelo cliente).
 */
export function getClientIp(req) {
    const xfRaw = String(getRequestHeader(req, 'x-forwarded-for') || '')
    const hops = xfRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
    return (
        getRequestHeader(req, 'x-real-ip') ||
        getRequestHeader(req, 'x-vercel-forwarded-for') ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        'unknown'
    )
}

export function createSupabaseAdminClient() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    })
}

function createSupabaseAuthClient() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const anonKey =
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) return null
    return createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
}

/**
 * @param {{ permitirTrocaSenhaPendente?: boolean, supabaseAdmin?: import('@supabase/supabase-js').SupabaseClient }} [opts]
 * @returns {Promise<{ user?, profile?, error?, status?, token? }>}
 */
export async function validarJwtComPerfil(req, { supabaseAdmin = null, permitirTrocaSenhaPendente = false } = {}) {
    const authHeader = getRequestHeader(req, 'authorization')
    const token = String(authHeader || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    if (!token) return { error: 'Sessão ausente.', status: 401 }

    const authClient = createSupabaseAuthClient()
    const admin = supabaseAdmin || createSupabaseAdminClient()
    const client = authClient || admin

    const { data: userData, error: userError } = await client.auth.getUser(token)
    if (userError || !userData?.user?.id) {
        return { error: 'Sessão inválida.', status: 401 }
    }

    let profileData = null
    let profileError = null
    ;({ data: profileData, error: profileError } = await admin
        .from('profiles')
        .select('id, name, email, permissions, force_password_change, password_changed_at')
        .eq('id', userData.user.id)
        .maybeSingle())

    if (profileError) {
        const msg = String(profileError.message || '').toLowerCase()
        const colunaOpcional =
            msg.includes('force_password_change') ||
            msg.includes('password_changed_at') ||
            msg.includes('does not exist') ||
            msg.includes('schema cache')
        if (colunaOpcional) {
            ;({ data: profileData, error: profileError } = await admin
                .from('profiles')
                .select('id, name, email, permissions')
                .eq('id', userData.user.id)
                .maybeSingle())
        }
    }

    if (profileError || !profileData) {
        return { error: 'Perfil não encontrado.', status: 403 }
    }

    const profile = normalizarProfileAcesso(profileData)
    if (profile.forcePasswordChange && !permitirTrocaSenhaPendente) {
        return {
            error: 'É necessário alterar a senha antes de continuar.',
            status: 403,
            forcePasswordChange: true,
        }
    }

    return {
        user: userData.user,
        profile,
        token,
    }
}

/**
 * @param {string|string[]} permissionKeys — PERMISSION_KEYS (qualquer uma basta)
 */
export async function validarJwtComPermissao(req, permissionKeys, opts = {}) {
    const base = await validarJwtComPerfil(req, opts)
    if (base.error) return base
    const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys]
    const ok = keys.some((k) => hasPermission(base.profile, k))
    if (!ok) {
        return { error: 'Sem permissão para esta operação.', status: 403 }
    }
    return base
}

/**
 * Credenciamento + ferramenta ACL específica (ex. prospectos_osm).
 * @param {{ requireEdit?: boolean }} [opts]
 */
export async function validarJwtFerramentaCredenciamento(req, toolId, viewKey, opts = {}) {
    const base = await validarJwtComPerfil(req, opts)
    if (base.error) return base
    const perms = base.profile.permissions
    const precisaEdit = Boolean(opts.requireEdit)
    const podeTela = precisaEdit
        ? hasPermission(base.profile, viewKey) && usuarioPodeEditarFerramenta(perms, toolId)
        : hasPermission(base.profile, viewKey) && podeLerFerramenta(perms, toolId)
    if (!podeTela) {
        return { error: 'Sem permissão para esta ferramenta.', status: 403 }
    }
    return base
}

export function responderJsonErro(res, status, mensagem, extra = {}) {
    return res.status(status).json({ ok: false, error: mensagem, ...extra })
}
