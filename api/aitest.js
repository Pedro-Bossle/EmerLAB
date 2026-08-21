/**
 * Playground Gemini — generateContent (texto).
 * GET  /api/aitest — ping da chave/modelo
 * POST /api/aitest — { prompt }
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    PERMISSION_KEYS,
    hasPermission,
    normalizarProfileAcesso,
} from '../src/lib/accessControl.js'
import { geminiConfigSnapshot, geminiGenerateText } from '../src/lib/credenciamento/geminiUpstream.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const PROMPT_MAX_CHARS = 8000

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

const getHeader = (req, name) => {
    const headers = req.headers || {}
    return headers[name] || headers[name.toLowerCase()] || ''
}

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para a API /aitest.')
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

const validarDevTools = async (supabase, req) => {
    const authHeader = getHeader(req, 'authorization')
    const token = String(authHeader || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    if (!token) return { error: 'Sessão ausente.', status: 401 }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user?.id) return { error: 'Sessão inválida.', status: 401 }

    const { data: profileData, error: profileError } = await buscarProfile(supabase, userData.user.id)
    if (profileError || !profileData) return { error: 'Perfil não encontrado.', status: 403 }

    const profile = normalizarProfileAcesso(profileData)
    if (!hasPermission(profile, PERMISSION_KEYS.DEV_TOOLS)) {
        return { error: 'Sem permissão para o playground Gemini (Dev Tool).', status: 403 }
    }

    return { user: userData.user, profile }
}

function payloadStatus(r) {
    return {
        ok: true,
        ping: r.ping !== false,
        configurado: Boolean(r.configurado),
        disponivel: r.disponivel == null ? null : Boolean(r.disponivel),
        quotaExceeded: Boolean(r.quotaExceeded),
        sobrecarregado: Boolean(r.sobrecarregado),
        modeloInvalido: Boolean(r.modeloInvalido),
        chaveFormatoInvalido: Boolean(r.chaveFormatoInvalido),
        codigoErro: r.codigoErro || null,
        httpStatus: r.httpStatus ?? null,
        modelo: r.modelo || null,
        modeloEfetivo: r.modeloEfetivo || null,
        erro: r.erro || null,
        verificadoEm: new Date().toISOString(),
    }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    try {
        const supabase = getSupabaseAdmin()
        const auth = await validarDevTools(supabase, req)
        if (auth.error) return responderErro(res, auth.status || 401, auth.error)

        if (method === 'GET') {
            return res.status(200).json(payloadStatus(geminiConfigSnapshot()))
        }

        const body = await getJsonBody(req)
        const prompt = String(body.prompt || '').trim()
        if (!prompt) return responderErro(res, 400, 'Informe um prompt.')
        if (prompt.length > PROMPT_MAX_CHARS) {
            return responderErro(res, 400, `Prompt demasiado longo (máx. ${PROMPT_MAX_CHARS} caracteres).`)
        }

        const t0 = Date.now()
        console.info('[aitest] POST generateContent', { promptChars: prompt.length })
        const r = await geminiGenerateText({
            prompt,
            maxOutputTokens: 2048,
            timeoutMs: 90_000,
        })
        const latenciaMs = Date.now() - t0
        console.info('[aitest] POST resultado', {
            ok: Boolean(r.ok),
            ms: latenciaMs,
            modeloEfetivo: r.modeloEfetivo || r.modeloUsado || null,
            erro: r.ok ? null : r.erro || null,
        })

        if (!r.ok) {
            return res.status(200).json({
                ok: false,
                error: r.erro || 'Falha na consulta Gemini.',
                codigoErro: r.codigoErro || null,
                quotaExceeded: Boolean(r.quotaExceeded),
                sobrecarregado: r.codigoErro === 'sobrecarregado',
                modeloInvalido: Boolean(r.modeloInvalido),
                modelo: r.modeloConfigurado || null,
                modeloEfetivo: r.modeloEfetivo || null,
                latenciaMs,
            })
        }

        return res.status(200).json({
            ok: true,
            texto: r.texto || '',
            modelo: r.modeloConfigurado || null,
            modeloEfetivo: r.modeloEfetivo || r.modeloUsado || null,
            finishReason: r.finishReason || null,
            latenciaMs,
        })
    } catch (e) {
        const msg = String(e?.message || e || 'Falha no playground Gemini.')
        return responderErro(res, 500, msg)
    }
}
