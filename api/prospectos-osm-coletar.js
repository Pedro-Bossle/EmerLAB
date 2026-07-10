/**
 * Prospectos OSM — uma function Vercel:
 * GET  /api/prospectos-gemini-status (rewrite) — ping Gemini
 * POST /api/prospectos-osm-coletar — coleta (async por etapas: start + step)
 */
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'

import { descansoGeminiParaResposta, previsaoRetornoGemini } from '../src/lib/credenciamento/geminiDescanso.js'
import { geminiVerificarDisponibilidade } from '../src/lib/credenciamento/geminiUpstream.js'
import { isGeminiStatusRequest } from '../src/lib/api/vercelUnifiedRoute.js'
import { executarPassoJobColeta, iniciarJobColeta } from '../src/lib/credenciamento/prospectosColetaJob.js'

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

function anexarCamposGeminiResposta(payload, descanso, quotaExceeded) {
    const ate = descanso.geminiDescansoAte || null
    const prev = previsaoRetornoGemini(ate, { quotaExceeded })
    return {
        ...payload,
        geminiDescansoAte: ate,
        geminiRetryAfterSec: descanso.geminiRetryAfterSec ?? null,
        geminiIndisponivelPorCota: Boolean(quotaExceeded),
        geminiQuotaPausa: Boolean(descanso.geminiQuotaPausa),
        geminiPrevisaoLinha: prev.linha || null,
        geminiPrevisaoTitulo: prev.titulo || null,
    }
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

    res.status(200).json(
        anexarCamposGeminiResposta(
            {
                configurado: Boolean(r.configurado),
                disponivel: Boolean(r.disponivel),
                quotaExceeded: Boolean(r.quotaExceeded),
                modeloInvalido: Boolean(r.modeloInvalido),
                chaveFormatoInvalido: Boolean(r.chaveFormatoInvalido),
                codigoErro: r.codigoErro || null,
                httpStatus: r.httpStatus ?? null,
                modelo: r.modelo || null,
                modeloEfetivo: r.modeloEfetivo || null,
                erro: r.erro || null,
                verificadoEm: new Date().toISOString(),
            },
            descanso,
            r.quotaExceeded,
        ),
    )
}

async function handleColetaStep(body, res) {
    const jobId = String(body.jobId || '').trim()
    if (!jobId) {
        res.status(400).json({ error: 'Informe jobId.' })
        return
    }
    const r = await executarPassoJobColeta(supabaseAdmin(), jobId)
    const base = {
        jobId: r.jobId,
        status: r.status,
        async: true,
        progresso: r.progresso,
        passoAtual: r.passoAtual,
        passosTotais: r.passosTotais,
        inseridos: r.inseridos,
    }
    if (r.resultado && typeof r.resultado === 'object') {
        Object.assign(base, r.resultado)
    }
    if (r.status === 'failed') {
        res.status(502).json({ ...base, error: r.erro || r.resultado?.erro || 'Falha na coleta.' })
        return
    }
    if (r.status === 'done') {
        res.status(200).json({ ok: true, ...base })
        return
    }
    res.status(200).json({ ok: true, ...base })
}

async function handleColetaStart(body, res) {
    const cidade = String(body.cidade || '').trim()
    const uf = String(body.uf || '').trim()
    if (!cidade) {
        res.status(400).json({ error: 'Informe cidade.' })
        return
    }
    const start = await iniciarJobColeta(supabaseAdmin(), {
        cidade,
        uf,
        fonte: body.fonte,
        omitirGemini: Boolean(body.omitirGemini),
        categorias: body.categorias,
    })
    if (!start.ok) {
        res.status(502).json({ error: start.erro || 'Não foi possível iniciar a coleta.' })
        return
    }
    res.status(202).json({
        ok: true,
        async: true,
        jobId: start.jobId,
        status: start.status,
        progresso: start.progresso,
        passoAtual: start.passoAtual,
        passosTotais: start.passosTotais,
    })
}

async function handleColeta(req, res) {
    const body = await readJsonBody(req)
    const action = String(body.action || 'start').trim().toLowerCase()
    if (action === 'step') {
        await handleColetaStep(body, res)
        return
    }
    if (action === 'start') {
        await handleColetaStart(body, res)
        return
    }
    res.status(400).json({ error: 'Ação inválida. Use action: start ou step.' })
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
