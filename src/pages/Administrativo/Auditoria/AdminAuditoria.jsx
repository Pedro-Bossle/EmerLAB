import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ACOES_AUDITORIA,
    SEVERIDADES_AUDITORIA,
    baixarTextoComoArquivo,
    chamarApiAuditoria,
    formatarDataHoraAuditoria,
    listarDiffCampos,
    montarCsvAuditoria,
    resumirAlteracaoAuditoria,
} from '../../../lib/auditoriaLogs.js'
import './AdminAuditoria.css'

const PAGE_SIZE = 50

function fmtJson(v) {
    if (v == null) return 'null'
    try {
        return JSON.stringify(v, null, 2)
    } catch {
        return String(v)
    }
}

const AdminAuditoria = () => {
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

    const [filtroUsuario, setFiltroUsuario] = useState('')
    const [filtroAcao, setFiltroAcao] = useState('')
    const [filtroTabela, setFiltroTabela] = useState('')
    const [filtroSeveridade, setFiltroSeveridade] = useState('')
    const [filtroDe, setFiltroDe] = useState('')
    const [filtroAte, setFiltroAte] = useState('')
    const [filtroQ, setFiltroQ] = useState('')

    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const payloadFiltros = useMemo(() => {
        const dataInicio = filtroDe ? new Date(`${filtroDe}T00:00:00`).toISOString() : ''
        const dataFim = filtroAte ? new Date(`${filtroAte}T23:59:59.999`).toISOString() : ''
        return {
            usuarioId: filtroUsuario || undefined,
            acao: filtroAcao || undefined,
            tabela: filtroTabela || undefined,
            severidade: filtroSeveridade || undefined,
            dataInicio: dataInicio || undefined,
            dataFim: dataFim || undefined,
            q: filtroQ.trim() || undefined,
        }
    }, [filtroUsuario, filtroAcao, filtroTabela, filtroSeveridade, filtroDe, filtroAte, filtroQ])

    const carregarMeta = useCallback(async () => {
        try {
            const json = await chamarApiAuditoria({ action: 'meta' })
            setUsuarios(json.usuarios || [])
            setTabelas(json.tabelas || [])
        } catch {
            /* meta opcional */
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
        void carregar(1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payloadFiltros])

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

    return (
        <div className="admin_auditoria">
            <header className="admin_auditoria_header">
                <div>
                    <p className="admin_auditoria_kicker">Administrativo</p>
                    <h1>Auditoria</h1>
                    <p>Registro imutável de alterações críticas do sistema.</p>
                </div>
                <div className="admin_auditoria_header_acoes">
                    <button type="button" onClick={() => void carregar(page)} disabled={loading}>
                        Atualizar
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
            </header>

            {aviso ? <div className="admin_auditoria_aviso">{aviso}</div> : null}
            {erro ? <div className="admin_auditoria_erro">{erro}</div> : null}

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
                    <select value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)}>
                        <option value="">Todas</option>
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

            <div className="admin_auditoria_table_wrap">
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
                                    <td className="admin_auditoria_resumo">
                                        {resumirAlteracaoAuditoria(log)}
                                    </td>
                                    <td>
                                        <button type="button" onClick={() => setDetalhe(log)}>
                                            Detalhes
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="admin_auditoria_paginacao">
                <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => void carregar(1)}
                >
                    «
                </button>
                <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => void carregar(page - 1)}
                >
                    Anterior
                </button>
                <button
                    type="button"
                    disabled={page >= totalPaginas || loading}
                    onClick={() => void carregar(page + 1)}
                >
                    Próxima
                </button>
                <button
                    type="button"
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
                    onClick={() => setDetalhe(null)}
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
                            <button type="button" onClick={() => setDetalhe(null)}>
                                Fechar
                            </button>
                        </header>
                        <p className="admin_auditoria_modal_meta">
                            {formatarDataHoraAuditoria(detalhe.data_hora)} ·{' '}
                            {detalhe.usuario_nome || '—'} · id {detalhe.registro_id || '—'}
                            {detalhe.ip_usuario ? ` · IP ${detalhe.ip_usuario}` : ''}
                        </p>

                        {diffsDetalhe.length > 0 ? (
                            <div className="admin_auditoria_diff_list">
                                <h3>Diferenças campo a campo</h3>
                                <ul>
                                    {diffsDetalhe.map((d) => (
                                        <li key={d.campo}>
                                            <strong>{d.campo}</strong>
                                            <div className="admin_auditoria_diff_pair">
                                                <pre className="is-old">{fmtJson(d.antes)}</pre>
                                                <span aria-hidden>→</span>
                                                <pre className="is-new">{fmtJson(d.depois)}</pre>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="admin_auditoria_json_grid">
                            <div>
                                <h3>Valor antigo</h3>
                                <pre>{fmtJson(detalhe.valor_antigo)}</pre>
                            </div>
                            <div>
                                <h3>Valor novo</h3>
                                <pre>{fmtJson(detalhe.valor_novo)}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default AdminAuditoria
