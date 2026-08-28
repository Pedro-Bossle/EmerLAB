import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    layoutRelatorioCadastrosPadrao,
    lerLayoutRelatorioCadastrosSalvo,
    METADADOS_COLUNAS_RELATORIO_CADASTROS,
    METADADOS_RESUMOS_RELATORIO_CADASTROS,
    normalizarLayoutRelatorioCadastros,
    salvarLayoutRelatorioCadastros,
    validarLayoutRelatorioCadastros,
} from '../../../lib/credenciamento/relatorioCadastrosLayout.js'
import './CadastroExportarPdfModal.css'

function ymdHoje() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymdPrimeiroDiaMes() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function reordenarLista(lista, deIdx, paraIdx) {
    if (deIdx == null || paraIdx == null || deIdx === paraIdx) return lista
    const next = [...lista]
    const [item] = next.splice(deIdx, 1)
    next.splice(paraIdx, 0, item)
    return next
}

function ListaReordenavelCampos({
    titulo,
    hint,
    ordem,
    metadados,
    ativoDeId,
    onToggleAtivo,
    onReorder,
    disabled,
}) {
    const [dragIdx, setDragIdx] = useState(null)
    const [overIdx, setOverIdx] = useState(null)

    const onDrop = (paraIdx) => {
        if (dragIdx == null) return
        onReorder(reordenarLista(ordem, dragIdx, paraIdx))
        setDragIdx(null)
        setOverIdx(null)
    }

    return (
        <fieldset className="ccad_exp_fieldset ccad_exp_fieldset--layout" disabled={disabled}>
            <legend>{titulo}</legend>
            {hint ? <p className="ccad_exp_layout_hint">{hint}</p> : null}
            <ul className="ccad_exp_reorder_list" aria-label={titulo}>
                {ordem.map((id, idx) => {
                    const meta = metadados[id]
                    if (!meta) return null
                    const ativo = ativoDeId(id)
                    return (
                        <li
                            key={id}
                            className={`ccad_exp_reorder_item${overIdx === idx ? ' is-over' : ''}${!ativo ? ' is-off' : ''}`}
                            draggable={!disabled}
                            onDragStart={() => setDragIdx(idx)}
                            onDragEnd={() => {
                                setDragIdx(null)
                                setOverIdx(null)
                            }}
                            onDragOver={(e) => {
                                e.preventDefault()
                                setOverIdx(idx)
                            }}
                            onDrop={(e) => {
                                e.preventDefault()
                                onDrop(idx)
                            }}
                        >
                            <span className="ccad_exp_reorder_handle" aria-hidden="true" title="Arrastar">
                                ⋮⋮
                            </span>
                            <label className="ccad_exp_check ccad_exp_check--reorder">
                                <input
                                    type="checkbox"
                                    checked={ativo}
                                    onChange={() => onToggleAtivo(id)}
                                />
                                <span>{meta.label}</span>
                            </label>
                        </li>
                    )
                })}
            </ul>
        </fieldset>
    )
}

/**
 * Modal: período, situações e layout do PDF de cadastros.
 */
export default function CadastroExportarPdfModal({
    aberto,
    onClose,
    onConfirmar,
    exportando = false,
    situacoes = [],
    situacaoIdsIniciais = null,
}) {
    const idsTodas = useMemo(
        () => (situacoes || []).map((s) => Number(s.id)).filter(Boolean),
        [situacoes],
    )

    const [periodoDe, setPeriodoDe] = useState(ymdPrimeiroDiaMes)
    const [periodoAte, setPeriodoAte] = useState(ymdHoje)
    const [situacaoIds, setSituacaoIds] = useState(() => idsTodas)
    const [layout, setLayout] = useState(() => layoutRelatorioCadastrosPadrao())
    const [erroLocal, setErroLocal] = useState('')

    useEffect(() => {
        if (!aberto) return
        setPeriodoDe(ymdPrimeiroDiaMes())
        setPeriodoAte(ymdHoje())
        setErroLocal('')
        setLayout(lerLayoutRelatorioCadastrosSalvo())
        const iniciais = Array.isArray(situacaoIdsIniciais)
            ? situacaoIdsIniciais.map(Number).filter((id) => idsTodas.includes(id))
            : []
        setSituacaoIds(iniciais.length ? iniciais : [...idsTodas])
    }, [aberto, idsTodas, situacaoIdsIniciais])

    const patchLayout = useCallback((patch) => {
        setLayout((prev) => normalizarLayoutRelatorioCadastros({ ...prev, ...patch }))
    }, [])

    const toggleColuna = useCallback((id) => {
        setLayout((prev) => {
            const norm = normalizarLayoutRelatorioCadastros(prev)
            const set = new Set(norm.colunasAtivas)
            if (set.has(id)) {
                if (set.size <= 1) return norm
                set.delete(id)
            } else {
                set.add(id)
            }
            return normalizarLayoutRelatorioCadastros({
                ...norm,
                colunasAtivas: [...set],
            })
        })
    }, [])

    const toggleResumo = useCallback((id) => {
        setLayout((prev) => {
            const norm = normalizarLayoutRelatorioCadastros(prev)
            return normalizarLayoutRelatorioCadastros({
                ...norm,
                resumosAtivos: { ...norm.resumosAtivos, [id]: !norm.resumosAtivos[id] },
            })
        })
    }, [])

    if (!aberto) return null

    const normLayout = normalizarLayoutRelatorioCadastros(layout)
    const todasMarcadas = idsTodas.length > 0 && idsTodas.every((id) => situacaoIds.includes(id))

    const alternarSituacao = (id) => {
        const nid = Number(id)
        setSituacaoIds((prev) =>
            prev.includes(nid) ? prev.filter((x) => x !== nid) : [...prev, nid],
        )
    }

    const alternarTodas = () => {
        setSituacaoIds(todasMarcadas ? [] : [...idsTodas])
    }

    const confirmar = () => {
        setErroLocal('')
        if (!periodoDe || !periodoAte) {
            setErroLocal('Informe a data inicial e a data final.')
            return
        }
        if (periodoDe > periodoAte) {
            setErroLocal('A data inicial não pode ser maior que a data final.')
            return
        }
        if (!situacaoIds.length) {
            setErroLocal('Selecione ao menos uma situação.')
            return
        }
        const layoutFinal = normalizarLayoutRelatorioCadastros(layout)
        const errLayout = validarLayoutRelatorioCadastros(layoutFinal)
        if (errLayout) {
            setErroLocal(errLayout)
            return
        }
        salvarLayoutRelatorioCadastros(layoutFinal)
        onConfirmar?.({
            periodoDe,
            periodoAte,
            situacaoIds: [...situacaoIds],
            layout: layoutFinal,
        })
    }

    return (
        <div
            className="ccad_exp_backdrop"
            role="presentation"
            onClick={() => !exportando && onClose?.()}
        >
            <div
                className="ccad_exp_modal ccad_exp_modal--wide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ccad-exp-titulo"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="ccad_exp_head">
                    <h3 id="ccad-exp-titulo">Exportar relatório PDF</h3>
                    <button
                        type="button"
                        className="ccad_exp_close"
                        aria-label="Fechar"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        ×
                    </button>
                </div>
                <p className="ccad_exp_sub">
                    Período por <strong>Credenciado Em</strong> e situações marcadas (ignora filtros
                    da lista). Escolha o que entra no PDF e arraste para reordenar colunas e resumos.
                </p>

                <div className="ccad_exp_periodo">
                    <label className="ccad_exp_field">
                        <span>De</span>
                        <input
                            type="date"
                            className="ccad_exp_input_date"
                            value={periodoDe}
                            disabled={exportando}
                            max={periodoAte || undefined}
                            onChange={(e) => setPeriodoDe(e.target.value)}
                        />
                    </label>
                    <label className="ccad_exp_field">
                        <span>Até</span>
                        <input
                            type="date"
                            className="ccad_exp_input_date"
                            value={periodoAte}
                            disabled={exportando}
                            min={periodoDe || undefined}
                            onChange={(e) => setPeriodoAte(e.target.value)}
                        />
                    </label>
                </div>

                <fieldset className="ccad_exp_fieldset" disabled={exportando}>
                    <legend>Situações</legend>
                    <div className="ccad_exp_situacoes_toolbar">
                        <button type="button" className="ccad_exp_link_btn" onClick={alternarTodas}>
                            {todasMarcadas ? 'Desmarcar todas' : 'Marcar todas'}
                        </button>
                        <span className="ccad_exp_situacoes_qtd">
                            {situacaoIds.length}/{idsTodas.length}
                        </span>
                    </div>
                    <div className="ccad_exp_situacoes_lista">
                        {(situacoes || []).map((s) => {
                            const id = Number(s.id)
                            return (
                                <label key={id} className="ccad_exp_check">
                                    <input
                                        type="checkbox"
                                        checked={situacaoIds.includes(id)}
                                        onChange={() => alternarSituacao(id)}
                                    />
                                    <span>{s.descricao || `Situação ${id}`}</span>
                                </label>
                            )
                        })}
                        {!idsTodas.length ? (
                            <p className="ccad_exp_sub">Nenhuma situação carregada.</p>
                        ) : null}
                    </div>
                </fieldset>

                <fieldset className="ccad_exp_fieldset ccad_exp_fieldset--secoes" disabled={exportando}>
                    <legend>Seções do PDF</legend>
                    <label className="ccad_exp_check">
                        <input
                            type="checkbox"
                            checked={normLayout.incluirTabelaGeral}
                            onChange={() =>
                                patchLayout({ incluirTabelaGeral: !normLayout.incluirTabelaGeral })
                            }
                        />
                        <span>Tabela geral de cadastros</span>
                    </label>
                    <label className="ccad_exp_check">
                        <input
                            type="checkbox"
                            checked={normLayout.incluirGraficoMeses}
                            onChange={() =>
                                patchLayout({ incluirGraficoMeses: !normLayout.incluirGraficoMeses })
                            }
                        />
                        <span>Gráfico credenciados por mês (quando o período tiver mais de um mês)</span>
                    </label>
                </fieldset>

                {normLayout.incluirTabelaGeral ? (
                    <ListaReordenavelCampos
                        titulo="Colunas da tabela"
                        hint="Marque as colunas desejadas. Arraste ⋮⋮ para alterar a ordem no PDF."
                        ordem={normLayout.ordemColunas}
                        metadados={METADADOS_COLUNAS_RELATORIO_CADASTROS}
                        ativoDeId={(id) => normLayout.colunasAtivas.includes(id)}
                        onToggleAtivo={toggleColuna}
                        onReorder={(ordemColunas) => patchLayout({ ordemColunas })}
                        disabled={exportando}
                    />
                ) : null}

                <ListaReordenavelCampos
                    titulo="Blocos de resumo"
                    hint="Página separada após a tabela. Desmarque o que não quiser exportar."
                    ordem={normLayout.ordemResumos}
                    metadados={METADADOS_RESUMOS_RELATORIO_CADASTROS}
                    ativoDeId={(id) => Boolean(normLayout.resumosAtivos[id])}
                    onToggleAtivo={toggleResumo}
                    onReorder={(ordemResumos) => patchLayout({ ordemResumos })}
                    disabled={exportando}
                />

                {erroLocal ? <p className="ccad_exp_erro">{erroLocal}</p> : null}

                <div className="ccad_exp_acoes">
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        disabled={exportando}
                        onClick={confirmar}
                    >
                        {exportando ? 'Gerando PDF…' : 'Exportar PDF'}
                    </button>
                </div>
            </div>
        </div>
    )
}
