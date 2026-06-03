import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { idsEspecialidadeLaboratorio, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'
import { resolverProcedimentosMassaGlobal } from '../../../lib/resolverProcedimentosMassa.js'
import {
    carregarMapaNomesAlternativosPrestador,
    nomeParaHonorariosPdf,
    salvarNomeAlternativoPrestadorProcedimento,
} from '../../../lib/prestadorNomeAlternativo.js'

const CATEGORIA_SERVICO_MIN = 3
const CATEGORIA_SERVICO_MAX = 25

/**
 * Abas por categoria; carrega procedimentos só da aba ativa.
 */
export default function PrestadorServicosAbas({
    prestadorId,
    somenteLeitura,
    selecionadosInicial,
    onChangeSelecionados,
    laboratoriosSelecionadosInicial,
    onChangeLaboratorios,
    onMapaNomeAlternativoChange,
    barraAcoes,
}) {
    const [categorias, setCategorias] = useState([])
    const [abaAtiva, setAbaAtiva] = useState(null)
    const [procedimentosAba, setProcedimentosAba] = useState([])
    const [selecionados, setSelecionados] = useState(() => new Set(selecionadosInicial || []))
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [ordenColuna, setOrdenColuna] = useState('codigo')
    const [ordenDir, setOrdenDir] = useState('asc')

    const [massaAtivo, setMassaAtivo] = useState(false)
    const [textoMassa, setTextoMassa] = useState('')
    const [feedbackMassa, setFeedbackMassa] = useState('')
    const [massaAplicando, setMassaAplicando] = useState(false)

    const [labsAtivo, setLabsAtivo] = useState(false)
    const [laboratoriosCatalogo, setLaboratoriosCatalogo] = useState([])
    const [labsSelecionados, setLabsSelecionados] = useState(() => new Set(laboratoriosSelecionadosInicial || []))
    const [buscaLab, setBuscaLab] = useState('')
    const [sugestoesLabAbertas, setSugestoesLabAbertas] = useState(false)
    const labWrapRef = useRef(null)
    const nomeAltInputRefs = useRef(new Map())
    const [nomesAlternativos, setNomesAlternativos] = useState(() => new Map())
    const [salvandoNomeAlt, setSalvandoNomeAlt] = useState(null)
    const [copiandoNomes, setCopiandoNomes] = useState(false)

    const codigoNorm = (cod) =>
        String(cod || '')
            .trim()
            .toUpperCase()

    useEffect(() => {
        if (!prestadorId) {
            setNomesAlternativos(new Map())
            return
        }
        let cancel = false
        const run = async () => {
            try {
                const mapa = await carregarMapaNomesAlternativosPrestador(prestadorId)
                if (!cancel) setNomesAlternativos(mapa)
            } catch {
                if (!cancel) setNomesAlternativos(new Map())
            }
        }
        void run()
        return () => {
            cancel = true
        }
    }, [prestadorId, selecionadosInicial])

    useEffect(() => {
        onMapaNomeAlternativoChange?.(nomesAlternativos)
    }, [nomesAlternativos, onMapaNomeAlternativoChange])

    useEffect(() => {
        const next = new Set((selecionadosInicial || []).map((c) => String(c).trim()).filter(Boolean))
        setSelecionados(next)
    }, [selecionadosInicial])

    useEffect(() => {
        setLabsSelecionados(new Set(laboratoriosSelecionadosInicial || []))
        if ((laboratoriosSelecionadosInicial || []).length > 0) setLabsAtivo(true)
    }, [laboratoriosSelecionadosInicial])

    useEffect(() => {
        const run = async () => {
            const { data, error } = await supabase
                .from('categorias')
                .select('id, nome')
                .gte('id', CATEGORIA_SERVICO_MIN)
                .lte('id', CATEGORIA_SERVICO_MAX)
                .order('id', { ascending: true })
            if (error) {
                setErro(error.message)
                return
            }
            const lista = data || []
            setCategorias(lista)
            if (lista.length) setAbaAtiva((atual) => (atual == null ? Number(lista[0].id) : atual))
        }
        void run()
    }, [])

    useEffect(() => {
        const run = async () => {
            const { data: esps } = await supabase.from('especialidades').select('id, nome')
            const labIds = idsEspecialidadeLaboratorio(esps || [])
            const { data, error } = await supabase
                .from('prestadores')
                .select('id, nome')
                .in('especialidade_id', labIds)
                .eq('ativo', true)
                .order('nome', { ascending: true })
            if (error) return
            setLaboratoriosCatalogo(data || [])
        }
        void run()
    }, [])

    useEffect(() => {
        if (!abaAtiva) return
        const run = async () => {
            setLoading(true)
            setErro('')
            try {
                const procRes = await supabase
                    .from('procedimentos')
                    .select('codigo, nome, categoria_id')
                    .eq('categoria_id', abaAtiva)
                    .order('codigo', { ascending: true })
                if (procRes.error) {
                    setErro(procRes.error.message)
                    return
                }
                setErro('')
                setProcedimentosAba(procRes.data || [])
            } finally {
                setLoading(false)
            }
        }
        void run()
    }, [abaAtiva])

    const categoriaAtiva = useMemo(
        () => categorias.find((c) => Number(c.id) === Number(abaAtiva)),
        [categorias, abaAtiva],
    )

    const procedimentosOrdenados = useMemo(() => {
        const list = [...procedimentosAba]
        const fator = ordenDir === 'asc' ? 1 : -1
        list.sort((a, b) => {
            if (ordenColuna === 'nome') {
                return (
                    fator *
                    String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
                )
            }
            if (ordenColuna === 'checked') {
                const ca = selecionados.has(String(a.codigo)) ? 1 : 0
                const cb = selecionados.has(String(b.codigo)) ? 1 : 0
                return (ca - cb) * fator
            }
            return (
                fator *
                String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { sensitivity: 'base' })
            )
        })
        return list
    }, [procedimentosAba, ordenColuna, ordenDir, selecionados])

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

    const sugestoesLab = useMemo(() => {
        const seg = normalizarTextoBusca(buscaLab)
        if (seg.length < 2) return []
        const idsSel = labsSelecionados
        return (laboratoriosCatalogo || [])
            .filter((l) => !idsSel.has(Number(l.id)))
            .filter((l) => normalizarTextoBusca(l.nome).includes(seg))
            .slice(0, 10)
    }, [buscaLab, laboratoriosCatalogo, labsSelecionados])

    const laboratoriosVinculados = useMemo(() => {
        const ids = labsSelecionados
        return (laboratoriosCatalogo || []).filter((l) => ids.has(Number(l.id)))
    }, [laboratoriosCatalogo, labsSelecionados])

    const emitirSelecionados = (next) => {
        onChangeSelecionados?.([...next])
    }

    const emitirLabs = (next) => {
        onChangeLaboratorios?.([...next].map(Number).filter(Boolean))
    }

    const toggle = (codigo) => {
        if (somenteLeitura) return
        const cod = String(codigo || '').trim()
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(cod)) next.delete(cod)
            else next.add(cod)
            emitirSelecionados(next)
            return next
        })
    }

    const adicionarLab = (lab) => {
        if (somenteLeitura) return
        const id = Number(lab.id)
        setLabsSelecionados((prev) => {
            const next = new Set(prev)
            next.add(id)
            emitirLabs(next)
            return next
        })
        setBuscaLab('')
        setSugestoesLabAbertas(false)
    }

    const removerLab = (labId) => {
        if (somenteLeitura) return
        setLabsSelecionados((prev) => {
            const next = new Set(prev)
            next.delete(Number(labId))
            emitirLabs(next)
            return next
        })
    }

    const obterNomeAlt = useCallback(
        (codigo) => nomesAlternativos.get(codigoNorm(codigo)) || '',
        [nomesAlternativos],
    )

    const atualizarNomeAltLocal = (codigo, texto) => {
        const cod = codigoNorm(codigo)
        if (!cod) return
        setNomesAlternativos((prev) => {
            const next = new Map(prev)
            const v = String(texto ?? '').trim()
            if (v) next.set(cod, v)
            else next.delete(cod)
            return next
        })
    }

    const persistirNomeAlt = async (codigo, texto) => {
        const cod = codigoNorm(codigo)
        if (!cod) return
        atualizarNomeAltLocal(codigo, texto)
        if (!prestadorId || somenteLeitura) return
        setSalvandoNomeAlt(cod)
        try {
            await salvarNomeAlternativoPrestadorProcedimento(prestadorId, codigo, texto)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setSalvandoNomeAlt(null)
        }
    }

    const processarColagemNomeAltVertical = (event, indiceInicial) => {
        if (somenteLeitura) return
        event.preventDefault()
        const texto = event.clipboardData?.getData('text') || ''
        const linhasColadas = texto
            .replace(/\r/g, '')
            .split('\n')
            .filter((linha) => linha.length > 0)
        if (!linhasColadas.length) return
        void (async () => {
            for (let i = 0; i < linhasColadas.length; i += 1) {
                const proc = procedimentosOrdenados[indiceInicial + i]
                if (!proc) break
                const cel = String(linhasColadas[i].split('\t')[0] ?? '')
                await persistirNomeAlt(proc.codigo, cel)
            }
        })()
    }

    const focarNomeAltLinha = (indice, shift) => {
        const alvo = indice + (shift ? -1 : 1)
        const proc = procedimentosOrdenados[alvo]
        if (!proc) return
        const el = nomeAltInputRefs.current.get(String(proc.codigo))
        el?.focus()
    }

    const copiarNomesProcedimentosSelecionados = async () => {
        const codigosSel = [...selecionados].map(codigoNorm).filter(Boolean)
        if (!codigosSel.length) return
        setCopiandoNomes(true)
        try {
            const rows = []
            const chunk = 80
            for (let i = 0; i < codigosSel.length; i += chunk) {
                const { data, error } = await supabase
                    .from('procedimentos')
                    .select('codigo, nome, categoria_id')
                    .in('codigo', codigosSel.slice(i, i + chunk))
                if (error) throw new Error(error.message)
                rows.push(...(data || []))
            }
            const selSet = new Set(codigosSel)
            const porCategoria = new Map()
            for (const row of rows) {
                const cod = codigoNorm(row.codigo)
                if (!selSet.has(cod)) continue
                const catId = Number(row.categoria_id)
                if (!porCategoria.has(catId)) porCategoria.set(catId, [])
                porCategoria
                    .get(catId)
                    .push(nomeParaHonorariosPdf(row.nome, obterNomeAlt(row.codigo)))
            }
            const partes = []
            const catsOrdenadas =
                categorias.length > 0
                    ? categorias
                    : [...porCategoria.keys()].map((id) => ({ id, nome: `Categoria ${id}` }))
            for (const cat of catsOrdenadas) {
                const nomes = porCategoria.get(Number(cat.id))
                if (!nomes?.length) continue
                nomes.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
                partes.push([String(cat.nome || '').trim(), ...nomes].join('\n'))
            }
            const texto = partes.join('\n\n')
            await navigator.clipboard.writeText(texto)
        } catch (e) {
            setErro(e?.message || 'Não foi possível copiar para a área de transferência.')
        } finally {
            setCopiandoNomes(false)
        }
    }

    const aplicarMassa = async () => {
        if (somenteLeitura || massaAplicando) return
        const idsCat = categorias.map((c) => Number(c.id)).filter(Boolean)
        if (!idsCat.length) {
            setFeedbackMassa('Categorias de serviço ainda não carregadas.')
            return
        }
        setMassaAplicando(true)
        setFeedbackMassa('')
        try {
            const { data, error } = await supabase
                .from('procedimentos')
                .select('codigo, nome, categoria_id')
                .gte('categoria_id', CATEGORIA_SERVICO_MIN)
                .lte('categoria_id', CATEGORIA_SERVICO_MAX)
            if (error) {
                setFeedbackMassa(error.message)
                return
            }
            const { codigos, naoEncontrados, ambiguos } = resolverProcedimentosMassaGlobal(textoMassa, data || [])
            if (!codigos.length && !naoEncontrados.length && !ambiguos.length) {
                setFeedbackMassa('Informe códigos ou nomes separados por vírgula, quebra de linha ou tab.')
                return
            }
            setSelecionados((prev) => {
                const next = new Set(prev)
                codigos.forEach((c) => next.add(String(c)))
                emitirSelecionados(next)
                return next
            })
            const partes = []
            if (codigos.length) partes.push(`${codigos.length} incluído(s) em todas as categorias`)
            if (naoEncontrados.length) {
                partes.push(`não encontrado(s): ${naoEncontrados.slice(0, 12).join(', ')}${naoEncontrados.length > 12 ? '…' : ''}`)
            }
            if (ambiguos.length) {
                const det = ambiguos
                    .slice(0, 5)
                    .map((a) => `"${a.token}" (${a.opcoes.map((o) => o.codigo).join(', ')})`)
                    .join('; ')
                partes.push(`ambíguo(s): ${det}${ambiguos.length > 5 ? '…' : ''}`)
            }
            setFeedbackMassa(partes.join(' · '))
        } finally {
            setMassaAplicando(false)
        }
    }

    return (
        <div className="pcad_servicos">
            <div className="pcad_servicos_opcoes">
                {!somenteLeitura && (
                    <button
                        type="button"
                        className={`credenciamento_main_action_btn secondary pcad_servicos_toggle ${massaAtivo ? 'is-on' : ''}`}
                        onClick={() => setMassaAtivo((v) => !v)}
                    >
                        Inclusão em massa
                    </button>
                )}
                {!somenteLeitura && (
                    <button
                        type="button"
                        className={`credenciamento_main_action_btn secondary pcad_servicos_toggle ${labsAtivo ? 'is-on' : ''}`}
                        onClick={() => setLabsAtivo((v) => !v)}
                    >
                        Laboratórios para solicitar exames
                    </button>
                )}
            </div>

            {!somenteLeitura && massaAtivo && (
                <div className="pcad_servicos_massa">
                    <label className="pcad_servicos_massa_label">
                        Código ou nome (todas as categorias de serviço)
                        <textarea
                            className="credenciamento_main_input pcad_servicos_massa_text"
                            rows={3}
                            placeholder="Cole códigos ou nomes (vírgula, Enter ou tab)"
                            value={textoMassa}
                            onChange={(e) => setTextoMassa(e.target.value)}
                            disabled={massaAplicando}
                        />
                    </label>
                    <div className="pcad_servicos_massa_actions">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            onClick={() => void aplicarMassa()}
                            disabled={massaAplicando || !textoMassa.trim()}
                        >
                            {massaAplicando ? 'Aplicando…' : 'Incluir em todas as categorias'}
                        </button>
                        {feedbackMassa ? <p className="pcad_muted pcad_servicos_massa_feedback">{feedbackMassa}</p> : null}
                    </div>
                </div>
            )}

            {(labsAtivo || (somenteLeitura && laboratoriosVinculados.length > 0)) && (
                <div className="pcad_servicos_labs">
                    {!somenteLeitura && (
                        <label className="pcad_field pcad_servicos_lab_busca">
                            Buscar laboratório
                            <div className="pcad_vet_nome_wrap" ref={labWrapRef}>
                                <input
                                    className="credenciamento_main_input"
                                    value={buscaLab}
                                    placeholder="Digite pelo menos 2 letras"
                                    disabled={somenteLeitura}
                                    onChange={(e) => {
                                        setBuscaLab(e.target.value)
                                        setSugestoesLabAbertas(true)
                                    }}
                                    onFocus={() => setSugestoesLabAbertas(true)}
                                    onBlur={() => setTimeout(() => setSugestoesLabAbertas(false), 150)}
                                />
                                {sugestoesLabAbertas && sugestoesLab.length > 0 && (
                                    <ul className="pcad_sugestoes" role="listbox">
                                        {sugestoesLab.map((s) => (
                                            <li key={s.id}>
                                                <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => adicionarLab(s)}
                                                >
                                                    {s.nome}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </label>
                    )}
                    <ul className="pcad_vet_vinculados pcad_servicos_labs_lista">
                        {laboratoriosVinculados.length === 0 && (
                            <li className="pcad_muted pcad_vet_vinculados_vazio">Nenhum laboratório vinculado.</li>
                        )}
                        {laboratoriosVinculados.map((lab) => (
                            <li key={lab.id}>
                                <span>
                                    <strong>{lab.nome}</strong>
                                </span>
                                {!somenteLeitura && (
                                    <button type="button" className="pcad_link_btn danger" onClick={() => removerLab(lab.id)}>
                                        Remover
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="pcad_servicos_tabs" role="tablist">
                {categorias.map((cat) => (
                    <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        className={`pcad_servicos_tab ${Number(abaAtiva) === Number(cat.id) ? 'is-active' : ''}`}
                        onClick={() => setAbaAtiva(Number(cat.id))}
                    >
                        {cat.nome}
                    </button>
                ))}
            </div>
            {erro && <p className="pcad_erro pcad_servicos_erro">{erro}</p>}

            <div className="pcad_servicos_toolbar">
                <div className="pcad_servicos_count_row">
                    <span className="pcad_servicos_count">
                        {selecionados.size} procedimento(s) selecionado(s) no total
                    </span>
                    <button
                        type="button"
                        className="pcad_servicos_copy_btn"
                        disabled={selecionados.size === 0 || copiandoNomes}
                        title="Copiar nomes dos procedimentos marcados (por categoria)"
                        aria-label="Copiar nomes dos procedimentos marcados para a área de transferência"
                        onClick={() => void copiarNomesProcedimentosSelecionados()}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path
                                fill="currentColor"
                                d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                            />
                        </svg>
                    </button>
                </div>
                {barraAcoes}
            </div>
            <div className="pcad_servicos_panel">
                {loading && (
                    <div className="pcad_servicos_loading" aria-live="polite">
                        <span className="pcad_muted">Atualizando…</span>
                    </div>
                )}
                {procedimentosAba.length > 0 && (
                    <div className="pcad_servicos_sort_bar" role="group" aria-label="Ordenar lista">
                        <span className="pcad_servicos_sort_lbl">Ordenar:</span>
                        <button type="button" className="pcad_servicos_sort_btn" onClick={() => alternarOrdenacao('checked')}>
                            Marcados{indicadorOrdem('checked')}
                        </button>
                        <button type="button" className="pcad_servicos_sort_btn" onClick={() => alternarOrdenacao('codigo')}>
                            Código{indicadorOrdem('codigo')}
                        </button>
                        <button type="button" className="pcad_servicos_sort_btn" onClick={() => alternarOrdenacao('nome')}>
                            Nome{indicadorOrdem('nome')}
                        </button>
                    </div>
                )}
                <div className={`pcad_servicos_lista${loading ? ' is-loading' : ''}`} role="tabpanel">
                    {!loading && procedimentosAba.length === 0 && (
                        <p className="pcad_muted pcad_servicos_vazio">Nenhum procedimento nesta categoria.</p>
                    )}
                    {procedimentosOrdenados.map((p, linhaIndex) => (
                        <div key={p.codigo} className="pcad_servicos_item">
                            <label className="pcad_servicos_item_check">
                                <input
                                    type="checkbox"
                                    checked={selecionados.has(String(p.codigo))}
                                    disabled={somenteLeitura || loading}
                                    onChange={() => toggle(p.codigo)}
                                />
                            </label>
                            <span className="pcad_servicos_item_titulo">
                                <strong>{p.codigo}</strong> — {p.nome}
                            </span>
                            <input
                                ref={(el) => {
                                    if (el) nomeAltInputRefs.current.set(String(p.codigo), el)
                                    else nomeAltInputRefs.current.delete(String(p.codigo))
                                }}
                                type="text"
                                className="credenciamento_main_input pcad_servicos_nome_alt"
                                placeholder="Nome alternativo"
                                value={obterNomeAlt(p.codigo)}
                                disabled={somenteLeitura || loading}
                                title={
                                    salvandoNomeAlt === codigoNorm(p.codigo)
                                        ? 'A guardar…'
                                        : 'Tab: linha seguinte · Cole uma coluna do Excel (Enter entre linhas)'
                                }
                                onChange={(e) => atualizarNomeAltLocal(p.codigo, e.target.value)}
                                onBlur={(e) => void persistirNomeAlt(p.codigo, e.target.value)}
                                onPaste={(e) => processarColagemNomeAltVertical(e, linhaIndex)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Tab') {
                                        e.preventDefault()
                                        focarNomeAltLinha(linhaIndex, e.shiftKey)
                                    }
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
