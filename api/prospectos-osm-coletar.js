/**
 * POST /api/prospectos-osm-coletar — body JSON { cidade, uf }
 * Requer service role no servidor (Vercel / dev).
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { coletarProspectosCidade } from '../src/lib/credenciamento/prospectosColeta.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

function supabaseAdmin() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.')
    return createClient(url, key, { auth: { persistSession: false } })
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object') return req.body
    const chunks = []
    for await (const ch of req) chunks.push(ch)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw.trim()) return {}
    return JSON.parse(raw)
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    try {
        const body = await readJsonBody(req)
        const cidade = String(body.cidade || '').trim()
        const uf = String(body.uf || '').trim()
        if (!cidade) {
            res.status(400).json({ error: 'Informe cidade.' })
            return
        }

        const fonte = body.fonte
        const omitirGemini = Boolean(body.omitirGemini)
        const r = await coletarProspectosCidade(supabaseAdmin(), { cidade, uf, fonte, omitirGemini })
        if (!r.ok) {
            res.status(502).json({
                error: r.erro || 'Falha na coleta.',
                geminiDescansoAte: r.geminiDescansoAte || null,
                geminiRetryAfterSec: r.geminiRetryAfterSec ?? null,
                geminiQuotaPausa: Boolean(r.geminiQuotaPausa),
            })
            return
        }
        res.status(200).json({
            ok: true,
            inseridos: r.inseridos,
            fonte: r.fonte || 'osm',
            modoColeta: r.modoColeta || null,
            aviso: r.aviso || '',
            fallbackDeGemini: Boolean(r.fallbackDeGemini),
            coletaDiretaOsm: Boolean(r.coletaDiretaOsm),
            geminiIndisponivelPorCota: Boolean(r.geminiIndisponivelPorCota),
            geminiDescansoAte: r.geminiDescansoAte || null,
            geminiRetryAfterSec: r.geminiRetryAfterSec ?? null,
            geminiQuotaPausa: Boolean(r.geminiQuotaPausa),
        })
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Erro interno.' })
    }
}
