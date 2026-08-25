import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission, hasStoredDevTools } from '../../../lib/accessControl'
import { useDevToolsUi } from '../../../lib/devToolsUi'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import { contarProcedimentosDistintosPorPrestador } from '../../../lib/prestadorProcedimentos'
import { aplicarVinculosLaboratoriosPorCidadeEmMassa } from '../../../lib/vincularLaboratoriosPorCidadeTabela.js'
import {
    acharSituacaoAguardandoFormularioId,
    acharSituacaoCredenciadoId,
    calcularPercentualCompletudePerfil,
    formatarCrmvEntrada,
    formatarTelefoneEntrada,
    filtrarPorTermoBusca,
    listarPendenciasCompletudePerfil,
    normalizarTextoBusca,
    resolverCidadePrincipalNome,
    prestadorEhCredenciado,
    prestadorEhEstabelecimento } from '../../../lib/prestadorCadastroHelpers'
import {
    montarEstabelecimentoPorVeterinarioDeListas,
    resolverLocalidadeEfetivaPrestador } from '../../../lib/prestadorLocalidadeVinculo.js'
import { buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import { obterOuCriarCidadeCredenciamento } from '../../../lib/cidadesCredenciamento.js'
import { montarNomeArquivoRc } from '../../../lib/rc/rcPdfNomeArquivo.js'
import {
    agruparCidadesRcPorMalha,
    carregarMalhaRc,
    listarUfsRcDisponiveis,
} from '../../../lib/rc/agruparCidadesRcPorMalha.js'
import { normalizarMunicipioChave } from '../../../lib/cidadesSupertabelaVinculos.js'
import {
    downloadRelatorioCadastrosPdf,
    formatarPeriodoYmdPtBr,
    gerarRelatorioCadastrosPdf,
    montarLinhasRelatorioCadastros,
} from '../../../lib/credenciamento/gerarRelatorioCadastrosPdf.js'
import { useAutoDismiss } from '../../../lib/toastUi.js'
import CadastroExportarPdfModal from './CadastroExportarPdfModal.jsx'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import { PageHeader } from '../../../components/ui'
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
    const [prestadorEspecialidades, setPrestadorEspecialidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [qtdProcedimentosPorPrestador, setQtdProcedimentosPorPrestador] = useState(() => new Map())
    const [labsMassaBusy, setLabsMassaBusy] = useState(false)
    const [feedbackLabsMassa, setFeedbackLabsMassa] = useState('')
    const [exportandoPdf, setExportandoPdf] = useState(false)
    const [modalExportPdfAberto, setModalExportPdfAberto] = useState(false)

    const [modalRcAberto, setModalRcAberto] = useState(false)
    const [rcCidadeBusca, setRcCidadeBusca] = useState('')
    const [rcUfFiltro, setRcUfFiltro] = useState('')
    const [rcCidadesSelecionadas, setRcCidadesSelecionadas] = useState([])
    const [rcGerando, setRcGerando] = useState(false)
    const [rcMalhaLoading, setRcMalhaLoading] = useState(false)
    const [rcMalhaCarregada, setRcMalhaCarregada] = useState(false)
    const [rcCidadesTabela, setRcCidadesTabela] = useState([])
    const [rcVinculosMalha, setRcVinculosMalha] = useState([])
    const [filtrosMaisAberto, setFiltrosMaisAberto] = useState(false)

    const [modalSimplesAberto, setModalSimplesAberto] = useState(false)
    const [simplesNome, setSimplesNome] = useState('')
    const [simplesUf, setSimplesUf] = useState('')
    const [simplesCidade, setSimplesCidade] = useState('')
    const [simplesTelefone, setSimplesTelefone] = useState('')
    const [simplesEspecialidadeId, setSimplesEspecialidadeId] = useState('')
    const [simplesSituacaoId, setSimplesSituacaoId] = useState('')
    const [municipiosUf, setMunicipiosUf] = useState([])
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false)
    const [salvandoSimples, setSalvandoSimples] = useState(false)

    useAutoDismiss(Boolean(feedbackLabsMassa), () => setFeedbackLabsMassa(''))

    const { ui: devToolsUi } = useDevToolsUi()
    const podeDevTool = hasStoredDevTools()
    const colCad = devToolsUi.colunasCadastro
    const mostrarColunaPerfil = podeDevTool && colCad.perfil
    const mostrarColunaCrmv = podeDevTool && colCad.crmv
    const mostrarColunaProcs = podeDevTool && colCad.procs
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
                substituir: false })
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
                { data: peEspData, error: errPeEsp },
            ] = await Promise.all([
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, tipo, telefone, celular, email, cidade_id, especialidade_id, situacao_id, cpf_cnpj, crmv, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, modalidade, chave_pix, tipo_repasse, credenciado_em',
                        )
                        .eq('ativo', true)
                        .order('id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase.from('cidades_credenciamento').select('id, nome').order('id', { ascending: true }),
                ),
                supabase.from('situacoes').select('id, codigo, descricao, ordem, ativo').eq('ativo', true).order('ordem'),
                supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_cidades')
                        .select('prestador_id, cidade_id, principal')
                        .order('prestador_id', { ascending: true })
                        .order('cidade_id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_estabelecimentos')
                        .select('veterinario_id, estabelecimento_id')
                        .order('veterinario_id', { ascending: true })
                        .order('estabelecimento_id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_especialidades')
                        .select('prestador_id, especialidade_id, principal')
                        .order('prestador_id', { ascending: true }),
                ),
            ])
            let procRows = []
            if (hasStoredDevTools() && colCad.procs) {
                const { data: procData, error: errProc } = await buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_procedimentos')
                        .select('prestador_id, procedimento_cod, procedimento_id')
                        .order('id', { ascending: true }),
                )
                if (errProc?.message) {
                    setErro(
                        [errP, errC, errS, errE, errPc, errPe, errPeEsp, errProc]
                            .map((e) => e?.message)
                            .filter(Boolean)
                            .join(' | '),
                    )
                    return
                }
                procRows = procData || []
            }
            const erros = [errP, errC, errS, errE, errPc, errPe, errPeEsp]
                .map((e) => e?.message)
                .filter(Boolean)
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
            setPrestadorEspecialidades(peEspData || [])
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
                ordenarDir })
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

    const estabelecimentoPorVeterinario = useMemo(
        () => montarEstabelecimentoPorVeterinarioDeListas(prestadores, prestadorEstabelecimentos),
        [prestadores, prestadorEstabelecimentos],
    )

    const cidadesPorPrestador = useMemo(() => {
        const mapa = new Map()
        prestadorCidades.forEach((rel) => {
            const pid = Number(rel.prestador_id)
            if (!mapa.has(pid)) mapa.set(pid, [])
            mapa.get(pid).push(rel)
        })
        return mapa
    }, [prestadorCidades])

    /** Municípios com credenciados (nomes usados no PDF da RC). */
    const nomesCidadesRcBase = useMemo(() => {
        const nomes = new Set()
        /** @type {Map<string, string>} */
        const ufPorNome = new Map()
        for (const p of prestadores) {
            if (!prestadorEhCredenciado(p, situacoes)) continue
            const pid = Number(p.id)
            const { prestador: pLoc, prestadorIdCidades } = resolverLocalidadeEfetivaPrestador(
                p,
                estabelecimentoPorVeterinario,
            )
            const ufPrestador = String(pLoc?.endereco_uf || p?.endereco_uf || '')
                .trim()
                .toUpperCase()
            const rels = cidadesPorPrestador.get(prestadorIdCidades) || cidadesPorPrestador.get(pid) || []
            const principal = resolverCidadePrincipalNome(pLoc, {
                mapaCidadeNomePorId: cidadePorId,
                relacoesCidades: rels,
            })
            const registrar = (nome) => {
                const n = String(nome || '').trim()
                if (!n || n === '—') return
                nomes.add(n)
                const chave = normalizarMunicipioChave(n)
                if (chave && ufPrestador && !ufPorNome.has(chave)) ufPorNome.set(chave, ufPrestador)
            }
            registrar(principal)
            for (const rel of rels) {
                registrar(cidadePorId.get(Number(rel.cidade_id))?.nome)
            }
        }
        return {
            nomes: [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
            ufPorNome,
        }
    }, [
        prestadores,
        situacoes,
        estabelecimentoPorVeterinario,
        cidadesPorPrestador,
        cidadePorId,
    ])

    const ufsRcDisponiveis = useMemo(
        () =>
            listarUfsRcDisponiveis(
                nomesCidadesRcBase.nomes,
                nomesCidadesRcBase.ufPorNome,
                rcCidadesTabela,
                rcVinculosMalha,
            ),
        [nomesCidadesRcBase, rcCidadesTabela, rcVinculosMalha],
    )

    const gruposCidadesRc = useMemo(
        () =>
            agruparCidadesRcPorMalha(
                nomesCidadesRcBase.nomes,
                nomesCidadesRcBase.ufPorNome,
                rcCidadesTabela,
                rcVinculosMalha,
                { uf: rcUfFiltro, termo: rcCidadeBusca },
            ),
        [
            nomesCidadesRcBase,
            rcCidadesTabela,
            rcVinculosMalha,
            rcUfFiltro,
            rcCidadeBusca,
        ],
    )

    const linhas = useMemo(() => {
        const temVinculoClinicaPorVet = new Map()
        ;(prestadorEstabelecimentos || []).forEach((rel) => {
            const vid = Number(rel.veterinario_id)
            if (vid) temVinculoClinicaPorVet.set(vid, true)
        })
        return (prestadores || []).map((p) => {
            const pid = Number(p.id)
            const { prestador: pLoc, prestadorIdCidades } = resolverLocalidadeEfetivaPrestador(
                p,
                estabelecimentoPorVeterinario,
            )
            const rels = cidadesPorPrestador.get(prestadorIdCidades) || cidadesPorPrestador.get(pid) || []
            const cidadeNome = resolverCidadePrincipalNome(pLoc, {
                mapaCidadeNomePorId: cidadePorId,
                relacoesCidades: rels })
            const espObj = especialidadePorId.get(Number(p.especialidade_id))
            const tipoLabel = espObj?.nome || '—'
            const perfilCompletoPct = calcularPercentualCompletudePerfil(p, {
                temVinculoClinica: temVinculoClinicaPorVet.get(pid) === true })
            const pendenciasPerfil = listarPendenciasCompletudePerfil(p, {
                temVinculoClinica: temVinculoClinicaPorVet.get(pid) === true })
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
                qtdProcedimentos: qtdProcedimentosPorPrestador.get(pid) ?? null }
        })
    }, [
        prestadores,
        prestadorEstabelecimentos,
        estabelecimentoPorVeterinario,
        cidadesPorPrestador,
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
            if (!filtrarPorTermoBusca(blob, b1)) return false
            if (!filtrarPorTermoBusca(blob, b2)) return false
            return true
        })
    }, [
        linhas,
        termoBusca1,
        termoBusca2,
        filtroSituacao,
        ocultarVetsClinica,
        idsVetsVinculadosClinica,
    ])

    const totalColunasTabela = useMemo(() => {
        let n = 4
        if (mostrarColunaPerfil) n += 1
        if (mostrarColunaCrmv) n += 1
        if (mostrarColunaProcs) n += 1
        return n
    }, [mostrarColunaPerfil, mostrarColunaCrmv, mostrarColunaProcs])

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
                    sensitivity: 'base' })
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

    const abrirModalRc = () => {
        setRcCidadeBusca('')
        setRcUfFiltro('')
        setRcCidadesSelecionadas([])
        setModalRcAberto(true)
        if (rcMalhaCarregada) return
        setRcMalhaLoading(true)
        void carregarMalhaRc()
            .then(({ cidadesTabela, vinculos }) => {
                setRcCidadesTabela(cidadesTabela)
                setRcVinculosMalha(vinculos)
                setRcMalhaCarregada(true)
            })
            .catch((e) => {
                setErro(e?.message || 'Falha ao carregar malha de cidades para a RC.')
            })
            .finally(() => setRcMalhaLoading(false))
    }

    const alternarCidadeRc = (nomeCidade) => {
        setRcCidadesSelecionadas((anteriores) =>
            anteriores.includes(nomeCidade)
                ? anteriores.filter((nome) => nome !== nomeCidade)
                : [...anteriores, nomeCidade],
        )
    }

    const alternarRegiaoRc = (cidadesDaRegiao) => {
        const lista = (cidadesDaRegiao || []).map((c) => String(c || '').trim()).filter(Boolean)
        if (!lista.length) return
        setRcCidadesSelecionadas((anteriores) => {
            const set = new Set(anteriores)
            const todasMarcadas = lista.every((c) => set.has(c))
            if (todasMarcadas) {
                lista.forEach((c) => set.delete(c))
            } else {
                lista.forEach((c) => set.add(c))
            }
            return [...set]
        })
    }

    const exportarPdfCadastros = async ({ periodoDe, periodoAte, situacaoIds }) => {
        if (exportandoPdf) return
        if (!periodoDe || !periodoAte) {
            setErro('Informe o período de exportação.')
            return
        }
        const idsSit = (situacaoIds || []).map(Number).filter(Boolean)
        if (!idsSit.length) {
            setErro('Selecione ao menos uma situação para o relatório.')
            return
        }
        if (!prestadores.length) {
            setErro('Nenhum cadastro carregado para exportar.')
            return
        }
        setExportandoPdf(true)
        setErro('')
        try {
            const linhasPdf = montarLinhasRelatorioCadastros({
                prestadores,
                situacoes,
                especialidades,
                cidadesCred: cidades,
                prestadorEspecialidades,
                prestadorCidades,
                estabelecimentoPorVeterinario,
                periodoDe,
                periodoAte,
                situacaoIds: idsSit,
            })

            if (!linhasPdf.length) {
                setErro(
                    `Nenhum cadastro no período ${formatarPeriodoYmdPtBr(periodoDe, periodoAte)} com as situações selecionadas.`,
                )
                return
            }

            const nomesSit = idsSit
                .map((id) => situacoes.find((s) => Number(s.id) === id)?.descricao)
                .filter(Boolean)
            const sitLabel =
                nomesSit.length <= 3
                    ? nomesSit.join(', ')
                    : `${nomesSit.slice(0, 2).join(', ')} +${nomesSit.length - 2}`
            const periodoLabel = formatarPeriodoYmdPtBr(periodoDe, periodoAte)
            const partesSub = [
                `Período (Credenciado Em): ${periodoLabel}`,
                `${linhasPdf.length} registro(s)`,
                `Situação(ões): ${sitLabel}`,
            ]

            const blob = await gerarRelatorioCadastrosPdf({
                linhas: linhasPdf,
                subtitulo: partesSub.join(' · '),
                periodoDe,
                periodoAte,
            })
            downloadRelatorioCadastrosPdf(
                blob,
                `${periodoDe}_${periodoAte}-${idsSit.length}sit`,
            )
            setModalExportPdfAberto(false)
        } catch (e) {
            setErro(e?.message || 'Falha ao gerar PDF do relatório de cadastros.')
        } finally {
            setExportandoPdf(false)
        }
    }

    const gerarPdfRc = async () => {
        if (!rcCidadesSelecionadas.length) {
            setErro('Selecione pelo menos uma cidade para gerar a RC.')
            return
        }
        try {
            setRcGerando(true)
            setErro('')
            const { data: sess } = await (await import('../../../lib/supabase')).supabase.auth.getSession()
            const token = sess?.session?.access_token
            const response = await fetch('/api/rc-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ cidades: rcCidadesSelecionadas }),
            })
            const erroJson = await response.clone().json().catch(() => null)
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(
                        'API RC não encontrada no dev local. Rode "npm run dev:api" e mantenha "npm run dev" em paralelo.',
                    )
                }
                throw new Error(erroJson?.error || 'Falha ao gerar PDF da RC.')
            }
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = montarNomeArquivoRc(rcCidadesSelecionadas)
            a.click()
            URL.revokeObjectURL(url)
            setModalRcAberto(false)
        } catch (error) {
            setErro(`Falha ao gerar RC: ${error?.message || error}`)
        } finally {
            setRcGerando(false)
        }
    }

    const abrirModalSimples = () => {
        setSimplesNome('')
        setSimplesUf('')
        setSimplesCidade('')
        setSimplesTelefone('')
        setSimplesEspecialidadeId('')
        setMunicipiosUf([])
        setErro('')
        setModalSimplesAberto(true)
        void (async () => {
            let id = acharSituacaoAguardandoFormularioId(situacoes)
            if (!id) {
                try {
                    const maxOrdem = situacoes.reduce((m, s) => Math.max(m, Number(s.ordem) || 0), 0)
                    const payloadBase = {
                        descricao: 'Aguardando Formulário',
                        codigo: 'AGUARDANDO_FORMULARIO',
                        ativo: true,
                    }
                    let data = null
                    let error = null
                    ;({ data, error } = await supabase
                        .from('situacoes')
                        .insert({
                            ...payloadBase,
                            ordem: maxOrdem + 1,
                        })
                        .select('id, codigo, descricao, ordem, ativo')
                        .single())
                    if (error) {
                        // Já existe com esse código, ou coluna ordem indisponível — tenta reutilizar / insert mínimo
                        const { data: existente } = await supabase
                            .from('situacoes')
                            .select('id, codigo, descricao, ordem, ativo')
                            .eq('codigo', 'AGUARDANDO_FORMULARIO')
                            .maybeSingle()
                        if (existente?.id) {
                            data = existente
                            error = null
                        } else {
                            ;({ data, error } = await supabase
                                .from('situacoes')
                                .insert(payloadBase)
                                .select('id, codigo, descricao, ordem, ativo')
                                .single())
                        }
                    }
                    if (error) throw new Error(error.message)
                    setSituacoes((anteriores) => {
                        if (anteriores.some((s) => Number(s.id) === Number(data.id))) return anteriores
                        return [...anteriores, data].sort((a, b) => Number(a.ordem) - Number(b.ordem))
                    })
                    id = String(data.id)
                } catch (e) {
                    setErro(
                        e?.message ||
                            'Situação «Aguardando Formulário» não encontrada. Cadastre-a em Situações.',
                    )
                }
            }
            setSimplesSituacaoId(id)
        })()
    }

    useEffect(() => {
        if (!modalSimplesAberto || !simplesUf) {
            setMunicipiosUf([])
            return
        }
        let cancelado = false
        setCarregandoMunicipios(true)
        void (async () => {
            try {
                const lista = await buscarMunicipiosPorUf(simplesUf)
                if (!cancelado) setMunicipiosUf(lista)
            } catch (e) {
                if (!cancelado) {
                    setMunicipiosUf([])
                    setErro(e?.message || 'Não foi possível carregar cidades desta UF.')
                }
            } finally {
                if (!cancelado) setCarregandoMunicipios(false)
            }
        })()
        return () => {
            cancelado = true
        }
    }, [modalSimplesAberto, simplesUf])

    const salvarNovoSimples = async () => {
        if (somenteLeitura) return setErro('Seu perfil tem acesso somente leitura para credenciamento.')
        if (!simplesNome.trim()) return setErro('Nome é obrigatório.')
        if (!simplesEspecialidadeId) return setErro('Especialidade é obrigatória.')
        if (!simplesUf) return setErro('UF é obrigatória.')
        if (!simplesCidade.trim()) return setErro('Cidade é obrigatória.')
        const situacaoId =
            simplesSituacaoId || acharSituacaoAguardandoFormularioId(situacoes)
        if (!situacaoId) {
            return setErro('Situação «Aguardando Formulário» não encontrada. Cadastre-a em Situações ou reabra o modal.')
        }
        const espSelecionada =
            (especialidades || []).find((e) => Number(e.id) === Number(simplesEspecialidadeId)) || null
        if (!espSelecionada?.id) {
            return setErro('Especialidade inválida. Selecione novamente.')
        }
        try {
            setSalvandoSimples(true)
            setErro('')
            const agora = new Date().toISOString()
            const cidadeObj = await obterOuCriarCidadeCredenciamento(simplesCidade.trim())
            const tipoSalvar = String(espSelecionada.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'
            const payload = {
                nome: simplesNome.trim(),
                telefone: simplesTelefone.trim() || null,
                endereco_uf: simplesUf,
                endereco_cidade: simplesCidade.trim(),
                endereco_pais: 'Brasil',
                situacao_id: Number(situacaoId),
                especialidade_id: Number(espSelecionada.id),
                tipo: tipoSalvar,
                cidade_id: cidadeObj?.id ? Number(cidadeObj.id) : null,
                ativo: true,
                data_cadastro: agora,
                data_atualizacao: agora,
            }
            let { data: ins, error: errIns } = await supabase
                .from('prestadores')
                .insert(payload)
                .select('id')
                .single()
            if (errIns && /tipo/i.test(String(errIns.message || ''))) {
                const { tipo: _t, ...semTipo } = payload
                const retry = await supabase.from('prestadores').insert(semTipo).select('id').single()
                ins = retry.data
                errIns = retry.error
            }
            if (errIns) {
                const detalhe = [errIns.message, errIns.details, errIns.hint].filter(Boolean).join(' — ')
                throw new Error(detalhe || 'Falha ao salvar cadastro simples.')
            }
            const novoId = Number(ins?.id)
            if (novoId) {
                await supabase.from('prestador_especialidades').upsert(
                    [
                        {
                            prestador_id: novoId,
                            especialidade_id: Number(espSelecionada.id),
                            principal: true,
                        },
                    ],
                    { onConflict: 'prestador_id,especialidade_id', ignoreDuplicates: true },
                )
                if (cidadeObj?.id) {
                    await supabase.from('prestador_cidades').upsert(
                        [
                            {
                                prestador_id: novoId,
                                cidade_id: Number(cidadeObj.id),
                                principal: true,
                            },
                        ],
                        { onConflict: 'prestador_id,cidade_id', ignoreDuplicates: true },
                    )
                }
            }
            setModalSimplesAberto(false)
            await carregar()
            if (novoId) navigate(`/credenciamento/cadastro/${novoId}`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setSalvandoSimples(false)
        }
    }

    return (
        <div className={`el-legacy-wrap credenciamento_main credenciamento_cadastro_lista${somenteLeitura ? ' somente_leitura_lista' : ''}`}>
            <PageHeader kicker="Credenciamento" title="Cadastro de prestadores" />

            <header className={`credenciamento_main_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2 className="credenciamento_cadastro_filters_title">Filtros</h2>
                <div className="credenciamento_main_filters credenciamento_cadastro_filters">
                    <div className="credenciamento_cadastro_filters_row_busca">
                        <label className="credenciamento_cadastro_field">
                            <span>Busca 1</span>
                            <CampoBuscaComLimpar
                                className="credenciamento_main_input"
                                placeholder="Nome, cidade, tipo…"
                                value={termoBusca1}
                                onChange={(e) => setTermoBusca1(e.target.value)}
                            />
                        </label>
                        <label className="credenciamento_cadastro_field">
                            <span>Busca 2</span>
                            <CampoBuscaComLimpar
                                className="credenciamento_main_input"
                                placeholder="2º critério…"
                                value={termoBusca2}
                                onChange={(e) => setTermoBusca2(e.target.value)}
                            />
                        </label>
                        <label className="credenciamento_cadastro_field credenciamento_cadastro_field--situacao">
                            <span>Situação</span>
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
                        </label>
                        <button
                            type="button"
                            className={`credenciamento_main_action_btn secondary credenciamento_cadastro_mais_btn${filtrosMaisAberto ? ' is-open' : ''}`}
                            aria-expanded={filtrosMaisAberto}
                            aria-controls="credenciamento-cadastro-acoes"
                            onClick={() => setFiltrosMaisAberto((v) => !v)}
                        >
                            Mais
                            <span className="credenciamento_cadastro_mais_chevron" aria-hidden="true">
                                {filtrosMaisAberto ? '▴' : '▾'}
                            </span>
                        </button>
                    </div>

                    {filtrosMaisAberto ? (
                        <div
                            id="credenciamento-cadastro-acoes"
                            className="credenciamento_cadastro_filters_row_acoes"
                        >
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={exportandoPdf || loading}
                                onClick={() => setModalExportPdfAberto(true)}
                                title="Exporta PDF pelos critérios do modal (período e situações)"
                            >
                                Relatório
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={abrirModalRc}
                                title="Imprimir rede credenciada (RC)"
                            >
                                Rede Cred.
                            </button>
                            {!somenteLeitura ? (
                                <>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary"
                                        onClick={abrirModalSimples}
                                    >
                                        Novo Simples
                                    </button>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn credenciamento_cadastro_btn_novo"
                                        onClick={() => navigate('/credenciamento/cadastro/novo')}
                                    >
                                        Novo
                                    </button>
                                </>
                            ) : null}
                            {podeDevTool && !somenteLeitura ? (
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary credenciamento_cadastro_btn_dev_labs"
                                    disabled={labsMassaBusy}
                                    onClick={() => void vincularLaboratoriosEmMassa()}
                                    title="Dev: vincular laboratórios por cidade-tabela em todos os prestadores"
                                >
                                    {labsMassaBusy ? 'Vinculando…' : 'Dev · vincular labs'}
                                </button>
                            ) : null}
                            {podeDevTool && feedbackLabsMassa ? (
                                <p className="pcad_muted pcad_servicos_massa_feedback credenciamento_cadastro_dev_labs_feedback">
                                    {feedbackLabsMassa}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </header>

            <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />

            <div className="credenciamento_main_table_container">
                {loading ? (
                    <p>Carregando…</p>
                ) : (
                    <>
                        <div className="credenciamento_cadastro_table_wrap">
                        <table className="table_main credenciamento_cadastro_table">
                            <thead>
                                <tr>
                                    <th className="table_header credenciamento_cadastro_th_sortable cred_col_pin cred_col_pin--nome">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('nome')}
                                        >
                                            Nome{indicadorOrdenacao('nome')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable cred_col_pin cred_col_pin--cidade">
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_th_sort_btn"
                                            onClick={() => alternarOrdenacao('cidade')}
                                        >
                                            Cidade{indicadorOrdenacao('cidade')}
                                        </button>
                                    </th>
                                    <th className="table_header credenciamento_cadastro_th_sortable cred_col_pin cred_col_pin--especialidade">
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
                                    <th className="table_header credenciamento_cadastro_th_sortable cred_col_situacao">
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
                                        <td className="table_text_left credenciamento_main_nome_click cred_col_pin cred_col_pin--nome">
                                            {l.nome}
                                        </td>
                                        <td className="table_text_left cred_col_pin cred_col_pin--cidade">
                                            {l.cidadeNome}
                                        </td>
                                        <td className="table_text_left cred_col_pin cred_col_pin--especialidade">
                                            {l.tipoLabel}
                                        </td>
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
                                        <td className="table_text_left cred_col_situacao">{l.situacao}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>

                        <ul className="credenciamento_cadastro_cards" aria-label="Lista de prestadores">
                            {linhasPaginadas.length === 0 ? (
                                <li className="credenciamento_cadastro_card is-empty">
                                    Nenhum prestador encontrado.
                                </li>
                            ) : (
                                linhasPaginadas.map((l) => (
                                    <li key={`card-${l.id}`}>
                                        <button
                                            type="button"
                                            className="credenciamento_cadastro_card"
                                            onClick={() => navigate(`/credenciamento/cadastro/${l.id}`)}
                                        >
                                            <span className="credenciamento_cadastro_card_nome">{l.nome}</span>
                                            <span className="credenciamento_cadastro_card_meta">
                                                <span className="credenciamento_cadastro_card_label">Cidade</span>
                                                <span>{l.cidadeNome || '—'}</span>
                                            </span>
                                            <span className="credenciamento_cadastro_card_meta">
                                                <span className="credenciamento_cadastro_card_label">Especialidade</span>
                                                <span>{l.tipoLabel || '—'}</span>
                                            </span>
                                            <span className="credenciamento_cadastro_card_meta credenciamento_cadastro_card_meta--situacao">
                                                <span className="credenciamento_cadastro_card_label">Situação</span>
                                                <span className="credenciamento_cadastro_card_situacao">
                                                    {l.situacao || '—'}
                                                </span>
                                            </span>
                                            {mostrarColunaPerfil ? (
                                                <span className="credenciamento_cadastro_card_meta">
                                                    <span className="credenciamento_cadastro_card_label">Perfil</span>
                                                    <span>{l.perfilCompletoPct}%</span>
                                                </span>
                                            ) : null}
                                            {mostrarColunaCrmv ? (
                                                <span className="credenciamento_cadastro_card_meta">
                                                    <span className="credenciamento_cadastro_card_label">CRMV</span>
                                                    <span>{l.crmv || '—'}</span>
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>

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
                                    <div className="credenciamento_main_paginacao_grupo">
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
                                    </div>
                                    <div className="credenciamento_main_paginacao_grupo credenciamento_main_paginacao_grupo--nav">
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
                                            onClick={() =>
                                                setPaginaAtual((anterior) => Math.min(totalPaginas, anterior + 1))
                                            }
                                            disabled={paginaAjustada >= totalPaginas}
                                        >
                                            Próxima
                                        </button>
                                    </div>
                                    <div className="credenciamento_main_paginacao_grupo credenciamento_main_paginacao_grupo--ir">
                                        <label className="credenciamento_main_paginacao_label credenciamento_main_paginacao_ir_label">
                                            Ir para
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                className="credenciamento_main_input credenciamento_main_paginacao_ir_input"
                                                value={paginaAlvoInput}
                                                onChange={(e) =>
                                                    setPaginaAlvoInput(e.target.value.replace(/\D/g, '').slice(0, 4))
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') irParaPagina()
                                                }}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn secondary"
                                            onClick={irParaPagina}
                                        >
                                            Ir
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <CadastroExportarPdfModal
                aberto={modalExportPdfAberto}
                onClose={() => !exportandoPdf && setModalExportPdfAberto(false)}
                exportando={exportandoPdf}
                situacoes={situacoes}
                situacaoIdsIniciais={null}
                onConfirmar={(opts) => void exportarPdfCadastros(opts)}
            />

            {modalRcAberto && (
                <div className="credenciamento_modal_backdrop" onClick={() => setModalRcAberto(false)}>
                    <div
                        className="credenciamento_modal credenciamento_rc_modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>Gerar RC por cidades</h3>
                        <p className="credenciamento_rc_modal_hint">
                            Cidades agrupadas por região da malha (Super-Tabela). Filtre por estado ou
                            pesquise a região / município.
                        </p>
                        <div className="credenciamento_rc_filtros">
                            <label className="credenciamento_rc_filtro_uf">
                                <span>Estado (UF)</span>
                                <SelectUfBusca
                                    value={rcUfFiltro}
                                    onChange={setRcUfFiltro}
                                    ufs={ufsRcDisponiveis}
                                    disabled={rcMalhaLoading}
                                    inputClassName="credenciamento_main_select"
                                    placeholder="Todos"
                                    emptyLabel="Todos"
                                    aria-label="Filtrar RC por UF"
                                />
                            </label>
                            <label className="credenciamento_modal_full credenciamento_rc_filtro_busca">
                                <span>Buscar região ou cidade</span>
                                <CampoBuscaComLimpar
                                    value={rcCidadeBusca}
                                    onChange={(event) => setRcCidadeBusca(event.target.value)}
                                    placeholder="Ex.: Curitiba, Litoral, PR…"
                                    className="credenciamento_main_input"
                                />
                            </label>
                        </div>
                        {rcCidadesSelecionadas.length > 0 ? (
                            <p className="credenciamento_rc_selecao_resumo">
                                {rcCidadesSelecionadas.length} cidade
                                {rcCidadesSelecionadas.length === 1 ? '' : 's'} selecionada
                                {rcCidadesSelecionadas.length === 1 ? '' : 's'}
                            </p>
                        ) : null}
                        <div className="credenciamento_rc_cidades_lista">
                            {rcMalhaLoading ? (
                                <p className="credenciamento_rc_lista_vazio">A carregar malha…</p>
                            ) : gruposCidadesRc.length === 0 ? (
                                <p className="credenciamento_rc_lista_vazio">
                                    Nenhuma cidade encontrada com os filtros atuais.
                                </p>
                            ) : (
                                gruposCidadesRc.map((grupo) => {
                                    const todasMarcadas =
                                        grupo.cidades.length > 0 &&
                                        grupo.cidades.every((c) => rcCidadesSelecionadas.includes(c))
                                    const algumasMarcadas =
                                        !todasMarcadas &&
                                        grupo.cidades.some((c) => rcCidadesSelecionadas.includes(c))
                                    const tituloRegiao = grupo.uf
                                        ? `${grupo.regiaoNome} (${grupo.uf})`
                                        : grupo.regiaoNome
                                    return (
                                        <section
                                            key={grupo.regiaoKey}
                                            className="credenciamento_rc_regiao"
                                        >
                                            <label className="credenciamento_rc_regiao_head">
                                                <input
                                                    type="checkbox"
                                                    checked={todasMarcadas}
                                                    ref={(el) => {
                                                        if (el) el.indeterminate = algumasMarcadas
                                                    }}
                                                    onChange={() => alternarRegiaoRc(grupo.cidades)}
                                                />
                                                <span className="credenciamento_rc_regiao_titulo">
                                                    {tituloRegiao}
                                                </span>
                                                <span className="credenciamento_rc_regiao_count">
                                                    {grupo.cidades.length}
                                                </span>
                                            </label>
                                            <div className="credenciamento_rc_regiao_cidades">
                                                {grupo.cidades.map((cidade) => (
                                                    <label
                                                        key={`rc-cidade-${grupo.regiaoKey}-${cidade}`}
                                                        className="credenciamento_rc_cidade_item"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={rcCidadesSelecionadas.includes(
                                                                cidade,
                                                            )}
                                                            onChange={() => alternarCidadeRc(cidade)}
                                                        />
                                                        <span>{cidade}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </section>
                                    )
                                })
                            )}
                        </div>
                        <div className="credenciamento_modal_actions">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                onClick={() => void gerarPdfRc()}
                                disabled={rcGerando || !rcCidadesSelecionadas.length}
                            >
                                {rcGerando ? 'Gerando...' : 'Gerar RC'}
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={() => setModalRcAberto(false)}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modalSimplesAberto && (
                <div className="credenciamento_modal_backdrop" onClick={() => setModalSimplesAberto(false)}>
                    <div
                        className="credenciamento_modal credenciamento_cadastro_simples_modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>Novo cadastro simples</h3>
                        <div className="credenciamento_modal_grid credenciamento_cadastro_simples_grid">
                            <label className="credenciamento_cadastro_simples_nome">
                                <span>Nome *</span>
                                <input
                                    type="text"
                                    value={simplesNome}
                                    onChange={(e) => setSimplesNome(e.target.value)}
                                    autoFocus
                                />
                            </label>
                            <label className="credenciamento_cadastro_simples_especialidade">
                                <span>Especialidade *</span>
                                <select
                                    value={simplesEspecialidadeId}
                                    onChange={(e) => setSimplesEspecialidadeId(e.target.value)}
                                >
                                    <option value="">Selecione</option>
                                    {especialidades.map((e) => (
                                        <option key={e.id} value={e.id}>
                                            {e.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="credenciamento_cadastro_simples_telefone">
                                <span>Telefone</span>
                                <input
                                    type="text"
                                    value={simplesTelefone}
                                    onChange={(e) => setSimplesTelefone(formatarTelefoneEntrada(e.target.value))}
                                    placeholder="(00) 00000-0000"
                                />
                            </label>
                            <label className="credenciamento_cadastro_simples_situacao">
                                <span>Situação</span>
                                <select
                                    value={simplesSituacaoId}
                                    onChange={(e) => setSimplesSituacaoId(e.target.value)}
                                >
                                    <option value="">Selecione</option>
                                    {situacoes.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.descricao}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="credenciamento_cadastro_simples_uf">
                                <span>UF *</span>
                                <SelectUfBusca
                                    value={simplesUf}
                                    emptyLabel="UF"
                                    placeholder="UF"
                                    onChange={(u) => {
                                        setSimplesUf(u)
                                        setSimplesCidade('')
                                    }}
                                />
                            </label>
                            <label className="credenciamento_cadastro_simples_cidade">
                                <span>Cidade *</span>
                                <SelectMunicipioBusca
                                    value={simplesCidade}
                                    options={municipiosUf}
                                    disabled={!simplesUf || carregandoMunicipios}
                                    loading={carregandoMunicipios}
                                    placeholder={!simplesUf ? 'Selecione a UF' : 'Buscar cidade…'}
                                    onChange={setSimplesCidade}
                                />
                            </label>
                        </div>
                        <div className="credenciamento_modal_actions">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                onClick={() => void salvarNovoSimples()}
                                disabled={salvandoSimples}
                            >
                                {salvandoSimples ? 'Salvando…' : 'Salvar'}
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={() => setModalSimplesAberto(false)}
                                disabled={salvandoSimples}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default CredenciamentoCadastroLista
