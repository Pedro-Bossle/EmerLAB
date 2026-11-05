/**
 * Emer-Radar — leitura das execuções (pipeline_runs / pipeline_results) e estado do cron.
 *
 * Em produção não há worker HTTP, e as tabelas do pipeline têm RLS sem políticas (só service role).
 * Esta rota lê com a service role depois de validar a sessão e a permissão da ferramenta.
 * Hospedada em api/audit-logs.js (rewrite) para caber no limite de 12 funções do plano Hobby.
 *
 * POST /api/emer-radar-runs  { action: 'status' | 'runs' | 'run' | 'catalogar', runId?, todos? }
 *
 * `catalogar` grava as coletas do pipeline no catálogo unificado (cred_prospectos_maps). Além do login
 * (com permissão), aceita o segredo do cron (EMAIL_INTERNAL_SECRET) para o worker chamar ao terminar.
 */
import { timingSafeEqual } from 'node:crypto'
import { podeLerFerramenta, usuarioPodeEditarFerramenta } from '../../src/lib/accessControl.js'
import {
    createSupabaseAdminClient,
    getClientIp,
    readJsonBodyLimited,
    responderSePayloadGrande,
    validarJwtComPerfil,
} from '../../src/lib/api/serverAuth.js'
import { aplicarRateLimit } from '../../src/lib/api/rateLimit.js'
import {
    linhasUnicasDeColeta,
    mesclarComExistentes,
} from '../../src/lib/credenciamento/prospectosMapsCore.js'

const responderErro = (res, status, mensagem) => res.status(status).json({ ok: false, error: mensagem })

const repoPadrao = () => String(process.env.EMER_RADAR_GITHUB_REPO || 'Pedro-Bossle/teste-emeradar').trim()
const workflowPadrao = () => String(process.env.EMER_RADAR_WORKFLOW_FILE || 'emer-radar-cron.yml').trim()
const tokenGithub = () =>
    String(process.env.EMER_RADAR_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()

/** Cron do workflow: seg–sex 21:00 UTC (18:00 em Brasília). */
export function proximaExecucaoAgendada(agora = new Date()) {
    const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 21, 0, 0))
    if (d.getTime() <= agora.getTime()) d.setUTCDate(d.getUTCDate() + 1)
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString()
}

const rotuloCidades = (cidades) =>
    (Array.isArray(cidades) ? cidades : [])
        .filter((c) => c && typeof c === 'object')
        .map((c) => `${c.cidade}/${c.uf}`)
        .join(', ')

function normalizarRun(r) {
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {}
    const cidades = Array.isArray(payload.cidades) ? payload.cidades : []
    const total = r.total ?? payload.total ?? null
    return {
        id: r.id,
        status: r.status || payload.status || null,
        started_at: r.started_at || payload.started_at || r.created_at || null,
        finished_at: r.finished_at || payload.finished_at || null,
        total,
        cidades: cidades.map((c) => ({ cidade: c?.cidade, uf: c?.uf })).filter((c) => c.cidade),
        label: `${r.id} · ${rotuloCidades(cidades) || '—'} · ${total ?? '?'} regs`,
        email: payload.email || null,
        tarefas: payload.tarefas || null,
        falhas: payload.falhas ?? null,
    }
}

async function statusGithub() {
    const token = tokenGithub()
    if (!token) return { runs: [], erro: 'EMER_RADAR_GITHUB_TOKEN não definido na Vercel.' }
    const [owner, name] = repoPadrao().split('/').map((s) => s.trim())
    if (!owner || !name) return { runs: [], erro: 'EMER_RADAR_GITHUB_REPO inválido.' }
    const workflow = workflowPadrao()
    const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=8`
    try {
        const gh = await fetch(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'EmerLAB-emer-radar-status',
            },
        })
        if (!gh.ok) return { runs: [], erro: `GitHub respondeu HTTP ${gh.status}.` }
        const j = await gh.json()
        const runs = (j.workflow_runs || []).map((r) => ({
            id: r.id,
            event: r.event,
            status: r.status,
            conclusion: r.conclusion,
            created_at: r.created_at,
            updated_at: r.updated_at,
            url: r.html_url,
        }))
        return { runs, erro: null, workflowUrl: `https://github.com/${owner}/${name}/actions/workflows/${workflow}` }
    } catch (e) {
        return { runs: [], erro: e?.message || 'Falha ao consultar o GitHub.' }
    }
}

async function acaoStatus(supabase) {
    const [ultimo, fila, trafego, gh] = await Promise.all([
        supabase
            .from('pipeline_runs')
            .select('id, status, total, started_at, finished_at, created_at, payload')
            .order('created_at', { ascending: false })
            .limit(1),
        supabase.from('pipeline_queue').select('status'),
        supabase.from('cred_trafego_cidades').select('marcadores'),
        statusGithub(),
    ])
    if (ultimo.error) throw new Error(ultimo.error.message)

    const contagemFila = { pending: 0, running: 0, done: 0, error: 0 }
    for (const q of fila.data || []) {
        if (q.status in contagemFila) contagemFila[q.status] += 1
    }
    const marcadores = {}
    for (const t of trafego.data || []) {
        const m = Number(t.marcadores) || 0
        marcadores[m] = (marcadores[m] || 0) + 1
    }

    return {
        ok: true,
        ultimaExecucao: ultimo.data?.[0] ? normalizarRun(ultimo.data[0]) : null,
        fila: contagemFila,
        trafego: { total: (trafego.data || []).length, marcadores },
        github: gh,
        proximaExecucao: proximaExecucaoAgendada(),
    }
}

async function acaoRuns(supabase) {
    const { data, error } = await supabase
        .from('pipeline_runs')
        .select('id, status, total, started_at, finished_at, created_at, payload')
        .order('created_at', { ascending: false })
        .limit(60)
    if (error) throw new Error(error.message)
    return { ok: true, runs: (data || []).map(normalizarRun) }
}

async function acaoRun(supabase, runId) {
    if (!runId) throw Object.assign(new Error('Informe o run.'), { status: 400 })
    const [run, res] = await Promise.all([
        supabase
            .from('pipeline_runs')
            .select('id, status, total, started_at, finished_at, created_at, payload')
            .eq('id', runId)
            .maybeSingle(),
        supabase.from('pipeline_results').select('results').eq('run_id', runId).maybeSingle(),
    ])
    if (run.error) throw new Error(run.error.message)
    if (res.error) throw new Error(res.error.message)
    if (!run.data && !res.data) throw Object.assign(new Error('Run não encontrado.'), { status: 404 })
    let results = res.data?.results ?? []
    if (typeof results === 'string') {
        try {
            results = JSON.parse(results)
        } catch {
            results = []
        }
    }
    results = Array.isArray(results) ? results : []
    const meta = run.data ? normalizarRun(run.data) : { id: runId }
    return { ok: true, run_id: runId, run: meta, results, total: results.length }
}

const COLUNAS_EXISTENTES =
    'maps_id, telefone, whatsapp, horario, horario_detalhado, endereco, nota, num_avaliacoes, categoria, link_maps, website, lat, lng, cidade, uf, status_prospeccao, tags'

const em = (lista, n) => {
    const out = []
    for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
    return out
}

/** Grava as coletas do Maps de um run no catálogo (só preenche vazios; nunca rebaixa status). */
async function catalogarRun(supabase, runId) {
    const { data, error } = await supabase.from('pipeline_results').select('results').eq('run_id', runId).maybeSingle()
    if (error) throw new Error(error.message)
    let lista = data?.results ?? []
    if (typeof lista === 'string') {
        try {
            lista = JSON.parse(lista)
        } catch {
            lista = []
        }
    }
    // «somente_rede» são credenciados de redes de plano sem presença no Maps: ficam só no run.
    const doMaps = (Array.isArray(lista) ? lista : []).filter((r) => r && r.nome && r.match_status !== 'somente_rede')
    const rows = linhasUnicasDeColeta(doMaps)
    if (!rows.length) return { lidos: doMaps.length, novos: 0, salvos: 0 }

    const existentes = []
    for (const ids of em(rows.map((r) => r.maps_id), 150)) {
        const { data: ex, error: eEx } = await supabase.from('cred_prospectos_maps').select(COLUNAS_EXISTENTES).in('maps_id', ids)
        if (eEx) throw new Error(eEx.message)
        existentes.push(...(ex || []))
    }
    const jaExistiam = new Set(existentes.map((r) => String(r.maps_id)))
    mesclarComExistentes(rows, existentes, { preferirNovos: false })

    let salvos = 0
    for (const lote of em(rows, 200)) {
        const { data: up, error: eUp } = await supabase
            .from('cred_prospectos_maps')
            .upsert(lote, { onConflict: 'maps_id' })
            .select('maps_id')
        if (eUp) throw new Error(eUp.message)
        salvos += (up || []).length
    }
    return { lidos: doMaps.length, novos: rows.filter((r) => !jaExistiam.has(String(r.maps_id))).length, salvos }
}

async function acaoCatalogar(supabase, { runId, todos }) {
    let ids = []
    if (todos) {
        // Do mais recente para o mais antigo: o dado novo entra primeiro e o antigo só preenche lacunas.
        const { data, error } = await supabase
            .from('pipeline_runs')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(200)
        if (error) throw new Error(error.message)
        ids = (data || []).map((r) => r.id)
    } else {
        if (!runId) throw Object.assign(new Error('Informe o run.'), { status: 400 })
        ids = [runId]
    }
    const total = { ok: true, runs: 0, lidos: 0, novos: 0, salvos: 0 }
    for (const id of ids) {
        const r = await catalogarRun(supabase, id)
        total.runs += 1
        total.lidos += r.lidos
        total.novos += r.novos
        total.salvos += r.salvos
    }
    return total
}

const BUCKET_WORKER = 'emer-radar-worker'
const ARQUIVO_WORKER = 'EmerRadarWorker.zip'

/**
 * Pacote do servidor de prospecção (.exe) guardado num bucket PRIVADO do Storage.
 * `assinar: true` devolve também um link de download que vale por 2 minutos.
 */
async function acaoWorker(supabase, { assinar }) {
    const { data, error } = await supabase.storage.from(BUCKET_WORKER).list('', { limit: 50 })
    if (error) return { ok: true, disponivel: false, motivo: 'O pacote do servidor ainda não foi publicado.' }
    const arq = (data || []).find((f) => f.name === ARQUIVO_WORKER)
    if (!arq) return { ok: true, disponivel: false, motivo: 'O pacote do servidor ainda não foi publicado.' }
    const info = {
        ok: true,
        disponivel: true,
        nome: 'Emer-Radar-Servidor-de-prospeccao.zip',
        tamanho: arq.metadata?.size ?? null,
        atualizado_em: arq.updated_at || arq.created_at || null,
    }
    if (assinar) {
        const { data: ass, error: eAss } = await supabase.storage
            .from(BUCKET_WORKER)
            .createSignedUrl(ARQUIVO_WORKER, 120, { download: info.nome })
        if (eAss || !ass?.signedUrl) throw new Error(eAss?.message || 'Não foi possível gerar o link de download.')
        info.url = ass.signedUrl
    }
    return info
}

/** Segredo do cron (mesmo do /api/email). Comparação em tempo constante. */
function segredoDoCronValido(req) {
    const esperado = String(process.env.EMAIL_INTERNAL_SECRET || process.env.RESEND_PIPELINE_SECRET || '').trim()
    if (!esperado) return false
    const recebido = String(req.headers?.authorization || req.headers?.Authorization || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
    const a = Buffer.from(recebido)
    const b = Buffer.from(esperado)
    return a.length === b.length && timingSafeEqual(a, b)
}

export default async function emerRadarRunsHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.method !== 'POST') return responderErro(res, 405, 'Método não permitido.')

    const ip = getClientIp(req)
    if (!aplicarRateLimit(res, `emer-radar-runs:${ip}`, { limit: 60, windowMs: 60_000 })) return

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

    const viaCron = String(body?.action || '') === 'catalogar' && segredoDoCronValido(req)
    if (!viaCron) {
        const auth = await validarJwtComPerfil(req, { supabaseAdmin: supabase })
        if (auth.error) return responderErro(res, auth.status || 401, auth.error)
        if (!podeLerFerramenta(auth.profile?.permissions, 'credenciamento.prospectos_osm')) {
            return responderErro(res, 403, 'Sem permissão para ver o Emer-Radar.')
        }
        // Gravar no catálogo exige permissão de edição da ferramenta (mesma regra do restante do Credenciamento).
        if (String(body?.action || '') === 'catalogar' && !usuarioPodeEditarFerramenta(auth.profile?.permissions, 'credenciamento.prospectos_osm')) {
            return responderErro(res, 403, 'Sem permissão para editar o catálogo.')
        }
    }

    try {
        const action = String(body?.action || 'status')
        if (action === 'status') return res.status(200).json(await acaoStatus(supabase))
        if (action === 'runs') return res.status(200).json(await acaoRuns(supabase))
        if (action === 'worker-info') return res.status(200).json(await acaoWorker(supabase, { assinar: false }))
        if (action === 'worker-download') return res.status(200).json(await acaoWorker(supabase, { assinar: true }))
        if (action === 'catalogar') {
            return res.status(200).json(await acaoCatalogar(supabase, { runId: String(body?.runId || '').trim(), todos: body?.todos === true }))
        }
        if (action === 'run') return res.status(200).json(await acaoRun(supabase, String(body?.runId || '').trim()))
        return responderErro(res, 400, 'Ação inválida.')
    } catch (e) {
        return responderErro(res, e?.status || 500, e?.message || 'Falha ao ler o Emer-Radar.')
    }
}
