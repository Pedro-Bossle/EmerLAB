import React, { useMemo, useState } from 'react'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import { PageHeader, buttonClassName } from '../../../components/ui'
import {
    ETIQUETAS_POR_PAGINA,
    MODELO_ETIQUETA,
    baixarBlob,
    baixarModeloEtiquetasExcel,
    gerarPdfEtiquetasEndereco,
    normalizarEtiquetaRegistro,
    parseArquivoEtiquetas,
} from '../../../lib/configuracoes/etiquetasEndereco.js'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigImpressaoEtiquetas.css'

const VAZIA = () => ({ nome: '', endereco: '', localidade: '', cep: '' })

const ConfigImpressaoEtiquetas = () => {
    const [itens, setItens] = useState(() => Array.from({ length: ETIQUETAS_POR_PAGINA }, VAZIA))
    const [arquivoNome, setArquivoNome] = useState('')
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [busy, setBusy] = useState('')

    const preenchidos = useMemo(
        () => itens.filter((e) => normalizarEtiquetaRegistro(e).nome || e.endereco || e.cep).length,
        [itens],
    )

    const setCampo = (idx, campo, valor) => {
        setItens((prev) => {
            const next = [...prev]
            next[idx] = { ...next[idx], [campo]: valor }
            return next
        })
    }

    const excluirEtiqueta = (idx) => {
        setItens((prev) => {
            const next = prev.filter((_, i) => i !== idx)
            while (next.length < ETIQUETAS_POR_PAGINA) next.push(VAZIA())
            return next
        })
    }

    const limpar = () => {
        setItens(Array.from({ length: ETIQUETAS_POR_PAGINA }, VAZIA))
        setArquivoNome('')
        setErro('')
        setFeedback('')
    }

    const onArquivos = async (fileListOrArray) => {
        const files = Array.isArray(fileListOrArray)
            ? fileListOrArray.filter(Boolean)
            : Array.from(fileListOrArray || []).filter(Boolean)
        if (!files.length) return
        setBusy('parse')
        setErro('')
        setFeedback('')
        try {
            const todos = []
            const okNomes = []
            const falhas = []
            const limiteTotal = 2000

            for (const file of files) {
                if (todos.length >= limiteTotal) break
                try {
                    const buf = await file.arrayBuffer()
                    const r = await parseArquivoEtiquetas(buf, {
                        nomeArquivo: file.name,
                        limite: limiteTotal - todos.length,
                    })
                    if (!r.ok) {
                        falhas.push(`${file.name}: ${r.erro || 'falha'}`)
                        continue
                    }
                    for (const e of r.itens || []) todos.push({ ...e })
                    okNomes.push(file.name)
                } catch (e) {
                    falhas.push(`${file.name}: ${e?.message || String(e)}`)
                }
            }

            if (!todos.length) {
                setErro(
                    falhas.length
                        ? `Nenhum destinatário importado.\n${falhas.join('\n')}`
                        : 'Nenhum destinatário importado.',
                )
                return
            }

            const lista = todos.map((e) => ({ ...e }))
            while (lista.length < ETIQUETAS_POR_PAGINA) lista.push(VAZIA())
            setItens(lista)
            setArquivoNome(
                okNomes.length === 1
                    ? okNomes[0]
                    : `${okNomes.length} arquivos (${okNomes.slice(0, 3).join(', ')}${okNomes.length > 3 ? '…' : ''})`,
            )
            const pags = Math.ceil(todos.length / ETIQUETAS_POR_PAGINA) || 1
            let msg = `${todos.length} destinatário(s) de ${okNomes.length} arquivo(s) · ${pags} folha(s) ${MODELO_ETIQUETA}.`
            if (falhas.length) msg += ` ${falhas.length} arquivo(s) com erro.`
            setFeedback(msg)
            if (falhas.length) setErro(falhas.join('\n'))
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setBusy('')
        }
    }

    const gerar = async () => {
        setBusy('pdf')
        setErro('')
        setFeedback('')
        try {
            const r = await gerarPdfEtiquetasEndereco(itens)
            if (!r.ok) {
                setErro(r.erro || 'Falha ao gerar PDF.')
                return
            }
            baixarBlob(r.blob, r.nomeArquivo)
            setFeedback(`PDF gerado: ${r.total} etiqueta(s) em ${r.paginas} página(s).`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setBusy('')
        }
    }

    return (
        <div className="el-page credenciamento_main config_etiquetas">
            <PageHeader
                kicker="Configurações"
                title="Impressão de Etiquetas"
                description={`Folha A4 ${MODELO_ETIQUETA}: 14 etiquetas de 99,1×38,1 mm. Importe um ou vários PDFs, Excel ou CSV.`}
            />

            {erro ? (
                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            ) : null}
            {feedback ? (
                <CredenciamentoMainAlert
                    message={feedback}
                    onClose={() => setFeedback('')}
                    role="status"
                />
            ) : null}

            <section className="config_etiquetas_card">
                <h2 className="config_etiquetas_h2">Arquivo</h2>
                <p className="config_etiquetas_hint">
                    Aceita um ou vários <strong>PDFs</strong> (exportação do outro sistema, com texto
                    selecionável), Excel (.xlsx) ou CSV. Os arquivos são unidos na ordem selecionada. Cada
                    folha A4 {MODELO_ETIQUETA} (99,1×38,1 mm) leva até 14 etiquetas.
                </p>
                <div className="config_etiquetas_acoes">
                    <label className={`config_etiquetas_file ${busy === 'parse' ? 'is-busy' : ''}`}>
                        <input
                            type="file"
                            multiple
                            accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                            disabled={Boolean(busy)}
                            onChange={(e) => {
                                // Copiar antes de limpar: FileList é live e zera ao resetar o input
                                const arquivos = Array.from(e.target.files || [])
                                e.target.value = ''
                                void onArquivos(arquivos)
                            }}
                        />
                        {busy === 'parse' ? 'Lendo…' : 'Selecionar PDF(s) / Excel / CSV'}
                    </label>
                    <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary' })}
                        disabled={Boolean(busy)}
                        onClick={() => void baixarModeloEtiquetasExcel()}
                    >
                        Baixar modelo Excel
                    </button>
                    <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary' })}
                        disabled={Boolean(busy)}
                        onClick={limpar}
                    >
                        Limpar
                    </button>
                    <button
                        type="button"
                        className={buttonClassName()}
                        disabled={Boolean(busy) || preenchidos === 0}
                        onClick={() => void gerar()}
                    >
                        {busy === 'pdf' ? 'Gerando…' : 'Gerar PDF para impressão'}
                    </button>
                </div>
                {arquivoNome ? (
                    <p className="config_etiquetas_arquivo">Arquivo: {arquivoNome}</p>
                ) : null}
                <p className="config_etiquetas_meta">
                    {preenchidos} etiqueta(s) com dados ·{' '}
                    {Math.max(1, Math.ceil(preenchidos / ETIQUETAS_POR_PAGINA))} folha(s)
                </p>
            </section>

            <section className="config_etiquetas_card">
                <h2 className="config_etiquetas_h2">Prévia / edição</h2>
                <div className="config_etiquetas_grid" aria-label="Etiquetas">
                    {itens.map((et, idx) => (
                        <article key={idx} className="config_etiquetas_item">
                            <header className="config_etiquetas_item_head">
                                <span>#{idx + 1}</span>
                                <button
                                    type="button"
                                    className={buttonClassName({
                                        variant: 'danger',
                                        size: 'sm',
                                        className: 'config_etiquetas_item_excluir',
                                    })}
                                    disabled={Boolean(busy)}
                                    onClick={() => excluirEtiqueta(idx)}
                                    aria-label={`Excluir etiqueta ${idx + 1}`}
                                    title="Excluir esta etiqueta"
                                >
                                    Excluir
                                </button>
                            </header>
                            <label>
                                Nome
                                <input
                                    value={et.nome}
                                    onChange={(e) => setCampo(idx, 'nome', e.target.value)}
                                    placeholder="NOME COMPLETO"
                                />
                            </label>
                            <label>
                                Endereço
                                <input
                                    value={et.endereco}
                                    onChange={(e) => setCampo(idx, 'endereco', e.target.value)}
                                    placeholder="RUA, NÚMERO"
                                />
                            </label>
                            <label>
                                Bairro — Cidade — UF
                                <input
                                    value={et.localidade}
                                    onChange={(e) => setCampo(idx, 'localidade', e.target.value)}
                                    placeholder="CENTRO - CAXIAS DO SUL - RS"
                                />
                            </label>
                            <label>
                                CEP
                                <input
                                    value={et.cep}
                                    onChange={(e) => setCampo(idx, 'cep', e.target.value)}
                                    placeholder="95000-000"
                                />
                            </label>
                        </article>
                    ))}
                </div>
                {itens.length > ETIQUETAS_POR_PAGINA ? (
                    <p className="config_etiquetas_hint">
                        Há mais de 14 linhas: o PDF usará várias folhas automaticamente.
                    </p>
                ) : null}
                <div className="config_etiquetas_acoes config_etiquetas_acoes_bottom">
                    <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary' })}
                        disabled={Boolean(busy)}
                        onClick={() => setItens((prev) => [...prev, VAZIA()])}
                    >
                        + Linha
                    </button>
                    <button
                        type="button"
                        className={buttonClassName()}
                        disabled={Boolean(busy) || preenchidos === 0}
                        onClick={() => void gerar()}
                    >
                        {busy === 'pdf' ? 'Gerando…' : 'Gerar PDF para impressão'}
                    </button>
                </div>
            </section>
        </div>
    )
}

export default ConfigImpressaoEtiquetas
