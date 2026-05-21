import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission } from '../../../lib/accessControl'
import { supabase } from '../../../lib/supabase'
import { acharSituacaoCredenciadoId, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoCadastro.css'

const CredenciamentoCadastroLista = () => {
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [termoBusca1, setTermoBusca1] = useState('')
    const [termoBusca2, setTermoBusca2] = useState('')
    const [filtroSituacao, setFiltroSituacao] = useState('')
    const [itensPorPagina, setItensPorPagina] = useState(20)
    const [paginaAtual, setPaginaAtual] = useState(1)
    const [paginaAlvoInput, setPaginaAlvoInput] = useState('1')

    const [prestadores, setPrestadores] = useState([])
    const [cidades, setCidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])

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
            ] = await Promise.all([
                supabase
                    .from('prestadores')
                    .select(
                        'id, nome, tipo, telefone, celular, email, cidade_id, especialidade_id, situacao_id, cpf_cnpj, crmv, ativo'
                    )
                    .eq('ativo', true),
                supabase.from('cidades_credenciamento').select('id, nome').order('nome', { ascending: true }),
                supabase.from('situacoes').select('id, descricao, ordem, ativo').eq('ativo', true).order('ordem'),
                supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
            ])
            const erros = [errP, errC, errS, errE, errPc].map((e) => e?.message).filter(Boolean)
            if (erros.length) {
                setErro(erros.join(' | '))
                return
            }
            setPrestadores(prestadoresData || [])
            setCidades(cidadesData || [])
            setSituacoes(situacoesData || [])
            const credId = acharSituacaoCredenciadoId(situacoesData || [])
            if (credId) setFiltroSituacao(credId)
            setEspecialidades(especialidadesData || [])
            setPrestadorCidades(pcData || [])
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
        const onScroll = () => setHeaderCompacto(window.scrollY > 22)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        setPaginaAtual(1)
    }, [termoBusca1, termoBusca2, filtroSituacao, itensPorPagina])

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
        return (prestadores || []).map((p) => {
            const rels = cidadesPorPrestador.get(Number(p.id)) || []
            const principal = rels.find((r) => r.principal) || rels[0]
            const cidadeNome = principal ? cidadePorId.get(Number(principal.cidade_id))?.nome || '—' : '—'
            const espObj = especialidadePorId.get(Number(p.especialidade_id))
            const tipoLabel = espObj?.nome || '—'
            return {
                id: p.id,
                nome: p.nome || '—',
                cidadeNome,
                tipoLabel,
                situacaoId: p.situacao_id,
                situacao: situacaoPorId.get(Number(p.situacao_id))?.descricao || '—',
            }
        })
    }, [prestadores, prestadorCidades, cidadePorId, situacaoPorId, especialidadePorId])

    const linhasFiltradas = useMemo(() => {
        const b1 = normalizarTextoBusca(termoBusca1)
        const b2 = normalizarTextoBusca(termoBusca2)
        return linhas.filter((l) => {
            if (filtroSituacao && Number(l.situacaoId) !== Number(filtroSituacao)) return false
            const blob = normalizarTextoBusca(`${l.nome} ${l.cidadeNome} ${l.tipoLabel} ${l.situacao}`)
            if (b1 && !blob.includes(b1)) return false
            if (b2 && !blob.includes(b2)) return false
            return true
        })
    }, [linhas, termoBusca1, termoBusca2, filtroSituacao])

    const totalPaginas = Math.max(1, Math.ceil(linhasFiltradas.length / Number(itensPorPagina || 20)))
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
        return linhasFiltradas.slice(inicio, inicio + Number(itensPorPagina || 20))
    }, [linhasFiltradas, paginaAjustada, itensPorPagina])

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
                                    <th className="table_header">Nome</th>
                                    <th className="table_header">Cidade</th>
                                    <th className="table_header">Especialidade</th>
                                    <th className="table_header">Situação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhasPaginadas.length === 0 && (
                                    <tr>
                                        <td colSpan={4}>Nenhum prestador encontrado.</td>
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
                                        <td className="table_text_left">{l.situacao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {linhasFiltradas.length > 0 && (
                            <div className="credenciamento_main_paginacao">
                                <div className="credenciamento_main_paginacao_info">
                                    Exibindo{' '}
                                    <strong>
                                        {(paginaAjustada - 1) * itensPorPagina + 1}-
                                        {Math.min(paginaAjustada * itensPorPagina, linhasFiltradas.length)}
                                    </strong>{' '}
                                    de <strong>{linhasFiltradas.length}</strong>
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
