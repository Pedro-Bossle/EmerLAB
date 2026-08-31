import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    carregarBeneficiosPrestador,
    carregarCatalogoBeneficios,
    formatarFaixaPercentual,
    gruposDoCatalogo,
    nomeGrupoBeneficioVisivel,
    sincronizarBeneficiosPrestador,
} from '../../lib/credenciamento/prestadorBeneficios.js'
import {
    downloadImpressaoDescontosPdf,
    gerarImpressaoDescontosPdf,
} from '../../lib/impressaoDescontos/gerarImpressaoDescontosPdf.js'
import './PrestadorBeneficiosDescontos.css'

function limparNumeroPct(valor) {
    return String(valor || '').replace(/[^\d.,]/g, '')
}

function parsePct(valor) {
    const n = Number(String(valor ?? '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
}

/**
 * Formulário de descontos: Grupo + Tipo + % de/% até + adicionar + OBS.
 * Pensado para viver na aba «Descontos» junto das categorias de Serviços.
 */
export default function PrestadorBeneficiosDescontos({
    prestadorId,
    prestadorNome,
    cidadeNome,
    somenteLeitura,
    disabled,
    onErro,
    onPacoteChange,
    embutido = false,
    onControleImpressao,
}) {
    const [catalogo, setCatalogo] = useState([])
    /** @type {Record<string, { incluir: boolean, percentual: string, percentualMax: string }>} */
    const [mapa, setMapa] = useState({})
    const [observacoes, setObservacoes] = useState('')
    const [grupoSel, setGrupoSel] = useState('')
    const [tipoSel, setTipoSel] = useState('')
    const [pctDe, setPctDe] = useState('')
    const [pctAte, setPctAte] = useState('')
    const [carregando, setCarregando] = useState(false)
    const [gerandoPdf, setGerandoPdf] = useState(false)
    const [dirty, setDirty] = useState(false)
    const onControleImpressaoRef = useRef(onControleImpressao)
    onControleImpressaoRef.current = onControleImpressao
    const onPacoteChangeRef = useRef(onPacoteChange)
    onPacoteChangeRef.current = onPacoteChange

    const grupos = useMemo(() => gruposDoCatalogo(catalogo), [catalogo])

    const tiposDoGrupo = useMemo(() => {
        if (!grupoSel) return []
        const g = grupos.find((x) => x.codigo === grupoSel)
        return g?.itens || []
    }, [grupos, grupoSel])

    const emitirPacote = useCallback(
        (nextMapa, nextObs) => {
            const itens = Object.entries(nextMapa || {})
                .filter(([, v]) => v?.incluir)
                .map(([beneficioId, v]) => ({
                    beneficioId: Number(beneficioId),
                    percentual: parsePct(v.percentual),
                    percentualMax:
                        v.percentualMax === '' || v.percentualMax == null
                            ? parsePct(v.percentual)
                            : parsePct(v.percentualMax),
                    incluir: true,
                }))
            onPacoteChangeRef.current?.({ itens, observacoes: String(nextObs || '') })
        },
        [],
    )

    const carregar = useCallback(async () => {
        setCarregando(true)
        try {
            const cat = await carregarCatalogoBeneficios()
            setCatalogo(cat)
            const gs = gruposDoCatalogo(cat)
            if (gs.length) setGrupoSel((prev) => prev || gs[0].codigo)

            const nextMapa = {}
            if (prestadorId) {
                const { itens, observacoes: obs } = await carregarBeneficiosPrestador(prestadorId)
                for (const i of itens) {
                    nextMapa[String(i.beneficioId)] = {
                        incluir: i.incluir !== false,
                        percentual: String(i.percentual ?? ''),
                        percentualMax: String(i.percentualMax ?? i.percentual ?? ''),
                    }
                }
                setObservacoes(obs || '')
                emitirPacote(nextMapa, obs || '')
            } else {
                setObservacoes('')
                emitirPacote({}, '')
            }
            setMapa(nextMapa)
            setDirty(false)
        } catch (e) {
            const msg = e?.message || String(e)
            if (/beneficios_catalogo|schema cache|does not exist/i.test(msg)) {
                onErro?.(
                    'Tabelas de benefícios ainda não existem. Execute scripts/sql/beneficios_descontos.sql no Supabase.',
                )
            } else if (/percentual_max/i.test(msg)) {
                onErro?.(
                    'Coluna percentual_max ausente. Execute scripts/sql/beneficios_descontos_faixa.sql no Supabase.',
                )
            } else {
                onErro?.(msg)
            }
        } finally {
            setCarregando(false)
        }
    }, [prestadorId, emitirPacote, onErro])

    useEffect(() => {
        void carregar()
        // eslint-disable-next-line react-hooks/exhaustive-deps -- carregar sob prestadorId
    }, [prestadorId])

    useEffect(() => {
        if (!grupoSel && grupos.length) setGrupoSel(grupos[0].codigo)
    }, [grupos, grupoSel])

    useEffect(() => {
        setTipoSel('')
    }, [grupoSel])

    const itensIncluidos = useMemo(() => {
        return Object.entries(mapa)
            .filter(([, v]) => v?.incluir)
            .map(([id, v]) => {
                const cat = catalogo.find((c) => Number(c.id) === Number(id))
                return {
                    beneficioId: Number(id),
                    codigo: cat?.codigo || '',
                    nome: cat?.nome || '',
                    grupoNome:
                        nomeGrupoBeneficioVisivel(cat?.grupo_nome || cat?.grupo_codigo || '') ||
                        cat?.grupo_nome ||
                        '',
                    percentual: v.percentual,
                    percentualMax: v.percentualMax,
                    faixa: formatarFaixaPercentual(v.percentual, v.percentualMax ?? v.percentual),
                }
            })
            .sort((a, b) =>
                `${a.grupoNome}${a.codigo}`.localeCompare(`${b.grupoNome}${b.codigo}`, 'pt-BR', {
                    sensitivity: 'base',
                }),
            )
    }, [mapa, catalogo])

    const adicionarDesconto = () => {
        if (somenteLeitura || disabled) return
        const id = Number(tipoSel)
        if (!id) {
            onErro?.('Selecione o tipo de desconto.')
            return
        }
        const de = limparNumeroPct(pctDe)
        const ate = limparNumeroPct(pctAte || pctDe)
        if (!de) {
            onErro?.('Informe o percentual.')
            return
        }
        setMapa((prev) => {
            const next = {
                ...prev,
                [String(id)]: {
                    incluir: true,
                    percentual: de,
                    percentualMax: ate || de,
                },
            }
            emitirPacote(next, observacoes)
            return next
        })
        setDirty(true)
        setPctDe('')
        setPctAte('')
        setTipoSel('')
        onErro?.('')
    }

    const removerDesconto = (beneficioId) => {
        if (somenteLeitura || disabled) return
        setMapa((prev) => {
            const next = { ...prev }
            delete next[String(beneficioId)]
            emitirPacote(next, observacoes)
            return next
        })
        setDirty(true)
    }

    const persistirSeDirty = useCallback(async () => {
        if (!prestadorId || somenteLeitura || !dirty) return
        await sincronizarBeneficiosPrestador(prestadorId, {
            itens: Object.entries(mapa)
                .filter(([, v]) => v?.incluir)
                .map(([beneficioId, v]) => ({
                    beneficioId: Number(beneficioId),
                    percentual: parsePct(v.percentual),
                    percentualMax:
                        v.percentualMax === '' || v.percentualMax == null
                            ? parsePct(v.percentual)
                            : parsePct(v.percentualMax),
                    incluir: true,
                })),
            observacoes,
        })
        setDirty(false)
    }, [prestadorId, somenteLeitura, dirty, mapa, observacoes])

    const imprimirPdf = useCallback(async () => {
        setGerandoPdf(true)
        try {
            await persistirSeDirty()
            const itens = itensIncluidos.map((i) => ({
                incluir: true,
                percentual: parsePct(i.percentual),
                percentualMax: parsePct(i.percentualMax ?? i.percentual),
                nome: i.nome,
                grupoNome: i.grupoNome,
                codigo: i.codigo,
            }))
            const blob = await gerarImpressaoDescontosPdf({
                itens,
                observacoes,
                prestadorNome,
                cidadeNome,
            })
            downloadImpressaoDescontosPdf(blob, prestadorNome)
        } catch (e) {
            onErro?.(e?.message || 'Falha ao gerar PDF de descontos.')
        } finally {
            setGerandoPdf(false)
        }
    }, [persistirSeDirty, itensIncluidos, observacoes, prestadorNome, cidadeNome, onErro])

    const bloqueado = disabled || somenteLeitura || carregando

    useEffect(() => {
        onControleImpressaoRef.current?.({
            imprimir: imprimirPdf,
            disabled: bloqueado || gerandoPdf || itensIncluidos.length === 0,
            gerando: gerandoPdf,
            total: itensIncluidos.length,
        })
    }, [imprimirPdf, bloqueado, gerandoPdf, itensIncluidos.length])

    return (
        <div className={`pcad_beneficios${embutido ? ' is-embutido' : ''}`}>
            {!embutido ? (
                <div className="pcad_beneficios_head">
                    <p className="pcad_muted">
                        Escolha o grupo e o tipo, informe a faixa de desconto e adicione. A impressão usa Descontos.pdf.
                    </p>
                    <div className="pcad_honorarios_bar">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            disabled={bloqueado || gerandoPdf || itensIncluidos.length === 0}
                            onClick={() => void imprimirPdf()}
                        >
                            {gerandoPdf ? 'Gerando PDF…' : 'Imprimir benefícios'}
                        </button>
                    </div>
                </div>
            ) : null}

            {carregando ? <p className="pcad_muted">Carregando catálogo…</p> : null}

            {!somenteLeitura ? (
                <div className="pcad_beneficios_form">
                    <label className="pcad_field pcad_beneficios_campo_grupo">
                        <span>Grupo</span>
                        <select
                            className="credenciamento_main_input"
                            value={grupoSel}
                            disabled={bloqueado}
                            onChange={(e) => setGrupoSel(e.target.value)}
                        >
                            <option value="">—</option>
                            {grupos.map((g) => (
                                <option key={g.codigo} value={g.codigo}>
                                    {g.nome || g.codigo}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="pcad_field pcad_beneficios_campo_tipo">
                        <span>Tipo</span>
                        <select
                            className="credenciamento_main_input"
                            value={tipoSel}
                            disabled={bloqueado || !grupoSel}
                            onChange={(e) => setTipoSel(e.target.value)}
                        >
                            <option value="">—</option>
                            {tiposDoGrupo.map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                    {t.nome}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="pcad_beneficios_pct_clip">
                        <label className="pcad_field pcad_beneficios_pct">
                            <span>% de</span>
                            <input
                                className="credenciamento_main_input"
                                inputMode="decimal"
                                value={pctDe}
                                disabled={bloqueado}
                                placeholder="5"
                                onChange={(e) => setPctDe(limparNumeroPct(e.target.value))}
                            />
                        </label>
                        <label className="pcad_field pcad_beneficios_pct">
                            <span>% até</span>
                            <input
                                className="credenciamento_main_input"
                                inputMode="decimal"
                                value={pctAte}
                                disabled={bloqueado}
                                placeholder="10"
                                onChange={(e) => setPctAte(limparNumeroPct(e.target.value))}
                            />
                        </label>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn pcad_beneficios_add"
                            title="Adicionar desconto"
                            disabled={bloqueado || !tipoSel || !pctDe}
                            onClick={adicionarDesconto}
                        >
                            +
                        </button>
                    </div>
                </div>
            ) : null}

            <ul className="pcad_beneficios_lista">
                {itensIncluidos.length === 0 && !carregando ? (
                    <li className="pcad_muted pcad_beneficios_lista_vazia">Nenhum desconto adicionado.</li>
                ) : null}
                {itensIncluidos.map((i) => (
                    <li key={i.beneficioId}>
                        <span>
                            <strong>{i.grupoNome}</strong>
                            {' — '}
                            {i.nome}
                            {' — '}
                            {i.faixa}
                        </span>
                        {!somenteLeitura ? (
                            <button
                                type="button"
                                className="pcad_link_btn danger"
                                disabled={bloqueado}
                                onClick={() => removerDesconto(i.beneficioId)}
                            >
                                Remover
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>

            <label className="pcad_field pcad_beneficios_obs">
                <span>OBS</span>
                <textarea
                    className="credenciamento_main_input"
                    rows={4}
                    value={observacoes}
                    disabled={bloqueado}
                    placeholder="Observações (exibidas no PDF)"
                    onChange={(e) => {
                        setObservacoes(e.target.value)
                        setDirty(true)
                        emitirPacote(mapa, e.target.value)
                    }}
                />
            </label>
        </div>
    )
}
