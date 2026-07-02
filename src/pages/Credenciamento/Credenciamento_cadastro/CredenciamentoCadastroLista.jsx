import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission, hasStoredDevTools } from '../../../lib/accessControl'
import { useBuscaNotAtiva, useDevToolsUi } from '../../../lib/devToolsUi'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import { contarProcedimentosDistintosPorPrestador } from '../../../lib/prestadorProcedimentos'
import { aplicarVinculosLaboratoriosPorCidadeEmMassa } from '../../../lib/vincularLaboratoriosPorCidadeTabela.js'
import {
    acharSituacaoCredenciadoId,
    calcularPercentualCompletudePerfil,
    formatarCrmvEntrada,
    filtrarPorTermoBusca,
    listarPendenciasCompletudePerfil,
    normalizarTextoBusca,
    resolverCidadePrincipalNome,
    prestadorEhEstabelecimento,
} from '../../../lib/prestadorCadastroHelpers'
import CopiarCodigosProcedimentosBtn from './CopiarCodigosProcedimentosBtn.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
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
    const aplicouDefaultSituacaoRef = useRef(!!lerEstadoListaUi())
    const pularResetPaginaRef = useRef(true)

    const [prestadores, setPrestadores] = useState([])
    const [cidades, setCidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [qtdProcedimentosPorPrestador, setQtdProcedimentosPorPrestador] = useState(() => new Map())
    const [labsMassaBusy, setLabsMassaBusy] = useState(false)
    const [feedbackLabsMassa, setFeedbackLabsMassa] = useState('')

    const { ui: devToolsUi } = useDevToolsUi()
    const podeDevTool = hasStoredDevTools()
    const buscaNotAtiva = useBuscaNotAtiva()
    const colCad = devToolsUi.colunasCadastro
    const mostrarColunaPerfil = podeDevTool && colCad.perfil
    const mostrarColunaCrmv = podeDevTool && colCad.crmv
    const mostrarColunaProcs = podeDevTool && colCad.procs
    const mostrarColunaCopiarCodigos = podeDevTool && colCad.copiarCodigosProcs
    const ocultarVetsClinica = podeDevTool && colCad.ocultarVetsClinica

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false
    }, [])

    const vincularLaboratoriosEmMassa = async () => {
        if (somenteLeitura || labsMassaBusy) return
        const ok = window.confirm(
            'Vincular em massa cada prestador (não laboratório) aos laboratórios da mesma cidade-tabela?\n\n' +
                'Critério: endereço (UF + município) resolvido via cidades_municipios_vinculo → id em cidades.\n' +
                'Vínculos já existentes são mantidos; só entram pares novos.',
        )
        if (!ok) return
        setLabsMassaBusy(true)
        setFeedbackLabsMassa('')
        setErro('')
        try {
            const stats = await aplicarVinculosLaboratoriosPorCidadeEmMassa(supabase, {
                apenasAtivos: true,
                substituir: false,
            })
            setFeedbackLabsMassa(
                `Concluído: ${stats.prestadoresComVinculo} prestador(es) com lab(s); ${stats.totalPares} par(es); ` +
                    `${stats.prestadoresSemCidadeTabela} sem cidade-tabela; ${stats.prestadoresSemLabNaRegiao} sem lab na região.`,
            )
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLabsMassaBusy(false)
        }
    }

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
            let procRows = []
            if (hasStoredDevTools() && colCad.procs) {
                const { data: procData, error: errProc } = await buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_procedimentos')
                        .select('prestador_id, procedimento_cod, procedimento_id'),
                )
                if (errProc?.message) {
                    setErro(
                        [errP, errC, errS, errE, errPc, errPe, errProc]
                            .map((e) => e?.message)
                            .filter(Boolean)
                            .join(' | '),
                    )
                    return
                }
                procRows = procData || []
            }
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
            if (hasStoredDevTools() && colCad.procs) {
                setQtdProcedimentosPorPrestador(contarProcedimentosDistintosPorPrestador(procRows))
            } else {
                setQtdProcedimentosPorPrestador(new Map())
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [colCad.procs])

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
    }, [termoBusca1, termoBusca2, filtroSituacao, itensPorPagina, ocultarVetsClinica])

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
            const cidadeNome = resolverCidadePrincipalNome(p, {
                mapaCidadeNomePorId: cidadePorId,
                relacoesCidades: rels,
            })
            const espObj = especialidadePorId.get(Number(p.especialidade_id))
            const tipoLabel = espObj?.nome || '—'
            const perfilCompletoPct = calcularPercentualCompletudePerfil(p, {
                temVinculoClinica: temVinculoClinicaPorVet.get(pid) === true,
            })
            const pendenciasPerfil = listarPendenciasCompletudePerfil(p, {
                temVinculoClinica: temVinculoClinicaPorVet.get(pid) === true,
            })
            const ehEstab = prestadorEhEstabelecimento(p.especialidade_id)
            return {
                id: p.id,
                nome: p.nome || '—',
                cidadeNome,
                tipoLabel,
                situacaoId: p.situacao_id,
                situacao: situacaoPorId.get(Number(p.situacao_id))?.descricao || '—',
                crmv: p.crmv ? formatarCrmvEntrada(String(p.crmv)) : '',
                ehEstabelecimento: ehEstab,
                perfilCompletoPct,
                pendenciasPerfil,
                qtdProcedimentos: qtdProcedimentosPorPrestador.get(pid) ?? null,
            }
        })
    }, [
        prestadores,
        prestadorCidades,
        prestadorEstabelecimentos,
        cidadePorId,
        situacaoPorId,
        especialidadePorId,
        qtdProcedimentosPorPrestador,
    ])

    const linhasFiltradas = useMemo(() => {
        const b1 = termoBusca1
        const b2 = termoBusca2
        return linhas.filter((l) => {
            if (ocultarVetsClinica && idsVetsVinculadosClinica.has(Number(l.id))) return false
            if (filtroSituacao && Number(l.situacaoId) !== Number(filtroSituacao)) return false
            const blob = normalizarTextoBusca(`${l.nome} ${l.cidadeNome} ${l.tipoLabel} ${l.situacao} ${l.crmv}`)
            if (!filtrarPorTermoBusca(blob, b1, buscaNotAtiva)) return false
            if (!filtrarPorTermoBusca(blob, b2, buscaNotAtiva)) return false
            return true
        })
    }, [
        linhas,
        termoBusca1,
        termoBusca2,
        filtroSituacao,
        buscaNotAtiva,
        ocultarVetsClinica,
        idsVetsVinculadosClinica,
    ])

    const totalColunasTabela = useMemo(() => {
        let n = 4
        if (mostrarColunaPerfil) n += 1
        if (mostrarColunaCrmv) n += 1
        if (mostrarColunaProcs) n += 1
        if (mostrarColunaCopiarCodigos) n += 1
        return n
    }, [mostrarColunaPerfil, mostrarColunaCrmv, mostrarColunaProcs, mostrarColunaCopiarCodigos])

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
                      : ordenarColuna === 'procedimentos'
                        ? 'qtdProcedimentos'
                        : 'nome'
        lista.sort((a, b) => {
            if (ordenarColuna === 'perfil') {
                return fator * (Number(a.perfilCompletoPct) - Number(b.perfilCompletoPct))
            }
            if (ordenarColuna === 'procedimentos') {
                return fator * (Number(a.qtdProcedimentos ?? 0) - Number(b.qtdProcedimentos ?? 0))
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
        <div className={`credenciamento_main credenciamento_cadastro_lista${somenteLeitura ? ' somente_leitura_lista' : ''}`}>
            <h1>Cadastro de prestadores</h1>
            <hr />

            <header className={`credenciamento_main_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2 className="credenciamento_cadastro_filters_title">Filtros</h2>
                <div className="credenciamento_main_filters">
                    <div className="credenciamento_main_filters_layout credenciamento_cadastro_filters_layout">
                        <div className="credenciamento_main_filters_selectors">
                            <div className="credenciamento_main_filters_row credenciamento_cadastro_filters_row">
                                <div className="credenciamento_main_filter_item credenciamento_main_filter_busca">
                                    <p>Busca</p>
                                    <CampoBuscaComLimpar
                                        className="credenciamento_main_input"
                                        placeholder={
                                            buscaNotAtiva
                                                ? 'Nome, cidade… ou NOT Caxias'
                                                : 'Nome, cidade, tipo…'
                                        }
                                        value={termoBusca1}
                                        onChange={(e) => setTermoBusca1(e.target.value)}
                                    />
                                </div>
                                <div className="credenciamento_main_filter_item credenciamento_main_filter_busca">
                                    <p>Refinar busca</p>
                                    <CampoBuscaComLimpar
                                        className="credenciamento_main_input"
                                        placeholder={
                                            buscaNotAtiva ? 'Refinar (NOT …)' : 'Refinar busca (2º critério)'
                                        }
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
                                {!somenteLeitura && (
                                    <div className="credenciamento_main_filter_item credenciamento_cadastro_filters_action">
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn credenciamento_cadastro_btn_novo"
                                            onClick={() => navigate('/credenciamento/cadastro/novo')}
                                        >
                                            ＋ Incluir novo
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {podeDevTool && !somenteLeitura && (
                <div className="credenciamento_cadastro_dev_massa">
                    <div className="credenciamento_cadastro_dev_massa_acoes">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            disabled={labsMassaBusy}
                            onClick={() => void vincularLaboratoriosEmMassa()}
                        >
                            {labsMassaBusy ? 'Vinculando…' : 'Dev · vincular labs por cidade-tabela (todos)'}
                        </button>
                    </div>
                    {feedbackLabsMassa ? (
                        <p className="pcad_muted pcad_servicos_massa_feedback">{feedbackLabsMassa}</p>
                    ) : null}
                </div>
            )}

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
                                    {mostrarColunaPerfil && (
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('perfil')}
                                                title="Completude da ficha (perfil, endereço e financeiro). Passe o mouse na barra para ver pendências."
                                            >
                                                Perfil %{indicadorOrdenacao('perfil')}
                                            </button>
                                        </th>
                                    )}
                                    {mostrarColunaCrmv && (
                                        <th className="table_header">CRMV</th>
                                    )}
                                    {mostrarColunaProcs && (
                                        <th className="table_header credenciamento_cadastro_th_sortable">
                                            <button
                                                type="button"
                                                className="credenciamento_cadastro_th_sort_btn"
                                                onClick={() => alternarOrdenacao('procedimentos')}
                                                title="Quantidade de procedimentos distintos no perfil (códigos únicos)"
                                            >
                                                Procs.{indicadorOrdenacao('procedimentos')}
                                            </button>
                                        </th>
                                    )}
                                    {mostrarColunaCopiarCodigos && (
                                        <th className="table_header credenciamento_cadastro_th_copiar_codigos">
                                            Códigos
                                        </th>
                                    )}
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
                                        <td colSpan={totalColunasTabela}>Nenhum prestador encontrado.</td>
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
                                        {mostrarColunaPerfil && (
                                            <td className="table_text_left credenciamento_cadastro_perfil_pct">
                                                <span
                                                    className={`credenciamento_cadastro_perfil_bar credenciamento_cadastro_perfil_bar--${l.perfilCompletoPct >= 100 ? 'full' : l.perfilCompletoPct >= 50 ? 'mid' : 'low'}`}
                                                    style={{ '--pct': `${l.perfilCompletoPct}%` }}
                                                    title={
                                                        l.pendenciasPerfil?.length
                                                            ? `Falta: ${l.pendenciasPerfil.join(', ')}`
                                                            : 'Perfil, endereço e financeiro completos (sem modalidade, atuação nem procedimentos)'
                                                    }
                                                >
                                                    <span className="credenciamento_cadastro_perfil_bar_fill" />
                                                </span>
                                                <span className="credenciamento_cadastro_perfil_pct_num">{l.perfilCompletoPct}%</span>
                                            </td>
                                        )}
                                        {mostrarColunaCrmv && (
                                            <td className="table_text_left">{l.crmv || '—'}</td>
                                        )}
                                        {mostrarColunaProcs && (
                                            <td className="table_text_left credenciamento_cadastro_qtd_procs">
                                                {l.qtdProcedimentos ?? 0}
                                            </td>
                                        )}
                                        {mostrarColunaCopiarCodigos && (
                                            <td className="table_text_left credenciamento_cadastro_td_copiar_codigos">
                                                <CopiarCodigosProcedimentosBtn
                                                    prestadorId={l.id}
                                                    compacto
                                                    rotulo="Copiar"
                                                    className="credenciamento_main_action_btn secondary credenciamento_cadastro_copiar_codigos_btn"
                                                />
                                            </td>
                                        )}
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
