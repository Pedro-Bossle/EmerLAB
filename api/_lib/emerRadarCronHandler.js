/**
 * Dispara o workflow «Emer-Radar cron» no GitHub Actions.
 * Hospedado em api/audit-logs.js (rewrite) para caber no limite Hobby de 12 Serverless.
 *
 * Secrets Vercel:
 *   EMER_RADAR_GITHUB_TOKEN  — PAT com scope `workflow` (ou fine-grained: Actions write)
 *   EMER_RADAR_GITHUB_REPO   — ex.: Pedro-Bossle/teste-emeradar (default)
 *   EMER_RADAR_WORKFLOW_FILE — default: emer-radar-cron.yml
 */
import { podeLerFerramenta } from '../../src/lib/accessControl.js'
import {
    createSupabaseAdminClient,
    getClientIp,
    readJsonBodyLimited,
    responderSePayloadGrande,
    validarJwtComPerfil,
} from '../../src/lib/api/serverAuth.js'
import { aplicarRateLimit, RATE_LIMITS } from '../../src/lib/api/rateLimit.js'

const responderErro = (res, status, mensagem) =>
    res.status(status).json({ ok: false, error: mensagem })

const repoPadrao = () =>
    String(process.env.EMER_RADAR_GITHUB_REPO || 'Pedro-Bossle/teste-emeradar').trim()

const workflowPadrao = () =>
    String(process.env.EMER_RADAR_WORKFLOW_FILE || 'emer-radar-cron.yml').trim()

const tokenGithub = () =>
    String(
        process.env.EMER_RADAR_GITHUB_TOKEN ||
            process.env.GITHUB_TOKEN ||
            process.env.GH_TOKEN ||
            '',
    ).trim()

export default async function emerRadarCronHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (req.method !== 'POST') {
        return responderErro(res, 405, 'Método não permitido.')
    }

    const ip = getClientIp(req)
    if (
        !aplicarRateLimit(
            res,
            `emer-radar-cron:${ip}`,
            RATE_LIMITS?.adminUsers || { windowMs: 60_000, max: 30 },
        )
    ) {
        return
    }

    let body = {}
    try {
        body = await readJsonBodyLimited(req)
    } catch (e) {
        if (responderSePayloadGrande(res, e)) return
        body = {}
    }

    let supabase
    try {
        supabase = createSupabaseAdminClient()
    } catch (e) {
        return responderErro(res, 503, e?.message || 'Supabase não configurado.')
    }

    const auth = await validarJwtComPerfil(req, { supabaseAdmin: supabase })
    if (auth.error) return responderErro(res, auth.status || 401, auth.error)
    if (!podeLerFerramenta(auth.profile?.permissions, 'credenciamento.prospectos_osm')) {
        return responderErro(res, 403, 'Sem permissão para disparar o Emer-Radar.')
    }

    const token = tokenGithub()
    if (!token) {
        return responderErro(
            res,
            503,
            'Defina EMER_RADAR_GITHUB_TOKEN no Vercel (PAT com permissão de workflow).',
        )
    }

    const repo = repoPadrao()
    const [owner, name] = repo.split('/').map((s) => s.trim())
    if (!owner || !name) {
        return responderErro(res, 503, 'EMER_RADAR_GITHUB_REPO inválido (use owner/repo).')
    }

    const workflow = workflowPadrao()
    const ref = String(body?.ref || process.env.EMER_RADAR_GITHUB_REF || 'main').trim() || 'main'
    const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`

    try {
        const gh = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'EmerLAB-emer-radar-cron',
            },
            body: JSON.stringify({ ref }),
        })

        if (gh.status === 204 || gh.status === 200) {
            return res.status(200).json({
                ok: true,
                message: 'Cron Emer-Radar disparado no GitHub Actions.',
                repo,
                workflow,
                ref,
                runsUrl: `https://github.com/${owner}/${name}/actions/workflows/${workflow}`,
            })
        }

        const detail = await gh.text().catch(() => '')
        let msg = `GitHub Actions respondeu HTTP ${gh.status}.`
        try {
            const j = JSON.parse(detail)
            if (j?.message) msg = j.message
        } catch {
            if (detail) msg = detail.slice(0, 300)
        }
        return responderErro(res, gh.status >= 400 && gh.status < 600 ? gh.status : 502, msg)
    } catch (e) {
        return responderErro(res, 502, e?.message || 'Falha ao contactar a API do GitHub.')
    }
}
