/**
 * GET /api/gemini-rate — restantes RPM/RPD deste processo (não vem da API Google).
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    PERMISSION_KEYS,
    hasPermission,
    normalizarProfileAcesso,
    podeLerFerramenta,
} from '../src/lib/accessControl.js'
import { lerRate } from '../src/lib/gemini/gemini.ts'
import { getClientIp, getRequestHeader } from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const getHeader = (req, name) => getRequestHeader(req, name) || ''

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para /api/gemini-rate.')
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    })
}

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const validarProspectos = async (supabase, req) => {
    const authHeader = getHeader(req, 'authorization')
    const token = String(authHeader || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    if (!token) return { error: 'Sessão ausente.', status: 401 }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user?.id) return { error: 'Sessão inválida.', status: 401 }

    const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, email, permissions')
        .eq('id', userData.user.id)
        .maybeSingle()
    if (profileError || !profileData) return { error: 'Perfil não encontrado.', status: 403 }

    const profile = normalizarProfileAcesso(profileData)
    const podeTela =
        hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_VIEW) &&
        podeLerFerramenta(profile.permissions, 'credenciamento.prospectos_osm')
    if (!podeTela) {
        return { error: 'Sem permissão para o rate do Gemini (prospectos).', status: 403 }
    }

    return { user: userData.user, profile }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    const ip = getClientIp(req)
    if (!aplicarRateLimit(res, `gemini-rate:${ip}`, RATE_LIMITS.geminiRate)) return

    try {
        const supabase = getSupabaseAdmin()
        const auth = await validarProspectos(supabase, req)
        if (auth.error) return responderErro(res, auth.status || 401, auth.error)
        return res.status(200).json(lerRate())
    } catch (e) {
        const msg = String(e?.message || e || 'Falha ao ler rate Gemini.')
        return responderErro(res, 500, msg)
    }
}
