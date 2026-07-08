import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { geocodificarESalvarPrestador } from '../src/lib/credenciamento/geocodePrestadorServer.js'

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

const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para geocodificar prestadores.')
    }
    return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Método não permitido.' })
        return
    }
    try {
        const body = await getJsonBody(req)
        const prestadorId = Number(body.prestadorId)
        if (!prestadorId) {
            res.status(400).json({ ok: false, error: 'Informe prestadorId.' })
            return
        }
        const supabase = getSupabaseAdmin()
        const resultado = await geocodificarESalvarPrestador(supabase, prestadorId, {
            forcar: Boolean(body.forcar),
        })
        if (!resultado.ok && !resultado.skipped) {
            res.status(422).json({ ok: false, ...resultado })
            return
        }
        res.status(200).json({ ok: true, ...resultado })
    } catch (error) {
        res.status(500).json({ ok: false, error: error?.message || 'Falha na geocodificação.' })
    }
}
