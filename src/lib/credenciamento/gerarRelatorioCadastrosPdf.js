import { jsPDF } from 'jspdf'
import { OPCOES_JSPDF_A4 } from '../pdf/serializarPdf.js'
import autoTable from 'jspdf-autotable'
import { idsEspecialidadesPrestador } from './especialidadesPorCidade.js'
import {
    carregarLogoPdfEmerdog,
    downloadPdf,
    sanitizarNomeArquivoPdf,
} from '../contratos/pdf/gerarContratoPdf.js'
import {
    prestadorEhCredenciado,
    resolverCidadePrincipalNome,
    situacaoDescricaoEhCredenciado,
} from '../prestadorCadastroHelpers.js'
import { resolverLocalidadeEfetivaPrestador } from '../prestadorLocalidadeVinculo.js'
import {
    blocosResumoRelatorioAtivos,
    colunasTabelaRelatorioAtivas,
    largurasColunasTabelaRelatorio,
    METADADOS_COLUNAS_RELATORIO_CADASTROS,
    normalizarLayoutRelatorioCadastros,
    valorCelulaColunaRelatorioCadastros,
} from './relatorioCadastrosLayout.js'
import { buscarTodosPaginado, supabase } from '../supabase.js'
import { listarUsuariosParaAtribuicao } from '../homeTarefas.js'

const MM_MARGIN = 12
const PAGE_H = 297
const PAGE_W = 210
const TABLE_WIDTH_MM = PAGE_W - MM_MARGIN * 2

function dataGeracaoPtBr() {
    return new Date().toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    })
}

function formatarDataCredenciadoEm(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleDateString('pt-BR')
}

/** YYYY-MM-DD no fuso local (para comparar com inputs type=date). */
export function dataIsoParaYmdLocal(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

export function dataNoPeriodoYmd(iso, deYmd, ateYmd) {
    const ymd = dataIsoParaYmdLocal(iso)
    if (!ymd || !deYmd || !ateYmd) return false
    return ymd >= deYmd && ymd <= ateYmd
}

/**
 * Data usada no filtro de período do relatório:
 * - credenciados → `credenciado_em`
 * - demais → data da auditoria em que entrou na situação atual (se houver),
 *   senão `data_atualizacao`, senão `data_cadastro`
 *
 * @param {object} prestador
 * @param {object[]} situacoes
 * @param {Map<string, string>|null} [mapaDataHoraPorPrestadorSituacao] chave `${prestadorId}|${situacaoId}` → ISO
 */
export function isoReferenciaPeriodoRelatorioCadastros(
    prestador,
    situacoes = [],
    mapaDataHoraPorPrestadorSituacao = null,
) {
    if (prestadorEhCredenciado(prestador, situacoes) && prestador?.credenciado_em) {
        return prestador.credenciado_em
    }
    const pid = Number(prestador?.id)
    const sid = Number(prestador?.situacao_id)
    if (mapaDataHoraPorPrestadorSituacao instanceof Map && pid && sid) {
        const isoAudit = mapaDataHoraPorPrestadorSituacao.get(`${pid}|${sid}`)
        if (isoAudit) return isoAudit
    }
    return prestador?.data_atualizacao || prestador?.data_cadastro || ''
}

export function formatarPeriodoYmdPtBr(deYmd, ateYmd) {
    const fmt = (ymd) => {
        const hit = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!hit) return String(ymd || '')
        return `${hit[3]}/${hit[2]}/${hit[1]}`
    }
    return `${fmt(deYmd)} a ${fmt(ateYmd)}`
}

function rotuloPrincipalComExtras(principal, totalUnicos) {
    const base = String(principal || '').trim() || '—'
    const extras = Math.max(0, Number(totalUnicos) - 1)
    return extras > 0 ? `${base} +${extras}` : base
}

function mapaEspecialidadesPorPrestador(linhas) {
    const m = new Map()
    for (const row of linhas || []) {
        const pid = Number(row.prestador_id)
        if (!pid) continue
        if (!m.has(pid)) m.set(pid, [])
        m.get(pid).push(row)
    }
    return m
}

function mapaCidadesPorPrestador(linhas) {
    const m = new Map()
    for (const row of linhas || []) {
        const pid = Number(row.prestador_id)
        if (!pid) continue
        if (!m.has(pid)) m.set(pid, [])
        m.get(pid).push(row)
    }
    return m
}

function compararLinhasCredenciadoEmAsc(a, b) {
    const ref = (l) => l.credenciadoEmIso || l.dataReferenciaPeriodoIso || ''
    const ta = ref(a) ? new Date(ref(a)).getTime() : NaN
    const tb = ref(b) ? new Date(ref(b)).getTime() : NaN
    const va = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY
    const vb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY
    if (va !== vb) return va - vb
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
        sensitivity: 'base',
    })
}

function resolverNomeUsuario(uid, mapaNomes) {
    const id = String(uid || '').trim()
    if (!id) return '—'
    const hit = mapaNomes?.get(id)
    if (hit) return hit
    if (/^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$/i.test(id)) {
        return '—'
    }
    return id
}

/** Valor de linha em audit_logs (jsonb ou string JSON). */
export function parseAuditRowJson(val) {
    if (val == null) return null
    if (typeof val === 'object') return val
    try {
        return JSON.parse(val)
    } catch {
        return null
    }
}

/** UPDATE em `prestadores` que passou a situação «Credenciado». */
export function auditLogTransicaoParaCredenciado(log, idsSituacaoCredenciado) {
    if (String(log?.acao || '').toUpperCase() !== 'UPDATE') return false
    if (!idsSituacaoCredenciado?.size) return false
    const depois = Number(parseAuditRowJson(log.valor_novo)?.situacao_id)
    const antes = Number(parseAuditRowJson(log.valor_antigo)?.situacao_id)
    if (!idsSituacaoCredenciado.has(depois)) return false
    return !idsSituacaoCredenciado.has(antes)
}

/**
 * Situação definida por CREATE ou UPDATE em que `situacao_id` mudou (valor_novo).
 * @returns {number|null}
 */
export function auditLogNovaSituacaoId(log) {
    const acao = String(log?.acao || '').toUpperCase()
    if (acao === 'CREATE') {
        const sid = Number(parseAuditRowJson(log.valor_novo)?.situacao_id)
        return Number.isFinite(sid) && sid > 0 ? sid : null
    }
    if (acao !== 'UPDATE') return null
    const antes = Number(parseAuditRowJson(log.valor_antigo)?.situacao_id)
    const depois = Number(parseAuditRowJson(log.valor_novo)?.situacao_id)
    if (!Number.isFinite(depois) || depois <= 0) return null
    if (antes === depois) return null
    return depois
}

/**
 * Quem alterou a situação (audit_logs / prestadores) e quando.
 * - `mapaUsuarioIdPorPrestadorSituacao`: chave `${prestadorId}|${situacaoId}` → último usuário que definiu essa situação.
 * - `mapaUsuarioIdPorPrestadorId`: última mudança de situação por prestador (qualquer situação).
 * - `mapaDataHoraPorPrestadorSituacao`: chave `${prestadorId}|${situacaoId}` → ISO da última entrada nessa situação.
 */
export function mapaUsuarioAlteracaoSituacaoViaAuditoria(logs = []) {
    const mapaUsuarioIdPorPrestadorSituacao = new Map()
    const mapaUsuarioIdPorPrestadorId = new Map()
    const mapaNomeUsuarioPorId = new Map()
    const mapaDataHoraPorPrestadorSituacao = new Map()

    const ordenados = [...(logs || [])].sort((a, b) => {
        const ta = new Date(a.data_hora || 0).getTime()
        const tb = new Date(b.data_hora || 0).getTime()
        return tb - ta
    })

    for (const log of ordenados) {
        const pid = Number(log.registro_id)
        if (!pid) continue

        const sidNovo = auditLogNovaSituacaoId(log)
        if (sidNovo == null) continue

        const chave = `${pid}|${sidNovo}`
        const iso = log.data_hora ? String(log.data_hora) : ''
        if (iso && !mapaDataHoraPorPrestadorSituacao.has(chave)) {
            mapaDataHoraPorPrestadorSituacao.set(chave, iso)
        }

        const uid = log.usuario_id ? String(log.usuario_id).trim() : ''
        if (!uid) continue
        const nome = log.usuario_nome
        if (nome) mapaNomeUsuarioPorId.set(uid, String(nome).trim())

        if (!mapaUsuarioIdPorPrestadorSituacao.has(chave)) {
            mapaUsuarioIdPorPrestadorSituacao.set(chave, uid)
        }
        if (!mapaUsuarioIdPorPrestadorId.has(pid)) {
            mapaUsuarioIdPorPrestadorId.set(pid, uid)
        }
    }

    return {
        mapaUsuarioIdPorPrestadorSituacao,
        mapaUsuarioIdPorPrestadorId,
        mapaNomeUsuarioPorId,
        mapaDataHoraPorPrestadorSituacao,
    }
}

/** @deprecated Use mapaUsuarioAlteracaoSituacaoViaAuditoria — mantido para testes legados. */
export function mapaUsuarioPrestadorViaAuditoria(
    logs = [],
    _idsSituacaoCredenciado,
    _prestadoresComKanban = new Set(),
) {
    return mapaUsuarioAlteracaoSituacaoViaAuditoria(logs)
}

/** Preenche mapa de nomes a partir de todos os logs (não só o «vencedor» por prestador). */
export function enriquecerMapaNomesUsuariosDeAuditoria(logs = [], mapaNomeUsuarioPorId = new Map()) {
    for (const log of logs || []) {
        const uid = log?.usuario_id ? String(log.usuario_id).trim() : ''
        const nome = String(log?.usuario_nome || '').trim()
        if (uid && nome && !mapaNomeUsuarioPorId.has(uid)) {
            mapaNomeUsuarioPorId.set(uid, nome)
        }
    }
    return mapaNomeUsuarioPorId
}

async function buscarAuditLogsPrestadoresViaApi() {
    if (typeof window === 'undefined') return []
    try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        if (!token) return []
        const res = await fetch('/api/audit-logs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'prestadoresResponsaveis' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.ok) return []
        return Array.isArray(json.logs) ? json.logs : []
    } catch {
        return []
    }
}

async function preencherNomesUsuariosFaltantes(
    supabaseClient,
    mapaNomeUsuarioPorId,
    mapaUsuarioIdPorPrestadorId,
    mapaUsuarioIdPorPrestadorSituacao = null,
) {
    const uids = new Set([...mapaUsuarioIdPorPrestadorId.values()])
    if (mapaUsuarioIdPorPrestadorSituacao) {
        for (const uid of mapaUsuarioIdPorPrestadorSituacao.values()) uids.add(uid)
    }
    const faltando = [...uids].filter((uid) => uid && !mapaNomeUsuarioPorId.has(uid))
    if (!faltando.length) return
    const chunk = 80
    for (let i = 0; i < faltando.length; i += chunk) {
        const fatia = faltando.slice(i, i + chunk)
        const { data, error } = await supabaseClient.from('profiles').select('id, name').in('id', fatia)
        if (error) break
        for (const row of data || []) {
            const uid = String(row.id || '').trim()
            const nome = String(row.name || '').trim()
            if (uid && nome) mapaNomeUsuarioPorId.set(uid, nome)
        }
    }
}

async function buscarLogsAuditoriaPrestadores(supabaseClient) {
    let logs = await buscarAuditLogsPrestadoresViaApi()
    if (!logs.length) {
        try {
            const { data, error } = await buscarTodosPaginado(() =>
                supabaseClient
                    .from('audit_logs')
                    .select(
                        'data_hora, usuario_id, usuario_nome, acao, registro_id, valor_antigo, valor_novo',
                    )
                    .eq('tabela', 'prestadores')
                    .in('acao', ['CREATE', 'UPDATE'])
                    .not('usuario_id', 'is', null)
                    .order('data_hora', { ascending: false }),
            )
            if (!error) logs = data || []
        } catch {
            logs = []
        }
    }
    return logs || []
}

/**
 * Usuário no relatório: (1) audit_logs — quem definiu a situação atual; (2) fallback Kanban `atribuido_a`.
 * @returns {Promise<{
 *   mapaNomeUsuarioPorId: Map<string, string>,
 *   mapaUsuarioIdPorPrestadorId: Map<number, string>,
 *   mapaUsuarioIdPorPrestadorSituacao: Map<string, string>,
 *   mapaDataHoraPorPrestadorSituacao: Map<string, string>,
 * }>}
 */
export async function carregarContextoUsuariosRelatorioCadastros(
    supabaseClient,
    { situacoes: _situacoes = [] } = {},
) {
    const mapaNomeUsuarioPorId = new Map()
    const mapaUsuarioIdPorPrestadorId = new Map()
    const mapaUsuarioIdPorPrestadorSituacao = new Map()
    const mapaDataHoraPorPrestadorSituacao = new Map()

    try {
        const usuarios = await listarUsuariosParaAtribuicao()
        for (const u of usuarios || []) {
            mapaNomeUsuarioPorId.set(String(u.id), String(u.nome || u.id).trim() || u.id)
        }
    } catch {
        /* lista de usuários indisponível */
    }

    const logs = await buscarLogsAuditoriaPrestadores(supabaseClient)
    if (logs.length) {
        enriquecerMapaNomesUsuariosDeAuditoria(logs, mapaNomeUsuarioPorId)
        const audit = mapaUsuarioAlteracaoSituacaoViaAuditoria(logs)
        for (const [chave, uid] of audit.mapaUsuarioIdPorPrestadorSituacao) {
            mapaUsuarioIdPorPrestadorSituacao.set(chave, uid)
        }
        for (const [pid, uid] of audit.mapaUsuarioIdPorPrestadorId) {
            mapaUsuarioIdPorPrestadorId.set(pid, uid)
        }
        for (const [uid, nome] of audit.mapaNomeUsuarioPorId) {
            if (!mapaNomeUsuarioPorId.has(uid) && nome) mapaNomeUsuarioPorId.set(uid, nome)
        }
        for (const [chave, iso] of audit.mapaDataHoraPorPrestadorSituacao || []) {
            mapaDataHoraPorPrestadorSituacao.set(chave, iso)
        }
    }

    try {
        const cardsResp = await buscarTodosPaginado(() =>
            supabaseClient
                .from('cred_kanban_cards')
                .select('prestador_id, atribuido_a, atualizado_em')
                .not('prestador_id', 'is', null),
        )
        const cards = cardsResp?.error ? [] : cardsResp?.data || []
        const melhorPorPrestador = new Map()
        for (const row of cards || []) {
            const pid = Number(row.prestador_id)
            const uid = row.atribuido_a ? String(row.atribuido_a).trim() : ''
            if (!pid || !uid) continue
            const t = new Date(row.atualizado_em || 0).getTime()
            const prev = melhorPorPrestador.get(pid)
            if (!prev || t >= prev.t) melhorPorPrestador.set(pid, { uid, t })
        }
        for (const [pid, { uid }] of melhorPorPrestador) {
            if (!mapaUsuarioIdPorPrestadorId.has(pid)) mapaUsuarioIdPorPrestadorId.set(pid, uid)
        }
    } catch {
        /* Kanban indisponível */
    }

    await preencherNomesUsuariosFaltantes(
        supabaseClient,
        mapaNomeUsuarioPorId,
        mapaUsuarioIdPorPrestadorId,
        mapaUsuarioIdPorPrestadorSituacao,
    )

    return {
        mapaNomeUsuarioPorId,
        mapaUsuarioIdPorPrestadorId,
        mapaUsuarioIdPorPrestadorSituacao,
        mapaDataHoraPorPrestadorSituacao,
    }
}

/**
 * Monta linhas do relatório (Nome | Especialidade | Cidade | Situação | Usuário | Credenciado Em).
 * Especialidade/Cidade: principal +N quando há vínculos extras.
 * Com `periodoDe`/`periodoAte` (YYYY-MM-DD): credenciados pelo `credenciado_em`; demais situações
 * pela data em que entraram na situação atual (auditoria), com fallback em `data_atualizacao`/`data_cadastro`.
 */
export function montarLinhasRelatorioCadastros({
    prestadores = [],
    situacoes = [],
    especialidades = [],
    cidadesCred = [],
    prestadorEspecialidades = [],
    prestadorCidades = [],
    estabelecimentoPorVeterinario,
    idsPermitidos = null,
    periodoDe = '',
    periodoAte = '',
    situacaoIds = null,
    mapaNomeUsuarioPorId = null,
    mapaUsuarioIdPorPrestadorId = null,
    mapaUsuarioIdPorPrestadorSituacao = null,
    mapaDataHoraPorPrestadorSituacao = null,
} = {}) {
    const mapaEsp = new Map((especialidades || []).map((e) => [Number(e.id), String(e.nome || '').trim()]))
    const mapaCidade = new Map((cidadesCred || []).map((c) => [Number(c.id), c]))
    const mapaCidadeNome = new Map(
        (cidadesCred || []).map((c) => [Number(c.id), String(c.nome || '').trim()]),
    )
    const espPorPrestador = mapaEspecialidadesPorPrestador(prestadorEspecialidades)
    const cidadesPorPrestador = mapaCidadesPorPrestador(prestadorCidades)
    const idsOk = idsPermitidos instanceof Set ? idsPermitidos : null
    const filtraPeriodo = Boolean(periodoDe && periodoAte)
    const situacoesOk =
        Array.isArray(situacaoIds) && situacaoIds.length
            ? new Set(situacaoIds.map(Number).filter(Boolean))
            : null

    const linhas = []
    for (const p of prestadores || []) {
        const pid = Number(p.id)
        if (!pid) continue
        if (idsOk && !idsOk.has(pid)) continue
        const sid = Number(p.situacao_id)
        if (situacoesOk && !situacoesOk.has(sid)) continue
        if (
            filtraPeriodo &&
            !dataNoPeriodoYmd(
                isoReferenciaPeriodoRelatorioCadastros(p, situacoes, mapaDataHoraPorPrestadorSituacao),
                periodoDe,
                periodoAte,
            )
        ) {
            continue
        }

        const espIds = idsEspecialidadesPrestador(p, espPorPrestador.get(pid) || [])
        const espPrincipal =
            mapaEsp.get(Number(p.especialidade_id)) ||
            (espIds.size ? mapaEsp.get([...espIds][0]) : '') ||
            '—'
        const especialidade = rotuloPrincipalComExtras(espPrincipal, espIds.size)

        const { prestador: pLoc, prestadorIdCidades } = resolverLocalidadeEfetivaPrestador(
            p,
            estabelecimentoPorVeterinario,
        )
        const rels =
            cidadesPorPrestador.get(Number(prestadorIdCidades)) ||
            cidadesPorPrestador.get(pid) ||
            []
        const cidadePrincipal = resolverCidadePrincipalNome(pLoc, {
            mapaCidadeNomePorId: mapaCidade,
            relacoesCidades: rels,
        })
        const nomesCidade = new Set()
        if (cidadePrincipal && cidadePrincipal !== '—') nomesCidade.add(cidadePrincipal)
        for (const rel of rels) {
            const nome = mapaCidadeNome.get(Number(rel.cidade_id))
            if (nome) nomesCidade.add(nome)
        }
        const cidadeBase =
            cidadePrincipal && cidadePrincipal !== '—'
                ? cidadePrincipal
                : [...nomesCidade][0] || '—'
        const cidade = rotuloPrincipalComExtras(cidadeBase, nomesCidade.size)

        const especialidadesTodas = [...espIds]
            .map((id) => mapaEsp.get(Number(id)))
            .filter(Boolean)
        const cidadesTodas = [...nomesCidade]

        const situacao =
            (situacoes || []).find((s) => Number(s.id) === sid)?.descricao || '—'
        const ehCredenciado = prestadorEhCredenciado(p, situacoes)
        const isoGrafico = p.credenciado_em || ''
        const dataReferenciaPeriodoIso = isoReferenciaPeriodoRelatorioCadastros(
            p,
            situacoes,
            mapaDataHoraPorPrestadorSituacao,
        )
        const credenciadoEm = ehCredenciado ? formatarDataCredenciadoEm(isoGrafico) : ''
        const uidResp =
            mapaUsuarioIdPorPrestadorSituacao?.get(`${pid}|${sid}`) ||
            mapaUsuarioIdPorPrestadorId?.get(pid) ||
            ''
        const usuario = resolverNomeUsuario(uidResp, mapaNomeUsuarioPorId)

        linhas.push({
            id: pid,
            nome: String(p.nome || '').trim() || '—',
            especialidade,
            especialidadeChave: espPrincipal && espPrincipal !== '—' ? espPrincipal : '—',
            especialidadesTodas,
            cidade,
            cidadeChave: cidadeBase && cidadeBase !== '—' ? cidadeBase : '—',
            cidadesTodas,
            situacao,
            situacaoId: sid || 0,
            usuario,
            usuarioId: uidResp || '',
            credenciadoEm,
            credenciadoEmIso: isoGrafico,
            dataReferenciaPeriodoIso,
        })
    }

    return linhas.sort(compararLinhasCredenciadoEmAsc)
}

/**
 * Totais por situação, usuário, especialidade (com nomes) e cidade.
 * Especialidade e cidade: cada vínculo secundário entra na contagem da respectiva chave.
 */
export function montarResumosRelatorioCadastros(linhas = []) {
    const porSituacao = new Map()
    const porUsuario = new Map()
    const porEspecialidade = new Map()
    const porCidade = new Map()

    const incEsp = (nomeEsp, nomePrestador) => {
        const esp = String(nomeEsp || '—').trim() || '—'
        if (!porEspecialidade.has(esp)) porEspecialidade.set(esp, new Set())
        porEspecialidade.get(esp).add(String(nomePrestador || '—'))
    }

    const incCid = (nomeCid, nomePrestador) => {
        const cid = String(nomeCid || '—').trim() || '—'
        if (!porCidade.has(cid)) porCidade.set(cid, new Set())
        porCidade.get(cid).add(String(nomePrestador || '—'))
    }

    for (const l of linhas || []) {
        const sit = String(l.situacao || '—').trim() || '—'
        porSituacao.set(sit, (porSituacao.get(sit) || 0) + 1)

        const usu = String(l.usuario || '—').trim() || '—'
        porUsuario.set(usu, (porUsuario.get(usu) || 0) + 1)

        const nomePrest = String(l.nome || '—')
        const esps =
            Array.isArray(l.especialidadesTodas) && l.especialidadesTodas.length
                ? l.especialidadesTodas
                : [l.especialidadeChave || l.especialidade || '—']
        for (const espNome of esps) incEsp(espNome, nomePrest)

        const cids =
            Array.isArray(l.cidadesTodas) && l.cidadesTodas.length
                ? l.cidadesTodas
                : [l.cidadeChave || l.cidade || '—']
        for (const cidNome of cids) incCid(cidNome, nomePrest)
    }

    const ordenarPar = (a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { sensitivity: 'base' })

    return {
        porSituacao: [...porSituacao.entries()].sort(ordenarPar).map(([label, total]) => ({ label, total })),
        porUsuario: [...porUsuario.entries()].sort(ordenarPar).map(([label, total]) => ({ label, total })),
        porEspecialidade: [...porEspecialidade.entries()]
            .map(([label, nomesSet]) => ({
                label,
                total: nomesSet.size,
                nomes: [...nomesSet].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' })),
        porCidade: [...porCidade.entries()]
            .map(([label, nomesSet]) => ({
                label,
                total: nomesSet.size,
                nomes: [...nomesSet].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' })),
    }
}

function estilosTabelaResumoPdf() {
    return {
        theme: 'striped',
        margin: { left: MM_MARGIN, right: MM_MARGIN },
        tableWidth: TABLE_WIDTH_MM,
        styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 2,
            overflow: 'linebreak',
            valign: 'middle',
        },
        headStyles: {
            fillColor: [30, 77, 122],
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 8.5,
        },
        alternateRowStyles: { fillColor: [245, 248, 252] },
        columnStyles: {},
    }
}

function desenharTabelaResumoPdf(doc, titulo, head, body, startY) {
    if (!body?.length) return startY
    let y = startY
    if (y > PAGE_H - MM_MARGIN - 24) {
        doc.addPage()
        y = MM_MARGIN + 4
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(21, 54, 79)
    doc.text(titulo, MM_MARGIN, y)
    doc.setTextColor(0, 0, 0)
    y += 4

    autoTable(doc, {
        ...estilosTabelaResumoPdf(),
        startY: y,
        head: [head],
        body,
    })
    return (doc.lastAutoTable?.finalY ?? y) + 8
}

function desenharResumosRelatorioCadastrosPdf(doc, resumos, startY, layout) {
    if (!resumos) return startY
    const norm = normalizarLayoutRelatorioCadastros(layout)
    const blocos = blocosResumoRelatorioAtivos(norm)
    if (!blocos.length) return startY

    let y = startY
    if (y > PAGE_H - MM_MARGIN - 30) {
        doc.addPage()
        y = MM_MARGIN + 4
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(21, 54, 79)
    doc.text('Resumo e totais', MM_MARGIN, y)
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(80, 90, 100)
    const notaParts = []
    if (blocos.includes('especialidade') || blocos.includes('cidade')) {
        notaParts.push(
            'Especialidade e cidade incluem vínculos secundários (cada combinação prestador × item).',
        )
    }
    if (notaParts.length) {
        doc.text(notaParts.join(' '), MM_MARGIN, y, { maxWidth: TABLE_WIDTH_MM })
        y += 7
    }
    doc.setTextColor(0, 0, 0)

    for (const id of blocos) {
        if (id === 'situacao') {
            y = desenharTabelaResumoPdf(
                doc,
                'Por situação',
                ['Situação', 'Total'],
                (resumos.porSituacao || []).map((r) => [r.label, String(r.total)]),
                y,
            )
        } else if (id === 'usuario') {
            y = desenharTabelaResumoPdf(
                doc,
                'Por usuário responsável',
                ['Usuário', 'Cadastros'],
                (resumos.porUsuario || []).map((r) => [r.label, String(r.total)]),
                y,
            )
        } else if (id === 'especialidade') {
            y = desenharTabelaResumoPdf(
                doc,
                'Por especialidade',
                ['Especialidade', 'Qtd.', 'Prestadores'],
                (resumos.porEspecialidade || []).map((r) => [
                    r.label,
                    String(r.total),
                    (r.nomes || []).join(', ') || '—',
                ]),
                y,
            )
        } else if (id === 'cidade') {
            y = desenharTabelaResumoPdf(
                doc,
                'Por cidade',
                ['Cidade', 'Qtd.', 'Prestadores'],
                (resumos.porCidade || []).map((r) => [
                    r.label,
                    String(r.total),
                    (r.nomes || []).join(', ') || '—',
                ]),
                y,
            )
        }
    }
    return y
}

const MESES_CURTOS_PT = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
]

/** Lista YYYY-MM entre duas datas (inclusive), ordenada. */
export function listarMesesYmdEntre(deYmd, ateYmd) {
    const de = String(deYmd || '').match(/^(\d{4})-(\d{2})/)
    const ate = String(ateYmd || '').match(/^(\d{4})-(\d{2})/)
    if (!de || !ate) return []
    let y = Number(de[1])
    let m = Number(de[2])
    const yF = Number(ate[1])
    const mF = Number(ate[2])
    if (!y || !m || !yF || !mF) return []
    const out = []
    while (y < yF || (y === yF && m <= mF)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`)
        m += 1
        if (m > 12) {
            m = 1
            y += 1
        }
        if (out.length > 120) break
    }
    return out
}

function rotuloMesAnoCurtoPdf(ym) {
    const hit = String(ym || '').match(/^(\d{4})-(\d{2})$/)
    if (!hit) return String(ym || '')
    const mes = Number(hit[2])
    const nome = MESES_CURTOS_PT[mes - 1] || hit[2]
    return `${nome}/${hit[1].slice(2)}`
}

/**
 * Série por mês/ano (total). Inclui meses vazios do período quando informado.
 * @returns {Array<{ ym: string, label: string, total: number }>}
 */
export function montarSerieCredenciadosPorMes(linhas, periodoDe = '', periodoAte = '') {
    const contagem = new Map()
    for (const l of linhas || []) {
        const ymd = dataIsoParaYmdLocal(l.credenciadoEmIso)
        if (!ymd) continue
        const ym = ymd.slice(0, 7)
        contagem.set(ym, (contagem.get(ym) || 0) + 1)
    }

    let meses = listarMesesYmdEntre(periodoDe, periodoAte)
    if (!meses.length) {
        meses = [...contagem.keys()].sort()
    }
    return meses.map((ym) => ({
        ym,
        label: rotuloMesAnoCurtoPdf(ym),
        total: contagem.get(ym) || 0,
    }))
}

const CORES_SITUACAO_PDF = [
    [47, 128, 237],
    [39, 174, 96],
    [242, 153, 74],
    [155, 81, 224],
    [235, 87, 87],
    [45, 156, 219],
    [111, 207, 151],
    [242, 201, 76],
]

/**
 * Séries por situação × mês (para gráfico agrupado).
 * @returns {{ meses: Array<{ ym: string, label: string }>, series: Array<{ situacaoId: number, nome: string, valores: number[], cor: number[] }> }}
 */
export function montarSeriesPorSituacaoEMes(linhas, periodoDe = '', periodoAte = '') {
    let mesesYm = listarMesesYmdEntre(periodoDe, periodoAte)
    const porSitMes = new Map() // `${sid}|${ym}` -> count
    const nomesSit = new Map()

    for (const l of linhas || []) {
        const ymd = dataIsoParaYmdLocal(l.credenciadoEmIso)
        if (!ymd) continue
        const ym = ymd.slice(0, 7)
        const sid = Number(l.situacaoId) || 0
        const chave = `${sid}|${ym}`
        porSitMes.set(chave, (porSitMes.get(chave) || 0) + 1)
        if (!nomesSit.has(sid)) {
            nomesSit.set(sid, String(l.situacao || '').trim() || `Situação ${sid}`)
        }
    }

    if (!mesesYm.length) {
        const set = new Set()
        for (const k of porSitMes.keys()) set.add(k.split('|')[1])
        mesesYm = [...set].sort()
    }

    const situacaoIds = [...nomesSit.keys()].sort((a, b) =>
        String(nomesSit.get(a)).localeCompare(String(nomesSit.get(b)), 'pt-BR', {
            sensitivity: 'base',
        }),
    )

    const meses = mesesYm.map((ym) => ({ ym, label: rotuloMesAnoCurtoPdf(ym) }))
    const series = situacaoIds.map((sid, idx) => ({
        situacaoId: sid,
        nome: nomesSit.get(sid),
        cor: CORES_SITUACAO_PDF[idx % CORES_SITUACAO_PDF.length],
        valores: mesesYm.map((ym) => porSitMes.get(`${sid}|${ym}`) || 0),
    }))

    return { meses, series }
}

function desenharGraficoCredenciadosPorMes(doc, serieOuPack, opts = {}) {
    const titleY = opts.startY ?? MM_MARGIN + 8
    const multi =
        serieOuPack &&
        typeof serieOuPack === 'object' &&
        Array.isArray(serieOuPack.meses) &&
        Array.isArray(serieOuPack.series)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(21, 54, 79)
    doc.text('Credenciados por mês/ano', MM_MARGIN, titleY)
    doc.setTextColor(0, 0, 0)

    const chartLeft = MM_MARGIN + 12
    const chartRight = PAGE_W - MM_MARGIN
    const chartBottom = multi && serieOuPack.series.length > 1 ? 235 : 250
    const chartTop = titleY + 14
    const chartH = chartBottom - chartTop
    const chartW = chartRight - chartLeft

    const meses = multi ? serieOuPack.meses : serieOuPack
    const series = multi
        ? serieOuPack.series
        : [
              {
                  nome: 'Total',
                  cor: [47, 128, 237],
                  valores: (serieOuPack || []).map((s) => s.total),
              },
          ]
    const nMeses = meses.length
    const nSeries = series.length
    const maxVal = Math.max(
        1,
        ...series.flatMap((s) => s.valores),
        ...(multi ? [] : (serieOuPack || []).map((s) => s.total)),
    )

    const groupGap = Math.min(5, chartW / (nMeses * 5))
    const groupW = Math.max(8, (chartW - groupGap * (nMeses + 1)) / nMeses)
    const barGap = nSeries > 1 ? 0.8 : 0
    const barW = Math.max(2.2, (groupW - barGap * (nSeries - 1)) / nSeries)

    doc.setDrawColor(180, 190, 200)
    doc.setLineWidth(0.3)
    doc.line(chartLeft, chartTop, chartLeft, chartBottom)
    doc.line(chartLeft, chartBottom, chartRight, chartBottom)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(120, 130, 140)
    for (let i = 0; i <= 4; i += 1) {
        const v = Math.round((maxVal * i) / 4)
        const y = chartBottom - (chartH * i) / 4
        doc.setDrawColor(230, 235, 240)
        doc.line(chartLeft, y, chartRight, y)
        doc.text(String(v), chartLeft - 2, y + 1, { align: 'right' })
    }
    doc.setTextColor(0, 0, 0)

    for (let mi = 0; mi < nMeses; mi += 1) {
        const groupX = chartLeft + groupGap + mi * (groupW + groupGap)
        for (let si = 0; si < nSeries; si += 1) {
            const val = Number(series[si].valores[mi]) || 0
            const h = (val / maxVal) * (chartH - 2)
            const x = groupX + si * (barW + barGap)
            const y = chartBottom - h
            const cor = series[si].cor || [47, 128, 237]
            doc.setFillColor(cor[0], cor[1], cor[2])
            doc.rect(x, y, barW, Math.max(val > 0 ? 0.5 : 0, h), 'F')
            if (val > 0 && nSeries <= 4) {
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(6)
                doc.setTextColor(30, 77, 122)
                doc.text(String(val), x + barW / 2, y - 1.2, { align: 'center' })
            }
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(nMeses > 10 ? 5.5 : 7)
        doc.setTextColor(60, 70, 80)
        const label = meses[mi].label || meses[mi]
        doc.text(String(label), groupX + groupW / 2, chartBottom + 4, {
            align: 'center',
            angle: nMeses > 8 ? 45 : 0,
        })
    }

    let legendY = chartBottom + 14
    if (nSeries > 1) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        let lx = MM_MARGIN
        for (const s of series) {
            const cor = s.cor || [47, 128, 237]
            doc.setFillColor(cor[0], cor[1], cor[2])
            doc.rect(lx, legendY - 2.5, 4, 4, 'F')
            doc.setTextColor(40, 50, 60)
            const nome = String(s.nome || '').slice(0, 28)
            doc.text(nome, lx + 5.5, legendY + 0.5)
            const tw = doc.getTextWidth(nome) + 12
            lx += tw
            if (lx > PAGE_W - MM_MARGIN - 40) {
                lx = MM_MARGIN
                legendY += 6
            }
        }
        legendY += 6
    }

    const soma = series.reduce(
        (acc, s) => acc + s.valores.reduce((a, v) => a + (Number(v) || 0), 0),
        0,
    )
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60, 70, 80)
    const sitTxt =
        nSeries > 1 ? `${nSeries} situação(ões)` : series[0]?.nome || '1 situação'
    doc.text(
        `Total no período: ${soma} · ${nMeses} mês(es) · ${sitTxt}`,
        MM_MARGIN,
        legendY + (nSeries > 1 ? 2 : 2),
    )
    doc.setTextColor(0, 0, 0)
}

/**
 * @param {{ linhas: Array, subtitulo?: string, periodoDe?: string, periodoAte?: string, layout?: object, resumos?: object }} opts
 */
export async function gerarRelatorioCadastrosPdf(opts) {
    const layout = normalizarLayoutRelatorioCadastros(opts.layout)
    const idsColunas = colunasTabelaRelatorioAtivas(layout)
    const doc = new jsPDF({ ...OPCOES_JSPDF_A4 })
    const logo = await carregarLogoPdfEmerdog()
    let y = MM_MARGIN
    const rightX = PAGE_W - MM_MARGIN

    doc.addImage(logo.dataUrl, 'PNG', MM_MARGIN, y, logo.w, logo.h)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    doc.text(`Gerado em: ${dataGeracaoPtBr()}`, rightX, y + logo.h * 0.45, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += logo.h + 6

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Relatório de Cadastros', MM_MARGIN, y)
    y += 6

    const sub = String(opts.subtitulo || '').trim()
    if (sub) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60, 60, 60)
        doc.text(sub, MM_MARGIN, y, { maxWidth: TABLE_WIDTH_MM })
        doc.setTextColor(0, 0, 0)
        y += 6
    } else {
        y += 2
    }

    const linhas = opts.linhas || []

    if (layout.incluirTabelaGeral && idsColunas.length) {
        const head = idsColunas.map(
            (id) => METADADOS_COLUNAS_RELATORIO_CADASTROS[id]?.label || id,
        )
        const body = linhas.map((l) =>
            idsColunas.map((id) => valorCelulaColunaRelatorioCadastros(l, id)),
        )
        const vazia = idsColunas.map(() => '—')

        autoTable(doc, {
            startY: y,
            margin: { left: MM_MARGIN, right: MM_MARGIN },
            tableWidth: TABLE_WIDTH_MM,
            theme: 'grid',
            styles: {
                font: 'helvetica',
                fontSize: 7.5,
                cellPadding: 1.4,
                overflow: 'linebreak',
                valign: 'middle',
            },
            head: [head],
            body: body.length ? body : [vazia],
            headStyles: { fillColor: [30, 77, 122], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
            columnStyles: largurasColunasTabelaRelatorio(idsColunas, TABLE_WIDTH_MM),
        })
    }

    const resumos = opts.resumos || montarResumosRelatorioCadastros(linhas)
    const temResumos = blocosResumoRelatorioAtivos(layout).length > 0
    if (temResumos && linhas.length) {
        if (layout.incluirTabelaGeral && idsColunas.length) doc.addPage()
        desenharResumosRelatorioCadastrosPdf(doc, resumos, MM_MARGIN + 4, layout)
    }

    const pack = montarSeriesPorSituacaoEMes(
        linhas,
        opts.periodoDe || '',
        opts.periodoAte || '',
    )
    if (layout.incluirGraficoMeses && pack.meses.length > 1) {
        doc.addPage()
        let gy = MM_MARGIN
        doc.addImage(logo.dataUrl, 'PNG', MM_MARGIN, gy, logo.w, logo.h)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60, 60, 60)
        doc.text(`Gerado em: ${dataGeracaoPtBr()}`, rightX, gy + logo.h * 0.45, { align: 'right' })
        doc.setTextColor(0, 0, 0)
        gy += logo.h + 10
        desenharGraficoCredenciadosPorMes(doc, pack, { startY: gy })
    }

    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i += 1) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(`Página ${i} de ${total}`, PAGE_W - MM_MARGIN, 290, { align: 'right' })
        doc.setTextColor(0, 0, 0)
    }

    return doc.output('blob')
}

export function nomeArquivoRelatorioCadastros(sufixo = '') {
    const base = sanitizarNomeArquivoPdf(String(sufixo || '').trim() || 'Cadastros')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    return `Relatorio-Cadastros-${base}-${stamp}.pdf`
}

export function downloadRelatorioCadastrosPdf(blob, sufixo) {
    downloadPdf(blob, nomeArquivoRelatorioCadastros(sufixo))
}
