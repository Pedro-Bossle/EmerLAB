import React, { useEffect, useMemo, useState } from 'react'
import {
    downloadImpressaoHonorariosPdf,
    gerarImpressaoHonorariosPdf,
} from '../../lib/impressaoHonorarios/gerarImpressaoHonorariosPdf.js'
import { resolverMensagensObservacoesPorSecoes } from '../../lib/impressaoHonorarios/honorariosObservacoes.js'
import './ModalImpressaoHonorariosCidade.css'

function formatarValorCelula(valor) {
    if (valor === '' || valor == null) return '—'
    const n = Number(valor)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ordenarLinhas(linhas, coluna, dir) {
    const fator = dir === 'asc' ? 1 : -1
    const list = [...linhas]
    list.sort((a, b) => {
        if (coluna === 'checked') {
            return ((a.checked ? 1 : 0) - (b.checked ? 1 : 0)) * fator
        }
        if (coluna === 'codigo') {
            return (
                fator *
                String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { sensitivity: 'base' })
            )
        }
        return (
            fator *
            String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
        )
    })
    return list
}

function reordenarLista(lista, deIdx, paraIdx) {
    if (deIdx == null || paraIdx == null || deIdx === paraIdx) return lista
    const next = [...lista]
    const [item] = next.splice(deIdx, 1)
    next.splice(paraIdx, 0, item)
    return next
}

function montarCategoriasIniciais(secoes) {
    return (secoes || [])
        .map((secao) => ({
            id: secao.categoriaId,
            nome: secao.categoriaNome || 'Categoria',
            ativa: true,
            linhas: (secao.linhas || []).map((linha) => ({
                codigo: String(linha.codigo || ''),
                nome: String(linha.procedimento || linha.nome || ''),
                porteP: linha.porteP,
                porteM: linha.porteM,
                porteG: linha.porteG,
                P: formatarValorCelula(linha.porteP),
                M: formatarValorCelula(linha.porteM),
                G: formatarValorCelula(linha.porteG),
                checked: true,
            })),
        }))
        .filter((cat) => cat.linhas.length > 0)
}

/**
 * Modal de seleção de procedimentos para PDF de honorários (Supertabela Cidades).
 */
export default function ModalImpressaoHonorariosCidade({ aberto, onClose, cidadeNome, secoes, onErro }) {
    const [categorias, setCategorias] = useState(() => montarCategoriasIniciais(secoes))
    const [ordenColuna, setOrdenColuna] = useState('codigo')
    const [ordenDir, setOrdenDir] = useState('asc')
    const [gerandoPdf, setGerandoPdf] = useState(false)
    const [avancadosAberto, setAvancadosAberto] = useState(false)
    const [dragIdx, setDragIdx] = useState(null)
    const [overIdx, setOverIdx] = useState(null)

    useEffect(() => {
        if (!aberto) return
        setCategorias(montarCategoriasIniciais(secoes))
        setOrdenColuna('codigo')
        setOrdenDir('asc')
        setAvancadosAberto(false)
        setDragIdx(null)
        setOverIdx(null)
    }, [aberto, secoes])

    const categoriasOrdenadas = useMemo(
        () =>
            categorias.map((cat) => ({
                ...cat,
                linhas: ordenarLinhas(cat.linhas || [], ordenColuna, ordenDir),
            })),
        [categorias, ordenColuna, ordenDir],
    )

    const categoriasAtivas = useMemo(
        () => categoriasOrdenadas.filter((cat) => cat.ativa !== false),
        [categoriasOrdenadas],
    )

    const totalLinhas = useMemo(
        () => categoriasAtivas.reduce((acc, c) => acc + (c.linhas?.length || 0), 0),
        [categoriasAtivas],
    )

    const totalMarcados = useMemo(
        () =>
            categoriasAtivas.reduce(
                (acc, c) => acc + (c.linhas || []).filter((l) => l.checked !== false).length,
                0,
            ),
        [categoriasAtivas],
    )

    const totalGruposAtivos = useMemo(
        () => categorias.filter((c) => c.ativa !== false).length,
        [categorias],
    )

    const alternarOrdenacao = (coluna) => {
        if (ordenColuna === coluna) {
            setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'))
            return
        }
        setOrdenColuna(coluna)
        setOrdenDir('asc')
    }

    const indicadorOrdem = (coluna) => {
        if (ordenColuna !== coluna) return ''
        return ordenDir === 'asc' ? ' ▲' : ' ▼'
    }

    const toggleLinha = (categoriaId, codigo) => {
        setCategorias((prev) =>
            prev.map((cat) => {
                if (Number(cat.id) !== Number(categoriaId)) return cat
                return {
                    ...cat,
                    linhas: (cat.linhas || []).map((l) =>
                        String(l.codigo) === String(codigo) ? { ...l, checked: !l.checked } : l,
                    ),
                }
            }),
        )
    }

    const toggleTodasCategoria = (categoriaId, marcar) => {
        setCategorias((prev) =>
            prev.map((cat) => {
                if (Number(cat.id) !== Number(categoriaId)) return cat
                return {
                    ...cat,
                    linhas: (cat.linhas || []).map((l) => ({ ...l, checked: marcar })),
                }
            }),
        )
    }

    const toggleGrupoAtivo = (categoriaId) => {
        setCategorias((prev) =>
            prev.map((cat) =>
                Number(cat.id) === Number(categoriaId) ? { ...cat, ativa: cat.ativa === false } : cat,
            ),
        )
    }

    const onDropCategoria = (paraIdx) => {
        if (dragIdx == null) return
        setCategorias((prev) => reordenarLista(prev, dragIdx, paraIdx))
        setDragIdx(null)
        setOverIdx(null)
    }

    const baixarPdf = async () => {
        setGerandoPdf(true)
        try {
            const secoesPdf = categoriasAtivas.map((cat) => ({
                categoriaId: cat.id,
                categoriaNome: cat.nome,
                linhas: (cat.linhas || []).map((l) => ({
                    codigo: l.codigo,
                    nome: l.nome,
                    procedimento: l.nome,
                    porteP: l.porteP,
                    porteM: l.porteM,
                    porteG: l.porteG,
                    checked: l.checked,
                })),
            }))
            const observacoes = await resolverMensagensObservacoesPorSecoes(secoesPdf)
            const blob = await gerarImpressaoHonorariosPdf({
                cidadeNome,
                secoes: secoesPdf,
                observacoes,
            })
            downloadImpressaoHonorariosPdf(blob, cidadeNome || 'Cidade')
            onClose?.()
        } catch (error) {
            onErro?.(error?.message || 'Falha ao gerar PDF.')
        } finally {
            setGerandoPdf(false)
        }
    }

    if (!aberto) return null

    return (
        <div className="sih_modal_backdrop" role="presentation" onClick={() => onClose?.()}>
            <div
                className="sih_modal"
                role="dialog"
                aria-labelledby="sih-honorarios-titulo"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="sih_modal_head">
                    <h3 id="sih-honorarios-titulo">Honorários — seleção para impressão</h3>
                    <button
                        type="button"
                        className="sih_modal_close"
                        onClick={() => onClose?.()}
                        aria-label="Fechar"
                    >
                        ×
                    </button>
                </header>
                <p className="sih_modal_sub">
                    {cidadeNome ? `Cidade: ${cidadeNome}` : 'Selecione os procedimentos, códigos e valores a imprimir.'}
                    {totalMarcados > 0 ? ` · ${totalMarcados} selecionado(s)` : ''}
                    {categorias.length > 0
                        ? ` · ${totalGruposAtivos}/${categorias.length} grupo(s)`
                        : ''}
                </p>

                <div className={`sih_avancados${avancadosAberto ? ' is-open' : ''}`}>
                    <button
                        type="button"
                        className="sih_avancados_summary"
                        aria-expanded={avancadosAberto}
                        onClick={() => setAvancadosAberto((v) => !v)}
                    >
                        Detalhes avançados
                    </button>
                    {avancadosAberto ? (
                        <div className="sih_avancados_body">
                            <p className="sih_avancados_hint">
                                Arraste para reordenar os grupos no PDF. Desmarque um grupo para não
                                imprimi-lo.
                            </p>
                            {categorias.length === 0 ? (
                                <p className="sih_modal_vazio">Nenhum grupo disponível.</p>
                            ) : (
                                <ul className="sih_reorder_list" aria-label="Ordem dos grupos">
                                    {categorias.map((cat, idx) => {
                                        const ativo = cat.ativa !== false
                                        return (
                                            <li
                                                key={cat.id}
                                                className={`sih_reorder_item${
                                                    overIdx === idx ? ' is-over' : ''
                                                }${dragIdx === idx ? ' is-dragging' : ''}${
                                                    !ativo ? ' is-off' : ''
                                                }`}
                                                draggable
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
                                                    onDropCategoria(idx)
                                                }}
                                            >
                                                <span
                                                    className="sih_reorder_handle"
                                                    aria-hidden="true"
                                                    title="Arrastar"
                                                >
                                                    ⋮⋮
                                                </span>
                                                <label className="sih_reorder_check">
                                                    <input
                                                        type="checkbox"
                                                        checked={ativo}
                                                        onChange={() => toggleGrupoAtivo(cat.id)}
                                                    />
                                                    <span>
                                                        {cat.nome}
                                                        <em>
                                                            {' '}
                                                            ({(cat.linhas || []).length} proc.)
                                                        </em>
                                                    </span>
                                                </label>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </div>
                    ) : null}
                </div>

                {totalLinhas === 0 ? (
                    <p className="sih_modal_vazio">
                        {categorias.length === 0
                            ? 'Nenhum procedimento na tabela atual para imprimir.'
                            : 'Nenhum grupo ativo. Ative ao menos um grupo em Detalhes avançados.'}
                    </p>
                ) : (
                    <div className="sih_honorarios_scroll">
                        {categoriasAtivas.map((cat) => (
                            <section key={cat.id} className="sih_honorarios_cat">
                                <h4>{cat.nome}</h4>
                                <table className="sih_honorarios_table">
                                    <thead>
                                        <tr>
                                            <th className="sih_honorarios_th_sort">
                                                <button type="button" onClick={() => alternarOrdenacao('checked')}>
                                                    ✓{indicadorOrdem('checked')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="sih_honorarios_link"
                                                    onClick={() => toggleTodasCategoria(cat.id, true)}
                                                >
                                                    todos
                                                </button>
                                                /
                                                <button
                                                    type="button"
                                                    className="sih_honorarios_link"
                                                    onClick={() => toggleTodasCategoria(cat.id, false)}
                                                >
                                                    nenhum
                                                </button>
                                            </th>
                                            <th className="sih_honorarios_th_sort">
                                                <button type="button" onClick={() => alternarOrdenacao('codigo')}>
                                                    Código{indicadorOrdem('codigo')}
                                                </button>
                                            </th>
                                            <th className="sih_honorarios_th_sort">
                                                <button type="button" onClick={() => alternarOrdenacao('nome')}>
                                                    Nome{indicadorOrdem('nome')}
                                                </button>
                                            </th>
                                            <th>Porte P</th>
                                            <th>Porte M</th>
                                            <th>Porte G</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cat.linhas.map((l) => (
                                            <tr key={`${cat.id}-${l.codigo}`}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!l.checked}
                                                        onChange={() => toggleLinha(cat.id, l.codigo)}
                                                    />
                                                </td>
                                                <td>{l.codigo}</td>
                                                <td>{l.nome}</td>
                                                <td>{l.P}</td>
                                                <td>{l.M}</td>
                                                <td>{l.G}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>
                        ))}
                    </div>
                )}

                <footer className="sih_modal_foot">
                    <button
                        type="button"
                        className="sih_btn_primario"
                        disabled={gerandoPdf || totalMarcados === 0}
                        onClick={() => void baixarPdf()}
                    >
                        {gerandoPdf ? 'Gerando PDF…' : 'Baixar PDF'}
                    </button>
                    <button type="button" className="sih_btn_secundario" onClick={() => onClose?.()}>
                        Fechar
                    </button>
                </footer>
            </div>
        </div>
    )
}
