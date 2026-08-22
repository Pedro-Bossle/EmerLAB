/**
 * Pedro Bot — chat de onboarding + CRUD da base de conhecimento.
 * GET  /api/pedro-bot
 * POST /api/pedro-bot  { action: 'chat'|'listar'|'salvar'|'apagar', ... }
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { normalizarProfileAcesso, podeLerFerramenta } from '../src/lib/accessControl.js'
import { configSnapshot, generateText } from '../src/lib/gemini/gemini.ts'
import { PEDRO_BOT_EDITOR_ABERTO, PEDRO_BOT_TOOL_ID, podeEditarConhecimentoPedroBot } from '../src/lib/pedroBot/pedroBotAcl.js'
import { montarContextoPedroBot, montarPromptChat } from '../src/lib/pedroBot/montarContexto.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const PROMPT_MAX_CHARS = 8000
const HISTORICO_MAX = 16

const getHeader = (req, name) => {
    const headers = req.headers || {}
    return headers[name] || headers[name.toLowerCase()] || ''
}

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

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para /api/pedro-bot.')
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    })
}

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const tabelaAusente = (error) => {
    const msg = String(error?.message || error || '')
    return error?.code === '42P01' || /pedro_bot_conhecimento|does not exist|schema cache/i.test(msg)
}

const validarPedroBot = async (supabase, req) => {
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
    if (!podeLerFerramenta(profile.permissions, PEDRO_BOT_TOOL_ID)) {
        return { error: 'Sem permissão para o Pedro Bot.', status: 403 }
    }

    return { user: userData.user, profile }
}

async function listarBlocos(supabase) {
    const { data, error } = await supabase
        .from('pedro_bot_conhecimento')
        .select('id, categoria, titulo, corpo, activo, updated_at')
        .order('titulo', { ascending: true })
    if (error) {
        if (tabelaAusente(error)) {
            return { ok: true, blocos: [], aviso: 'Tabela pedro_bot_conhecimento ausente. Execute scripts/sql/pedro_bot_conhecimento.sql no Supabase.' }
        }
        throw new Error(error.message || String(error))
    }
    return { ok: true, blocos: data || [] }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    try {
        const supabase = getSupabaseAdmin()
        const auth = await validarPedroBot(supabase, req)
        if (auth.error) return responderErro(res, auth.status || 401, auth.error)

        const snap = configSnapshot()
        const meta = {
            editorAberto: PEDRO_BOT_EDITOR_ABERTO,
            podeEditar: podeEditarConhecimentoPedroBot(auth.profile),
            modelo: snap.modelo || null,
            configurado: Boolean(snap.configurado),
        }

        if (method === 'GET') {
            return res.status(200).json({ ok: true, ...meta, erro: snap.erro || null })
        }

        const body = await getJsonBody(req)
        const action = String(body.action || (body.mensagens ? 'chat' : '')).trim().toLowerCase()

        if (action === 'listar') {
            const lista = await listarBlocos(supabase)
            return res.status(200).json({ ...lista, ...meta })
        }

        if (action === 'salvar') {
            if (!meta.podeEditar) return responderErro(res, 403, 'Sem permissão para editar a base de conhecimento.')
            const id = body.id ? String(body.id) : null
            const patch = {
                categoria: String(body.categoria || 'geral').trim() || 'geral',
                titulo: String(body.titulo || '').trim(),
                corpo: String(body.corpo || '').trim(),
                activo: body.activo !== false,
                updated_at: new Date().toISOString(),
            }
            if (!patch.titulo || !patch.corpo) {
                return responderErro(res, 400, 'Informe título e corpo.')
            }
            let q
            if (id) {
                q = await supabase.from('pedro_bot_conhecimento').update(patch).eq('id', id).select('*').single()
            } else {
                q = await supabase.from('pedro_bot_conhecimento').insert(patch).select('*').single()
            }
            if (q.error) {
                if (tabelaAusente(q.error)) {
                    return responderErro(res, 503, 'Tabela pedro_bot_conhecimento ausente. Execute scripts/sql/pedro_bot_conhecimento.sql no Supabase.')
                }
                return responderErro(res, 400, q.error.message || String(q.error))
            }
            return res.status(200).json({ ok: true, bloco: q.data, ...meta })
        }

        if (action === 'apagar') {
            if (!meta.podeEditar) return responderErro(res, 403, 'Sem permissão para editar a base de conhecimento.')
            const id = String(body.id || '').trim()
            if (!id) return responderErro(res, 400, 'Informe o id.')
            const { error } = await supabase.from('pedro_bot_conhecimento').delete().eq('id', id)
            if (error) {
                if (tabelaAusente(error)) {
                    return responderErro(res, 503, 'Tabela pedro_bot_conhecimento ausente. Execute scripts/sql/pedro_bot_conhecimento.sql no Supabase.')
                }
                return responderErro(res, 400, error.message || String(error))
            }
            return res.status(200).json({ ok: true, ...meta })
        }

        if (action !== 'chat') {
            return responderErro(res, 400, 'Acção inválida.')
        }

        const mensagens = Array.isArray(body.mensagens) ? body.mensagens.slice(-HISTORICO_MAX) : []
        const ultima = mensagens.filter((m) => String(m?.role || '').toLowerCase() !== 'assistant').at(-1)
        const textoUser = String(ultima?.content || '').trim()
        if (!textoUser) return responderErro(res, 400, 'Escreva uma pergunta.')
        if (textoUser.length > PROMPT_MAX_CHARS) {
            return responderErro(res, 400, `Pergunta demasiado longa (máx. ${PROMPT_MAX_CHARS} caracteres).`)
        }

        const contexto = await montarContextoPedroBot(supabase)
        const prompt = montarPromptChat(contexto, mensagens)
        const t0 = Date.now()
        console.info('[pedro-bot] POST chat', { promptChars: prompt.length, msgs: mensagens.length })
        const r = await generateText({
            prompt,
            maxOutputTokens: 2048,
            timeoutMs: 90_000,
        })
        const latenciaMs = Date.now() - t0
        console.info('[pedro-bot] resultado', {
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
                modelo: r.modeloConfigurado || snap.modelo || null,
                latenciaMs,
                ...meta,
            })
        }

        return res.status(200).json({
            ok: true,
            texto: r.texto || '',
            modeloEfetivo: r.modeloEfetivo || r.modeloUsado || null,
            latenciaMs,
            ...meta,
        })
    } catch (e) {
        const msg = String(e?.message || e || 'Falha no Pedro Bot.')
        return responderErro(res, 500, msg)
    }
}
