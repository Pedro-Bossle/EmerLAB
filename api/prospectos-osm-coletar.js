/**
 * Prospectos OSM — uma function Vercel:
 * GET  /api/prospectos-gemini-status (rewrite) — ping Gemini
 * POST /api/prospectos-osm-coletar — coleta cidade
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { coletarProspectosCidade } from '../src/lib/credenciamento/prospectosColeta.js'
import { descansoGeminiParaResposta } from '../src/lib/credenciamento/geminiDescanso.js'
import { geminiVerificarDisponibilidade } from '../src/lib/credenciamento/geminiUpstream.js'

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

function isGeminiStatusRequest(req) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    return pathname.includes('prospectos-gemini-status')
}

async function handleGeminiStatus(res) {
    const r = await geminiVerificarDisponibilidade()
    const descanso = r.disponivel
        ? {}
        : descansoGeminiParaResposta({
              quotaExceeded: r.quotaExceeded,
              erroOriginal: r.erroOriginal,
              retryAfterSec: r.retryAfterSec,
              geminiDescansoAte: r.geminiDescansoAte,
          })

    res.status(200).json({
        configurado: Boolean(r.configurado),
        disponivel: Boolean(r.disponivel),
        quotaExceeded: Boolean(r.quotaExceeded),
        modelo: r.modelo || null,
        erro: r.erro || null,
        geminiDescansoAte: descanso.geminiDescansoAte || null,
        geminiRetryAfterSec: descanso.geminiRetryAfterSec ?? null,
        geminiIndisponivelPorCota: Boolean(r.quotaExceeded),
        verificadoEm: new Date().toISOString(),
    })
}

async function handleColeta(req, res) {
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
}

export default async function handler(req, res) {
    try {
        if (req.method === 'GET' && isGeminiStatusRequest(req)) {
            await handleGeminiStatus(res)
            return
        }
        if (req.method === 'POST') {
            await handleColeta(req, res)
            return
        }
        res.status(405).json({ error: 'Método não permitido.' })
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Erro interno.' })
    }
}
