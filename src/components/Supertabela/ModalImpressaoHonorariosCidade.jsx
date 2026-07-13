import React, { useEffect, useMemo, useState } from 'react'
import {
    downloadImpressaoHonorariosPdf,
    gerarImpressaoHonorariosPdf,
} from '../../lib/impressaoHonorarios/gerarImpressaoHonorariosPdf.js'
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

function montarCategoriasIniciais(secoes) {
    return (secoes || []).map((secao) => ({
        id: secao.categoriaId,
        nome: secao.categoriaNome || 'Categoria',
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
    })).filter((cat) => cat.linhas.length > 0)
}

/**
 * Modal de seleção de procedimentos para PDF de honorários (Supertabela Cidades).
 */
export default function ModalImpressaoHonorariosCidade({ aberto, onClose, cidadeNome, secoes, onErro }) {
    const [categorias, setCategorias] = useState(() => montarCategoriasIniciais(secoes))
    const [ordenColuna, setOrdenColuna] = useState('codigo')
    const [ordenDir, setOrdenDir] = useState('asc')
    const [gerandoPdf, setGerandoPdf] = useState(false)

    useEffect(() => {
        if (!aberto) return
        setCategorias(montarCategoriasIniciais(secoes))
        setOrdenColuna('codigo')
        setOrdenDir('asc')
    }, [aberto, secoes])

    const categoriasOrdenadas = useMemo(
        () =>
            categorias.map((cat) => ({
                ...cat,
                linhas: ordenarLinhas(cat.linhas || [], ordenColuna, ordenDir),
            })),
        [categorias, ordenColuna, ordenDir],
    )

    const totalLinhas = useMemo(
        () => categorias.reduce((acc, c) => acc + (c.linhas?.length || 0), 0),
        [categorias],
    )

    const totalMarcados = useMemo(
        () =>
            categorias.reduce(
                (acc, c) => acc + (c.linhas || []).filter((l) => l.checked !== false).length,
                0,
            ),
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

    const baixarPdf = async () => {
        setGerandoPdf(true)
        try {
            const blob = await gerarImpressaoHonorariosPdf({
                cidadeNome,
                secoes: categoriasOrdenadas.map((cat) => ({
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
                })),
            })
            downloadImpressaoHonorariosPdf(blob, cidadeNome)
            onClose?.()
        } catch (error) {
            onErro?.(error?.message || 'Falha ao gerar PDF.')
        } finally {
            setGerandoPdf(false)
        }
    }

    if (!aberto) return null

    return (
        <div className='sih_modal_backdrop' role='presentation' onClick={() => onClose?.()}>
            <div
                className='sih_modal'
                role='dialog'
                aria-labelledby='sih-honorarios-titulo'
                onClick={(e) => e.stopPropagation()}
            >
                <header className='sih_modal_head'>
                    <h3 id='sih-honorarios-titulo'>Honorários — seleção para impressão</h3>
                    <button type='button' className='sih_modal_close' onClick={() => onClose?.()} aria-label='Fechar'>
                        ×
                    </button>
                </header>
                <p className='sih_modal_sub'>
                    {cidadeNome ? `Cidade: ${cidadeNome}` : 'Selecione os procedimentos, códigos e valores a imprimir.'}
                    {totalMarcados > 0 ? ` · ${totalMarcados} selecionado(s)` : ''}
                </p>

                {totalLinhas === 0 ? (
                    <p className='sih_modal_vazio'>Nenhum procedimento na tabela atual para imprimir.</p>
                ) : (
                    <div className='sih_honorarios_scroll'>
                        {categoriasOrdenadas.map((cat) => (
                            <section key={cat.id} className='sih_honorarios_cat'>
                                <h4>{cat.nome}</h4>
                                <table className='sih_honorarios_table'>
                                    <thead>
                                        <tr>
                                            <th className='sih_honorarios_th_sort'>
                                                <button type='button' onClick={() => alternarOrdenacao('checked')}>
                                                    ✓{indicadorOrdem('checked')}
                                                </button>
                                                <button
                                                    type='button'
                                                    className='sih_honorarios_link'
                                                    onClick={() => toggleTodasCategoria(cat.id, true)}
                                                >
                                                    todos
                                                </button>
                                                /
                                                <button
                                                    type='button'
                                                    className='sih_honorarios_link'
                                                    onClick={() => toggleTodasCategoria(cat.id, false)}
                                                >
                                                    nenhum
                                                </button>
                                            </th>
                                            <th className='sih_honorarios_th_sort'>
                                                <button type='button' onClick={() => alternarOrdenacao('codigo')}>
                                                    Código{indicadorOrdem('codigo')}
                                                </button>
                                            </th>
                                            <th className='sih_honorarios_th_sort'>
                                                <button type='button' onClick={() => alternarOrdenacao('nome')}>
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
                                                        type='checkbox'
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

                <footer className='sih_modal_foot'>
                    <button
                        type='button'
                        className='sih_btn_primario'
                        disabled={gerandoPdf || totalMarcados === 0}
                        onClick={() => void baixarPdf()}
                    >
                        {gerandoPdf ? 'Gerando PDF…' : 'Baixar PDF'}
                    </button>
                    <button type='button' className='sih_btn_secundario' onClick={() => onClose?.()}>
                        Fechar
                    </button>
                </footer>
            </div>
        </div>
    )
}
