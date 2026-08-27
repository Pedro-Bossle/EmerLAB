import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/ui'
import { supabase } from '../../../lib/supabase.js'
import { listarUsuariosParaAtribuicao } from '../../../lib/homeTarefas.js'
import { buscarMunicipiosPorUfRobusto } from '../../../lib/ibgeLocalidades.js'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import {
    COLUNAS_KANBAN,
    ETAPAS_KANBAN,
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
    garantirPerfilSimplesAoPreenchendoForm,
    importacaoSituacoesJaFeita,
    importarSituacoesParaKanban,
    listarCardsKanban,
    montarResumoRelatorioKanban,
    moverCardKanban,
    podeMoverColunaKanban,
    sincronizarPrestadorComCardKanban,
} from '../../../lib/credKanban.js'
import {
    marcarMencoesKanbanCardLidas,
    notificarMencoesKanban,
    queryMencaoUsuarioNoCorpo,
    tokenMencaoUsuario,
} from '../../../lib/credenciamento/kanbanMencoes.js'
import { baixarTextoComoArquivo } from '../../../lib/auditoriaLogs.js'
import { getStoredAccessProfile, podeLerFerramenta } from '../../../lib/accessControl.js'
import KanbanOutlookReuniao from '../../../components/Outlook/KanbanOutlookReuniao.jsx'
import {
    corpoVisivelSemMetaOutlook,
    lerMetaOutlookReuniao,
    escreverMetaOutlookReuniao,
} from '../../../lib/credenciamento/kanbanOutlookMeta.js'
import {
    anexarContatosAdicionaisNaDescricao,
    formatarTelefoneBrExibicao,
    maskTelefoneBr,
    separarTelefonePrincipalEExtras,
} from '../../../lib/telefoneBrasil.js'
import {
    parseColagemCardsKanban,
    pareceColagemTabelaKanban,
} from '../../../lib/credKanbanColagem.js'
import './CredenciamentoKanban.css'

function novaEntradaRascunhoKanban(base = {}) {
    return {
        key: `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nome: base.nome || '',
        uf: base.uf || '',
        cidade: base.cidade || '',
        telefone: base.telefone || '',
        especialidade: base.especialidade || '',
        atribuidoA: base.atribuidoA || '',
        corpo: base.corpo || '',
        prestadorId: base.prestadorId || null,
    }
}

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

/** Contagem de checkboxes do card (markdown do corpo; fallback `checklist`). */
function resumoChecklistCard(card) {
    const doCorpo = parseChecklistMarkdownLinhas(card?.corpo)
    if (doCorpo.length) {
        return {
            total: doCorpo.length,
            feitos: doCorpo.filter((i) => i.feito).length,
        }
    }
    const arr = Array.isArray(card?.checklist) ? card.checklist : []
    return {
        total: arr.length,
        feitos: arr.filter((i) => i?.feito).length,
    }
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
    const [searchParams, setSearchParams] = useSearchParams()
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
    const [filtroAssignee, setFiltroAssignee] = useState(() => getStoredAccessProfile()?.id || '')
    const [filtroBusca, setFiltroBusca] = useState('')
    const [filtroDe, setFiltroDe] = useState('')
    const [filtroAte, setFiltroAte] = useState('')
    const [especialidades, setEspecialidades] = useState([])
    const [selecionados, setSelecionados] = useState(() => new Set())
    const [assignMassa, setAssignMassa] = useState('')
    const [assignBusy, setAssignBusy] = useState(false)
    const [colunaMobile, setColunaMobile] = useState(COLUNAS_KANBAN[0].id)
    const [filtrosAbertos, setFiltrosAbertos] = useState(false)
    const realtimeDebounceRef = useRef(null)
    const assigneeDefaultRef = useRef(Boolean(getStoredAccessProfile()?.id))
    const mencoesDeepLinkLidasRef = useRef(null)

    const cardIdQuery = searchParams.get('card')
    const cardFromQuery = useMemo(() => {
        const id = Number(cardIdQuery)
        if (!Number.isFinite(id) || id <= 0) return null
        return cards.find((c) => Number(c.id) === id) || null
    }, [cards, cardIdQuery])
    const cardExibido = cardAberto || cardFromQuery

    const limparCardDaQuery = useCallback(() => {
        if (!searchParams.has('card')) return
        const next = new URLSearchParams(searchParams)
        next.delete('card')
        setSearchParams(next, { replace: true })
    }, [searchParams, setSearchParams])

    const abrirCard = useCallback(
        (card) => {
            if (!card) return
            setCardAberto(card)
            limparCardDaQuery()
            void marcarMencoesKanbanCardLidas(card.id).catch(() => {})
        },
        [limparCardDaQuery],
    )

    const fecharCard = useCallback(() => {
        setCardAberto(null)
        limparCardDaQuery()
    }, [limparCardDaQuery])

    const podeRelatorio = podeLerFerramenta(
        getStoredAccessProfile()?.permissions,
        'credenciamento.processos_relatorio',
    )

    const mapaUsuarios = useMemo(() => {
        const m = new Map()
        for (const u of usuarios) m.set(u.id, u.nome)
        return m
    }, [usuarios])

    useEffect(() => {
        if (assigneeDefaultRef.current) return
        let ativo = true
        void supabase.auth.getUser().then(({ data }) => {
            const id = data?.user?.id
            if (!ativo || !id) return
            assigneeDefaultRef.current = true
            setFiltroAssignee(id)
        })
        return () => {
            ativo = false
        }
    }, [])

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
        if (!cardFromQuery?.id) return
        if (mencoesDeepLinkLidasRef.current === cardFromQuery.id) return
        mencoesDeepLinkLidasRef.current = cardFromQuery.id
        void marcarMencoesKanbanCardLidas(cardFromQuery.id).catch(() => {})
    }, [cardFromQuery?.id])

    useEffect(() => {
        return () => {
            if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
        }
    }, [])

    useEffect(() => {
        return assinarCardsKanbanLive(() => {
            if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
            realtimeDebounceRef.current = setTimeout(() => {
                void listarCardsKanban()
                    .then(setCards)
                    .catch(() => {})
            }, 300)
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

    const opcoesCidadeFiltro = useMemo(() => {
        const set = new Set()
        for (const c of cards || []) {
            if (filtroUf && String(c.uf || '').toUpperCase() !== String(filtroUf).toUpperCase()) continue
            const nome = String(c.cidade || '').trim()
            if (nome) set.add(nome)
        }
        return [...set]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .map((nome) => ({ id: nome, nome }))
    }, [cards, filtroUf])

    const ufsNosCards = useMemo(() => {
        const set = new Set()
        for (const c of cards || []) {
            const uf = String(c.uf || '').trim().toUpperCase()
            if (uf) set.add(uf)
        }
        return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    }, [cards])

    useEffect(() => {
        if (!filtroUf) return
        if (ufsNosCards.includes(String(filtroUf).toUpperCase())) return
        setFiltroUf('')
        setFiltroCidade('')
    }, [filtroUf, ufsNosCards])

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

    const novoCard = (colunaId = 'nao_contatado') => {
        const coluna = COLUNAS_KANBAN.some((c) => c.id === colunaId) ? colunaId : 'nao_contatado'
        setColunaMobile(coluna)
        setErro('')
        setCardAberto({
            id: null,
            isRascunho: true,
            coluna,
            ordem: 0,
            nome: '',
            uf: '',
            cidade: '',
            telefone: '',
            tipo: '',
            especialidade: '',
            prestadorId: null,
            prospectoOsmId: null,
            atribuidoA: getStoredAccessProfile()?.id || '',
            corpo: '',
            checklist: [],
            criadoEm: null,
            atualizadoEm: null,
            criadoPor: null,
        })
    }

    const criarCardComDados = async (coluna, patch) => {
        const nomeLimpo = String(patch.nome || '').trim()
        if (!nomeLimpo) throw new Error('Informe o nome para criar o card.')
        let criado = await criarCardKanban({
            coluna,
            nome: nomeLimpo,
            uf: patch.uf,
            cidade: patch.cidade,
            telefone: patch.telefone,
            tipo: patch.tipo || patch.especialidade,
            corpo: patch.corpo,
            checklist: patch.checklist,
            atribuidoA: patch.atribuidoA,
            prestadorId: patch.prestadorId,
        })
        if (criado.coluna === 'preenchendo_form' && !criado.prestadorId) {
            try {
                criado = await garantirPerfilSimplesAoPreenchendoForm(criado, { situacoes })
            } catch (err) {
                setAviso(err?.message || 'Card criado, mas o perfil simples não foi gerado.')
            }
        } else if (criado.coluna === 'preenchendo_form' && criado.prestadorId) {
            try {
                await sincronizarPrestadorComCardKanban(criado, { situacoes })
            } catch (err) {
                setAviso(err?.message || 'Card salvo, mas o perfil vinculado não foi atualizado.')
            }
        }
        setCards((prev) => [...prev, criado])
        setColunaMobile(criado.coluna)
        return criado
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
            if (cardExibido && mapa.has(Number(cardExibido.id))) {
                setCardAberto(mapa.get(Number(cardExibido.id)))
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
        if (!cardExibido) return
        const ehRascunho = Boolean(cardExibido.isRascunho) || !cardExibido.id

        if (ehRascunho) {
            const criado = await criarCardComDados(cardExibido.coluna, {
                ...patch,
                prestadorId: patch.prestadorId ?? cardExibido.prestadorId,
            })
            if (patch.corpo !== undefined) {
                const r = await notificarMencoesKanban({
                    cardId: criado.id,
                    cardNome: criado.nome,
                    corpoNovo: criado.corpo,
                    corpoAnterior: '',
                })
                if (r?.aviso) setAviso(r.aviso)
                else if (r?.criados > 0) {
                    setAviso(
                        r.criados === 1
                            ? '1 utilizador notificado por menção.'
                            : `${r.criados} utilizadores notificados por menção.`,
                    )
                }
            }
            setCardAberto(null)
            limparCardDaQuery()
            return criado
        }

        const corpoAnterior = cardExibido.corpo || ''
        let atualizado = await atualizarCardKanban(cardExibido.id, patch)
        if (atualizado.coluna === 'preenchendo_form' && !atualizado.prestadorId) {
            try {
                atualizado = await garantirPerfilSimplesAoPreenchendoForm(atualizado, { situacoes })
            } catch (err) {
                setAviso(err?.message || 'Não foi possível criar o perfil simples automaticamente.')
            }
        } else if (atualizado.coluna === 'preenchendo_form' && atualizado.prestadorId) {
            try {
                await sincronizarPrestadorComCardKanban(atualizado, { situacoes })
            } catch (err) {
                setAviso(err?.message || 'Card salvo, mas o perfil vinculado não foi atualizado.')
            }
        }
        setCardAberto(atualizado)
        limparCardDaQuery()
        setCards((prev) => prev.map((c) => (Number(c.id) === Number(atualizado.id) ? atualizado : c)))
        if (patch.corpo !== undefined) {
            const r = await notificarMencoesKanban({
                cardId: atualizado.id,
                cardNome: atualizado.nome || cardExibido.nome,
                corpoNovo: atualizado.corpo,
                corpoAnterior,
            })
            if (r?.aviso) setAviso(r.aviso)
            else if (r?.criados > 0) {
                setAviso(
                    r.criados === 1
                        ? '1 utilizador notificado por menção.'
                        : `${r.criados} utilizadores notificados por menção.`,
                )
            }
        }
        return atualizado
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
            'responsavel,total',
            ...resumo.porAssignee.map((a) => `${a.id},${a.total}`),
        ]
        baixarTextoComoArquivo(
            `kanban-credenciamento-${new Date().toISOString().slice(0, 10)}.csv`,
            `\uFEFF${linhas.join('\n')}`,
        )
    }

    const etapas = ETAPAS_KANBAN

    const nSel = selecionados.size
    const cardsColunaMobile = porColuna[colunaMobile] || []
    const todosMobileMarcados =
        cardsColunaMobile.length > 0 && cardsColunaMobile.every((c) => selecionados.has(Number(c.id)))

    const renderCard = (card, { compact = false } = {}) => {
        const marcado = selecionados.has(Number(card.id))
        const chk = resumoChecklistCard(card)
        return (
            <article
                key={card.id}
                role="button"
                tabIndex={0}
                className={`cred_kanban_card${dragId === card.id ? ' is-dragging' : ''}${marcado ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`}
                draggable={!compact}
                onDragStart={compact ? undefined : (e) => onDragStart(e, card.id)}
                onClick={() => abrirCard(card)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        abrirCard(card)
                    }
                }}
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
                    {chk.total > 0 ? (
                        <span
                            className={`cred_kanban_card_chk_count${chk.feitos >= chk.total ? ' is-done' : ''}`}
                            title={`${chk.feitos} de ${chk.total} itens da checklist`}
                            aria-label={`${chk.feitos} de ${chk.total} checkboxes`}
                        >
                            {chk.feitos}/{chk.total}
                        </span>
                    ) : null}
                </div>
                <p>{[card.cidade, card.uf].filter(Boolean).join(' / ') || '—'}</p>
                {!compact ? (
                    <p>{card.telefone ? formatarTelefoneBrExibicao(card.telefone) : '—'}</p>
                ) : null}
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
                {card.prestadorId ? (
                    <Link
                        to={`/credenciamento/cadastro/${card.prestadorId}`}
                        className="cred_kanban_tag cred_kanban_tag_perfil"
                        title="Abrir perfil do credenciado"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        Perfil #{card.prestadorId}
                    </Link>
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
                description="Funil Kanban live — Contato Inicial, Cadastro/Pós e Sem interesse / Re-Contato. Arraste os cards entre colunas."
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
                <label className="cred_kanban_filtro_busca">
                    <span>Busca</span>
                    <input
                        value={filtroBusca}
                        onChange={(e) => setFiltroBusca(e.target.value)}
                        placeholder="Nome, telefone…"
                    />
                </label>
                <label>
                    <span>Tipo</span>
                    <input
                        value={filtroEsp}
                        onChange={(e) => setFiltroEsp(e.target.value)}
                        list="cred_kanban_esp_filtro"
                        placeholder="Especialidade…"
                    />
                    <datalist id="cred_kanban_esp_filtro">
                        {especialidades.map((e) => (
                            <option key={e.id} value={e.nome} />
                        ))}
                    </datalist>
                </label>
                <label>
                    <span>Responsável</span>
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
                    <span>UF</span>
                    <SelectUfBusca
                        value={filtroUf}
                        ufs={ufsNosCards}
                        emptyLabel="Todas"
                        placeholder="Todas"
                        className="cred_kanban_select_uf"
                        onChange={(u) => {
                            setFiltroUf(u)
                            setFiltroCidade('')
                        }}
                    />
                </label>
                <label>
                    <span>Cidade</span>
                    <SelectMunicipioBusca
                        options={opcoesCidadeFiltro}
                        value={filtroCidade}
                        valueKey="nome"
                        onChange={setFiltroCidade}
                        placeholder="Todas"
                        searchPlaceholder="Buscar cidade…"
                        emptyLabel="Todas"
                        aria-label="Filtrar por cidade"
                        className="cred_kanban_select_cidade"
                    />
                </label>
                <div className="cred_kanban_filtro_datas" role="group" aria-label="Datas">
                    <span>Datas</span>
                    <div className="cred_kanban_filtro_datas_campos">
                        <input
                            type="date"
                            value={filtroDe}
                            onChange={(e) => setFiltroDe(e.target.value)}
                            aria-label="Data inicial"
                            title="De"
                        />
                        <span className="cred_kanban_filtro_datas_sep" aria-hidden="true">
                            –
                        </span>
                        <input
                            type="date"
                            value={filtroAte}
                            onChange={(e) => setFiltroAte(e.target.value)}
                            aria-label="Data final"
                            title="Até"
                        />
                    </div>
                </div>
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
                            onClick={() => novoCard(colunaMobile)}
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
                                                onClick={() => novoCard(col.id)}
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

            {cardExibido ? (
                <KanbanCardModal
                    card={cardExibido}
                    usuarios={usuarios}
                    especialidades={especialidades}
                    onClose={fecharCard}
                    onSave={async (patch) => {
                        try {
                            return await salvarCard(patch)
                        } catch (e) {
                            setErro(e?.message || String(e))
                            throw e
                        }
                    }}
                    onSaveMany={
                        cardExibido.isRascunho || !cardExibido.id
                            ? async (patches) => {
                                  try {
                                      const coluna = cardExibido.coluna
                                      const lista = Array.isArray(patches) ? patches : []
                                      if (!lista.length) return []
                                      const criados = []
                                      for (const patch of lista) {
                                          const criado = await criarCardComDados(coluna, {
                                              ...patch,
                                              prestadorId:
                                                  patch.prestadorId ?? cardExibido.prestadorId,
                                          })
                                          if (patch.corpo !== undefined) {
                                              const r = await notificarMencoesKanban({
                                                  cardId: criado.id,
                                                  cardNome: criado.nome,
                                                  corpoNovo: criado.corpo,
                                                  corpoAnterior: '',
                                              })
                                              if (r?.aviso) setAviso(r.aviso)
                                          }
                                          criados.push(criado)
                                      }
                                      setAviso(
                                          criados.length === 1
                                              ? '1 card criado.'
                                              : `${criados.length} cards criados.`,
                                      )
                                      setCardAberto(null)
                                      limparCardDaQuery()
                                      return criados
                                  } catch (e) {
                                      setErro(e?.message || String(e))
                                      throw e
                                  }
                              }
                            : null
                    }
                    onDelete={
                        cardExibido.isRascunho || !cardExibido.id
                            ? null
                            : async () => {
                                  await excluirCardKanban(cardExibido.id)
                                  setCards((prev) =>
                                      prev.filter((c) => Number(c.id) !== Number(cardExibido.id)),
                                  )
                                  setSelecionados((prev) => {
                                      const next = new Set(prev)
                                      next.delete(Number(cardExibido.id))
                                      return next
                                  })
                                  fecharCard()
                              }
                    }
                    onCriarPrestador={
                        cardExibido.isRascunho || !cardExibido.id
                            ? null
                            : async () => {
                                  const r = await criarPrestadorMinimoParaCard(cardExibido, {
                                      situacoes,
                                  })
                                  setCardAberto(r.card)
                                  limparCardDaQuery()
                                  setCards((prev) =>
                                      prev.map((c) =>
                                          Number(c.id) === Number(r.card.id) ? r.card : c,
                                      ),
                                  )
                                  return r
                              }
                    }
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

function KanbanCardModal({
    card,
    usuarios,
    especialidades = [],
    onClose,
    onSave,
    onSaveMany,
    onDelete,
    onCriarPrestador,
}) {
    const isRascunho = Boolean(card?.isRascunho) || !card?.id
    const [entradas, setEntradas] = useState(() => [
        novaEntradaRascunhoKanban({
            nome: card.nome || '',
            uf: card.uf || '',
            cidade: card.cidade || '',
            telefone: maskTelefoneBr(card.telefone || ''),
            especialidade: especialidadeVisivelKanban(card.especialidade || card.tipo) || '',
            atribuidoA: card.atribuidoA || '',
            corpo: corpoVisivelSemMetaOutlook(card.corpo || ''),
            prestadorId: card.prestadorId || null,
        }),
    ])
    const [abaAtiva, setAbaAtiva] = useState(0)
    const [colagemAberta, setColagemAberta] = useState(false)
    const [nome, setNome] = useState(card.nome || '')
    const [uf, setUf] = useState(card.uf || '')
    const [cidade, setCidade] = useState(card.cidade || '')
    const [municipiosUf, setMunicipiosUf] = useState([])
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false)
    const [telefone, setTelefone] = useState(() => maskTelefoneBr(card.telefone || ''))
    const [especialidade, setEspecialidade] = useState(
        () => especialidadeVisivelKanban(card.especialidade || card.tipo) || '',
    )
    const [corpo, setCorpo] = useState(() => corpoVisivelSemMetaOutlook(card.corpo || ''))
    const [atribuidoA, setAtribuidoA] = useState(card.atribuidoA || '')
    const [prestadorIdLocal, setPrestadorIdLocal] = useState(card.prestadorId || null)
    const [sugestoesNome, setSugestoesNome] = useState([])
    const [salvando, setSalvando] = useState(false)
    const [excluindo, setExcluindo] = useState(false)
    const [confirmarExclusao, setConfirmarExclusao] = useState(false)
    const [cliquesFora, setCliquesFora] = useState(0)
    const [autocompleteColchete, setAutocompleteColchete] = useState(null)
    const [mencaoUsuario, setMencaoUsuario] = useState(null)
    const [sugestoesMencao, setSugestoesMencao] = useState([])
    const corpoRef = useRef(null)
    const espInputRef = useRef(null)
    const [espFoco, setEspFoco] = useState(false)
    const [sugestoesEsp, setSugestoesEsp] = useState([])
    const [espBalao, setEspBalao] = useState(null)

    const checklistGh = useMemo(() => parseChecklistMarkdownLinhas(corpo), [corpo])

    const opcoesMunicipio = useMemo(() => {
        const lista = [...(municipiosUf || [])]
        const atual = String(cidade || '').trim()
        if (atual && !lista.some((m) => String(m.nome || '').trim() === atual)) {
            lista.unshift({ id: `custom:${atual}`, nome: atual })
        }
        return lista
    }, [municipiosUf, cidade])

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

    const carregarEntradaNoForm = useCallback((entrada) => {
        setNome(entrada?.nome || '')
        setUf(entrada?.uf || '')
        setCidade(entrada?.cidade || '')
        setTelefone(maskTelefoneBr(entrada?.telefone || ''))
        setEspecialidade(entrada?.especialidade || '')
        setCorpo(entrada?.corpo || '')
        setAtribuidoA(entrada?.atribuidoA || '')
        setPrestadorIdLocal(entrada?.prestadorId || null)
        setSugestoesNome([])
        setAutocompleteColchete(null)
        setMencaoUsuario(null)
        setSugestoesMencao([])
        setEspFoco(false)
        setSugestoesEsp([])
        setEspBalao(null)
    }, [])

    const snapshotFormAtual = useCallback(
        () => ({
            nome,
            uf,
            cidade,
            telefone: maskTelefoneBr(telefone),
            especialidade,
            atribuidoA,
            corpo,
            prestadorId: prestadorIdLocal || null,
        }),
        [nome, uf, cidade, telefone, especialidade, atribuidoA, corpo, prestadorIdLocal],
    )

    const sincronizarAbaAtualNasEntradas = useCallback(() => {
        if (!isRascunho) return entradas
        const snap = snapshotFormAtual()
        const next = entradas.map((e, i) =>
            i === abaAtiva ? { ...e, ...snap, key: e.key } : e,
        )
        setEntradas(next)
        return next
    }, [isRascunho, entradas, abaAtiva, snapshotFormAtual])

    const irParaAba = (idx) => {
        if (!isRascunho || idx === abaAtiva || idx < 0 || idx >= entradas.length) return
        const next = sincronizarAbaAtualNasEntradas()
        setAbaAtiva(idx)
        carregarEntradaNoForm(next[idx])
    }

    const removerAba = (idx) => {
        if (!isRascunho || entradas.length <= 1) return
        const nextBase = sincronizarAbaAtualNasEntradas()
        const lista = nextBase.filter((_, i) => i !== idx)
        const novoIdx = Math.min(idx, lista.length - 1)
        setEntradas(lista)
        setAbaAtiva(novoIdx)
        carregarEntradaNoForm(lista[novoIdx])
    }

    const aplicarColagemExcel = (texto) => {
        const rows = parseColagemCardsKanban(texto, {
            usuarios,
            atribuidoAPadrao: getStoredAccessProfile()?.id || card.atribuidoA || '',
        })
        if (!rows.length) return false
        const novas = rows.map((r) =>
            novaEntradaRascunhoKanban({
                ...r,
                corpo: '',
                prestadorId: null,
            }),
        )
        setEntradas(novas)
        setAbaAtiva(0)
        carregarEntradaNoForm(novas[0])
        if (novas.length > 1) setColagemAberta(false)
        return true
    }

    const onPasteNomeOuDados = (e) => {
        if (!isRascunho) return
        const texto = e.clipboardData?.getData('text') || ''
        if (!pareceColagemTabelaKanban(texto)) return
        if (!texto.includes('\t') && !texto.includes('\n') && !texto.includes('\r')) return
        e.preventDefault()
        e.stopPropagation()
        aplicarColagemExcel(texto)
    }

    useEffect(() => {
        const base = novaEntradaRascunhoKanban({
            nome: card.nome || '',
            uf: card.uf || '',
            cidade: card.cidade || '',
            telefone: maskTelefoneBr(card.telefone || ''),
            especialidade: especialidadeVisivelKanban(card.especialidade || card.tipo) || '',
            atribuidoA: card.atribuidoA || '',
            corpo: corpoVisivelSemMetaOutlook(card.corpo || ''),
            prestadorId: card.prestadorId || null,
        })
        setEntradas([base])
        setAbaAtiva(0)
        setColagemAberta(false)
        carregarEntradaNoForm(base)
        setConfirmarExclusao(false)
        setCliquesFora(0)
    }, [card, carregarEntradaNoForm])

    useEffect(() => {
        const sigla = String(uf || '').trim().toUpperCase()
        if (!sigla) {
            setMunicipiosUf([])
            setCarregandoMunicipios(false)
            return undefined
        }
        let cancel = false
        setCarregandoMunicipios(true)
        buscarMunicipiosPorUfRobusto(sigla, { supabase })
            .then((lista) => {
                if (!cancel) setMunicipiosUf(lista || [])
            })
            .catch(() => {
                if (!cancel) setMunicipiosUf([])
            })
            .finally(() => {
                if (!cancel) setCarregandoMunicipios(false)
            })
        return () => {
            cancel = true
        }
    }, [uf])
    useEffect(() => {
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKeyDown = (e) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            document.body.style.overflow = prevOverflow
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [onClose])

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

    const aplicarTelefoneComExtras = (valorBruto) => {
        const { principal, extras } = separarTelefonePrincipalEExtras(valorBruto)
        setTelefone(principal)
        if (extras.length) {
            setCorpo((prev) => anexarContatosAdicionaisNaDescricao(prev, extras))
        }
    }

    const aplicarPrestadorMencao = (p) => {
        const nomeFinal = aplicarMencaoNoNome(nome, p.nome)
        setNome(nomeFinal)
        setSugestoesNome([])
        const telPrest = String(p.telefone || '').trim()
        let telPrincipal = telefone
        if (telPrest) {
            const { principal, extras } = separarTelefonePrincipalEExtras(telPrest)
            telPrincipal = principal
            setTelefone(principal)
            if (extras.length) {
                setCorpo((prev) => anexarContatosAdicionaisNaDescricao(prev, extras))
            }
        }
        if (p.endereco_uf) setUf(p.endereco_uf)
        if (p.endereco_cidade) setCidade(p.endereco_cidade)
        if (p.especialidadePrincipal) {
            setEspecialidade(p.especialidadePrincipal)
        }
        setPrestadorIdLocal(p.id)
        if (isRascunho) return
        void onSave({
            prestadorId: p.id,
            nome: nomeSemArroba(nomeFinal),
            uf: p.endereco_uf || uf,
            cidade: p.endereco_cidade || cidade,
            telefone: telPrincipal || telefone,
            tipo: p.especialidadePrincipal || especialidade,
        })
    }

    const aplicarMencaoUsuario = (user) => {
        const el = corpoRef.current
        if (!mencaoUsuario || !user) return
        const token = `${tokenMencaoUsuario(user)} `
        const val = String(corpo)
        const next = `${val.slice(0, mencaoUsuario.start)}${token}${val.slice(mencaoUsuario.end)}`
        setCorpo(next)
        setMencaoUsuario(null)
        setSugestoesMencao([])
        setAutocompleteColchete(null)
        requestAnimationFrame(() => {
            if (!el) return
            el.focus()
            const pos = mencaoUsuario.start + token.length
            el.setSelectionRange(pos, pos)
        })
    }

    const atualizarSugestoesMencao = (texto, cursor) => {
        const hit = queryMencaoUsuarioNoCorpo(texto, cursor)
        if (!hit) {
            setMencaoUsuario(null)
            setSugestoesMencao([])
            return
        }
        setMencaoUsuario(hit)
        const q = String(hit.query || '')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
        const meuId = getStoredAccessProfile()?.id
        const lista = (usuarios || [])
            .filter((u) => u?.id && u.id !== meuId)
            .filter((u) => {
                if (!q) return true
                const nome = String(u.nome || '')
                    .normalize('NFD')
                    .replace(/\p{M}/gu, '')
                    .toLowerCase()
                return nome.includes(q)
            })
            .slice(0, 8)
        setSugestoesMencao(lista)
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
        if (sugestoesMencao.length > 0 && mencaoUsuario) {
            if (e.key === 'Escape') {
                e.preventDefault()
                setMencaoUsuario(null)
                setSugestoesMencao([])
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (String(mencaoUsuario.query || '').length < 1) return
                e.preventDefault()
                aplicarMencaoUsuario(sugestoesMencao[0])
                return
            }
        }
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
            setMencaoUsuario(null)
            setSugestoesMencao([])
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
            setMencaoUsuario(null)
            setSugestoesMencao([])
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
        setMencaoUsuario(null)
        setSugestoesMencao([])
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
        const val = e.target.value
        const cursor = e.target.selectionStart ?? val.length
        setCorpo(val)
        if (autocompleteColchete) setAutocompleteColchete(null)
        atualizarSugestoesMencao(val, cursor)
    }

    const onCorpoSelect = (e) => {
        const val = e.target.value
        const cursor = e.target.selectionStart ?? val.length
        atualizarSugestoesMencao(val, cursor)
    }

    const toggleChecklistGh = (lineIndex) => {
        setCorpo((prev) => alternarChecklistNaLinha(prev, lineIndex))
    }

    const persistir = async () => {
        if (isRascunho && typeof onSaveMany === 'function') {
            const lista = sincronizarAbaAtualNasEntradas()
            const patches = lista
                .map((e) => {
                    const nomeLimpo = nomeSemArroba(e.nome)
                    if (!String(nomeLimpo || '').trim()) return null
                    return {
                        nome: nomeLimpo,
                        uf: e.uf,
                        cidade: e.cidade,
                        telefone: maskTelefoneBr(e.telefone),
                        tipo: e.especialidade,
                        corpo: corpoComMeta(e.corpo || ''),
                        checklist: checklistDeMarkdown(e.corpo || ''),
                        atribuidoA: e.atribuidoA || null,
                        prestadorId: e.prestadorId || null,
                    }
                })
                .filter(Boolean)
            if (!patches.length) {
                window.alert('Informe o nome em pelo menos um card antes de criar.')
                return
            }
            setSalvando(true)
            try {
                await onSaveMany(patches)
                onClose()
            } catch {
                /* erro já tratado no parent */
            } finally {
                setSalvando(false)
            }
            return
        }

        const nomeLimpo = nomeSemArroba(nome)
        if (!String(nomeLimpo || '').trim()) {
            window.alert('Informe o nome antes de salvar o card.')
            return
        }
        setSalvando(true)
        try {
            setNome(nomeLimpo)
            const telSalvar = maskTelefoneBr(telefone)
            setTelefone(telSalvar)
            await onSave({
                nome: nomeLimpo,
                uf,
                cidade,
                telefone: telSalvar,
                tipo: especialidade,
                corpo: corpoComMeta(corpo),
                checklist: checklistDeMarkdown(corpo),
                atribuidoA: atribuidoA || null,
                prestadorId: prestadorIdLocal || card.prestadorId || null,
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
                        <p className="cred_kanban_modal_kicker">
                            {isRascunho
                                ? entradas.length > 1
                                    ? `Novos cards · ${entradas.length}`
                                    : 'Novo card'
                                : `Card #${card.id}`}
                        </p>
                        <h2>
                            {nome ||
                                (isRascunho
                                    ? entradas.length > 1
                                        ? `Card ${abaAtiva + 1} de ${entradas.length}`
                                        : 'Preencha e salve'
                                    : 'Sem nome')}
                        </h2>
                    </div>
                    <button type="button" onClick={onClose}>
                        {isRascunho ? 'Cancelar' : 'Fechar'}
                    </button>
                </header>

                {isRascunho ? (
                    <div className="cred_kanban_modal_abas_wrap">
                        <button
                            type="button"
                            className={`cred_kanban_modal_varios_toggle${colagemAberta ? ' is-open' : ''}`}
                            aria-expanded={colagemAberta}
                            onClick={() => setColagemAberta((v) => !v)}
                        >
                            <span>Adicionar vários</span>
                            <span className="cred_kanban_modal_varios_chevron" aria-hidden="true">
                                ▾
                            </span>
                        </button>
                        {colagemAberta ? (
                            <div className="cred_kanban_modal_varios_painel">
                                <p className="cred_kanban_modal_abas_tip" role="note">
                                    Cole do Excel (colunas com tab): Nome · Especialidade · UF · Cidade ·
                                    Telefone · Responsável — uma linha vira um card.
                                </p>
                                <textarea
                                    className="cred_kanban_modal_colagem"
                                    rows={3}
                                    placeholder="Cole aqui várias linhas do Excel…"
                                    aria-label="Colar linhas do Excel"
                                    defaultValue=""
                                    onPaste={(e) => {
                                        const texto = e.clipboardData?.getData('text') || ''
                                        if (!pareceColagemTabelaKanban(texto)) return
                                        e.preventDefault()
                                        aplicarColagemExcel(texto)
                                        e.currentTarget.value = ''
                                    }}
                                />
                            </div>
                        ) : null}
                        {entradas.length > 1 ? (
                            <div className="cred_kanban_modal_abas" role="tablist" aria-label="Cards a criar">
                                {entradas.map((e, idx) => {
                                    const rotulo =
                                        String(idx === abaAtiva ? nome : e.nome || '').trim() ||
                                        `Card ${idx + 1}`
                                    return (
                                        <div
                                            key={e.key}
                                            className={`cred_kanban_modal_aba${idx === abaAtiva ? ' is-active' : ''}`}
                                        >
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={idx === abaAtiva}
                                                className="cred_kanban_modal_aba_btn"
                                                onClick={() => irParaAba(idx)}
                                                title={rotulo}
                                            >
                                                {rotulo.length > 22 ? `${rotulo.slice(0, 20)}…` : rotulo}
                                            </button>
                                            <button
                                                type="button"
                                                className="cred_kanban_modal_aba_x"
                                                aria-label={`Remover ${rotulo}`}
                                                onClick={(ev) => {
                                                    ev.stopPropagation()
                                                    removerAba(idx)
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <section className="cred_kanban_modal_secao" aria-label="Dados do contato">
                    <h3>Dados{isRascunho && entradas.length > 1 ? ` · aba ${abaAtiva + 1}` : ''}</h3>
                    <div className="cred_kanban_modal_grid">
                        <label className="cred_kanban_span_full cred_kanban_nome_mencao_wrap">
                            <span>Nome</span>
                            <input
                                value={nome}
                                onChange={(e) => setNome(e.target.value)}
                                onPaste={onPasteNomeOuDados}
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
                            <SelectUfBusca
                                value={uf}
                                emptyLabel="—"
                                placeholder="Selecionar UF…"
                                onChange={(u) => {
                                    setUf(u)
                                    setCidade('')
                                }}
                            />
                        </label>
                        <label className="cred_kanban_campo_cidade">
                            <span>Cidade</span>
                            <SelectMunicipioBusca
                                options={opcoesMunicipio}
                                value={cidade}
                                valueKey="nome"
                                onChange={setCidade}
                                disabled={!uf || carregandoMunicipios}
                                loading={carregandoMunicipios}
                                placeholder={!uf ? 'Selecione a UF' : 'Buscar cidade…'}
                                searchPlaceholder="Buscar cidade…"
                                emptyLabel="—"
                                creatable
                                createLabel={(q) => `Usar «${q}»`}
                                aria-label="Cidade do card"
                            />
                        </label>
                        <label className="cred_kanban_campo_telefone">
                            <span>Telefone</span>
                            <input
                                value={telefone}
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="(00) 00000-0000"
                                title="Um número aqui. Contatos extras vão para a Descrição."
                                onChange={(e) => aplicarTelefoneComExtras(e.target.value)}
                                onPaste={(e) => {
                                    const texto = e.clipboardData?.getData('text')
                                    if (!texto) return
                                    if (
                                        isRascunho &&
                                        texto.includes('\t') &&
                                        pareceColagemTabelaKanban(texto)
                                    ) {
                                        e.preventDefault()
                                        aplicarColagemExcel(texto)
                                        return
                                    }
                                    e.preventDefault()
                                    aplicarTelefoneComExtras(texto)
                                }}
                            />
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
                            <span>Responsável</span>
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
                    {prestadorIdLocal || card.prestadorId ? (
                        <p className="cred_kanban_vinculo cred_kanban_vinculo_dados">
                            Prestador vinculado:{' '}
                            {isRascunho ? (
                                <span>#{prestadorIdLocal || card.prestadorId}</span>
                            ) : (
                                <Link to={`/credenciamento/cadastro/${prestadorIdLocal || card.prestadorId}`}>
                                    #{prestadorIdLocal || card.prestadorId}
                                </Link>
                            )}
                        </p>
                    ) : null}
                </section>

                {!isRascunho && card.coluna === 'reuniao' ? (
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
                        <strong>Tip:</strong> digite <code>@</code> na descrição para mencionar um
                        utilizador (notifica na Home). <code>[</code> cria checklist (
                        <code>- [ ]</code>). No campo Nome, <code>@</code> vincula prestador (mín. 4
                        letras).
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
                            onKeyUp={onCorpoSelect}
                            onClick={onCorpoSelect}
                            onKeyDown={onCorpoKeyDown}
                            placeholder={
                                'Notas…\n\n@ para mencionar alguém\n- [ ] Enviar tabela\n- [ ] Agendar reunião'
                            }
                        />
                        {sugestoesMencao.length > 0 && mencaoUsuario ? (
                            <ul
                                className="cred_kanban_nome_sugestoes cred_kanban_mencao_sugestoes"
                                role="listbox"
                                aria-label="Mencionar utilizador"
                            >
                                {sugestoesMencao.map((u) => (
                                    <li key={u.id}>
                                        <button
                                            type="button"
                                            role="option"
                                            onMouseDown={(e) => {
                                                e.preventDefault()
                                                aplicarMencaoUsuario(u)
                                            }}
                                        >
                                            {u.nome}
                                            {u.email ? (
                                                <span className="cred_kanban_mencao_email">{u.email}</span>
                                            ) : null}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
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
                    {onDelete ? (
                        <button
                            type="button"
                            className="is-danger"
                            disabled={excluindo || salvando}
                            onClick={() => setConfirmarExclusao(true)}
                        >
                            Excluir
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="cred_kanban_modal_footer_direita">
                        {!isRascunho && (prestadorIdLocal || card.prestadorId) ? (
                            <Link
                                to={`/credenciamento/cadastro/${prestadorIdLocal || card.prestadorId}`}
                                className="cred_kanban_btn_abrir_perfil is-footer"
                            >
                                Abrir perfil
                            </Link>
                        ) : null}
                        {!isRascunho &&
                        onCriarPrestador &&
                        !card.prestadorId &&
                        !prestadorIdLocal &&
                        card.coluna === 'preenchendo_form' ? (
                            <button type="button" onClick={() => void onCriarPrestador()}>
                                Criar perfil simples
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="is-primary"
                            disabled={salvando || excluindo}
                            onClick={() => void persistir()}
                        >
                            {salvando
                                ? 'Salvando…'
                                : isRascunho
                                  ? entradas.length > 1
                                      ? `Criar ${entradas.length} cards`
                                      : 'Criar card'
                                  : 'Salvar'}
                        </button>
                    </div>
                </footer>
                <p className="cred_kanban_modal_meta">
                    {isRascunho
                        ? entradas.length > 1
                            ? `Serão criados ${entradas.length} cards nesta coluna. Abas vazias (sem nome) são ignoradas.`
                            : 'O card só entra no Kanban depois de criar/salvar. Pode colar várias linhas do Excel.'
                        : `Criado ${card.criadoEm ? new Date(card.criadoEm).toLocaleString('pt-BR') : '—'} · Atualizado ${card.atualizadoEm ? new Date(card.atualizadoEm).toLocaleString('pt-BR') : '—'}`}
                </p>
            </div>

            {confirmarExclusao && onDelete ? (
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
                            Remover «{nome || `Card #${card.id}`}» do Kanban? Só o card é apagado
                            {card.prestadorId || prestadorIdLocal
                                ? ' — o perfil do prestador permanece no cadastro'
                                : ''}
                            . Esta ação não pode ser desfeita.
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
                <p>Em Adicionar em SITE: {resumo.adicionarSite}</p>
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
                <h3>Por responsável</h3>
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
