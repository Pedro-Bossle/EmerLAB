import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { carregarLinhasHonorariosPrestador } from '../../../lib/credenciamento/carregarLinhasHonorariosPrestador.js'
import {
    downloadImpressaoHonorariosPdf,
    gerarImpressaoHonorariosPdf,
} from '../../../lib/impressaoHonorarios/gerarImpressaoHonorariosPdf.js'
import {
    buildPayloadContratoFromPrestadorForm,
    tipoPdfContratoFromModelo,
} from '../../../lib/credenciamento/prestadorFormParaContrato.js'
import { downloadPdf, gerarPdfBlob, nomeArquivoContrato } from '../../../lib/contratos/pdf/gerarContratoPdf.js'
import { errosValidacao } from '../../../lib/contratos/validarDocumentos.js'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi.js'

const MODELOS_CONTRATO = [
    { id: 'clinica', label: 'Clínica' },
    { id: 'volante_pj', label: 'Volante PJ' },
    { id: 'volante_pf', label: 'Volante PF' },
    { id: 'desconto', label: 'Desconto (parceria)' },
]

function ordenarLinhas(linhas, coluna, dir) {
    const fator = dir === 'asc' ? 1 : -1
    const list = [...linhas]
    list.sort((a, b) => {
        if (coluna === 'checked') {
            const ca = a.checked ? 1 : 0
            const cb = b.checked ? 1 : 0
            return (ca - cb) * fator
        }
        if (coluna === 'codigo') {
            return (
                fator *
                String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { sensitivity: 'base' })
            )
        }
        return (
            fator * String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
        )
    })
    return list
}

export default function PrestadorHonorariosContratos({
    prestadorId,
    prestadorNome,
    codigosSelecionados,
    form,
    nomeEspecialidade,
    podeGerarContrato,
    disabled,
}) {
    const [modalAberto, setModalAberto] = useState(false)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState('')
    const [fonte, setFonte] = useState('')
    const [cidadeTabelaLabel, setCidadeTabelaLabel] = useState('')
    const [categorias, setCategorias] = useState([])
    const [ordenColuna, setOrdenColuna] = useState('codigo')
    const [ordenDir, setOrdenDir] = useState('asc')
    const [gerandoPdf, setGerandoPdf] = useState(false)
    const [menuContratoAberto, setMenuContratoAberto] = useState(false)
    const [gerandoContrato, setGerandoContrato] = useState(false)
    const [toast, setToast] = useState(null)
    const menuRef = useRef(null)

    const pushToast = useCallback((title, body) => {
        setToast({ title, body: String(body || '').trim() || '—' })
    }, [])

    useEffect(() => {
        if (!toast) return undefined
        const id = setTimeout(() => setToast(null), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(id)
    }, [toast])

    const totalLinhas = useMemo(
        () => categorias.reduce((acc, c) => acc + (c.linhas?.length || 0), 0),
        [categorias],
    )

    const categoriasOrdenadas = useMemo(() => {
        return categorias.map((cat) => ({
            ...cat,
            linhas: ordenarLinhas(cat.linhas || [], ordenColuna, ordenDir),
        }))
    }, [categorias, ordenColuna, ordenDir])

    const alternarOrdenacao = (coluna) => {
        if (ordenColuna === coluna) {
            setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setOrdenColuna(coluna)
            setOrdenDir(coluna === 'nome' ? 'asc' : 'asc')
        }
    }

    const indicadorOrdem = (coluna) => {
        if (ordenColuna !== coluna) return ''
        return ordenDir === 'asc' ? ' ▲' : ' ▼'
    }

    const abrirModalHonorarios = useCallback(async () => {
        if (!prestadorId || !codigosSelecionados?.length) return
        setModalAberto(true)
        setCarregando(true)
        setErro('')
        try {
            const res = await carregarLinhasHonorariosPrestador({
                prestadorId,
                codigosSelecionados,
                enderecoUf: form?.endereco_uf,
                enderecoMunicipio: form?.endereco_cidade,
            })
            setFonte(res.fonte)
            setCidadeTabelaLabel(res.cidadeTabelaLabel || '')
            setCategorias(res.categorias)
            if (!res.categorias.length) {
                setErro('Nenhum procedimento selecionado encontrado no catálogo.')
            } else if (res.fonte === 'repasses' && !res.cidadeTabelaLabel) {
                setErro(
                    'Preencha UF e cidade do endereço do prestador, ou vincule o município em Supertabela > Cidades (Gerenciar tabelas).',
                )
            }
        } catch (e) {
            setErro(e?.message || String(e))
            setCategorias([])
        } finally {
            setCarregando(false)
        }
    }, [prestadorId, codigosSelecionados, form])

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

    const gerarPdfHonorarios = async () => {
        setGerandoPdf(true)
        setErro('')
        try {
            const secoes = categoriasOrdenadas.map((cat) => ({
                categoriaId: cat.id,
                categoriaNome: cat.nome,
                linhas: (cat.linhas || []).map((l) => ({
                    codigo: l.codigo,
                    nome: l.nome,
                    procedimento: l.nome,
                    porteP: l.porteP ?? l.P,
                    porteM: l.porteM ?? l.M,
                    porteG: l.porteG ?? l.G,
                    P: l.P,
                    M: l.M,
                    G: l.G,
                    checked: l.checked,
                })),
            }))
            const cidadeNome =
                String(cidadeTabelaLabel || '')
                    .replace(/^Supertabela\s*—\s*Cidades:\s*/i, '')
                    .replace(/\s*\(P\s*\/\s*M\s*\/\s*G\)\s*$/i, '')
                    .trim() ||
                String(form?.endereco_cidade || '').trim()
            const blob = await gerarImpressaoHonorariosPdf({
                secoes,
                cidadeNome,
                prestadorNome,
            })
            downloadImpressaoHonorariosPdf(blob, prestadorNome || cidadeNome)
        } catch (e) {
            setErro(e?.message || 'Falha ao gerar PDF.')
        } finally {
            setGerandoPdf(false)
        }
    }

    const gerarContrato = async (modelo) => {
        setMenuContratoAberto(false)
        if (gerandoContrato) return
        if (!podeGerarContrato) {
            pushToast('Contrato', 'Sem permissão para gerar contratos.')
            return
        }
        const rotulo = MODELOS_CONTRATO.find((m) => m.id === modelo)?.label || modelo
        const tipo = tipoPdfContratoFromModelo(modelo)
        setGerandoContrato(true)
        setToast(null)
        try {
            let dados
            try {
                dados = await buildPayloadContratoFromPrestadorForm(form, modelo, { nomeEspecialidade })
            } catch (e) {
                pushToast(`Contrato — ${rotulo}`, e?.message || 'Erro ao consultar CNPJ.')
                return
            }
            const erros = errosValidacao(tipo, dados)
            if (erros.length) {
                pushToast(`Contrato — ${rotulo}`, erros.map((msg) => `• ${msg}`).join('\n'))
                return
            }
            const blob = await gerarPdfBlob(tipo, dados)
            downloadPdf(blob, nomeArquivoContrato(tipo, dados))
        } catch (e) {
            const msg = e?.message || String(e) || 'Falha ao gerar contrato.'
            pushToast(`Contrato — ${rotulo}`, msg)
        } finally {
            setGerandoContrato(false)
        }
    }

    useEffect(() => {
        if (!menuContratoAberto) return undefined
        const fechar = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenuContratoAberto(false)
        }
        document.addEventListener('mousedown', fechar)
        return () => document.removeEventListener('mousedown', fechar)
    }, [menuContratoAberto])

    const semProcedimentos = !codigosSelecionados?.length

    return (
        <>
            <div className="pcad_honorarios_bar">
                <button
                    type="button"
                    className="credenciamento_main_action_btn secondary"
                    disabled={disabled || semProcedimentos || !prestadorId}
                    onClick={() => void abrirModalHonorarios()}
                    title={semProcedimentos ? 'Selecione procedimentos no perfil' : undefined}
                >
                    Imprimir honorários
                </button>
                <div className="pcad_contrato_menu_wrap" ref={menuRef}>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary"
                        disabled={disabled || !prestadorId || gerandoContrato}
                        aria-expanded={menuContratoAberto}
                        onClick={() => setMenuContratoAberto((v) => !v)}
                    >
                        {gerandoContrato ? 'Gerando contrato…' : 'Gerar contrato…'}
                    </button>
                    {menuContratoAberto && (
                        <ul className="pcad_contrato_menu" role="menu">
                            {MODELOS_CONTRATO.map((m) => (
                                <li key={m.id} role="none">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        disabled={!podeGerarContrato || gerandoContrato}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => void gerarContrato(m.id)}
                                    >
                                        {m.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            {gerandoContrato && (
                <div
                    className="contratos_toast contratos_toast--info pcad_contrato_loading_toast"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                >
                    <div className="contratos_toast_text">
                        <strong>Gerando contrato…</strong>
                        <span className="contratos_toast_body">
                            Consultando CNPJ e montando o PDF. Por favor, não saia desta tela até terminar.
                        </span>
                    </div>
                </div>
            )}
            {toast && !gerandoContrato && (
                <div className="contratos_toast contratos_toast--error" role="alert" aria-live="assertive">
                    <div className="contratos_toast_text">
                        <strong>{toast.title}</strong>
                        <span className="contratos_toast_body">{toast.body}</span>
                    </div>
                    <button
                        type="button"
                        className="contratos_toast_close"
                        onClick={() => setToast(null)}
                        aria-label="Fechar aviso"
                    >
                        ×
                    </button>
                </div>
            )}

            {erro && !modalAberto ? <p className="pcad_erro pcad_honorarios_erro_msg">{erro}</p> : null}

            {modalAberto && (
                <div className="pcad_modal_backdrop" role="presentation" onClick={() => setModalAberto(false)}>
                    <div
                        className="pcad_modal pcad_modal_honorarios"
                        role="dialog"
                        aria-labelledby="pcad-honorarios-titulo"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="pcad_modal_head">
                            <h3 id="pcad-honorarios-titulo">Honorários de Repasse — pré-visualização</h3>
                            <button type="button" className="pcad_modal_close" onClick={() => setModalAberto(false)} aria-label="Fechar">
                                ×
                            </button>
                        </header>
                        <p className="pcad_muted pcad_modal_sub">
                            {prestadorNome}
                            {fonte === 'negociacao'
                                ? ' · valores da negociação'
                                : fonte === 'repasses'
                                  ? cidadeTabelaLabel
                                      ? ` · Supertabela Cidades: ${cidadeTabelaLabel}`
                                      : ' · Supertabela Cidades (P/M/G)'
                                  : ''}
                        </p>
                        {erro && <p className="pcad_erro">{erro}</p>}
                        {carregando && <p className="pcad_muted">A carregar…</p>}
                        {!carregando && totalLinhas > 0 && (
                            <div className="pcad_honorarios_scroll">
                                {categoriasOrdenadas.map((cat) => (
                                    <section key={cat.id} className="pcad_honorarios_cat">
                                        <h4>{cat.nome}</h4>
                                        <table className="pcad_honorarios_table">
                                            <thead>
                                                <tr>
                                                    <th className="pcad_honorarios_th_sort">
                                                        <button type="button" onClick={() => alternarOrdenacao('checked')}>
                                                            ✓{indicadorOrdem('checked')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="pcad_honorarios_link"
                                                            onClick={() => toggleTodasCategoria(cat.id, true)}
                                                        >
                                                            todos
                                                        </button>
                                                        /
                                                        <button
                                                            type="button"
                                                            className="pcad_honorarios_link"
                                                            onClick={() => toggleTodasCategoria(cat.id, false)}
                                                        >
                                                            nenhum
                                                        </button>
                                                    </th>
                                                    <th className="pcad_honorarios_th_sort">
                                                        <button type="button" onClick={() => alternarOrdenacao('codigo')}>
                                                            Código{indicadorOrdem('codigo')}
                                                        </button>
                                                    </th>
                                                    <th className="pcad_honorarios_th_sort">
                                                        <button type="button" onClick={() => alternarOrdenacao('nome')}>
                                                            Nome (alt.){indicadorOrdem('nome')}
                                                        </button>
                                                    </th>
                                                    <th>P</th>
                                                    <th>M</th>
                                                    <th>G</th>
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
                                                        <td
                                                            title={
                                                                l.nomeAlternativo?.trim()
                                                                    ? `Catálogo: ${l.nomeCatalogo || l.nome}`
                                                                    : undefined
                                                            }
                                                        >
                                                            {l.nome}
                                                        </td>
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
                        <footer className="pcad_modal_foot">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                disabled={gerandoPdf || carregando || totalLinhas === 0}
                                onClick={() => void gerarPdfHonorarios()}
                            >
                                {gerandoPdf ? 'A gerar PDF…' : 'Baixar PDF'}
                            </button>
                            <button type="button" className="credenciamento_main_action_btn secondary" onClick={() => setModalAberto(false)}>
                                Fechar
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </>
    )
}
