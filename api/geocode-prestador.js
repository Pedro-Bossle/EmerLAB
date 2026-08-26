import { geocodificarESalvarPrestador } from '../src/lib/credenciamento/geocodePrestadorServer.js'
import { PERMISSION_KEYS } from '../src/lib/accessControl.js'
import {
    createSupabaseAdminClient,
    getClientIp,
    readJsonBodyLimited,
    responderSePayloadGrande,
    validarJwtComPermissao,
} from '../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../src/lib/api/rateLimit.js'

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Método não permitido.' })
        return
    }
    try {
        const ip = getClientIp(req)
        if (!aplicarRateLimit(res, `geocode:${ip}`, RATE_LIMITS.geocode)) return

        const auth = await validarJwtComPermissao(req, PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
        if (auth.error) {
            res.status(auth.status || 401).json({ ok: false, error: auth.error })
            return
        }

        let body
        try {
            body = await readJsonBodyLimited(req)
        } catch (e) {
            if (responderSePayloadGrande(res, e)) return
            throw e
        }
        const prestadorId = Number(body.prestadorId)
        if (!prestadorId) {
            res.status(400).json({ ok: false, error: 'Informe prestadorId.' })
            return
        }
        const supabase = createSupabaseAdminClient()
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
