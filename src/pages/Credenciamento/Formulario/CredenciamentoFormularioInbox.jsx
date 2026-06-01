import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSfscExclusaoConfirm } from '../../../hooks/useSfscExclusaoConfirm.jsx'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { getReadOnlyFlag } from '../../../lib/supabase'
import {
    atualizarStatusEntradaFormulario,
    contarEntradasFormularioPendentes,
    converterEntradaFormularioEmPrestador,
    formatarDataEntrada,
    listarEntradasFormulario,
    obterEntradaFormulario,
    rotuloTipoPerfil,
} from '../../../lib/formularioCredenciamento'
import { formatarCpfCnpjEntrada } from '../../../lib/prestadorCadastroHelpers'
import { supabase } from '../../../lib/supabase'

const FILTROS = [
    { id: 'abertas', label: 'Pendentes e em análise', status: ['pendente', 'em_analise'] },
    { id: 'pendente', label: 'Só pendentes', status: ['pendente'] },
    { id: 'em_analise', label: 'Em análise', status: ['em_analise'] },
    { id: 'convertido', label: 'Cadastrados', status: ['convertido'] },
    { id: 'descartado', label: 'Descartados', status: ['descartado'] },
    { id: 'todos', label: 'Todas', status: null },
]

function rotuloStatus(st) {
    const s = String(st || '')
    if (s === 'pendente') return 'Pendente'
    if (s === 'em_analise') return 'Em análise'
    if (s === 'convertido') return 'Cadastrado'
    if (s === 'descartado') return 'Descartado'
    return s || '—'
}

export default function CredenciamentoFormularioInbox() {
    const { askExclusao, exclusaoToast } = useSfscExclusaoConfirm()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const somenteLeitura =
        getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.CREDENCIAMENTO_EDIT)

    const filtroId = searchParams.get('filtro') || 'abertas'
    const entradaIdParam = searchParams.get('id')

    const filtroAtivo = useMemo(
        () => FILTROS.find((f) => f.id === filtroId) || FILTROS[0],
        [filtroId],
    )

    const [lista, setLista] = useState([])
    const [selecionada, setSelecionada] = useState(null)
    const [mapaProcedimentos, setMapaProcedimentos] = useState(new Map())
    const [loading, setLoading] = useState(true)
    const [acaoLoading, setAcaoLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [okMsg, setOkMsg] = useState('')
    const [abertasCount, setAbertasCount] = useState(0)

    const carregarLista = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const rows = await listarEntradasFormulario({
                status: filtroAtivo.status,
                limite: 200,
            })
            setLista(rows)
            try {
                const n = await contarEntradasFormularioPendentes()
                setAbertasCount(n)
            } catch {
                /* opcional */
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [filtroAtivo.status])

    const carregarDetalhe = useCallback(async (id) => {
        if (!id) {
            setSelecionada(null)
            return
        }
        setErro('')
        try {
            const row = await obterEntradaFormulario(id)
            setSelecionada(row)
            const codigos = [...new Set((row?.payload?.procedimentos || []).map((c) => String(c).trim().toUpperCase()))]
            if (codigos.length) {
                const { data } = await supabase
                    .from('procedimentos')
                    .select('codigo, nome')
                    .in('codigo', codigos)
                const m = new Map()
                ;(data || []).forEach((p) => m.set(String(p.codigo).toUpperCase(), p.nome))
                setMapaProcedimentos(m)
            } else {
                setMapaProcedimentos(new Map())
            }
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }, [])

    useEffect(() => {
        void carregarLista()
    }, [carregarLista])

    useEffect(() => {
        const id = entradaIdParam?.trim() || null
        if (id) void carregarDetalhe(id)
        else setSelecionada(null)
    }, [entradaIdParam, carregarDetalhe])

    const selecionar = (id) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('id', String(id))
            return next
        })
    }

    const mudarFiltro = (id) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('filtro', id)
            next.delete('id')
            return next
        })
        setSelecionada(null)
    }

    const recarregarTudo = async () => {
        await carregarLista()
        if (selecionada?.id) await carregarDetalhe(selecionada.id)
    }

    const marcarEmAnalise = async () => {
        if (!selecionada?.id || somenteLeitura) return
        setAcaoLoading(true)
        setOkMsg('')
        try {
            await atualizarStatusEntradaFormulario(selecionada.id, 'em_analise')
            setOkMsg('Marcado como em análise.')
            await recarregarTudo()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAcaoLoading(false)
        }
    }

    const descartar = () => {
        if (!selecionada?.id || somenteLeitura) return
        askExclusao(
            'Descartar esta entrada? Não será criado cadastro a partir dela.',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                try {
                    await atualizarStatusEntradaFormulario(selecionada.id, 'descartado')
                    setOkMsg('Entrada descartada.')
                    await recarregarTudo()
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Descartar entrada',
        )
    }

    const criarCadastro = () => {
        if (!selecionada?.id || somenteLeitura) return
        askExclusao(
            'Será criado um prestador com os dados enviados no formulário. Você poderá completar a ficha em seguida.',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                setErro('')
                try {
                    const prestadorId = await converterEntradaFormularioEmPrestador(selecionada.id)
                    setOkMsg('Cadastro criado. Abrindo ficha do prestador…')
                    navigate(`/credenciamento/cadastro/${prestadorId}`)
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Criar cadastro definitivo',
            { variante: 'primary', rotuloConfirmar: 'Criar cadastro' },
        )
    }

    const p = selecionada?.payload || {}
    const end = p.endereco || {}
    const podeConverter =
        selecionada &&
        !selecionada.prestador_id &&
        selecionada.status !== 'convertido' &&
        selecionada.status !== 'descartado'

    return (
        <div className="credenciamento_main fcred_inbox">
            {exclusaoToast}
            <h1>Credenciamento — Inbox do formulário</h1>
            <p className="pcad_muted fcred_inbox_lead">
                Revise pré-cadastros enviados pelos parceiros e converta em ficha de prestador.
                {abertasCount > 0 && (
                    <>
                        {' '}
                        <strong>{abertasCount}</strong> em aberto (pendente ou em análise).
                    </>
                )}
            </p>
            <p className="fcred_inbox_top_links">
                <Link to="/credenciamento/formulario" className="credenciamento_main_action_btn secondary">
                    Configuração do formulário
                </Link>
            </p>
            <hr />

            {erro && (
                <div className="credenciamento_main_alert" role="alert">
                    <span>{erro}</span>
                    <button type="button" onClick={() => setErro('')} aria-label="Fechar">
                        ×
                    </button>
                </div>
            )}
            {okMsg && (
                <div className="credenciamento_main_alert" role="status">
                    <span>{okMsg}</span>
                    <button type="button" onClick={() => setOkMsg('')} aria-label="Fechar">
                        ×
                    </button>
                </div>
            )}

            <header className="credenciamento_main_header">
                <h2 className="credenciamento_cadastro_filters_title">Filtrar entradas</h2>
                <div className="credenciamento_main_filters fcred_inbox_filters">
                    <div className="fcred_inbox_filtros" role="tablist" aria-label="Filtrar entradas">
                        {FILTROS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                role="tab"
                                aria-selected={filtroAtivo.id === f.id}
                                className={`credenciamento_main_action_btn ${
                                    filtroAtivo.id === f.id ? '' : 'secondary'
                                }`}
                                onClick={() => mudarFiltro(f.id)}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="fcred_layout fcred_inbox_layout">
                <aside className="fcred_paginas fcred_inbox_lista" aria-label="Lista de entradas">
                    <div className="fcred_paginas_head">
                        <h2>Entradas</h2>
                        <span className="pcad_muted">{loading ? '…' : lista.length}</span>
                    </div>
                    {loading && <p className="pcad_muted fcred_inbox_pad">Carregando…</p>}
                    {!loading && lista.length === 0 && (
                        <p className="pcad_muted fcred_inbox_pad">Nenhuma entrada neste filtro.</p>
                    )}
                    <ul className="fcred_inbox_ul">
                        {lista.map((e) => {
                            const pl = e.payload || {}
                            const ativo = String(selecionada?.id) === String(e.id)
                            return (
                                <li key={e.id}>
                                    <button
                                        type="button"
                                        className={`fcred_inbox_item ${ativo ? 'is-active' : ''}`}
                                        onClick={() => selecionar(e.id)}
                                    >
                                        <span className="fcred_inbox_item_nome">{pl.nome || 'Sem nome'}</span>
                                        <span className={`fcred_inbox_badge status-${e.status}`}>
                                            {rotuloStatus(e.status)}
                                        </span>
                                        <span className="fcred_inbox_item_meta">
                                            {rotuloTipoPerfil(e.tipo_perfil)} ·{' '}
                                            {formatarCpfCnpjEntrada(e.cpf_cnpj)}
                                        </span>
                                        <span className="fcred_inbox_item_data">
                                            {formatarDataEntrada(e.criado_em)}
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </aside>

                <section className="fcred_inbox_detalhe" aria-label="Detalhe da entrada">
                    {!selecionada && (
                        <p className="pcad_muted fcred_inbox_placeholder">
                            Selecione uma entrada na lista para revisar.
                        </p>
                    )}
                    {selecionada && (
                        <>
                            <div className="fcred_inbox_detalhe_head">
                                <h2 className="fcred_inbox_detalhe_tit">{p.nome || 'Sem nome'}</h2>
                                <span className={`fcred_inbox_badge status-${selecionada.status}`}>
                                    {rotuloStatus(selecionada.status)}
                                </span>
                            </div>
                            <p className="pcad_muted fcred_inbox_detalhe_sub">
                                {rotuloTipoPerfil(selecionada.tipo_perfil)} ·{' '}
                                {formatarCpfCnpjEntrada(selecionada.cpf_cnpj)}
                            </p>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <p>
                                    <strong>Enviado em:</strong> {formatarDataEntrada(selecionada.criado_em)}
                                </p>
                                <p>
                                    <strong>E-mail:</strong> {p.email || '—'}
                                </p>
                                <p>
                                    <strong>Telefone / celular:</strong>{' '}
                                    {[p.telefone, p.celular].filter(Boolean).join(' · ') || '—'}
                                </p>
                            </div>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <p>
                                    <strong>CEP:</strong> {p.cep || '—'}
                                </p>
                                <p>
                                    <strong>Endereço:</strong>{' '}
                                    {[
                                        [end.logradouro, end.numero].filter(Boolean).join(', '),
                                        end.complemento,
                                        end.bairro,
                                        [end.cidade, end.uf].filter(Boolean).join(' / '),
                                    ]
                                        .filter(Boolean)
                                        .join(' — ') || '—'}
                                </p>
                            </div>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <p>
                                    <strong>Procedimentos selecionados</strong>
                                </p>
                                {(p.procedimentos || []).length === 0 && (
                                    <p className="pcad_muted">Nenhum procedimento no envio.</p>
                                )}
                                <ul className="fcred_inbox_proc_list">
                                    {(p.procedimentos || []).map((cod) => {
                                        const c = String(cod).trim().toUpperCase()
                                        const nome = mapaProcedimentos.get(c)
                                        return (
                                            <li key={c}>
                                                <code>{c}</code>
                                                {nome ? ` — ${nome}` : ''}
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>

                            <div className="fcred_inbox_acoes">
                                {selecionada.prestador_id && (
                                    <Link
                                        to={`/credenciamento/cadastro/${selecionada.prestador_id}`}
                                        className="credenciamento_main_action_btn"
                                    >
                                        Abrir ficha do prestador
                                    </Link>
                                )}
                                {podeConverter && (
                                    <>
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn"
                                            disabled={acaoLoading || somenteLeitura}
                                            onClick={() => void criarCadastro()}
                                        >
                                            {acaoLoading ? 'A processar…' : 'Criar cadastro definitivo'}
                                        </button>
                                        {selecionada.status === 'pendente' && (
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn secondary"
                                                disabled={acaoLoading || somenteLeitura}
                                                onClick={() => void marcarEmAnalise()}
                                            >
                                                Marcar em análise
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn secondary fcred_inbox_btn_descartar"
                                            disabled={acaoLoading || somenteLeitura}
                                            onClick={() => void descartar()}
                                        >
                                            Descartar
                                        </button>
                                    </>
                                )}
                            </div>
                            {somenteLeitura && (
                                <p className="pcad_muted fcred_inbox_readonly">
                                    Modo somente leitura: não é possível converter ou alterar status.
                                </p>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    )
}
