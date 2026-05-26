import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission } from '../../../lib/accessControl'
import { supabase } from '../../../lib/supabase'
import {
    acharSituacaoCredenciadoId,
    calcularPercentualCompletudePerfil,
    normalizarTextoBusca,
} from '../../../lib/prestadorCadastroHelpers'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoCadastro.css'

const LISTA_UI_STORAGE_KEY = 'emerdog_credenciamento_cadastro_lista_ui'

function lerEstadoListaUi() {
    try {
        const raw = sessionStorage.getItem(LISTA_UI_STORAGE_KEY)
        if (!raw) return null
        return JSON.parse(raw)
    } catch {
        return null
    }
}

const CredenciamentoCadastroLista = () => {
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [termoBusca1, setTermoBusca1] = useState(() => lerEstadoListaUi()?.termoBusca1 ?? '')
    const [termoBusca2, setTermoBusca2] = useState(() => lerEstadoListaUi()?.termoBusca2 ?? '')
    const [filtroSituacao, setFiltroSituacao] = useState(() => lerEstadoListaUi()?.filtroSituacao ?? '')
    const [itensPorPagina, setItensPorPagina] = useState(
        () => Number(lerEstadoListaUi()?.itensPorPagina) || 20
    )
    const [paginaAtual, setPaginaAtual] = useState(() => Number(lerEstadoListaUi()?.paginaAtual) || 1)
    const [paginaAlvoInput, setPaginaAlvoInput] = useState(() =>
        String(Number(lerEstadoListaUi()?.paginaAtual) || 1)
    )
    const [ordenarColuna, setOrdenarColuna] = useState(() => lerEstadoListaUi()?.ordenarColuna ?? 'nome')
    const [ordenarDir, setOrdenarDir] = useState(() => lerEstadoListaUi()?.ordenarDir ?? 'asc')
    const [ocultarVetsVinculadosClinica, setOcultarVetsVinculadosClinica] = useState(
        () => lerEstadoListaUi()?.ocultarVetsVinculadosClinica !== false
    )
    const aplicouDefaultSituacaoRef = useRef(!!lerEstadoListaUi())
    const pularResetPaginaRef = useRef(true)

    const [prestadores, setPrestadores] = useState([])
    const [cidades, setCidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false
    }, [])

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [
                { data: prestadoresData, error: errP },
                { data: cidadesData, error: errC },
                { data: situacoesData, error: errS },
                { data: especialidadesData, error: errE },
                { data: pcData, error: errPc },
                { data: peData, error: errPe },
            ] = await Promise.all([
                supabase
                    .from('prestadores')
                    .select(
                        'id, nome, tipo, telefone, celular, email, cidade_id, especialidade_id, situacao_id, cpf_cnpj, crmv, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, modalidade, chave_pix, tipo_repasse'
                    )
                    .eq('ativo', true),
                supabase.from('cidades_credenciamento').select('id, nome').order('nome', { ascending: true }),
                supabase.from('situacoes').select('id, descricao, ordem, ativo').eq('ativo', true).order('ordem'),
                supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
                supabase.from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id'),
            ])
            const erros = [errP, errC, errS, errE, errPc, errPe].map((e) => e?.message).filter(Boolean)
            if (erros.length) {
                setErro(erros.join(' | '))
                return
            }
            setPrestadores(prestadoresData || [])
            setCidades(cidadesData || [])
            setSituacoes(situacoesData || [])
            setEspecialidades(especialidadesData || [])
            setPrestadorCidades(pcData || [])
            setPrestadorEstabelecimentos(peData || [])
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    useEffect(() => {
        if (aplicouDefaultSituacaoRef.current || !situacoes.length) return
        const credId = acharSituacaoCredenciadoId(situacoes)
        if (credId) setFiltroSituacao(String(credId))
        aplicouDefaultSituacaoRef.current = true
    }, [situacoes])

    useEffect(() => {
        sessionStorage.setItem(
            LISTA_UI_STORAGE_KEY,
            JSON.stringify({
                termoBusca1,
                termoBusca2,
                filtroSituacao,
                itensPorPagina,
                paginaAtual,
                ordenarColuna,
                ordenarDir,
                ocultarVetsVinculadosClinica,
            })
        )
    }, [
        termoBusca1,
        termoBusca2,
        filtroSituacao,
        itensPorPagina,
        paginaAtual,
        ordenarColuna,
        ordenarDir,
        ocultarVetsVinculadosClinica,
    ])

    useEffect(() => {
        const onScroll = () => setHeaderCompacto(window.scrollY > 22)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        if (pularResetPaginaRef.current) {
            pularResetPaginaRef.current = false
            return
        }
        setPaginaAtual(1)
    }, [termoBusca1, termoBusca2, filtroSituacao, itensPorPagina, ocultarVetsVinculadosClinica])

    const idsVetsVinculadosClinica = useMemo(() => {
        const ids = new Set()
        ;(prestadorEstabelecimentos || []).forEach((rel) => {
            const vid = Number(rel.veterinario_id)
            if (vid) ids.add(vid)
        })
        return ids
    }, [prestadorEstabelecimentos])

    const cidadePorId = useMemo(() => new Map(cidades.map((c) => [Number(c.id), c])), [cidades])
    const situacaoPorId = useMemo(() => new Map(situacoes.map((s) => [Number(s.id), s])), [situacoes])
    const especialidadePorId = useMemo(() => new Map(especialidades.map((e) => [Number(e.id), e])), [especialidades])

    const linhas = useMemo(() => {
        const cidadesPorPrestador = new Map()
        prestadorCidades.forEach((rel) => {
            const pid = Number(rel.prestador_id)
            if (!cidadesPorPrestador.has(pid)) cidadesPorPrestador.set(pid, [])
            cidadesPorPrestador.get(pid).push(rel)
        })
        const temVinculoClinicaPorVet = new Map()
        ;(prestadorEstabelecimentos || []).forEach((rel) => {
            const vid = Number(rel.veterinario_id)
            if (vid) temVinculoClinicaPorVet.set(vid, true)
        })
        return (prestadores || []).map((p) => {
            const pid = Number(p.id)
            const rels = cidadesPorPrestador.get(pid) || []
            const principal = rels.find((r) => r.principal) || rels[0]
            const cidadeNome = principal ? cidadePorId.get(Number(principal.cidade_id))?.nome || '—' : '—'
            const espObj = especialidadePorId.get(Number(p.especialidade_id))
            const tipoLabel = espObj?.nome || '—'
            const perfilCompletoPct = calcularPercentualCompletudePerfil(p, {
                temCidadeAtende: rels.length > 0,
                temVinculoClinica: temVinculoClinicaPorVet.get(pid) === true,
            })
            return {
                id: p.id,
                nome: p.nome || '—',
                cidadeNome,
                tipoLabel,
                situacaoId: p.situacao_id,
                situacao: situacaoPorId.get(Number(p.situacao_id))?.descricao || '—',
                perfilCompletoPct,
            }
        })
    }, [
        prestadores,
        prestadorCidades,
        prestadorEstabelecimentos,
        cidadePorId,
        situacaoPorId,
        especialidadePorId,
    ])

    const linhasFiltradas = useMemo(() => {
        const b1 = normalizarTextoBusca(termoBusca1)
        const b2 = normalizarTextoBusca(termoBusca2)
        return linhas.filter((l) => {
            if (ocultarVetsVinculadosClinica && idsVetsVinculadosClinica.has(Number(l.id))) return false
            if (filtroSituacao && Number(l.situacaoId) !== Number(filtroSituacao)) return false
            const blob = normalizarTextoBusca(`${l.nome} ${l.cidadeNome} ${l.tipoLabel} ${l.situacao}`)
            if (b1 && !blob.includes(b1)) return false
            if (b2 && !blob.includes(b2)) return false
            return true
        })
    }, [linhas, termoBusca1, termoBusca2, filtroSituacao, ocultarVetsVinculadosClinica, idsVetsVinculadosClinica])

    const alternarOrdenacao = (coluna) => {
        if (ordenarColuna === coluna) {
            setOrdenarDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setOrdenarColuna(coluna)
            setOrdenarDir('asc')
        }
    }

    const indicadorOrdenacao = (coluna) => {
        if (ordenarColuna !== coluna) return ''
        return ordenarDir === 'asc' ? ' ▲' : ' ▼'
    }

    const linhasFiltradasOrdenadas = useMemo(() => {
        const lista = [...linhasFiltradas]
        const fator = ordenarDir === 'asc' ? 1 : -1
        const chave =
            ordenarColuna === 'cidade'
                ? 'cidadeNome'
                : ordenarColuna === 'especialidade'
                  ? 'tipoLabel'
                  : ordenarColuna === 'situacao'
                    ? 'situacao'
                    : ordenarColuna === 'perfil'
                      ? 'perfilCompletoPct'
                      : 'nome'
        lista.sort((a, b) => {
            if (ordenarColuna === 'perfil') {
                return fator * (Number(a.perfilCompletoPct) - Number(b.perfilCompletoPct))
            }
            return (
                fator *
                String(a[chave] ?? '').localeCompare(String(b[chave] ?? ''), 'pt-BR', {
                    sensitivity: 'base',
                })
            )
        })
        return lista
    }, [linhasFiltradas, ordenarColuna, ordenarDir])

    const totalPaginas = Math.max(1, Math.ceil(linhasFiltradasOrdenadas.length / Number(itensPorPagina || 20)))
    const paginaAjustada = Math.min(Math.max(1, paginaAtual), totalPaginas)

    useEffect(() => {
        setPaginaAlvoInput(String(paginaAjustada))
    }, [paginaAjustada])

    const irParaPagina = () => {
        const paginaDesejada = Number(String(paginaAlvoInput || '').replace(/\D/g, ''))
        if (!paginaDesejada) return setPaginaAlvoInput(String(paginaAjustada))
        setPaginaAtual(Math.min(totalPaginas, Math.max(1, paginaDesejada)))
    }

    const linhasPaginadas = useMemo(() => {
        const inicio = (paginaAjustada - 1) * Number(itensPorPagina || 20)
        return linhasFiltradasOrdenadas.slice(inicio, inicio + Number(itensPorPagina || 20))
    }, [linhasFiltradasOrdenadas, paginaAjustada, itensPorPagina])

    return (
        <div className="credenciamento_main credenciamento_cadastro_lista">
            <h1>Cadastro de prestadores</h1>
            <hr />
            <p className="credenciamento_cadastro_sub">
                Ficha completa do parceiro (separada do fluxo de processo na tela Principal). Clique numa linha para editar.
            </p>

            <header className={`credenciamento_main_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className="credenciamento_main_filters">
                    <div className="credenciamento_main_filters_layout">
                        <div className="credenciamento_main_filters_selectors">
                            <div className="credenciamento_main_filters_row credenciamento_cadastro_filters_row">
                                <div className="credenciamento_main_filter_item credenciamento_main_filter_busca">
                                    <p>Busca</p>
                                    <input
                                        type="text"
                                        className="credenciamento_main_input"
                                        placeholder="Nome, cidade, tipo…"
                                        value={termoBusca1}
                                        onChange={(e) => setTermoBusca1(e.target.value)}
                                    />
                                </div>
                                <div className="credenciamento_main_filter_item credenciamento_main_filter_busca">
                                    <p>Refinar busca</p>
                                    <input
                                        type="text"
                                        className="credenciamento_main_input"
                                        placeholder="Refinar busca (2º critério)"
                                        value={termoBusca2}
                                        onChange={(e) => setTermoBusca2(e.target.value)}
                                    />
                                </div>
                                <div className="credenciamento_main_filter_item">
                                    <p>Situação</p>
                                    <select
                                        className="credenciamento_main_select"
                                        value={filtroSituacao}
                                        onChange={(e) => setFiltroSituacao(e.target.value)}
                                    >
                                        <option value="">Todas</option>
                                        {situacoes.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.descricao}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="credenciamento_main_filter_item credenciamento_cadastro_filter_switch">
                                    <p>Ocultar vets em clínicas</p>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={ocultarVetsVinculadosClinica}
                                        className={`credenciamento_switch ${ocultarVetsVinculadosClinica ? 'is-on' : 'is-off'}`}
                                        onClick={() => setOcultarVetsVinculadosClinica((v) => !v)}
                                        title="Filtro temporário: esconde prestadores que são veterinários vinculados a um estabelecimento"
                                    >
                                        <span className="credenciamento_switch_track">
                                            <span className="credenciamento_switch_knob" />
                                        </span>
                                        <span className="credenciamento_switch_label">
                                            {ocultarVetsVinculadosClinica ? 'Sim' : 'Não'}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="credenciamento_main_filters_actions">
                            {!somenteLeitura && (
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn"
                                    onClick={() => navigate('/credenciamento/cadastro/novo')}
                                >
                                    ＋ Incluir novo
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {erro && (
                <div className="credenciamento_main_alert" role="alert">
                    <span>{erro}</span>
                    <button type="button" onClick={() => setErro('')}>
                        x
                    </button>
                </div>
            )}

            <div className="credenciamento_main_table_container">
                {loading ? (
                    <p>Carregando…</p>
                ) : (
                    <>
                        <table className="table_main credenciamento_cadastro_table">
                            <thead>
                                <tr>
                                    <th className="table_header credenciamento_cadastro_th_sortable">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('nome')}
                                        >
                                            Nome{indicadorOrdenacao('nome')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('cidade')}
                                        >
                                            Cidade{indicadorOrdenacao('cidade')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('especialidade')}
                                        >
                                            Especialidade{indicadorOrdenacao('especialidade')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('perfil')}
                                            title="Completude da ficha (perfil, endereço, financeiro e cidades). Não inclui procedimentos."
                                        >
                                            Perfil %{indicadorOrdenacao('perfil')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('situacao')}
                                        >
                                            Situação{indicadorOrdenacao('situacao')}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhasPaginadas.length === 0 && (
                                    <tr>
                                        <td colSpan={5}>Nenhum prestador encontrado.</td>
                                    </tr>
                                )}
                                {linhasPaginadas.map((l) => (
                                    <tr
                                        key={l.id}
                                        className="credenciamento_main_clickrow"
                                        onClick={() => navigate(`/credenciamento/cadastro/${l.id}`)}
                                    >
                                        <td className="table_text_left credenciamento_main_nome_click">{l.nome}</td>
                                        <td className="table_text_left">{l.cidadeNome}</td>
                                        <td className="table_text_left">{l.tipoLabel}</td>
                                        <td className="table_text_left credenciamento_cadastro_perfil_pct">
                                            <span
                                                className={`credenciamento_cadastro_perfil_bar credenciamento_cadastro_perfil_bar--${l.perfilCompletoPct >= 100 ? 'full' : l.perfilCompletoPct >= 50 ? 'mid' : 'low'}`}
                                                style={{ '--pct': `${l.perfilCompletoPct}%` }}
                                                title="Perfil, endereço, financeiro e cidades (sem procedimentos)"
                                            >
                                                <span className="credenciamento_cadastro_perfil_bar_fill" />
                                            </span>
                                            <span className="credenciamento_cadastro_perfil_pct_num">{l.perfilCompletoPct}%</span>
                                        </td>
                                        <td className="table_text_left">{l.situacao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {linhasFiltradasOrdenadas.length > 0 && (
                            <div className="credenciamento_main_paginacao">
                                <div className="credenciamento_main_paginacao_info">
                                    Exibindo{' '}
                                    <strong>
                                        {(paginaAjustada - 1) * itensPorPagina + 1}-
                                        {Math.min(paginaAjustada * itensPorPagina, linhasFiltradasOrdenadas.length)}
                                    </strong>{' '}
                                    de <strong>{linhasFiltradasOrdenadas.length}</strong>
                                </div>
                                <div className="credenciamento_main_paginacao_controles">
                                    <label className="credenciamento_main_paginacao_label">
                                        Por página
                                        <select
                                            className="credenciamento_main_select"
                                            value={itensPorPagina}
                                            onChange={(e) => setItensPorPagina(Number(e.target.value))}
                                        >
                                            <option value={20}>20</option>
                                            <option value={30}>30</option>
                                            <option value={40}>40</option>
                                            <option value={100}>100</option>
                                        </select>
                                    </label>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary"
                                        onClick={() => setPaginaAtual((anterior) => Math.max(1, anterior - 1))}
                                        disabled={paginaAjustada <= 1}
                                    >
                                        Anterior
                                    </button>
                                    <span className="credenciamento_main_paginacao_page">
                                        Página {paginaAjustada} de {totalPaginas}
                                    </span>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary"
                                        onClick={() => setPaginaAtual((anterior) => Math.min(totalPaginas, anterior + 1))}
                                        disabled={paginaAjustada >= totalPaginas}
                                    >
                                        Próxima
                                    </button>
                                    <label className="credenciamento_main_paginacao_label credenciamento_main_paginacao_ir_label">
                                        Ir para
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            className="credenciamento_main_input credenciamento_main_paginacao_ir_input"
                                            value={paginaAlvoInput}
                                            onChange={(e) => setPaginaAlvoInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') irParaPagina()
                                            }}
                                        />
                                    </label>
                                    <button type="button" className="credenciamento_main_action_btn secondary" onClick={irParaPagina}>
                                        Ir
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default CredenciamentoCadastroLista
