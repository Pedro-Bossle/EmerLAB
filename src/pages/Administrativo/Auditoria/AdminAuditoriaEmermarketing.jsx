import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    SEVERIDADES_AUDITORIA,
    baixarTextoComoArquivo,
    chamarApiAuditoria,
    formatarDataHoraAuditoria,
    formatarValorAuditoriaAmigavel,
    listarDiffCampos,
} from '../../../lib/auditoriaLogs.js'

const PAGE_SIZE = 50

/** Presets por entidade (equivalente aos presets de tabela dos logs EmerLAB). */
export const PRESETS_AUDITORIA_EMERMARKETING = [
    { id: 'conteudo', label: 'Conteúdo', entidades: ['documento', 'legenda'] },
    { id: 'roleta', label: 'Roleta', entidades: ['roleta'] },
    { id: 'relatorios', label: 'Relatórios', entidades: ['relatorio'] },
    { id: 'ops', label: 'Ops', entidades: ['ops_link'] },
]

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

/** Normaliza ação mkt → vocabulário dos logs EmerLAB (CREATE/UPDATE/DELETE…). */
function normalizarAcaoMkt(acao) {
    const a = String(acao || '')
        .trim()
        .toLowerCase()
    if (['criar', 'create'].includes(a)) return 'CREATE'
    if (['atualizar', 'update'].includes(a)) return 'UPDATE'
    if (['excluir', 'delete', 'remover'].includes(a)) return 'DELETE'
    if (['exportar', 'export', 'exportar_pdf'].includes(a)) return 'EXPORT'
    if (['gerar', 'generate'].includes(a)) return 'GENERATE'
    if (['compartilhar', 'share'].includes(a)) return 'SHARE'
    return a ? a.toUpperCase() : 'UPDATE'
}

function severidadeDeAcao(acaoNorm) {
    if (acaoNorm === 'DELETE') return 'warning'
    if (acaoNorm === 'EXPORT' || acaoNorm === 'SHARE') return 'info'
    return 'info'
}

/**
 * Converte linha de `mkt_audit_log` para o formato dos logs EmerLAB
 * (tabela, modal, CSV, filtros).
 */
export function normalizarLogMktParaAuditoria(row) {
    const acao = normalizarAcaoMkt(row?.acao)
    const detalhes =
        row?.detalhes && typeof row.detalhes === 'object' && !Array.isArray(row.detalhes)
            ? row.detalhes
            : row?.detalhes != null
              ? { valor: row.detalhes }
              : {}
    return {
        id: row?.id,
        data_hora: row?.created_at,
        usuario_id: row?.user_id || null,
        usuario_nome: row?.user_email || row?.user_id || null,
        acao,
        acao_original: row?.acao || '',
        tabela: row?.entidade || '',
        registro_id: row?.entidade_id || null,
        severidade: severidadeDeAcao(acao),
        valor_antigo: null,
        valor_novo: detalhes,
        ip_usuario: null,
        user_agent: null,
        _mkt: true,
    }
}

function resumirLogMkt(log) {
    if (!log) return '—'
    const acao = String(log.acao || '').toUpperCase()
    const ent = String(log.tabela || '').trim() || 'registro'
    const det = log.valor_novo && typeof log.valor_novo === 'object' ? log.valor_novo : null
    const nome = det?.nome || det?.titulo || det?.name || det?.arquivo || ''
    if (acao === 'CREATE') return nome ? `Criou ${ent} «${nome}»` : `Criou ${ent}`
    if (acao === 'DELETE') return nome ? `Removeu ${ent} «${nome}»` : `Removeu ${ent}`
    if (acao === 'UPDATE') return nome ? `Atualizou ${ent} «${nome}»` : `Atualizou ${ent}`
    if (acao === 'EXPORT') {
        const fmt = det?.formato || det?.tipo || ''
        return fmt ? `Exportou ${ent} (${fmt})` : `Exportou ${ent}`
    }
    if (acao === 'GENERATE') return nome ? `Gerou ${ent} «${nome}»` : `Gerou ${ent}`
    if (acao === 'SHARE') return nome ? `Compartilhou ${ent} «${nome}»` : `Compartilhou ${ent}`
    const keys = det ? Object.keys(det).slice(0, 3) : []
    if (keys.length) return `${String(log.acao_original || acao).toLowerCase()} · ${keys.join(', ')}`
    return log.acao_original || acao || ent
}

function montarCsvMkt(logs) {
    const header = [
        'id',
        'data_hora',
        'usuario_id',
        'usuario_nome',
        'acao',
        'tabela',
        'registro_id',
        'severidade',
        'resumo',
        'detalhes',
    ]
    const esc = (v) => {
        const s = v == null ? '' : String(v)
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
    }
    const lines = [header.join(',')]
    for (const log of logs || []) {
        lines.push(
            [
                log.id,
                log.data_hora,
                log.usuario_id,
                log.usuario_nome,
                log.acao,
                log.tabela,
                log.registro_id,
                log.severidade,
                resumirLogMkt(log),
                JSON.stringify(log.valor_novo ?? null),
            ]
                .map(esc)
                .join(','),
        )
    }
    return lines.join('\n')
}

/**
 * Painel EmerMarketing com os mesmos comportamentos da aba Logs,
 * sem o bloco de análise (resumo semanal / padrões suspeitos).
 * @param {{
 *   acoesRef?: React.MutableRefObject<null | object>,
 *   onStatusChange?: (s: { loading: boolean, exportando: boolean }) => void
 * }} props
 */
export default function AdminAuditoriaEmermarketing({ acoesRef = null, onStatusChange = null }) {
    const [loading, setLoading] = useState(true)
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [logs, setLogs] = useState([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [usuarios, setUsuarios] = useState([])
    const [entidades, setEntidades] = useState([])
    const [acoesLista, setAcoesLista] = useState([])
    const [detalhe, setDetalhe] = useState(null)

    const [filtroUsuario, setFiltroUsuario] = useState('')
    const [filtroAcao, setFiltroAcao] = useState('')
    const [filtroEntidade, setFiltroEntidade] = useState('')
    const [filtroPreset, setFiltroPreset] = useState('')
    const [filtroSeveridade, setFiltroSeveridade] = useState('')
    const [filtroDe, setFiltroDe] = useState('')
    const [filtroAte, setFiltroAte] = useState('')
    const [filtroQ, setFiltroQ] = useState('')

    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const presetAtivo = useMemo(
        () => PRESETS_AUDITORIA_EMERMARKETING.find((p) => p.id === filtroPreset) || null,
        [filtroPreset],
    )

    const payloadFiltros = useMemo(() => {
        const dataInicio = filtroDe ? new Date(`${filtroDe}T00:00:00`).toISOString() : ''
        const dataFim = filtroAte ? new Date(`${filtroAte}T23:59:59.999`).toISOString() : ''
        const base = {
            usuarioId: filtroUsuario || undefined,
            acao: filtroAcao || undefined,
            dataInicio: dataInicio || undefined,
            dataFim: dataFim || undefined,
            q: filtroQ.trim() || undefined,
        }
        if (presetAtivo?.entidades?.length) {
            return { ...base, entidades: presetAtivo.entidades }
        }
        return { ...base, entidade: filtroEntidade || undefined }
    }, [
        filtroUsuario,
        filtroAcao,
        filtroEntidade,
        filtroDe,
        filtroAte,
        filtroQ,
        presetAtivo,
    ])

    const selecionarPreset = (id) => {
        setFiltroPreset((atual) => (atual === id ? '' : id))
        if (id) setFiltroEntidade('')
    }

    const carregarMeta = useCallback(async () => {
        try {
            const json = await chamarApiAuditoria({ action: 'metaMkt' })
            setUsuarios(json.usuarios || [])
            setEntidades(json.entidades || [])
            const acoesNorm = new Set()
            for (const a of json.acoes || []) acoesNorm.add(normalizarAcaoMkt(a))
            setAcoesLista([...acoesNorm].sort((a, b) => a.localeCompare(b, 'pt-BR')))
        } catch {
            /* meta opcional */
        }
    }, [])

    const carregar = useCallback(
        async (pagina = 1) => {
            setLoading(true)
            setErro('')
            try {
                const filtroCliente = Boolean(filtroAcao || filtroSeveridade)
                const json = await chamarApiAuditoria({
                    action: 'listMkt',
                    page: filtroCliente ? 1 : pagina,
                    pageSize: filtroCliente ? 3000 : PAGE_SIZE,
                    ...payloadFiltros,
                    acao: undefined,
                })
                let logsNorm = (json.logs || []).map(normalizarLogMktParaAuditoria)

                if (filtroAcao) {
                    const alvo = String(filtroAcao).toUpperCase()
                    logsNorm = logsNorm.filter(
                        (l) =>
                            String(l.acao).toUpperCase() === alvo ||
                            String(l.acao_original || '').toUpperCase() === alvo,
                    )
                }
                if (filtroSeveridade) {
                    logsNorm = logsNorm.filter(
                        (l) => String(l.severidade || 'info') === filtroSeveridade,
                    )
                }

                if (filtroCliente) {
                    const from = (pagina - 1) * PAGE_SIZE
                    setLogs(logsNorm.slice(from, from + PAGE_SIZE))
                    setTotal(logsNorm.length)
                    setPage(pagina)
                } else {
                    setLogs(logsNorm)
                    setTotal(Number(json.total) || logsNorm.length)
                    setPage(pagina)
                }

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
        [payloadFiltros, filtroAcao, filtroSeveridade],
    )

    const exportarCsv = useCallback(async () => {
        setExportando(true)
        setErro('')
        try {
            const json = await chamarApiAuditoria({
                action: 'listMkt',
                page: 1,
                pageSize: 5000,
                ...payloadFiltros,
                acao: undefined,
            })
            let logsNorm = (json.logs || []).map(normalizarLogMktParaAuditoria)
            if (filtroAcao) {
                const alvo = String(filtroAcao).toUpperCase()
                logsNorm = logsNorm.filter(
                    (l) =>
                        String(l.acao).toUpperCase() === alvo ||
                        String(l.acao_original || '').toUpperCase() === alvo,
                )
            }
            if (filtroSeveridade) {
                logsNorm = logsNorm.filter((l) => String(l.severidade || 'info') === filtroSeveridade)
            }
            const csv = montarCsvMkt(logsNorm)
            const stamp = new Date().toISOString().slice(0, 10)
            baixarTextoComoArquivo(`auditoria-emermarketing-${stamp}.csv`, `\uFEFF${csv}`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setExportando(false)
        }
    }, [payloadFiltros, filtroAcao, filtroSeveridade])

    useEffect(() => {
        void carregarMeta()
    }, [carregarMeta])

    useEffect(() => {
        void carregar(1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payloadFiltros, filtroAcao, filtroSeveridade])

    useEffect(() => {
        onStatusChange?.({ loading, exportando })
    }, [loading, exportando, onStatusChange])

    useEffect(() => {
        if (!acoesRef) return undefined
        acoesRef.current = {
            atualizar: () => void carregar(page),
            exportar: () => void exportarCsv(),
        }
        return () => {
            acoesRef.current = null
        }
    }, [acoesRef, carregar, exportarCsv, page])

    const diffsDetalhe = useMemo(
        () => (detalhe ? listarDiffCampos(detalhe.valor_antigo, detalhe.valor_novo) : []),
        [detalhe],
    )

    const abrirDetalhe = (log) => setDetalhe(log)
    const fecharDetalhe = () => setDetalhe(null)

    return (
        <>
            {aviso ? <div className="admin_auditoria_aviso">{aviso}</div> : null}
            {erro ? <div className="admin_auditoria_erro">{erro}</div> : null}

            <section className="admin_auditoria_presets" aria-label="Relatórios operacionais">
                <p className="admin_auditoria_presets_titulo">Relatórios operacionais</p>
                <div className="admin_auditoria_presets_chips">
                    {PRESETS_AUDITORIA_EMERMARKETING.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            className={`admin_auditoria_preset_chip${filtroPreset === p.id ? ' is-active' : ''}`}
                            onClick={() => selecionarPreset(p.id)}
                            title={p.entidades.join(', ')}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                {presetAtivo ? (
                    <p className="admin_auditoria_presets_hint">
                        Filtrando: {presetAtivo.entidades.join(', ')}
                    </p>
                ) : null}
            </section>

            <section className="admin_auditoria_filtros" aria-label="Filtros">
                <label>
                    <span>Usuário</span>
                    <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)}>
                        <option value="">Todos</option>
                        {usuarios.map((u) => (
                            <option key={u.id || u.email} value={u.id}>
                                {u.nome || u.email || u.id}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Ação</span>
                    <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)}>
                        <option value="">Todas</option>
                        {(acoesLista.length
                            ? acoesLista
                            : ['CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'GENERATE', 'SHARE']
                        ).map((a) => (
                            <option key={a} value={a}>
                                {a}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Tabela</span>
                    <select
                        value={presetAtivo ? '' : filtroEntidade}
                        disabled={Boolean(presetAtivo)}
                        onChange={(e) => {
                            setFiltroPreset('')
                            setFiltroEntidade(e.target.value)
                        }}
                    >
                        <option value="">{presetAtivo ? '(preset ativo)' : 'Todas'}</option>
                        {entidades.map((t) => (
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
                                        <span
                                            className={`admin_auditoria_acao acao-${String(log.acao || '').toLowerCase()}`}
                                        >
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
                                    <td className="admin_auditoria_cel_resumo">{resumirLogMkt(log)}</td>
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
                            {detalhe.acao_original && detalhe.acao_original !== detalhe.acao
                                ? ` · original «${detalhe.acao_original}»`
                                : ''}
                        </p>

                        <div className="admin_auditoria_contexto">
                            <h3>Onde / o quê</h3>
                            <dl className="admin_auditoria_contexto_lista">
                                <div className="admin_auditoria_contexto_item">
                                    <dt>Resumo</dt>
                                    <dd>{resumirLogMkt(detalhe)}</dd>
                                </div>
                                <div className="admin_auditoria_contexto_item">
                                    <dt>Severidade</dt>
                                    <dd>{detalhe.severidade || 'info'}</dd>
                                </div>
                            </dl>
                        </div>

                        {diffsDetalhe.length > 0 ? (
                            <div className="admin_auditoria_diff_list">
                                <h3>Campos nos detalhes</h3>
                                <ul>
                                    {diffsDetalhe.map((d) => (
                                        <li key={d.campo}>
                                            <strong className="admin_auditoria_diff_campo">{d.campo}</strong>
                                            <div className="admin_auditoria_diff_pair">
                                                <div className="admin_auditoria_diff_cell is-new">
                                                    <span className="admin_auditoria_diff_cell_lbl">Valor</span>
                                                    <pre>
                                                        {formatarValorAuditoriaAmigavel(
                                                            d.campo,
                                                            d.depois,
                                                            null,
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
                            <div className="admin_auditoria_json_block is-new">
                                <h3>Valor novo (técnico)</h3>
                                <pre>{fmtJsonAmigavel(detalhe.valor_novo)}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    )
}
