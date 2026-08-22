import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../../components/ui'
import { supabase } from '../../../lib/supabase.js'
import { listarUsuariosParaAtribuicao } from '../../../lib/homeTarefas.js'
import { UFS_BRASIL } from '../../../lib/ibgeLocalidades.js'
import {
    COLUNAS_KANBAN,
    assinarCardsKanbanLive,
    atualizarCardKanban,
    atribuirCardsKanbanEmMassa,
    buscarPrestadoresParaMencao,
    buscarEspecialidadesKanban,
    criarCardKanban,
    criarPrestadorMinimoParaCard,
    especialidadeVisivelKanban,
    excluirCardKanban,
    filtrarCardsKanban,
    formatarDataRelativaKanban,
    importacaoSituacoesJaFeita,
    importarSituacoesParaKanban,
    listarCardsKanban,
    montarResumoRelatorioKanban,
    moverCardKanban,
    podeMoverColunaKanban,
} from '../../../lib/credKanban.js'
import { baixarTextoComoArquivo } from '../../../lib/auditoriaLogs.js'
import { getStoredAccessProfile, podeLerFerramenta } from '../../../lib/accessControl.js'
import KanbanOutlookReuniao from '../../../components/Outlook/KanbanOutlookReuniao.jsx'
import {
    corpoVisivelSemMetaOutlook,
    lerMetaOutlookReuniao,
    escreverMetaOutlookReuniao,
} from '../../../lib/credenciamento/kanbanOutlookMeta.js'
import './CredenciamentoKanban.css'

async function listarUsuariosParaAtribuicaoComEmail() {
    const { data, error } = await supabase.from('profiles').select('id, name, email').order('name')
    if (error) {
        const base = await listarUsuariosParaAtribuicao()
        return base.map((u) => ({ ...u, email: '' }))
    }
    return (data || []).map((u) => ({
        id: u.id,
        nome: u.name || u.id,
        email: String(u.email || '').trim().toLowerCase(),
    }))
}

function queryMencaoNoNome(valor) {
    const m = String(valor || '').match(/@([^\s@]*)$/)
    return m ? m[1] : null
}

/** Remove `@` do nome ao persistir. */
function nomeSemArroba(valor) {
    return String(valor || '')
        .replace(/@/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Substitui o trecho `@query` no fim pelo nome escolhido (sem @). */
function aplicarMencaoNoNome(valorAtual, nomeEscolhido) {
    const base = String(valorAtual || '').replace(/@[^\s@]*$/, '')
    const limpo = String(nomeEscolhido || '').replace(/@/g, '').trim()
    return `${base}${limpo}`.replace(/\s+/g, ' ').trim()
}

/** Extrai checklist estilo GitHub (`- [ ]` / `- [x]`) do markdown. */
function checklistDeMarkdown(texto) {
    return parseChecklistMarkdownLinhas(texto).map((item) => ({
        id: item.id,
        texto: item.texto,
        feito: item.feito,
    }))
}

function parseChecklistMarkdownLinhas(texto) {
    const linhas = String(texto || '').split(/\r?\n/)
    const out = []
    for (let i = 0; i < linhas.length; i += 1) {
        const m = linhas[i].match(/^(\s*[-*]\s+)\[([ xX])\](\s+)(.*)$/)
        if (!m) continue
        const textoItem = String(m[4] || '').trim()
        out.push({
            id: `md-${i}`,
            lineIndex: i,
            prefix: m[1],
            mid: m[3],
            texto: textoItem || '…',
            feito: String(m[2]).toLowerCase() === 'x',
        })
    }
    return out
}

function alternarChecklistNaLinha(texto, lineIndex) {
    const linhas = String(texto || '').split(/\r?\n/)
    const i = Number(lineIndex)
    if (!Number.isFinite(i) || i < 0 || i >= linhas.length) return texto
    const linha = linhas[i]
    if (/\[ \]/i.test(linha) || /\[\s\]/.test(linha)) {
        linhas[i] = linha.replace(/\[\s\]/, '[x]')
    } else if (/\[[xX]\]/.test(linha)) {
        linhas[i] = linha.replace(/\[[xX]\]/, '[ ]')
    } else {
        return texto
    }
    return linhas.join('\n')
}

export default function CredenciamentoKanban() {
    const [cards, setCards] = useState([])
    const [usuarios, setUsuarios] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [cardAberto, setCardAberto] = useState(null)
    const [mostrarRelatorio, setMostrarRelatorio] = useState(false)
    const [dragId, setDragId] = useState(null)
    const [importFeito, setImportFeito] = useState(true)

    const [filtroUf, setFiltroUf] = useState('')
    const [filtroCidade, setFiltroCidade] = useState('')
    const [filtroEsp, setFiltroEsp] = useState('')
    const [filtroAssignee, setFiltroAssignee] = useState('')
    const [filtroBusca, setFiltroBusca] = useState('')
    const [filtroDe, setFiltroDe] = useState('')
    const [filtroAte, setFiltroAte] = useState('')
    const [especialidades, setEspecialidades] = useState([])
    const [selecionados, setSelecionados] = useState(() => new Set())
    const [assignMassa, setAssignMassa] = useState('')
    const [assignBusy, setAssignBusy] = useState(false)
    const [colunaMobile, setColunaMobile] = useState(COLUNAS_KANBAN[0].id)
    const [filtrosAbertos, setFiltrosAbertos] = useState(false)

    const podeRelatorio = podeLerFerramenta(
        getStoredAccessProfile()?.permissions,
        'credenciamento.processos_relatorio',
    )

    const mapaUsuarios = useMemo(() => {
        const m = new Map()
        for (const u of usuarios) m.set(u.id, u.nome)
        return m
    }, [usuarios])

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [lista, users, sits, feito, esps] = await Promise.all([
                listarCardsKanban(),
                listarUsuariosParaAtribuicaoComEmail().catch(() => listarUsuariosParaAtribuicao()),
                supabase.from('situacoes').select('id, descricao, codigo').then((r) => r.data || []),
                importacaoSituacoesJaFeita().catch(() => false),
                supabase.from('especialidades').select('id, nome').order('nome').then((r) => {
                    if (r.error) return []
                    return r.data || []
                }),
            ])
            setCards(lista)
            setUsuarios(users)
            setSituacoes(sits)
            setImportFeito(feito)
            setEspecialidades(Array.isArray(esps) ? esps : [])
        } catch (e) {
            setErro(e?.message || String(e))
            if (/cred_kanban_cards|schema cache|does not exist/i.test(String(e?.message || ''))) {
                setAviso('Tabela do Kanban ausente. Execute scripts/sql/cred_kanban_cards.sql no Supabase.')
            }
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    useEffect(() => {
        return assinarCardsKanbanLive(() => {
            void listarCardsKanban()
                .then(setCards)
                .catch(() => {})
        })
    }, [])

    const cardsFiltrados = useMemo(
        () =>
            filtrarCardsKanban(cards, {
                uf: filtroUf,
                cidade: filtroCidade,
                tipo: filtroEsp,
                atribuidoA: filtroAssignee,
                busca: filtroBusca,
                dataDe: filtroDe,
                dataAte: filtroAte,
            }),
        [cards, filtroUf, filtroCidade, filtroEsp, filtroAssignee, filtroBusca, filtroDe, filtroAte],
    )

    const porColuna = useMemo(() => {
        const m = Object.fromEntries(COLUNAS_KANBAN.map((c) => [c.id, []]))
        for (const card of cardsFiltrados) {
            if (m[card.coluna]) m[card.coluna].push(card)
        }
        for (const id of Object.keys(m)) {
            m[id].sort((a, b) => a.ordem - b.ordem || a.id - b.id)
        }
        return m
    }, [cardsFiltrados])

    const onDragStart = (e, cardId) => {
        setDragId(cardId)
        e.dataTransfer.setData('text/plain', String(cardId))
        e.dataTransfer.effectAllowed = 'move'
    }

    const moverPara = useCallback(
        async (cardId, colunaId) => {
            const id = Number(cardId)
            const card = cards.find((c) => Number(c.id) === id)
            if (!card || !colunaId) return
            if (!podeMoverColunaKanban(card.coluna, colunaId)) {
                setErro(`Não é permitido mover de «${card.coluna}» para esta coluna.`)
                return
            }
            if (card.coluna === colunaId) return
            const ordem = (porColuna[colunaId]?.length || 0) + 1
            try {
                setErro('')
                const atualizado = await moverCardKanban(id, colunaId, ordem, { situacoes })
                setCards((prev) => prev.map((c) => (Number(c.id) === id ? atualizado : c)))
                setColunaMobile(colunaId)
            } catch (err) {
                setErro(err?.message || String(err))
            }
        },
        [cards, porColuna, situacoes]
    )

    const onDropColuna = async (e, colunaId) => {
        e.preventDefault()
        const id = Number(e.dataTransfer.getData('text/plain') || dragId)
        setDragId(null)
        if (!id) return
        await moverPara(id, colunaId)
    }

    const novoCard = async (colunaId = 'nao_contatado') => {
        try {
            const coluna = COLUNAS_KANBAN.some((c) => c.id === colunaId) ? colunaId : 'nao_contatado'
            const criado = await criarCardKanban({
                coluna,
                nome: 'Novo contato',
            })
            setCards((prev) => [...prev, criado])
            setColunaMobile(coluna)
            setCardAberto(criado)
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }

    const toggleSelecionado = (cardId, e) => {
        e?.stopPropagation?.()
        const id = Number(cardId)
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const selecionarTodosVisiveis = (lista) => {
        setSelecionados((prev) => {
            const next = new Set(prev)
            const ids = (lista || []).map((c) => Number(c.id))
            const todosJa = ids.length > 0 && ids.every((id) => next.has(id))
            if (todosJa) {
                for (const id of ids) next.delete(id)
            } else {
                for (const id of ids) next.add(id)
            }
            return next
        })
    }

    const limparSelecao = () => {
        setSelecionados(new Set())
        setAssignMassa('')
    }

    const aplicarAssignMassa = async () => {
        const ids = [...selecionados]
        if (!ids.length) return
        setAssignBusy(true)
        setErro('')
        try {
            const atualizados = await atribuirCardsKanbanEmMassa(ids, assignMassa || null)
            const mapa = new Map(atualizados.map((c) => [Number(c.id), c]))
            setCards((prev) => prev.map((c) => mapa.get(Number(c.id)) || c))
            if (cardAberto && mapa.has(Number(cardAberto.id))) {
                setCardAberto(mapa.get(Number(cardAberto.id)))
            }
            setAviso(
                assignMassa
                    ? `Responsável atribuído a ${ids.length} card(s).`
                    : `Responsável removido de ${ids.length} card(s).`,
            )
            limparSelecao()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAssignBusy(false)
        }
    }

    const rodarImport = async () => {
        try {
            const r = await importarSituacoesParaKanban({ forcar: false })
            if (r.jaFeito) {
                setAviso('Importação de situações já foi feita anteriormente.')
            } else {
                setAviso(`Importação concluída: ${r.criados} card(s).`)
                await carregar()
            }
            setImportFeito(true)
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }

    const salvarCard = async (patch) => {
        if (!cardAberto) return
        const atualizado = await atualizarCardKanban(cardAberto.id, patch)
        setCardAberto(atualizado)
        setCards((prev) => prev.map((c) => (Number(c.id) === Number(atualizado.id) ? atualizado : c)))
    }

    const exportarRelatorio = () => {
        const resumo = montarResumoRelatorioKanban(cardsFiltrados)
        const linhas = [
            ['coluna', 'total', 'tempo_medio_dias'].join(','),
            ...COLUNAS_KANBAN.map((col) =>
                [
                    col.label,
                    resumo.porColuna[col.id]?.total ?? 0,
                    resumo.tempoMedioDiasNaColuna[col.id] != null
                        ? resumo.tempoMedioDiasNaColuna[col.id].toFixed(1)
                        : '',
                ].join(','),
            ),
            '',
            'assignee,total',
            ...resumo.porAssignee.map((a) => `${a.id},${a.total}`),
        ]
        baixarTextoComoArquivo(
            `kanban-credenciamento-${new Date().toISOString().slice(0, 10)}.csv`,
            `\uFEFF${linhas.join('\n')}`,
        )
    }

    const etapas = [
        { id: 'contato', titulo: 'Contato Inicial' },
        { id: 'cadastro', titulo: 'Cadastro e Pós' },
    ]

    const nSel = selecionados.size
    const cardsColunaMobile = porColuna[colunaMobile] || []
    const todosMobileMarcados =
        cardsColunaMobile.length > 0 && cardsColunaMobile.every((c) => selecionados.has(Number(c.id)))

    const renderCard = (card, { compact = false } = {}) => {
        const marcado = selecionados.has(Number(card.id))
        return (
            <article
                key={card.id}
                className={`cred_kanban_card${dragId === card.id ? ' is-dragging' : ''}${marcado ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`}
                draggable={!compact}
                onDragStart={compact ? undefined : (e) => onDragStart(e, card.id)}
                onClick={() => setCardAberto(card)}
            >
                <div className="cred_kanban_card_topo">
                    <label
                        className="cred_kanban_card_check"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) => toggleSelecionado(card.id, e)}
                            aria-label={`Selecionar ${card.nome || card.id}`}
                        />
                    </label>
                    <strong>{card.nome}</strong>
                </div>
                <p>{[card.cidade, card.uf].filter(Boolean).join(' / ') || '—'}</p>
                {!compact ? <p>{card.telefone || '—'}</p> : null}
                {card.especialidade || especialidadeVisivelKanban(card.tipo) ? (
                    <span className="cred_kanban_tag" title="Especialidade principal">
                        {card.especialidade || especialidadeVisivelKanban(card.tipo)}
                    </span>
                ) : null}
                {card.atribuidoA ? (
                    <span className="cred_kanban_assignee">
                        @{mapaUsuarios.get(card.atribuidoA) || 'user'}
                    </span>
                ) : (
                    <span className="cred_kanban_assignee is-empty">sem responsável</span>
                )}
                {card.coluna === 'reuniao' && lerMetaOutlookReuniao(card.corpo) ? (
                    <span className="cred_kanban_tag cred_kanban_tag_outlook" title="Evento no Outlook">
                        Outlook
                    </span>
                ) : null}
                {compact ? (
                    <div
                        className="cred_kanban_card_mover"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <label>
                            <span>Mover para</span>
                            <select
                                value=""
                                aria-label={`Mover ${card.nome || card.id} para outra coluna`}
                                onChange={(e) => {
                                    const dest = e.target.value
                                    if (dest) void moverPara(card.id, dest)
                                }}
                            >
                                <option value="" disabled>
                                    Escolher coluna…
                                </option>
                                {COLUNAS_KANBAN.filter(
                                    (c) =>
                                        c.id !== card.coluna &&
                                        podeMoverColunaKanban(card.coluna, c.id)
                                ).map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                ) : null}
                {!compact ? (
                    <footer title={new Date(card.atualizadoEm || card.criadoEm).toLocaleString('pt-BR')}>
                        <span>Criado {formatarDataRelativaKanban(card.criadoEm)}</span>
                        <span>Atual. {formatarDataRelativaKanban(card.atualizadoEm)}</span>
                    </footer>
                ) : (
                    <footer title={new Date(card.atualizadoEm || card.criadoEm).toLocaleString('pt-BR')}>
                        <span>{formatarDataRelativaKanban(card.atualizadoEm)}</span>
                    </footer>
                )}
            </article>
        )
    }

    return (
        <div className={`el-page cred_kanban${nSel ? ' has-bulk' : ''}`}>
            <PageHeader
                kicker="Credenciamento"
                title="Processos"
                description="Funil Kanban live — Contato Inicial e Cadastro/Pós. Arraste os cards entre colunas."
                actions={
                    <div className="cred_kanban_acoes">
                        <button type="button" onClick={() => void carregar()} disabled={loading}>
                            Atualizar
                        </button>
                        {!importFeito ? (
                            <button type="button" onClick={() => void rodarImport()}>
                                Importar situações
                            </button>
                        ) : null}
                        {podeRelatorio ? (
                            <button type="button" onClick={() => setMostrarRelatorio(true)}>
                                Relatório
                            </button>
                        ) : null}
                    </div>
                }
            />

            {aviso ? <div className="cred_kanban_aviso">{aviso}</div> : null}
            {erro ? <div className="cred_kanban_erro">{erro}</div> : null}

            <div className="cred_kanban_filtros_wrap">
                <button
                    type="button"
                    className="cred_kanban_filtros_toggle"
                    aria-expanded={filtrosAbertos}
                    onClick={() => setFiltrosAbertos((v) => !v)}
                >
                    Filtros {filtrosAbertos ? '▴' : '▾'}
                </button>
                <section
                    className={`cred_kanban_filtros${filtrosAbertos ? ' is-open' : ''}`}
                    aria-label="Filtros"
                >
                <label>
                    <span>UF</span>
                    <select value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)}>
                        <option value="">Todas</option>
                        {UFS_BRASIL.map((u) => (
                            <option key={u} value={u}>
                                {u}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Cidade</span>
                    <input value={filtroCidade} onChange={(e) => setFiltroCidade(e.target.value)} />
                </label>
                <label>
                    <span>Especialidade</span>
                    <input
                        value={filtroEsp}
                        onChange={(e) => setFiltroEsp(e.target.value)}
                        list="cred_kanban_esp_filtro"
                        placeholder="Principal…"
                    />
                    <datalist id="cred_kanban_esp_filtro">
                        {especialidades.map((e) => (
                            <option key={e.id} value={e.nome} />
                        ))}
                    </datalist>
                </label>
                <label>
                    <span>Assignee</span>
                    <select value={filtroAssignee} onChange={(e) => setFiltroAssignee(e.target.value)}>
                        <option value="">Todos</option>
                        {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.nome}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Adicionado de</span>
                    <input type="date" value={filtroDe} onChange={(e) => setFiltroDe(e.target.value)} />
                </label>
                <label>
                    <span>Até</span>
                    <input type="date" value={filtroAte} onChange={(e) => setFiltroAte(e.target.value)} />
                </label>
                <label className="cred_kanban_filtro_busca">
                    <span>Busca</span>
                    <input
                        value={filtroBusca}
                        onChange={(e) => setFiltroBusca(e.target.value)}
                        placeholder="Nome, telefone…"
                    />
                </label>
                </section>
            </div>

            {loading ? <p className="cred_kanban_loading">Carregando board…</p> : null}

            {/* Mobile: uma coluna por vez */}
            <section className="cred_kanban_mobile" aria-label="Kanban mobile">
                <div className="cred_kanban_mobile_chips" role="tablist" aria-label="Colunas">
                    {COLUNAS_KANBAN.map((col) => (
                        <button
                            key={col.id}
                            type="button"
                            role="tab"
                            aria-selected={colunaMobile === col.id}
                            className={`cred_kanban_mobile_chip${colunaMobile === col.id ? ' is-active' : ''}`}
                            onClick={() => setColunaMobile(col.id)}
                        >
                            <span>{col.label}</span>
                            <em>{porColuna[col.id]?.length || 0}</em>
                        </button>
                    ))}
                </div>
                <div className="cred_kanban_mobile_coluna">
                    <header className="cred_kanban_mobile_coluna_head">
                        <div className="cred_kanban_mobile_coluna_titulo">
                            <label className="cred_kanban_card_check">
                                <input
                                    type="checkbox"
                                    checked={todosMobileMarcados}
                                    onChange={() => selecionarTodosVisiveis(cardsColunaMobile)}
                                    aria-label="Selecionar todos nesta coluna"
                                />
                            </label>
                            <h2>{COLUNAS_KANBAN.find((c) => c.id === colunaMobile)?.label}</h2>
                            <em>{cardsColunaMobile.length}</em>
                        </div>
                        <button
                            type="button"
                            className="cred_kanban_col_add"
                            title="Novo card nesta coluna"
                            aria-label="Novo card nesta coluna"
                            onClick={() => void novoCard(colunaMobile)}
                        >
                            +
                        </button>
                    </header>
                    <div className="cred_kanban_mobile_lista">
                        {cardsColunaMobile.length === 0 ? (
                            <p className="cred_kanban_mobile_vazio">Nenhum card nesta coluna.</p>
                        ) : (
                            cardsColunaMobile.map((card) => renderCard(card, { compact: true }))
                        )}
                    </div>
                </div>
            </section>

            {/* Desktop: board completo */}
            <div className="cred_kanban_desktop">
                {etapas.map((etapa) => (
                    <section key={etapa.id} className="cred_kanban_etapa">
                        <h2>{etapa.titulo}</h2>
                        <div className="cred_kanban_colunas">
                            {COLUNAS_KANBAN.filter((c) => c.etapa === etapa.id).map((col) => {
                                const lista = porColuna[col.id] || []
                                const todosMarcados =
                                    lista.length > 0 && lista.every((c) => selecionados.has(Number(c.id)))
                                return (
                                    <div
                                        key={col.id}
                                        className="cred_kanban_coluna"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => void onDropColuna(e, col.id)}
                                    >
                                        <header>
                                            <div className="cred_kanban_coluna_titulo">
                                                <label
                                                    className="cred_kanban_card_check"
                                                    title="Selecionar todos da coluna"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={todosMarcados}
                                                        onChange={() => selecionarTodosVisiveis(lista)}
                                                        aria-label={`Selecionar todos em ${col.label}`}
                                                    />
                                                </label>
                                                <span>{col.label}</span>
                                                <em>{lista.length}</em>
                                            </div>
                                            <button
                                                type="button"
                                                className="cred_kanban_col_add"
                                                title={`Novo card em ${col.label}`}
                                                aria-label={`Novo card em ${col.label}`}
                                                onClick={() => void novoCard(col.id)}
                                            >
                                                +
                                            </button>
                                        </header>
                                        <div className="cred_kanban_coluna_lista">
                                            {lista.map((card) => renderCard(card))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>

            {nSel > 0 ? (
                <div className="cred_kanban_bulk" role="region" aria-label="Atribuição em massa">
                    <span className="cred_kanban_bulk_count">{nSel} selecionado(s)</span>
                    <select
                        value={assignMassa}
                        onChange={(e) => setAssignMassa(e.target.value)}
                        aria-label="Responsável"
                    >
                        <option value="">Sem responsável</option>
                        {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.nome}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="is-primary"
                        disabled={assignBusy}
                        onClick={() => void aplicarAssignMassa()}
                    >
                        {assignBusy ? 'A aplicar…' : 'Atribuir'}
                    </button>
                    <button type="button" onClick={limparSelecao} disabled={assignBusy}>
                        Limpar
                    </button>
                </div>
            ) : null}

            {cardAberto ? (
                <KanbanCardModal
                    card={cardAberto}
                    usuarios={usuarios}
                    especialidades={especialidades}
                    onClose={() => setCardAberto(null)}
                    onSave={async (patch) => {
                        try {
                            await salvarCard(patch)
                        } catch (e) {
                            setErro(e?.message || String(e))
                            throw e
                        }
                    }}
                    onDelete={async () => {
                        await excluirCardKanban(cardAberto.id)
                        setCards((prev) => prev.filter((c) => Number(c.id) !== Number(cardAberto.id)))
                        setSelecionados((prev) => {
                            const next = new Set(prev)
                            next.delete(Number(cardAberto.id))
                            return next
                        })
                        setCardAberto(null)
                    }}
                    onCriarPrestador={async () => {
                        const r = await criarPrestadorMinimoParaCard(cardAberto, { situacoes })
                        setCardAberto(r.card)
                        setCards((prev) =>
                            prev.map((c) => (Number(c.id) === Number(r.card.id) ? r.card : c)),
                        )
                    }}
                />
            ) : null}

            {mostrarRelatorio && podeRelatorio ? (
                <RelatorioKanbanModal
                    cards={cardsFiltrados}
                    mapaUsuarios={mapaUsuarios}
                    onClose={() => setMostrarRelatorio(false)}
                    onExport={exportarRelatorio}
                />
            ) : null}
        </div>
    )
}

function KanbanCardModal({ card, usuarios, especialidades = [], onClose, onSave, onDelete, onCriarPrestador }) {
    const [nome, setNome] = useState(card.nome)
    const [uf, setUf] = useState(card.uf || '')
    const [cidade, setCidade] = useState(card.cidade || '')
    const [telefone, setTelefone] = useState(card.telefone || '')
    const [especialidade, setEspecialidade] = useState(
        () => especialidadeVisivelKanban(card.especialidade || card.tipo) || '',
    )
    const [corpo, setCorpo] = useState(() => corpoVisivelSemMetaOutlook(card.corpo || ''))
    const [atribuidoA, setAtribuidoA] = useState(card.atribuidoA || '')
    const [sugestoesNome, setSugestoesNome] = useState([])
    const [salvando, setSalvando] = useState(false)
    const [excluindo, setExcluindo] = useState(false)
    const [confirmarExclusao, setConfirmarExclusao] = useState(false)
    const [cliquesFora, setCliquesFora] = useState(0)
    const [autocompleteColchete, setAutocompleteColchete] = useState(null)
    const corpoRef = useRef(null)
    const espInputRef = useRef(null)
    const [espFoco, setEspFoco] = useState(false)
    const [sugestoesEsp, setSugestoesEsp] = useState([])
    const [espBalao, setEspBalao] = useState(null)

    const checklistGh = useMemo(() => parseChecklistMarkdownLinhas(corpo), [corpo])

    const atualizarPosBalaoEsp = useCallback(() => {
        const el = espInputRef.current
        if (!el) {
            setEspBalao(null)
            return
        }
        const r = el.getBoundingClientRect()
        setEspBalao({
            top: r.bottom + 8,
            left: r.left,
            width: Math.max(r.width, 180),
        })
    }, [])

    useEffect(() => {
        setNome(card.nome)
        setUf(card.uf || '')
        setCidade(card.cidade || '')
        setTelefone(card.telefone || '')
        setEspecialidade(especialidadeVisivelKanban(card.especialidade || card.tipo) || '')
        setCorpo(corpoVisivelSemMetaOutlook(card.corpo || ''))
        setAtribuidoA(card.atribuidoA || '')
        setSugestoesNome([])
        setAutocompleteColchete(null)
        setConfirmarExclusao(false)
        setCliquesFora(0)
        setEspFoco(false)
        setSugestoesEsp([])
        setEspBalao(null)
    }, [card])

    useEffect(() => {
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = prevOverflow
        }
    }, [])

    useEffect(() => {
        const mostrar = espFoco && sugestoesEsp.length > 0
        if (!mostrar) {
            setEspBalao(null)
            return undefined
        }
        atualizarPosBalaoEsp()
        const onScrollOrResize = () => atualizarPosBalaoEsp()
        window.addEventListener('resize', onScrollOrResize)
        // modal faz scroll no próprio painel
        const modal = espInputRef.current?.closest('.cred_kanban_modal')
        modal?.addEventListener('scroll', onScrollOrResize, { passive: true })
        return () => {
            window.removeEventListener('resize', onScrollOrResize)
            modal?.removeEventListener('scroll', onScrollOrResize)
        }
    }, [espFoco, sugestoesEsp, atualizarPosBalaoEsp])

    useEffect(() => {
        let cancel = false
        const q = String(especialidade || '').trim()
        if (q.length < 3) {
            setSugestoesEsp([])
            return undefined
        }
        const t = setTimeout(() => {
            buscarEspecialidadesKanban(q)
                .then((lista) => {
                    if (cancel) return
                    if (lista.length) {
                        setSugestoesEsp(lista)
                        return
                    }
                    const nq = q.toLowerCase()
                    const local = (especialidades || [])
                        .map((e) => ({
                            id: e.id,
                            nome: especialidadeVisivelKanban(e.nome) || String(e.nome || '').trim(),
                        }))
                        .filter((e) => e.nome && e.nome.toLowerCase().includes(nq))
                        .slice(0, 12)
                    setSugestoesEsp(local)
                })
                .catch(() => {
                    if (cancel) return
                    const nq = q.toLowerCase()
                    setSugestoesEsp(
                        (especialidades || [])
                            .map((e) => ({
                                id: e.id,
                                nome: especialidadeVisivelKanban(e.nome) || String(e.nome || '').trim(),
                            }))
                            .filter((e) => e.nome && e.nome.toLowerCase().includes(nq))
                            .slice(0, 12),
                    )
                })
        }, 200)
        return () => {
            cancel = true
            clearTimeout(t)
        }
    }, [especialidade, especialidades])

    useEffect(() => {
        let cancel = false
        const q = queryMencaoNoNome(nome)
        if (q == null || q.length < 4) {
            setSugestoesNome([])
            return undefined
        }
        const t = setTimeout(() => {
            buscarPrestadoresParaMencao(q)
                .then((lista) => {
                    if (!cancel) setSugestoesNome(lista)
                })
                .catch(() => {})
        }, 250)
        return () => {
            cancel = true
            clearTimeout(t)
        }
    }, [nome])

    const corpoComMeta = (textoVisivel) => {
        const meta = lerMetaOutlookReuniao(card.corpo || '')
        if (!meta?.eventId) return String(textoVisivel || '').trimEnd()
        return escreverMetaOutlookReuniao(textoVisivel, meta)
    }

    const aplicarPrestadorMencao = (p) => {
        const nomeFinal = aplicarMencaoNoNome(nome, p.nome)
        setNome(nomeFinal)
        setSugestoesNome([])
        void onSave({
            prestadorId: p.id,
            nome: nomeSemArroba(nomeFinal),
            uf: p.endereco_uf || uf,
            cidade: p.endereco_cidade || cidade,
            telefone: p.telefone || telefone,
            tipo: p.especialidadePrincipal || especialidade,
        })
        if (p.endereco_uf) setUf(p.endereco_uf)
        if (p.endereco_cidade) setCidade(p.endereco_cidade)
        if (p.telefone) setTelefone(p.telefone)
        if (p.especialidadePrincipal) {
            setEspecialidade(p.especialidadePrincipal)
        }
    }

    const inserirChecklistMarkdown = () => {
        const el = corpoRef.current
        const trecho = '- [ ] '
        if (!el) {
            setCorpo((prev) => `${String(prev || '').replace(/\s*$/, '')}\n${trecho}`)
            return
        }
        const start = el.selectionStart ?? String(corpo).length
        const end = el.selectionEnd ?? start
        const antes = String(corpo).slice(0, start)
        const depois = String(corpo).slice(end)
        const precisaQuebra = antes.length > 0 && !antes.endsWith('\n')
        const inserido = `${precisaQuebra ? '\n' : ''}${trecho}`
        const next = `${antes}${inserido}${depois}`
        setCorpo(next)
        setAutocompleteColchete(null)
        requestAnimationFrame(() => {
            el.focus()
            const pos = start + inserido.length
            el.setSelectionRange(pos, pos)
        })
    }

    const aplicarAutocompleteColchete = () => {
        const el = corpoRef.current
        if (!el || !autocompleteColchete) return
        const { start, insert, cursor } = autocompleteColchete
        const val = String(corpo)
        const next = `${val.slice(0, start)}${insert}${val.slice(start)}`
        setCorpo(next)
        setAutocompleteColchete(null)
        requestAnimationFrame(() => {
            el.focus()
            el.setSelectionRange(cursor, cursor)
        })
    }

    const onCorpoKeyDown = (e) => {
        if (autocompleteColchete && (e.key === 'Tab' || e.key === 'Enter' || e.key === ']')) {
            e.preventDefault()
            aplicarAutocompleteColchete()
            return
        }
        if (autocompleteColchete && e.key === 'Escape') {
            e.preventDefault()
            setAutocompleteColchete(null)
            return
        }
        if (e.key !== '[') return
        if (e.ctrlKey || e.metaKey || e.altKey) return

        const el = e.currentTarget
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? start
        const val = String(corpo)
        if (val[start] === ']') return

        const antes = val.slice(0, start)
        const lineStart = antes.lastIndexOf('\n') + 1
        const prefixoLinha = antes.slice(lineStart)
        const depoisChar = val[end] || ''

        // Já tem fechamento imediato → não sugere
        if (depoisChar === ']') return

        e.preventDefault()

        // Em linha de lista (`- ` / `* `) ou vazia → item de checklist
        if (/^\s*[-*]\s*$/.test(prefixoLinha)) {
            const insert = '[ ] '
            const next = `${val.slice(0, start)}${insert}${val.slice(end)}`
            setCorpo(next)
            setAutocompleteColchete(null)
            requestAnimationFrame(() => {
                el.focus()
                const pos = start + insert.length
                el.setSelectionRange(pos, pos)
            })
            return
        }
        if (/^\s*$/.test(prefixoLinha)) {
            const insert = '- [ ] '
            const next = `${val.slice(0, start)}${insert}${val.slice(end)}`
            setCorpo(next)
            setAutocompleteColchete(null)
            requestAnimationFrame(() => {
                el.focus()
                const pos = start + insert.length
                el.setSelectionRange(pos, pos)
            })
            return
        }

        // Autocomplete: digita `[` e sugere `]` (fecha o checkbox)
        const next = `${val.slice(0, start)}[${val.slice(end)}`
        setCorpo(next)
        setAutocompleteColchete({
            start: start + 1,
            insert: ']',
            cursor: start + 1,
            label: ']',
        })
        requestAnimationFrame(() => {
            el.focus()
            el.setSelectionRange(start + 1, start + 1)
        })
    }

    const onCorpoChange = (e) => {
        setCorpo(e.target.value)
        if (autocompleteColchete) setAutocompleteColchete(null)
    }

    const toggleChecklistGh = (lineIndex) => {
        setCorpo((prev) => alternarChecklistNaLinha(prev, lineIndex))
    }

    const persistir = async () => {
        setSalvando(true)
        try {
            const nomeLimpo = nomeSemArroba(nome)
            setNome(nomeLimpo)
            await onSave({
                nome: nomeLimpo,
                uf,
                cidade,
                telefone,
                tipo: especialidade,
                corpo: corpoComMeta(corpo),
                checklist: checklistDeMarkdown(corpo),
                atribuidoA: atribuidoA || null,
            })
            onClose()
        } catch {
            /* erro já tratado no parent */
        } finally {
            setSalvando(false)
        }
    }

    const confirmarEExcluir = async () => {
        setExcluindo(true)
        try {
            await onDelete()
        } finally {
            setExcluindo(false)
            setConfirmarExclusao(false)
        }
    }

    const onBackdropClick = () => {
        setConfirmarExclusao(false)
        setCliquesFora((n) => {
            const next = n + 1
            if (next >= 2) {
                onClose()
                return 0
            }
            return next
        })
    }

    const salvarCorpoOutlook = async (novoCorpoCompleto) => {
        await onSave({ corpo: novoCorpoCompleto })
        setCorpo(corpoVisivelSemMetaOutlook(novoCorpoCompleto))
    }

    return (
        <div className="cred_kanban_modal_backdrop" role="presentation" onClick={onBackdropClick}>
            <div
                className="cred_kanban_modal"
                role="dialog"
                aria-modal="true"
                onClick={(e) => {
                    e.stopPropagation()
                    setCliquesFora(0)
                }}
            >
                {cliquesFora === 1 ? (
                    <p className="cred_kanban_fechar_dica" role="status">
                        Clique outra vez fora para fechar
                    </p>
                ) : null}
                <header className="cred_kanban_modal_cabecalho">
                    <div>
                        <p className="cred_kanban_modal_kicker">Card #{card.id}</p>
                        <h2>{nome || 'Sem nome'}</h2>
                    </div>
                    <button type="button" onClick={onClose}>
                        Fechar
                    </button>
                </header>

                <section className="cred_kanban_modal_secao" aria-label="Dados do contato">
                    <h3>Dados</h3>
                    <div className="cred_kanban_modal_grid">
                        <label className="cred_kanban_span_full cred_kanban_nome_mencao_wrap">
                            <span>Nome</span>
                            <input
                                value={nome}
                                onChange={(e) => setNome(e.target.value)}
                                placeholder="Digite o nome ou @ para mencionar (a partir de 4 letras)"
                                autoComplete="off"
                            />
                            {sugestoesNome.length > 0 ? (
                                <ul className="cred_kanban_nome_sugestoes" role="listbox">
                                    {sugestoesNome.map((p) => (
                                        <li key={p.id}>
                                            <button
                                                type="button"
                                                onClick={() => aplicarPrestadorMencao(p)}
                                            >
                                                {p.nome}
                                                {p.especialidadePrincipal
                                                    ? ` · ${p.especialidadePrincipal}`
                                                    : ''}{' '}
                                                ({p.endereco_cidade}/{p.endereco_uf})
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </label>
                        <label className="cred_kanban_campo_uf">
                            <span>UF</span>
                            <select value={uf} onChange={(e) => setUf(e.target.value)}>
                                <option value="">—</option>
                                {UFS_BRASIL.map((u) => (
                                    <option key={u} value={u}>
                                        {u}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="cred_kanban_campo_cidade">
                            <span>Cidade</span>
                            <input value={cidade} onChange={(e) => setCidade(e.target.value)} />
                        </label>
                        <label className="cred_kanban_campo_telefone">
                            <span>Telefone</span>
                            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                        </label>
                        <label className="cred_kanban_span_2 cred_kanban_esp_ac_wrap">
                            <span>Especialidade principal</span>
                            <input
                                ref={espInputRef}
                                value={especialidade}
                                onChange={(e) => setEspecialidade(e.target.value)}
                                onFocus={() => {
                                    setEspFoco(true)
                                    requestAnimationFrame(atualizarPosBalaoEsp)
                                }}
                                onBlur={() => {
                                    window.setTimeout(() => setEspFoco(false), 150)
                                }}
                                placeholder="Digite 3+ letras…"
                                autoComplete="off"
                                aria-autocomplete="list"
                                aria-expanded={Boolean(espBalao && sugestoesEsp.length)}
                            />
                            {espFoco && sugestoesEsp.length > 0 && espBalao
                                ? createPortal(
                                      <ul
                                          className="cred_kanban_esp_sugestoes"
                                          role="listbox"
                                          style={{
                                              top: espBalao.top,
                                              left: espBalao.left,
                                              width: espBalao.width,
                                          }}
                                      >
                                          {sugestoesEsp.map((e) => (
                                              <li key={e.id}>
                                                  <button
                                                      type="button"
                                                      onMouseDown={(ev) => {
                                                          ev.preventDefault()
                                                          setEspecialidade(e.nome)
                                                          setSugestoesEsp([])
                                                          setEspFoco(false)
                                                      }}
                                                  >
                                                      {e.nome}
                                                  </button>
                                              </li>
                                          ))}
                                      </ul>,
                                      document.body,
                                  )
                                : null}
                        </label>
                        <label>
                            <span>Assignee</span>
                            <select value={atribuidoA} onChange={(e) => setAtribuidoA(e.target.value)}>
                                <option value="">—</option>
                                {usuarios.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.nome}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    {card.prestadorId ? (
                        <p className="cred_kanban_vinculo cred_kanban_vinculo_dados">
                            Prestador vinculado:{' '}
                            <Link to={`/credenciamento/cadastro/${card.prestadorId}`}>
                                #{card.prestadorId}
                            </Link>
                            <span className="cred_kanban_vinculo_hint"> (via @ no nome)</span>
                        </p>
                    ) : null}
                </section>

                {card.coluna === 'reuniao' ? (
                    <KanbanOutlookReuniao
                        card={card}
                        usuarios={usuarios}
                        corpoAtual={corpoComMeta(corpo)}
                        onSalvarCorpo={salvarCorpoOutlook}
                    />
                ) : null}

                <section className="cred_kanban_modal_full cred_kanban_modal_secao cred_kanban_modal_desc_unica">
                    <div className="cred_kanban_desc_topo">
                        <h3>Descrição</h3>
                        <button type="button" className="cred_kanban_desc_chk_btn" onClick={inserirChecklistMarkdown}>
                            + [ ]
                        </button>
                    </div>
                    <p className="cred_kanban_modal_tip" role="note">
                        <strong>Tip:</strong> digite <code>[</code> para criar item (
                        <code>- [ ]</code>) ou completar com <code>]</code> (Tab/Enter). Checklist vira checkbox
                        estilo GitHub Issues abaixo. Vincule prestador com <code>@</code> no nome (mín. 4 letras).
                    </p>
                    {checklistGh.length > 0 ? (
                        <ul className="cred_kanban_gh_tasks" aria-label="Checklist">
                            {checklistGh.map((item) => (
                                <li
                                    key={item.id}
                                    className={`cred_kanban_gh_task${item.feito ? ' is-done' : ''}`}
                                >
                                    <label>
                                        <input
                                            type="checkbox"
                                            className="cred_kanban_gh_check"
                                            checked={item.feito}
                                            onChange={() => toggleChecklistGh(item.lineIndex)}
                                        />
                                        <span className="cred_kanban_gh_box" aria-hidden />
                                        <span className="cred_kanban_gh_text">{item.texto}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="cred_kanban_corpo_editor_wrap">
                        <textarea
                            ref={corpoRef}
                            rows={12}
                            value={corpo}
                            onChange={onCorpoChange}
                            onKeyDown={onCorpoKeyDown}
                            placeholder={'Notas…\n\n- [ ] Enviar tabela\n- [ ] Agendar reunião'}
                        />
                        {autocompleteColchete ? (
                            <div className="cred_kanban_md_ac" role="listbox" aria-label="Autocomplete markdown">
                                <button
                                    type="button"
                                    className="cred_kanban_md_ac_item is-active"
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        aplicarAutocompleteColchete()
                                    }}
                                >
                                    <code>]</code>
                                    <span>fechar checkbox / item</span>
                                    <kbd>Tab</kbd>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </section>

                <footer className="cred_kanban_modal_footer">
                    <button
                        type="button"
                        className="is-danger"
                        disabled={excluindo || salvando}
                        onClick={() => setConfirmarExclusao(true)}
                    >
                        Excluir
                    </button>
                    <div className="cred_kanban_modal_footer_direita">
                        {!card.prestadorId && card.coluna === 'preenchendo_form' ? (
                            <button type="button" onClick={() => void onCriarPrestador()}>
                                Criar prestador (Preenchendo Form)
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="is-primary"
                            disabled={salvando || excluindo}
                            onClick={() => void persistir()}
                        >
                            {salvando ? 'Salvando…' : 'Salvar'}
                        </button>
                    </div>
                </footer>
                <p className="cred_kanban_modal_meta">
                    Criado {card.criadoEm ? new Date(card.criadoEm).toLocaleString('pt-BR') : '—'} · Atualizado{' '}
                    {card.atualizadoEm ? new Date(card.atualizadoEm).toLocaleString('pt-BR') : '—'}
                </p>
            </div>

            {confirmarExclusao ? (
                <div
                    className="cred_kanban_confirm_backdrop"
                    role="presentation"
                    onClick={(e) => {
                        e.stopPropagation()
                        setConfirmarExclusao(false)
                    }}
                >
                    <div
                        className="cred_kanban_confirm"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="cred-kanban-excluir-titulo"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="cred-kanban-excluir-titulo">Excluir card?</h3>
                        <p>
                            Remover «{nome || `Card #${card.id}`}» do Kanban? Esta ação não pode ser
                            desfeita.
                        </p>
                        <div className="cred_kanban_confirm_acoes">
                            <button
                                type="button"
                                disabled={excluindo}
                                onClick={() => setConfirmarExclusao(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="is-danger"
                                disabled={excluindo}
                                onClick={() => void confirmarEExcluir()}
                            >
                                {excluindo ? 'Excluindo…' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

function RelatorioKanbanModal({ cards, mapaUsuarios, onClose, onExport }) {
    const resumo = useMemo(() => montarResumoRelatorioKanban(cards), [cards])
    return (
        <div className="cred_kanban_modal_backdrop" role="presentation" onClick={onClose}>
            <div className="cred_kanban_modal cred_kanban_modal_relatorio" role="dialog" onClick={(e) => e.stopPropagation()}>
                <header>
                    <h2>Relatório gerencial</h2>
                    <button type="button" onClick={onClose}>
                        Fechar
                    </button>
                </header>
                <p>Total de cards (filtro atual): {resumo.total}</p>
                <p>Em Credenciado (pendentes de SITE): {resumo.siteAposCredenciadoPendentes}</p>
                <p>Já em Adicionar em SITE: {resumo.adicionarSite}</p>
                <table className="cred_kanban_relatorio_table">
                    <thead>
                        <tr>
                            <th>Coluna</th>
                            <th>Total</th>
                            <th>Dias médios desde atualização</th>
                        </tr>
                    </thead>
                    <tbody>
                        {COLUNAS_KANBAN.map((col) => (
                            <tr key={col.id}>
                                <td>{col.label}</td>
                                <td>{resumo.porColuna[col.id]?.total ?? 0}</td>
                                <td>
                                    {resumo.tempoMedioDiasNaColuna[col.id] != null
                                        ? resumo.tempoMedioDiasNaColuna[col.id].toFixed(1)
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <h3>Por assignee</h3>
                <ul>
                    {resumo.porAssignee.map((a) => (
                        <li key={a.id}>
                            {a.id === '(sem assign)' ? a.id : mapaUsuarios.get(a.id) || a.id}: {a.total}
                        </li>
                    ))}
                </ul>
                <footer className="cred_kanban_modal_footer">
                    <button type="button" className="is-primary" onClick={onExport}>
                        Exportar CSV
                    </button>
                </footer>
            </div>
        </div>
    )
}
