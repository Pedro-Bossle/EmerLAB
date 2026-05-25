import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { idsEspecialidadeLaboratorio, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'
import { resolverProcedimentosMassaGlobal } from '../../../lib/resolverProcedimentosMassa.js'
import { carregarPortesDb, mapaLetraPorPorteId } from '../../../lib/prestadorProcedimentos.js'

const CATEGORIA_SERVICO_MIN = 3
const CATEGORIA_SERVICO_MAX = 25

/**
 * Abas por categoria; carrega procedimentos só da aba ativa.
 */
export default function PrestadorServicosAbas({
    prestadorId,
    cidadeId,
    somenteLeitura,
    selecionadosInicial,
    onChangeSelecionados,
    laboratoriosSelecionadosInicial,
    onChangeLaboratorios,
}) {
    const [categorias, setCategorias] = useState([])
    const [abaAtiva, setAbaAtiva] = useState(null)
    const [procedimentosAba, setProcedimentosAba] = useState([])
    const [repassesMap, setRepassesMap] = useState(new Map())
    const [selecionados, setSelecionados] = useState(() => new Set(selecionadosInicial || []))
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')

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

    const carregarRepasses = useCallback(async () => {
        if (!cidadeId) return new Map()
        const { data } = await supabase
            .from('repasses')
            .select('procedimento_id, porte_id, valor')
            .eq('cidade_id', cidadeId)
        const portesLista = await carregarPortesDb()
        const letraPorId = mapaLetraPorPorteId(portesLista)
        const mapa = new Map()
        ;(data || []).forEach((r) => {
            const codProc = String(r.procedimento_id || '').trim()
            if (!codProc) return
            if (!mapa.has(codProc)) mapa.set(codProc, { P: '—', M: '—', G: '—' })
            const letra = letraPorId.get(Number(r.porte_id))
            if (letra === 'P' || letra === 'M' || letra === 'G') {
                mapa.get(codProc)[letra] = r.valor != null ? String(r.valor) : '—'
            }
        })
        return mapa
    }, [cidadeId])

    useEffect(() => {
        if (!abaAtiva) return
        const run = async () => {
            setLoading(true)
            setErro('')
            try {
                const [procRes, repMap] = await Promise.all([
                    supabase
                        .from('procedimentos')
                        .select('codigo, nome, categoria_id')
                        .eq('categoria_id', abaAtiva)
                        .order('codigo', { ascending: true }),
                    carregarRepasses(),
                ])
                if (procRes.error) {
                    setErro(procRes.error.message)
                    return
                }
                setErro('')
                setProcedimentosAba(procRes.data || [])
                setRepassesMap(repMap)
            } finally {
                setLoading(false)
            }
        }
        void run()
    }, [abaAtiva, carregarRepasses])

    const categoriaAtiva = useMemo(
        () => categorias.find((c) => Number(c.id) === Number(abaAtiva)),
        [categorias, abaAtiva],
    )

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

    const linhasImpressao = useMemo(() => {
        return procedimentosAba
            .filter((p) => selecionados.has(String(p.codigo)))
            .map((p) => {
                const rep = repassesMap.get(String(p.codigo)) || { P: '—', M: '—', G: '—' }
                return { codigo: p.codigo, nome: p.nome, P: rep.P, M: rep.M, G: rep.G }
            })
    }, [procedimentosAba, selecionados, repassesMap])

    const imprimir = () => {
        const titulo = categoriaAtiva?.nome || 'Serviços'
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px}th{background:#f0f0f0}</style></head><body>
<h1>${titulo}</h1><p>Prestador #${prestadorId || '—'}</p>
<table><thead><tr><th>Código</th><th>Nome</th><th>P</th><th>M</th><th>G</th></tr></thead><tbody>
${linhasImpressao
    .map(
        (l) =>
            `<tr><td>${l.codigo}</td><td>${l.nome}</td><td>${l.P}</td><td>${l.M}</td><td>${l.G}</td></tr>`,
    )
    .join('')}
</tbody></table></body></html>`
        const w = window.open('', '_blank')
        if (!w) return
        w.document.write(html)
        w.document.close()
        w.focus()
        w.print()
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
                <span className="pcad_servicos_count">{selecionados.size} procedimento(s) selecionado(s) no total</span>
                <button type="button" className="credenciamento_main_action_btn secondary" onClick={imprimir} disabled={linhasImpressao.length === 0}>
                    Imprimir aba atual
                </button>
            </div>
            <div className="pcad_servicos_panel">
                {loading && (
                    <div className="pcad_servicos_loading" aria-live="polite">
                        <span className="pcad_muted">Atualizando…</span>
                    </div>
                )}
                <div className={`pcad_servicos_lista${loading ? ' is-loading' : ''}`} role="tabpanel">
                    {!loading && procedimentosAba.length === 0 && (
                        <p className="pcad_muted pcad_servicos_vazio">Nenhum procedimento nesta categoria.</p>
                    )}
                    {procedimentosAba.map((p) => (
                        <label key={p.codigo} className="pcad_servicos_item">
                            <input
                                type="checkbox"
                                checked={selecionados.has(String(p.codigo))}
                                disabled={somenteLeitura || loading}
                                onChange={() => toggle(p.codigo)}
                            />
                            <span>
                                <strong>{p.codigo}</strong> — {p.nome}
                            </span>
                        </label>
                    ))}
                </div>
            </div>
        </div>
    )
}
