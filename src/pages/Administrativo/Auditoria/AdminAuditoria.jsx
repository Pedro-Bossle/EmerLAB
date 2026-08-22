import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    ACOES_AUDITORIA,
    PRESETS_AUDITORIA_OPERACIONAL,
    SEVERIDADES_AUDITORIA,
    baixarTextoComoArquivo,
    carregarMapasReferenciasAuditoria,
    chamarApiAuditoria,
    detectarPadroesSuspeitosAuditoria,
    formatarDataHoraAuditoria,
    formatarValorAuditoriaAmigavel,
    listarDiffCampos,
    montarContextoAuditoriaAmigavel,
    montarCsvAuditoria,
    montarResumoAuditoriaSemanal,
    resumirAlteracaoAuditoria,
    rotuloCampoAuditoria,
} from '../../../lib/auditoriaLogs.js'
import AdminQualidadePainel from '../Qualidade/AdminQualidade.jsx'
import './AdminAuditoria.css'
import { PageHeader } from '../../../components/ui'

const PAGE_SIZE = 50
const CACHE_RESUMO_KEY = 'emerlab-auditoria-resumo-semana'
const CACHE_RESUMO_TTL_MS = 10 * 60 * 1000

function lerCacheResumo() {
    try {
        const raw = sessionStorage.getItem(CACHE_RESUMO_KEY)
        if (!raw) return null
        const obj = JSON.parse(raw)
        if (!obj?.em || Date.now() - obj.em > CACHE_RESUMO_TTL_MS) return null
        return obj
    } catch {
        return null
    }
}

function gravarCacheResumo(payload) {
    try {
        sessionStorage.setItem(CACHE_RESUMO_KEY, JSON.stringify({ ...payload, em: Date.now() }))
    } catch {
        /* ignore quota */
    }
}

/** Exibição amigável: vazio em CREATE / campos nulos. */
function fmtJsonAmigavel(v) {
    if (v == null) return '—'
    if (typeof v === 'string' && v.trim() === '') return '—'
    try {
        if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) {
            return '—'
        }
        return JSON.stringify(v, null, 2)
    } catch {
        return String(v)
    }
}

const AdminAuditoria = () => {
    const [searchParams, setSearchParams] = useSearchParams()
    const abaPrincipal = searchParams.get('aba') === 'qualidade' ? 'qualidade' : 'logs'

    const selecionarAba = useCallback(
        (aba) => {
            if (aba === 'qualidade') {
                setSearchParams({ aba: 'qualidade' }, { replace: false })
                return
            }
            // Limpa ?aba=qualidade → volta à tela de auditoria (logs)
            setSearchParams({}, { replace: true })
        },
        [setSearchParams],
    )

    const [loading, setLoading] = useState(true)
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [logs, setLogs] = useState([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [usuarios, setUsuarios] = useState([])
    const [tabelas, setTabelas] = useState([])
    const [detalhe, setDetalhe] = useState(null)
    const [mapasDetalhe, setMapasDetalhe] = useState(null)
    const [carregandoMapas, setCarregandoMapas] = useState(false)
    const [resumoSemana, setResumoSemana] = useState(null)
    const [alertasSuspeitos, setAlertasSuspeitos] = useState([])
    const [loadingResumo, setLoadingResumo] = useState(false)

    const [filtroUsuario, setFiltroUsuario] = useState('')
    const [filtroAcao, setFiltroAcao] = useState('')
    const [filtroTabela, setFiltroTabela] = useState('')
    const [filtroPreset, setFiltroPreset] = useState('')
    const [filtroSeveridade, setFiltroSeveridade] = useState('')
    const [filtroDe, setFiltroDe] = useState('')
    const [filtroAte, setFiltroAte] = useState('')
    const [filtroQ, setFiltroQ] = useState('')

    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const presetAtivo = useMemo(
        () => PRESETS_AUDITORIA_OPERACIONAL.find((p) => p.id === filtroPreset) || null,
        [filtroPreset],
    )

    const payloadFiltros = useMemo(() => {
        const dataInicio = filtroDe ? new Date(`${filtroDe}T00:00:00`).toISOString() : ''
        const dataFim = filtroAte ? new Date(`${filtroAte}T23:59:59.999`).toISOString() : ''
        const base = {
            usuarioId: filtroUsuario || undefined,
            acao: filtroAcao || undefined,
            severidade: filtroSeveridade || undefined,
            dataInicio: dataInicio || undefined,
            dataFim: dataFim || undefined,
            q: filtroQ.trim() || undefined,
        }
        if (presetAtivo?.tabelas?.length) {
            return { ...base, tabelas: presetAtivo.tabelas }
        }
        return { ...base, tabela: filtroTabela || undefined }
    }, [
        filtroUsuario,
        filtroAcao,
        filtroTabela,
        filtroSeveridade,
        filtroDe,
        filtroAte,
        filtroQ,
        presetAtivo,
    ])

    const selecionarPreset = (id) => {
        setFiltroPreset((atual) => (atual === id ? '' : id))
        if (id) setFiltroTabela('')
    }

    const carregarMeta = useCallback(async () => {
        try {
            const json = await chamarApiAuditoria({ action: 'meta' })
            setUsuarios(json.usuarios || [])
            setTabelas(json.tabelas || [])
        } catch {
            /* meta opcional */
        }
    }, [])

    /** Resumo determinístico (contagens) — sem LLM; cache 10 min para não refazer fetch. */
    const carregarResumoSemana = useCallback(async ({ forcar = false } = {}) => {
        if (!forcar) {
            const cache = lerCacheResumo()
            if (cache?.resumo) {
                setResumoSemana(cache.resumo)
                setAlertasSuspeitos(cache.alertas || [])
                return
            }
        }
        setLoadingResumo(true)
        try {
            const json = await chamarApiAuditoria({ action: 'resumoSemana', dias: 7, pageSize: 3000 })
            const logsLeves = json.logs || []
            const resumo = montarResumoAuditoriaSemanal(logsLeves)
            const alertas = detectarPadroesSuspeitosAuditoria(logsLeves)
            setResumoSemana(resumo)
            setAlertasSuspeitos(alertas)
            gravarCacheResumo({ resumo, alertas })
            if (json.aviso) setAviso(json.aviso)
        } catch (e) {
            setResumoSemana(null)
            setAlertasSuspeitos([])
            setErro((prev) => prev || e?.message || String(e))
        } finally {
            setLoadingResumo(false)
        }
    }, [])

    const carregar = useCallback(
        async (pagina = page) => {
            setLoading(true)
            setErro('')
            try {
                const json = await chamarApiAuditoria({
                    action: 'list',
                    page: pagina,
                    pageSize: PAGE_SIZE,
                    ...payloadFiltros,
                })
                setLogs(json.logs || [])
                setTotal(Number(json.total) || 0)
                setPage(pagina)
                if (json.aviso) setAviso(json.aviso)
                else setAviso('')
            } catch (e) {
                setErro(e?.message || String(e))
                setLogs([])
                setTotal(0)
            } finally {
                setLoading(false)
            }
        },
        [page, payloadFiltros],
    )

    useEffect(() => {
        void carregarMeta()
    }, [carregarMeta])

    useEffect(() => {
        if (abaPrincipal !== 'logs') return
        void carregarResumoSemana()
    }, [abaPrincipal, carregarResumoSemana])

    useEffect(() => {
        if (abaPrincipal !== 'logs') return
        void carregar(1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payloadFiltros, abaPrincipal])

    const aplicarFiltroAlerta = (alerta) => {
        if (/DELETE/i.test(alerta.titulo) || /DELETE/i.test(alerta.detalhe)) {
            setFiltroAcao('DELETE')
            setFiltroPreset('')
        }
        const de = new Date()
        de.setDate(de.getDate() - 7)
        setFiltroDe(de.toISOString().slice(0, 10))
        setFiltroAte(new Date().toISOString().slice(0, 10))
    }

    const exportarCsv = async () => {
        setExportando(true)
        setErro('')
        try {
            const json = await chamarApiAuditoria({
                action: 'export',
                page: 1,
                pageSize: 5000,
                ...payloadFiltros,
            })
            const csv = montarCsvAuditoria(json.logs || [])
            const stamp = new Date().toISOString().slice(0, 10)
            baixarTextoComoArquivo(`auditoria-${stamp}.csv`, `\uFEFF${csv}`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setExportando(false)
        }
    }

    const diffsDetalhe = useMemo(
        () => (detalhe ? listarDiffCampos(detalhe.valor_antigo, detalhe.valor_novo) : []),
        [detalhe],
    )

    const contextoDetalhe = useMemo(() => {
        if (!detalhe || !mapasDetalhe) return []
        const base = detalhe.valor_novo || detalhe.valor_antigo
        return montarContextoAuditoriaAmigavel(base, mapasDetalhe)
    }, [detalhe, mapasDetalhe])

    useEffect(() => {
        if (!detalhe) {
            setMapasDetalhe(null)
            return undefined
        }
        let cancelado = false
        setCarregandoMapas(true)
        carregarMapasReferenciasAuditoria(detalhe.valor_antigo, detalhe.valor_novo)
            .then((mapas) => {
                if (!cancelado) setMapasDetalhe(mapas)
            })
            .catch(() => {
                if (!cancelado) setMapasDetalhe(null)
            })
            .finally(() => {
                if (!cancelado) setCarregandoMapas(false)
            })
        return () => {
            cancelado = true
        }
    }, [detalhe])

    const abrirDetalhe = (log) => {
        setDetalhe(log)
        setMapasDetalhe(null)
    }

    const fecharDetalhe = () => {
        setDetalhe(null)
        setMapasDetalhe(null)
    }

    return (
        <div className="el-page admin_auditoria">
            <PageHeader
                kicker="Administrativo"
                title="Auditoria"
                description={
                    abaPrincipal === 'qualidade'
                        ? 'Qualidade de dados dos credenciados: documentos, geocode LOCAL, especialidade RC e duplicatas.'
                        : 'Auditoria operacional = mudanças de dados (cadastros, pagamentos, valores). Cada log expira 45 dias após a própria data. Histórico fino de convites/permissões fica em Gerenciar acessos.'
                }
                actions={
                    abaPrincipal === 'logs' ? (
                        <div className="admin_auditoria_header_acoes">
                            <button type="button" onClick={() => void carregar(page)} disabled={loading}>
                                Atualizar
                            </button>
                            <button
                                type="button"
                                onClick={() => void carregarResumoSemana({ forcar: true })}
                                disabled={loadingResumo}
                            >
                                {loadingResumo ? 'Resumo…' : 'Atualizar resumo'}
                            </button>
                            <button
                                type="button"
                                className="is-primary"
                                onClick={() => void exportarCsv()}
                                disabled={exportando || loading}
                            >
                                {exportando ? 'Exportando…' : 'Exportar CSV'}
                            </button>
                        </div>
                    ) : null
                }
            />

            <div className="admin_auditoria_abas" role="tablist" aria-label="Seções da auditoria">
                <button
                    type="button"
                    role="tab"
                    aria-selected={abaPrincipal === 'logs'}
                    className={`admin_auditoria_aba${abaPrincipal === 'logs' ? ' is-active' : ''}`}
                    onClick={() => selecionarAba('logs')}
                >
                    Logs
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={abaPrincipal === 'qualidade'}
                    className={`admin_auditoria_aba${abaPrincipal === 'qualidade' ? ' is-active' : ''}`}
                    onClick={() => selecionarAba('qualidade')}
                >
                    Qualidade de dados
                </button>
            </div>

            {abaPrincipal === 'qualidade' ? (
                <AdminQualidadePainel />
            ) : (
                <>
            {aviso ? <div className="admin_auditoria_aviso">{aviso}</div> : null}
            {erro ? <div className="admin_auditoria_erro">{erro}</div> : null}

            <section className="admin_auditoria_resumo" aria-label="Resumo da semana">
                <div className="admin_auditoria_resumo_topo">
                    <h2 className="admin_auditoria_resumo_titulo">Resumo — últimos 7 dias</h2>
                    <p className="admin_auditoria_resumo_nota">
                        Agregação local (sem IA). Foco: cidades e prestadores.
                    </p>
                </div>
                {loadingResumo && !resumoSemana ? (
                    <p className="admin_auditoria_resumo_loading">Calculando resumo…</p>
                ) : resumoSemana ? (
                    <>
                        <p className="admin_auditoria_resumo_texto">{resumoSemana.texto}</p>
                        <div className="admin_auditoria_resumo_cards">
                            <div className="admin_auditoria_resumo_card">
                                <span className="admin_auditoria_resumo_n">{resumoSemana.totalFoco}</span>
                                <span>Eventos (foco)</span>
                            </div>
                            <div className="admin_auditoria_resumo_card">
                                <span className="admin_auditoria_resumo_n">{resumoSemana.totalCidades}</span>
                                <span>Cidades / vínculos</span>
                            </div>
                            <div className="admin_auditoria_resumo_card">
                                <span className="admin_auditoria_resumo_n">
                                    {resumoSemana.totalPrestadores}
                                </span>
                                <span>Prestadores</span>
                            </div>
                            <div className="admin_auditoria_resumo_card">
                                <span className="admin_auditoria_resumo_n">{resumoSemana.totalGeral}</span>
                                <span>Todos os logs</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="admin_auditoria_resumo_loading">Resumo indisponível.</p>
                )}

                {alertasSuspeitos.length > 0 ? (
                    <div className="admin_auditoria_alertas">
                        <h3>Padrões suspeitos</h3>
                        <ul>
                            {alertasSuspeitos.map((a) => (
                                <li
                                    key={a.id}
                                    className={`admin_auditoria_alerta sev-${a.severidade || 'warning'}`}
                                >
                                    <div>
                                        <strong>{a.titulo}</strong>
                                        <p>{a.detalhe}</p>
                                    </div>
                                    <button type="button" onClick={() => aplicarFiltroAlerta(a)}>
                                        Filtrar
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : resumoSemana && !loadingResumo ? (
                    <p className="admin_auditoria_alertas_ok">Nenhum padrão suspeito nos limiares atuais.</p>
                ) : null}
            </section>

            <section className="admin_auditoria_presets" aria-label="Relatórios operacionais">
                <p className="admin_auditoria_presets_titulo">Relatórios operacionais</p>
                <div className="admin_auditoria_presets_chips">
                    {PRESETS_AUDITORIA_OPERACIONAL.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            className={`admin_auditoria_preset_chip${filtroPreset === p.id ? ' is-active' : ''}`}
                            onClick={() => selecionarPreset(p.id)}
                            title={p.tabelas.join(', ')}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                {presetAtivo ? (
                    <p className="admin_auditoria_presets_hint">
                        Filtrando: {presetAtivo.tabelas.join(', ')}
                        {presetAtivo.id === 'acessos'
                            ? ' · Gestão de convites/permissões também em Gerenciar acessos (access_audit_log).'
                            : ''}
                    </p>
                ) : null}
            </section>

            <section className="admin_auditoria_filtros" aria-label="Filtros">
                <label>
                    <span>Usuário</span>
                    <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)}>
                        <option value="">Todos</option>
                        {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.nome}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Ação</span>
                    <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)}>
                        <option value="">Todas</option>
                        {ACOES_AUDITORIA.map((a) => (
                            <option key={a} value={a}>
                                {a}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Tabela</span>
                    <select
                        value={presetAtivo ? '' : filtroTabela}
                        disabled={Boolean(presetAtivo)}
                        onChange={(e) => {
                            setFiltroPreset('')
                            setFiltroTabela(e.target.value)
                        }}
                    >
                        <option value="">{presetAtivo ? '(preset ativo)' : 'Todas'}</option>
                        {tabelas.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Severidade</span>
                    <select
                        value={filtroSeveridade}
                        onChange={(e) => setFiltroSeveridade(e.target.value)}
                    >
                        {SEVERIDADES_AUDITORIA.map((s) => (
                            <option key={s.value || 'all'} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>De</span>
                    <input type="date" value={filtroDe} onChange={(e) => setFiltroDe(e.target.value)} />
                </label>
                <label>
                    <span>Até</span>
                    <input type="date" value={filtroAte} onChange={(e) => setFiltroAte(e.target.value)} />
                </label>
                <label className="admin_auditoria_filtro_q">
                    <span>Busca</span>
                    <input
                        type="search"
                        value={filtroQ}
                        onChange={(e) => setFiltroQ(e.target.value)}
                        placeholder="Usuário, tabela, id…"
                    />
                </label>
            </section>

            <div className="admin_auditoria_stats">
                <span>
                    {total} registro{total === 1 ? '' : 's'}
                </span>
                <span>
                    Página {page} / {totalPaginas}
                </span>
            </div>

            <div className="admin_auditoria_table_wrap overflow-x-auto">
                <table className="admin_auditoria_table">
                    <thead>
                        <tr>
                            <th>Data/Hora</th>
                            <th>Usuário</th>
                            <th>Ação</th>
                            <th>Tabela</th>
                            <th>ID</th>
                            <th>Severidade</th>
                            <th>Resumo</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={8} className="admin_auditoria_empty">
                                    Carregando…
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="admin_auditoria_empty">
                                    Nenhum log encontrado.
                                </td>
                            </tr>
                        ) : (
                            logs.map((log) => (
                                <tr key={log.id}>
                                    <td>{formatarDataHoraAuditoria(log.data_hora)}</td>
                                    <td>{log.usuario_nome || '—'}</td>
                                    <td>
                                        <span className={`admin_auditoria_acao acao-${String(log.acao || '').toLowerCase()}`}>
                                            {log.acao}
                                        </span>
                                    </td>
                                    <td>
                                        <code>{log.tabela}</code>
                                    </td>
                                    <td>
                                        <code>{log.registro_id || '—'}</code>
                                    </td>
                                    <td>
                                        <span
                                            className={`admin_auditoria_sev sev-${log.severidade || 'info'}`}
                                        >
                                            {log.severidade || 'info'}
                                        </span>
                                    </td>
                                    <td className="admin_auditoria_cel_resumo">
                                        {resumirAlteracaoAuditoria(log)}
                                    </td>
                                    <td>
                                        <button type="button" onClick={() => abrirDetalhe(log)}>
                                            Detalhes
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="admin_auditoria_paginacao flex flex-wrap items-center justify-center gap-3">
                <button
                    type="button"
                    className="min-h-11 min-w-11"
                    disabled={page <= 1 || loading}
                    onClick={() => void carregar(1)}
                >
                    «
                </button>
                <button
                    type="button"
                    className="min-h-11 px-3"
                    disabled={page <= 1 || loading}
                    onClick={() => void carregar(page - 1)}
                >
                    Anterior
                </button>
                <button
                    type="button"
                    className="min-h-11 px-3"
                    disabled={page >= totalPaginas || loading}
                    onClick={() => void carregar(page + 1)}
                >
                    Próxima
                </button>
                <button
                    type="button"
                    className="min-h-11 min-w-11"
                    disabled={page >= totalPaginas || loading}
                    onClick={() => void carregar(totalPaginas)}
                >
                    »
                </button>
            </div>

            {detalhe ? (
                <div
                    className="admin_auditoria_modal_backdrop"
                    role="presentation"
                    onClick={fecharDetalhe}
                >
                    <div
                        className="admin_auditoria_modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Detalhe do log"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header>
                            <h2>
                                {detalhe.acao} · {detalhe.tabela}
                            </h2>
                            <button type="button" onClick={fecharDetalhe}>
                                Fechar
                            </button>
                        </header>
                        <p className="admin_auditoria_modal_meta">
                            {formatarDataHoraAuditoria(detalhe.data_hora)} ·{' '}
                            {detalhe.usuario_nome || '—'} · id {detalhe.registro_id || '—'}
                            {detalhe.ip_usuario ? ` · IP ${detalhe.ip_usuario}` : ''}
                        </p>

                        {carregandoMapas ? (
                            <p className="admin_auditoria_contexto_loading">Resolvendo nomes…</p>
                        ) : null}

                        {contextoDetalhe.length > 0 ? (
                            <div className="admin_auditoria_contexto">
                                <h3>Onde / o quê</h3>
                                <dl className="admin_auditoria_contexto_lista">
                                    {contextoDetalhe.map((c) => (
                                        <div key={c.campo} className="admin_auditoria_contexto_item">
                                            <dt>{c.rotulo}</dt>
                                            <dd>{c.texto}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        ) : null}

                        {diffsDetalhe.length > 0 ? (
                            <div className="admin_auditoria_diff_list">
                                <h3>Diferenças campo a campo</h3>
                                <ul>
                                    {diffsDetalhe.map((d) => (
                                        <li key={d.campo}>
                                            <strong className="admin_auditoria_diff_campo">
                                                {rotuloCampoAuditoria(d.campo)}
                                                <span className="admin_auditoria_diff_campo_tech">
                                                    {d.campo}
                                                </span>
                                            </strong>
                                            <div className="admin_auditoria_diff_pair">
                                                <div className="admin_auditoria_diff_cell is-old">
                                                    <span className="admin_auditoria_diff_cell_lbl">Antes</span>
                                                    <pre>
                                                        {formatarValorAuditoriaAmigavel(
                                                            d.campo,
                                                            d.antes,
                                                            mapasDetalhe,
                                                        )}
                                                    </pre>
                                                </div>
                                                <span className="admin_auditoria_diff_arrow" aria-hidden>
                                                    →
                                                </span>
                                                <div className="admin_auditoria_diff_cell is-new">
                                                    <span className="admin_auditoria_diff_cell_lbl">Depois</span>
                                                    <pre>
                                                        {formatarValorAuditoriaAmigavel(
                                                            d.campo,
                                                            d.depois,
                                                            mapasDetalhe,
                                                        )}
                                                    </pre>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="admin_auditoria_json_grid">
                            <div className="admin_auditoria_json_block is-old">
                                <h3>Valor antigo (técnico)</h3>
                                <pre>{fmtJsonAmigavel(detalhe.valor_antigo)}</pre>
                            </div>
                            <div className="admin_auditoria_json_block is-new">
                                <h3>Valor novo (técnico)</h3>
                                <pre>{fmtJsonAmigavel(detalhe.valor_novo)}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
                </>
            )}
        </div>
    )
}

export default AdminAuditoria
