/**
 * GET /api/prospectos-gemini-status — ping leve na API Gemini (servidor).
 */
import path from 'node:path'
import { config as dotenvConfig } from 'dotenv'
import { descansoGeminiParaResposta } from '../src/lib/credenciamento/geminiDescanso.js'
import { geminiVerificarDisponibilidade } from '../src/lib/credenciamento/geminiUpstream.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }

    try {
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
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Erro interno.' })
    }
}
