import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSfscExclusaoConfirm } from '../../../hooks/useSfscExclusaoConfirm.jsx'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { getReadOnlyFlag } from '../../../lib/supabase'
import {
    carregarConfigFormularioCredenciamento,
    contarProcedimentosPublicadosPorCategoria,
    criarPaginaFormulario,
    excluirPaginaFormulario,
    salvarCategoriasDaPagina,
    salvarOrdemPaginasFormulario,
    atualizarConfigFormulario,
    urlPublicaFormularioCredenciamento,
} from '../../../lib/formularioCredenciamento'

const AUTOSAVE_MS = 650

function reorderList(lista, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return lista
    const next = [...lista]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    return next
}

function serializarPaginas(paginas) {
    return JSON.stringify(
        paginas.map((p) => ({
            id: p.id,
            ordem: p.ordem,
            titulo: p.titulo,
            categorias: p.categorias.map((c) => c.categoriaId),
        })),
    )
}

function serializarConfig(config) {
    if (!config) return ''
    return JSON.stringify({
        slug: config.slug,
        titulo: config.titulo,
        ativo: config.ativo,
    })
}

function formatarUltimaAlteracao(iso) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString('pt-PT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return ''
    }
}

function rotuloContagem(n) {
    const x = Number(n) || 0
    return x === 1 ? '1 procedimento' : `${x} procedimentos`
}

export default function CredenciamentoFormularioConfig() {
    const { askExclusao, exclusaoToast } = useSfscExclusaoConfirm()
    const somenteLeitura =
        getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.CREDENCIAMENTO_EDIT)

    const [loading, setLoading] = useState(true)
    const [autoEstado, setAutoEstado] = useState('idle')
    const [linkAberto, setLinkAberto] = useState(false)
    const [erro, setErro] = useState('')
    const [okMsg, setOkMsg] = useState('')
    const paginasSalvasRef = useRef(null)
    const configSalvaRef = useRef(null)
    const hidratadoRef = useRef(false)
    const [config, setConfig] = useState(null)
    const [paginas, setPaginas] = useState([])
    const [todasCategorias, setTodasCategorias] = useState([])
    const [paginaSelecionadaId, setPaginaSelecionadaId] = useState(null)
    const [dragPaginaIdx, setDragPaginaIdx] = useState(null)
    const [dragCatIdx, setDragCatIdx] = useState(null)
    const [contagemPorCategoria, setContagemPorCategoria] = useState(() => new Map())
    const [ultimaAlteracao, setUltimaAlteracao] = useState(null)

    const linkPublico = useMemo(
        () => urlPublicaFormularioCredenciamento(config?.slug),
        [config?.slug],
    )

    const paginaSelecionada = useMemo(
        () => paginas.find((p) => p.id === paginaSelecionadaId) || null,
        [paginas, paginaSelecionadaId],
    )

    const idsCategoriasUsadas = useMemo(() => {
        const s = new Set()
        paginas.forEach((p) => p.categorias.forEach((c) => s.add(c.categoriaId)))
        return s
    }, [paginas])

    const categoriasDisponiveis = useMemo(
        () => todasCategorias.filter((c) => !idsCategoriasUsadas.has(Number(c.id))),
        [todasCategorias, idsCategoriasUsadas],
    )

    const contagemPorPagina = useMemo(() => {
        const mapa = new Map()
        for (const p of paginas) {
            let total = 0
            for (const c of p.categorias) {
                total += contagemPorCategoria.get(Number(c.categoriaId)) || 0
            }
            mapa.set(p.id, total)
        }
        return mapa
    }, [paginas, contagemPorCategoria])

    const recarregarContagens = useCallback(async () => {
        try {
            const mapa = await contarProcedimentosPublicadosPorCategoria()
            setContagemPorCategoria(mapa)
        } catch {
            /* opcional */
        }
    }, [])

    const recarregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const pack = await carregarConfigFormularioCredenciamento()
            setConfig(pack.config)
            setPaginas(pack.paginas)
            setTodasCategorias(pack.todasCategorias)
            setUltimaAlteracao(pack.config?.updated_at || null)
            void recarregarContagens()
            setPaginaSelecionadaId((atual) => {
                if (atual && pack.paginas.some((p) => p.id === atual)) return atual
                return pack.paginas[0]?.id ?? null
            })
            paginasSalvasRef.current = serializarPaginas(pack.paginas)
            configSalvaRef.current = serializarConfig(pack.config)
            hidratadoRef.current = true
            setAutoEstado('idle')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [recarregarContagens])

    useEffect(() => {
        void recarregar()
    }, [recarregar])

    const atualizarPaginaLocal = (paginaId, patch) => {
        setPaginas((prev) => prev.map((p) => (p.id === paginaId ? { ...p, ...patch } : p)))
    }

    const persistirPaginas = useCallback(async () => {
        const snap = serializarPaginas(paginas)
        if (paginasSalvasRef.current === snap) return
        setAutoEstado('saving')
        setErro('')
        try {
            await salvarOrdemPaginasFormulario(paginas)
            for (const p of paginas) {
                await salvarCategoriasDaPagina(
                    p.id,
                    p.categorias.map((c) => ({ categoriaId: c.categoriaId })),
                )
            }
            paginasSalvasRef.current = snap
            setUltimaAlteracao(new Date().toISOString())
            setAutoEstado('saved')
            void recarregarContagens()
        } catch (e) {
            setAutoEstado('error')
            setErro(e?.message || String(e))
        }
    }, [paginas, recarregarContagens])

    const persistirConfig = useCallback(async () => {
        if (!config) return
        const snap = serializarConfig(config)
        if (configSalvaRef.current === snap) return
        setAutoEstado('saving')
        setErro('')
        try {
            await atualizarConfigFormulario({
                slug: config.slug,
                titulo: config.titulo,
                ativo: config.ativo,
            })
            configSalvaRef.current = snap
            setUltimaAlteracao(new Date().toISOString())
            setAutoEstado('saved')
        } catch (e) {
            setAutoEstado('error')
            setErro(e?.message || String(e))
        }
    }, [config])

    useEffect(() => {
        if (!hidratadoRef.current || loading || somenteLeitura) return undefined
        const snap = serializarPaginas(paginas)
        if (paginasSalvasRef.current === snap) return undefined
        setAutoEstado('pending')
        const t = setTimeout(() => void persistirPaginas(), AUTOSAVE_MS)
        return () => clearTimeout(t)
    }, [paginas, loading, somenteLeitura, persistirPaginas])

    useEffect(() => {
        if (!hidratadoRef.current || loading || somenteLeitura || !config) return undefined
        const snap = serializarConfig(config)
        if (configSalvaRef.current === snap) return undefined
        setAutoEstado('pending')
        const t = setTimeout(() => void persistirConfig(), AUTOSAVE_MS)
        return () => clearTimeout(t)
    }, [config, loading, somenteLeitura, persistirConfig])

    const onDropPagina = (toIndex) => {
        if (dragPaginaIdx == null) return
        setPaginas((prev) => {
            const reordered = reorderList(prev, dragPaginaIdx, toIndex).map((p, i) => ({
                ...p,
                ordem: i + 1,
            }))
            return reordered
        })
        setDragPaginaIdx(null)
    }

    const onDropCategoria = (toIndex) => {
        if (!paginaSelecionada || dragCatIdx == null) return
        atualizarPaginaLocal(paginaSelecionada.id, {
            categorias: reorderList(paginaSelecionada.categorias, dragCatIdx, toIndex),
        })
        setDragCatIdx(null)
    }

    const adicionarCategoriaNaPagina = (cat) => {
        if (!paginaSelecionada || somenteLeitura) return
        const cid = Number(cat.id)
        setPaginas((prev) =>
            prev.map((p) => {
                const semEmOutras = p.categorias.filter((c) => c.categoriaId !== cid)
                if (p.id !== paginaSelecionada.id) {
                    return { ...p, categorias: p.categorias.filter((c) => c.categoriaId !== cid) }
                }
                return {
                    ...p,
                    categorias: [
                        ...semEmOutras,
                        { categoriaId: cid, ordem: semEmOutras.length + 1, nome: cat.nome },
                    ],
                }
            }),
        )
    }

    const removerCategoriaDaPagina = (categoriaId) => {
        if (!paginaSelecionada || somenteLeitura) return
        atualizarPaginaLocal(paginaSelecionada.id, {
            categorias: paginaSelecionada.categorias.filter((c) => c.categoriaId !== categoriaId),
        })
    }

    const copiarLink = async () => {
        try {
            await navigator.clipboard.writeText(linkPublico)
            setOkMsg('Link copiado para a área de transferência.')
        } catch {
            setErro('Não foi possível copiar o link.')
        }
    }

    const rotuloAutoEstado =
        autoEstado === 'saving' || autoEstado === 'pending'
            ? 'A guardar…'
            : autoEstado === 'saved'
              ? 'Guardado'
              : autoEstado === 'error'
                ? 'Erro ao guardar'
                : ''

    return (
        <div className="credenciamento_main fcred_config">
            {exclusaoToast}
            <h1>Credenciamento — Formulário público</h1>
            <p className="pcad_muted fcred_config_sub">
                {ultimaAlteracao
                    ? `Última alteração: ${formatarUltimaAlteracao(ultimaAlteracao)}`
                    : 'Páginas do wizard e categorias exibidas ao parceiro'}
            </p>
            <p className="fcred_config_nav">
                {!somenteLeitura && rotuloAutoEstado && (
                    <span
                        className={`fcred_autosave ${autoEstado === 'error' ? 'is-error' : ''} ${autoEstado === 'saved' ? 'is-ok' : ''}`}
                        aria-live="polite"
                    >
                        {rotuloAutoEstado}
                    </span>
                )}
                <Link
                    to="/credenciamento/formulario/entradas"
                    className="credenciamento_main_action_btn secondary"
                >
                    Inbox de pré-cadastros
                </Link>
            </p>
            <hr />

            {erro && (
                <div className="credenciamento_main_alert" role="alert">
                    <span>{erro}</span>
                    <button type="button" onClick={() => setErro('')} aria-label="Fechar">
                        ×
                    </button>
                </div>
            )}
            {okMsg && (
                <div className="credenciamento_main_alert" role="status">
                    <span>{okMsg}</span>
                    <button type="button" onClick={() => setOkMsg('')} aria-label="Fechar">
                        ×
                    </button>
                </div>
            )}

            <div className="fcred_config_body">
            <section className="fcred_link_collapse fcred_config_link_box">
                <button
                    type="button"
                    className="fcred_link_collapse_btn"
                    aria-expanded={linkAberto}
                    onClick={() => setLinkAberto((v) => !v)}
                >
                    <span>Link e definições gerais</span>
                    <span className="fcred_link_collapse_meta">
                        {config?.ativo ? 'Ativo' : 'Inativo'} · {config?.slug || 'parceiros'}
                    </span>
                    <span className="fcred_link_collapse_chevron" aria-hidden>
                        {linkAberto ? '▾' : '▸'}
                    </span>
                </button>
                {linkAberto && (
                    <div className="fcred_link_box credenciamento_main_detail_box">
                        <div className="fcred_link_row">
                            <input
                                className="credenciamento_main_input fcred_link_input"
                                readOnly
                                value={linkPublico}
                            />
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                onClick={() => void copiarLink()}
                            >
                                Copiar
                            </button>
                            <a
                                className="credenciamento_main_action_btn secondary"
                                href={linkPublico}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Abrir
                            </a>
                        </div>
                        {!somenteLeitura && config && (
                            <div className="fcred_config_meta">
                                <label className="pcad_field">
                                    <span>Slug na URL</span>
                                    <input
                                        className="credenciamento_main_input"
                                        value={config.slug || ''}
                                        onChange={(e) =>
                                            setConfig((c) => ({ ...c, slug: e.target.value.trim() }))
                                        }
                                    />
                                </label>
                                <label className="pcad_field">
                                    <span>Título exibido</span>
                                    <input
                                        className="credenciamento_main_input"
                                        value={config.titulo || ''}
                                        onChange={(e) =>
                                            setConfig((c) => ({ ...c, titulo: e.target.value }))
                                        }
                                    />
                                </label>
                                <label className="fcred_ativo_label">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(config.ativo)}
                                        onChange={(e) =>
                                            setConfig((c) => ({ ...c, ativo: e.target.checked }))
                                        }
                                    />
                                    Formulário ativo
                                </label>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {loading ? (
                <p className="pcad_muted">A carregar…</p>
            ) : (
                <div className="fcred_layout">
                    <aside className="fcred_paginas">
                        <div className="fcred_paginas_head">
                            <h2>Páginas do formulário</h2>
                            {!somenteLeitura && (
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary"
                                    onClick={async () => {
                                        try {
                                            const nova = await criarPaginaFormulario('Nova página')
                                            setPaginas((p) => [...p, nova].sort((a, b) => a.ordem - b.ordem))
                                            setPaginaSelecionadaId(nova.id)
                                        } catch (e) {
                                            setErro(e?.message || String(e))
                                        }
                                    }}
                                >
                                    + Página
                                </button>
                            )}
                        </div>
                        <ul className="fcred_lista">
                            {paginas.map((p, idx) => (
                                <li
                                    key={p.id}
                                    draggable={!somenteLeitura}
                                    onDragStart={() => setDragPaginaIdx(idx)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => onDropPagina(idx)}
                                    className={`fcred_item ${paginaSelecionadaId === p.id ? 'is-on' : ''} ${
                                        (contagemPorPagina.get(p.id) || 0) === 0 ? 'is-empty' : ''
                                    }`}
                                >
                                    <button
                                        type="button"
                                        className="fcred_item_btn"
                                        onClick={() => setPaginaSelecionadaId(p.id)}
                                    >
                                        <span className="fcred_ordem">{p.ordem}</span>
                                        <span className="fcred_item_titulo_wrap">
                                            <input
                                                className="fcred_titulo_input"
                                                value={p.titulo}
                                                disabled={somenteLeitura}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) =>
                                                    atualizarPaginaLocal(p.id, { titulo: e.target.value })
                                                }
                                            />
                                            <span
                                                className={`fcred_proc_count ${
                                                    (contagemPorPagina.get(p.id) || 0) === 0 ? 'is-zero' : ''
                                                }`}
                                            >
                                                {rotuloContagem(contagemPorPagina.get(p.id) || 0)}
                                            </span>
                                        </span>
                                    </button>
                                    {!somenteLeitura && paginas.length > 1 && (
                                        <button
                                            type="button"
                                            className="fcred_rem credenciamento_main_action_btn secondary"
                                            title="Excluir página"
                                            onClick={() => {
                                                askExclusao(
                                                    `Excluir a página «${p.titulo}»? Esta ação não pode ser desfeita.`,
                                                    async () => {
                                                        try {
                                                            await excluirPaginaFormulario(p.id)
                                                            await recarregar()
                                                        } catch (e) {
                                                            setErro(e?.message || String(e))
                                                        }
                                                    },
                                                )
                                            }}
                                        >
                                            ×
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </aside>

                    <main className="fcred_detalhe">
                        {!paginaSelecionada ? (
                            <p className="pcad_muted">Selecione uma página.</p>
                        ) : (
                            <>
                                <div className="fcred_detalhe_head_row">
                                    <p className="fcred_detalhe_resumo pcad_muted">
                                        {paginaSelecionada.categorias.length === 1
                                            ? '1 categoria'
                                            : `${paginaSelecionada.categorias.length} categorias`}
                                        {' · '}
                                        <span
                                            className={
                                                (contagemPorPagina.get(paginaSelecionada.id) || 0) === 0
                                                    ? 'fcred_proc_count is-zero'
                                                    : 'fcred_proc_count'
                                            }
                                        >
                                            {rotuloContagem(contagemPorPagina.get(paginaSelecionada.id) || 0)}{' '}
                                            visíveis
                                        </span>
                                    </p>
                                </div>
                                <ul className="fcred_lista fcred_lista_cats">
                                    {paginaSelecionada.categorias.map((c, idx) => (
                                        <li
                                            key={c.categoriaId}
                                            draggable={!somenteLeitura}
                                            onDragStart={() => setDragCatIdx(idx)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={() => onDropCategoria(idx)}
                                            className="fcred_item fcred_item_cat"
                                        >
                                            <span className="fcred_grip">⋮⋮</span>
                                            <span className="fcred_cat_nome">
                                                {c.nome}
                                                <span className="fcred_proc_count">
                                                    {rotuloContagem(
                                                        contagemPorCategoria.get(Number(c.categoriaId)) || 0,
                                                    )}
                                                </span>
                                            </span>
                                            {!somenteLeitura && (
                                                <button
                                                    type="button"
                                                    className="fcred_rem_cat"
                                                    title="Remover categoria desta página"
                                                    aria-label={`Remover ${c.nome}`}
                                                    onClick={() => removerCategoriaDaPagina(c.categoriaId)}
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                    {paginaSelecionada.categorias.length === 0 && (
                                        <li className="pcad_muted">Nenhuma categoria nesta página.</li>
                                    )}
                                </ul>

                                {!somenteLeitura && categoriasDisponiveis.length > 0 && (
                                    <div className="fcred_pool">
                                        <h3>Adicionar categoria</h3>
                                        <div className="fcred_pool_tags">
                                            {categoriasDisponiveis.map((cat) => (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    className="credenciamento_main_action_btn secondary"
                                                    onClick={() => adicionarCategoriaNaPagina(cat)}
                                                >
                                                    + {cat.nome}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </main>
                </div>
            )}
            </div>

        </div>
    )
}
