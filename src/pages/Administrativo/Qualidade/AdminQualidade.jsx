import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    CATEGORIAS_QUALIDADE,
    arquivarAvisoQualidade,
    chaveAvisoQualidade,
    listarAvisosArquivados,
    montarCsvQualidadeCategoria,
    particionarScanPorArquivo,
    restaurarAvisoQualidade,
    scanQualidadeDados,
} from '../../../lib/qualidadeDados.js'
import { baixarTextoComoArquivo } from '../../../lib/auditoriaLogs.js'
import { getStoredAccessProfile } from '../../../lib/accessControl.js'
import './AdminQualidade.css'

/**
 * Painel de qualidade (usado como aba em Administrativo → Auditoria).
 */
export default function AdminQualidadePainel() {
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [scan, setScan] = useState(null)
    const [mapaArquivados, setMapaArquivados] = useState({})
    const [aba, setAba] = useState('documento_invalido')
    const [filtroQ, setFiltroQ] = useState('')
    const [busyChave, setBusyChave] = useState('')

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [result, arq] = await Promise.all([scanQualidadeDados(), listarAvisosArquivados()])
            setScan(result)
            setMapaArquivados(arq.mapa || {})
        } catch (e) {
            setErro(e?.message || String(e))
            setScan(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const particao = useMemo(
        () => particionarScanPorArquivo(scan, mapaArquivados),
        [scan, mapaArquivados],
    )

    const linhas = useMemo(() => {
        const q = filtroQ.trim().toLowerCase()
        if (aba === 'duplicatas') {
            return (particao.duplicatas || []).filter((g) => {
                if (!q) return true
                const blob = `${g.motivo} ${g.chave} ${g.detalhe} ${(g.itens || []).map((i) => i.nome).join(' ')}`.toLowerCase()
                return blob.includes(q)
            })
        }
        if (aba === 'arquivados') {
            return (particao.arquivados || []).filter((row) => {
                if (!q) return true
                const blob = `${row.categoria} ${row.nome} ${row.detalhe || ''} ${row.chave}`.toLowerCase()
                return blob.includes(q)
            })
        }
        const lista =
            aba === 'documento_invalido'
                ? particao.documentoInvalido
                : aba === 'geocode_faltando'
                  ? particao.geocodeFaltando
                  : particao.especialidadeSemRc
        return (lista || []).filter((row) => {
            if (!q) return true
            const blob = `${row.nome} ${row.detalhe || ''} ${row.id}`.toLowerCase()
            return blob.includes(q)
        })
    }, [particao, aba, filtroQ])

    const exportar = () => {
        const csv = montarCsvQualidadeCategoria(aba, particao)
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        baixarTextoComoArquivo(`qualidade-${aba}-${stamp}.csv`, `\uFEFF${csv}`)
    }

    const nomeUsuario = () => {
        const p = getStoredAccessProfile()
        return p?.name || p?.email || ''
    }

    const arquivar = async (categoria, row) => {
        const chave = chaveAvisoQualidade(categoria, row)
        setBusyChave(chave)
        try {
            const meta = await arquivarAvisoQualidade({
                chave,
                categoria,
                detalhe: {
                    id: row.id,
                    nome: row.nome,
                    detalhe: row.detalhe,
                    href: row.href,
                    motivo: row.motivo,
                    chaveGrupo: row.chave,
                },
                usuarioNome: nomeUsuario(),
            })
            setMapaArquivados((prev) => ({ ...prev, [chave]: meta }))
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setBusyChave('')
        }
    }

    const restaurar = async (chave) => {
        setBusyChave(chave)
        try {
            await restaurarAvisoQualidade(chave)
            setMapaArquivados((prev) => {
                const next = { ...prev }
                delete next[chave]
                return next
            })
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setBusyChave('')
        }
    }

    return (
        <div className="admin_qualidade admin_qualidade_painel">
            <div className="admin_qualidade_painel_topo">
                <p className="admin_qualidade_painel_desc">
                    Só credenciados. Geocode: especialidade LOCAL. Duplicatas: CRMV, nome, CPF/CNPJ,
                    e-mail e telefone. Use «Ignorar» para arquivar avisos.
                </p>
                <div className="admin_qualidade_header_acoes">
                    <button type="button" onClick={() => void carregar()} disabled={loading}>
                        {loading ? 'Analisando…' : 'Atualizar scan'}
                    </button>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={exportar}
                        disabled={!scan || loading}
                    >
                        Exportar CSV (aba)
                    </button>
                </div>
            </div>

            {erro ? <div className="admin_qualidade_erro">{erro}</div> : null}

            <div className="admin_qualidade_cards" role="tablist" aria-label="Categorias">
                {CATEGORIAS_QUALIDADE.map((c) => {
                    const n = particao.totais?.[c.id] ?? 0
                    const ativo = aba === c.id
                    return (
                        <button
                            key={c.id}
                            type="button"
                            role="tab"
                            aria-selected={ativo}
                            className={`admin_qualidade_card${ativo ? ' is-active' : ''}${c.id === 'arquivados' ? ' is-arquivo' : ''}`}
                            onClick={() => setAba(c.id)}
                        >
                            <span className="admin_qualidade_card_n">{n}</span>
                            <span className="admin_qualidade_card_label">{c.label}</span>
                        </button>
                    )
                })}
            </div>

            <div className="admin_qualidade_toolbar">
                <label className="admin_qualidade_filtro_q">
                    <span>Buscar</span>
                    <input
                        type="search"
                        value={filtroQ}
                        onChange={(e) => setFiltroQ(e.target.value)}
                        placeholder="Nome, detalhe, chave…"
                    />
                </label>
                {scan?.geradoEm ? (
                    <p className="admin_qualidade_meta">
                        Scan em {new Date(scan.geradoEm).toLocaleString('pt-BR')} ·{' '}
                        {particao.totais?.prestadores ?? 0} credenciados
                    </p>
                ) : null}
            </div>

            <div className="admin_qualidade_table_wrap overflow-x-auto">
                {aba === 'duplicatas' ? (
                    <table className="admin_qualidade_table">
                        <thead>
                            <tr>
                                <th>Motivo</th>
                                <th>Chave</th>
                                <th>Prestadores</th>
                                <th>Detalhe</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="admin_qualidade_empty">
                                        Analisando…
                                    </td>
                                </tr>
                            ) : linhas.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="admin_qualidade_empty">
                                        Nenhum grupo duplicado.
                                    </td>
                                </tr>
                            ) : (
                                linhas.map((g) => {
                                    const chave = chaveAvisoQualidade('duplicatas', g)
                                    return (
                                        <tr key={chave}>
                                            <td>
                                                <span className={`admin_qualidade_motivo motivo-${g.motivo}`}>
                                                    {g.motivo}
                                                </span>
                                            </td>
                                            <td className="admin_qualidade_mono">{g.chave}</td>
                                            <td>
                                                <ul className="admin_qualidade_dup_list">
                                                    {(g.itens || []).map((it) => (
                                                        <li key={it.id}>
                                                            {it.href ? (
                                                                <Link to={it.href}>{it.nome}</Link>
                                                            ) : (
                                                                it.nome
                                                            )}{' '}
                                                            <span className="admin_qualidade_id">#{it.id}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </td>
                                            <td>{g.detalhe}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="admin_qualidade_btn_ignorar"
                                                    disabled={busyChave === chave}
                                                    onClick={() => void arquivar('duplicatas', g)}
                                                >
                                                    Ignorar
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                ) : aba === 'arquivados' ? (
                    <table className="admin_qualidade_table">
                        <thead>
                            <tr>
                                <th>Categoria</th>
                                <th>Registro</th>
                                <th>Detalhe</th>
                                <th>Arquivado</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="admin_qualidade_empty">
                                        Analisando…
                                    </td>
                                </tr>
                            ) : linhas.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="admin_qualidade_empty">
                                        Nenhum aviso arquivado.
                                    </td>
                                </tr>
                            ) : (
                                linhas.map((row) => (
                                    <tr key={row.chave}>
                                        <td>{row.categoria}</td>
                                        <td>
                                            <strong>{row.nome}</strong>
                                            {row.href ? (
                                                <div>
                                                    <Link to={row.href} className="admin_qualidade_link">
                                                        Abrir
                                                    </Link>
                                                </div>
                                            ) : null}
                                            {row.itens?.length ? (
                                                <ul className="admin_qualidade_dup_list">
                                                    {row.itens.map((it) => (
                                                        <li key={it.id}>
                                                            {it.href ? (
                                                                <Link to={it.href}>{it.nome}</Link>
                                                            ) : (
                                                                it.nome
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : null}
                                        </td>
                                        <td>{row.detalhe}</td>
                                        <td>
                                            {row.arquivadoEm
                                                ? new Date(row.arquivadoEm).toLocaleString('pt-BR')
                                                : '—'}
                                            {row.arquivadoPorNome ? (
                                                <div className="admin_qualidade_id">{row.arquivadoPorNome}</div>
                                            ) : null}
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                className="admin_qualidade_btn_ignorar"
                                                disabled={busyChave === row.chave}
                                                onClick={() => void restaurar(row.chave)}
                                            >
                                                Restaurar
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                ) : (
                    <table className="admin_qualidade_table">
                        <thead>
                            <tr>
                                <th>Registro</th>
                                <th>Detalhe</th>
                                <th>Ativo</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="admin_qualidade_empty">
                                        Analisando…
                                    </td>
                                </tr>
                            ) : linhas.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="admin_qualidade_empty">
                                        Nenhum problema nesta categoria.
                                    </td>
                                </tr>
                            ) : (
                                linhas.map((row) => {
                                    const chave = chaveAvisoQualidade(aba, row)
                                    return (
                                        <tr key={chave}>
                                            <td>
                                                <strong>{row.nome}</strong>
                                                <div className="admin_qualidade_id">{row.id}</div>
                                            </td>
                                            <td>{row.detalhe}</td>
                                            <td>{row.ativo === false ? 'Não' : 'Sim'}</td>
                                            <td className="admin_qualidade_acoes_cel">
                                                {row.href ? (
                                                    <Link to={row.href} className="admin_qualidade_link">
                                                        Abrir
                                                    </Link>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="admin_qualidade_btn_ignorar"
                                                    disabled={busyChave === chave}
                                                    onClick={() => void arquivar(aba, row)}
                                                >
                                                    Ignorar
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
