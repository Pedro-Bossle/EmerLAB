import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PERMISSION_KEYS, hasStoredDevTools, hasStoredPermission } from '../../../lib/accessControl'
import { useBuscaNotAtiva, useDevToolsUi } from '../../../lib/devToolsUi'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { calcularJanelaVirtualTabela, criarHandlerScrollVirtualTabela } from '../../../lib/tabelaVirtualScroll.js'
import { extrairCodigosProcedimentoEmMassa } from '../../../lib/parseCodigosEmMassa'
import { exportarNegociacaoParaExcel } from '../../../lib/exportNegociacaoExcel.js'
import { carregarMapaNomesAlternativosPrestador } from '../../../lib/prestadorNomeAlternativo.js'
import { carregarCodigosPrestadorProcedimentos } from '../../../lib/prestadorProcedimentos.js'
import { TOAST_AUTO_DISMISS_MS, useConfirmacaoExclusaoAutoDismiss } from '../../../lib/toastUi.js'
import PrestadorVinculoBusca from './PrestadorVinculoBusca.jsx'
import {
    buscarCidadeIdsFiltroPlanoCredenciados,
    carregarVinculosMunicipios,
    cidadeExibicaoNegociacaoPrestador,
    resolverCidadeIdTabelaNegociacao,
} from '../../../lib/cidadesSupertabelaVinculos.js'
import '../Supertabela_main/Supertabelamain.css'
import './Supertabelanegociacoes.css'

const ALTURA_LINHA_TABELA = 42
const MAX_LINHAS_VISIVEIS = 10
const LINHAS_OVERSCAN = 6

/** Hierarquia de plano base (Básico → Ultra), alinhada à Supertabela main. */
const ORDEM_PLANOS = ['basico', 'classico', 'avancado', 'ultra']
const ROTULO_PLANO = {
    basico: 'Básico',
    classico: 'Clássico',
    avancado: 'Avançado',
    ultra: 'Ultra',
}

const normalizarPlanoNome = (nome) =>
    String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const mapearPlanosListaPorChave = (lista) => {
    const usados = new Set()
    const resultado = {}
    const localizar = (chave, matcher) => {
        const encontrado = lista.find((plano) => {
            if (usados.has(plano.id)) return false
            return matcher(normalizarPlanoNome(plano.nome))
        })
        if (encontrado) {
            usados.add(encontrado.id)
            resultado[chave] = { id: Number(encontrado.id), nome: encontrado.nome }
        } else {
            resultado[chave] = null
        }
    }
    localizar('basico', (nome) => nome.includes('BASICO') || nome.includes('BASIC'))
    localizar('classico', (nome) => nome.includes('CLASSICO'))
    localizar('avancado', (nome) => nome.includes('AVANCADO'))
    localizar('ultra', (nome) => nome.includes('ULTRA'))
    return resultado
}

const obterChavePlanoPorId = (planoIdValor, mapaPlanosLocal) => {
    const idNumerico = Number(planoIdValor)
    if (!idNumerico) return null
    return ORDEM_PLANOS.find((chave) => Number(mapaPlanosLocal[chave]?.id) === idNumerico) || null
}

const obterChavePlanoProcedimento = (planoBaseId, mapaPlanosLocal, planosLista) => {
    const porNome = obterChavePlanoPorId(planoBaseId, mapaPlanosLocal)
    if (porNome) return porNome
    const idNum = Number(planoBaseId)
    if (!idNum) return 'basico'
    const idx = planosLista.findIndex((p) => Number(p.id) === idNum)
    if (idx >= 0 && idx < ORDEM_PLANOS.length) return ORDEM_PLANOS[idx]
    return 'basico'
}

const obterChavePlanoFiltroAtivo = (planoIdStr, planosLista, mapaPlanos) => {
    const planoIdNumerico = Number(planoIdStr)
    const chavePorMapa = ORDEM_PLANOS.find((chave) => Number(mapaPlanos[chave]?.id) === planoIdNumerico)
    if (chavePorMapa) return chavePorMapa
    const indicePorPosicao = planosLista.findIndex((plano) => Number(plano.id) === planoIdNumerico)
    if (indicePorPosicao >= 0 && indicePorPosicao < ORDEM_PLANOS.length) {
        return ORDEM_PLANOS[indicePorPosicao]
    }
    return null
}

const normalizarTexto = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const normalizarNumeroEntrada = (valorTexto) => {
    const texto = String(valorTexto || '').trim().replace(/\s/g, '')
    if (!texto) return NaN
    const temPonto = texto.includes('.')
    const temVirgula = texto.includes(',')
    if (temPonto && temVirgula) return Number(texto.replace(/\./g, '').replace(',', '.'))
    if (temVirgula) return Number(texto.replace(',', '.'))
    return Number(texto)
}

const Supertabelanegociacoes = () => {
    const [somenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT))
    const buscaNotAtiva = useBuscaNotAtiva()
    const { ui: devToolsUi } = useDevToolsUi()
    const podeDevToolNeg = hasStoredDevTools()
    const mostrarColunaVinculoLista =
        !podeDevToolNeg || !!devToolsUi.colunasNegociacoes?.vinculoPrestadorLista
    const [cidades, setCidades] = useState([])
    const [planos, setPlanos] = useState([])
    const [portes, setPortes] = useState([])
    const [categorias, setCategorias] = useState([])
    const [procedimentos, setProcedimentos] = useState([])
    const [negociacoes, setNegociacoes] = useState([])
    const [suportaTipo, setSuportaTipo] = useState(true)
    const [suportaPrestadorId, setSuportaPrestadorId] = useState(true)
    const [prestadoresParaVinculo, setPrestadoresParaVinculo] = useState([])
    const [especialidadesPrestador, setEspecialidadesPrestador] = useState([])
    const [mapaCidadesCred, setMapaCidadesCred] = useState(() => new Map())
    const [municipiosVinculos, setMunicipiosVinculos] = useState([])
    const [novoPrestadorId, setNovoPrestadorId] = useState('')

    const [negociacaoSelecionadaId, setNegociacaoSelecionadaId] = useState(null)
    const [detalheBase, setDetalheBase] = useState([])
    const [diferencasPorCodigo, setDiferencasPorCodigo] = useState({})

    const [termoBuscaLista, setTermoBuscaLista] = useState('')
    const [termoBuscaDetalhe, setTermoBuscaDetalhe] = useState('')
    const [edicaoAtiva, setEdicaoAtiva] = useState(false)
    const [inclusaoMassaAtiva, setInclusaoMassaAtiva] = useState(false)
    const [mostrarCustos, setMostrarCustos] = useState(false)
    const [mostrarNomeAlternativo, setMostrarNomeAlternativo] = useState(false)
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [loading, setLoading] = useState(false)
    const [erroDetalhe, setErroDetalhe] = useState('')

    const [planoId, setPlanoId] = useState('')
    const [porteSelecionado, setPorteSelecionado] = useState('')
    const [edicoesLocais, setEdicoesLocais] = useState({})
    const [scrollTopoPorCategoria, setScrollTopoPorCategoria] = useState({})
    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})
    const [ordenacaoListaNegociacoes, setOrdenacaoListaNegociacoes] = useState({
        coluna: 'nome',
        direcao: 'asc',
    })
    const [itensPorPaginaLista, setItensPorPaginaLista] = useState(20)
    const [paginaAtualLista, setPaginaAtualLista] = useState(1)
    const [categoriaEmInclusao, setCategoriaEmInclusao] = useState(null)
    const [textoNovoProcedimento, setTextoNovoProcedimento] = useState('')
    const [novoProcedimentoSelecionadoCodigo, setNovoProcedimentoSelecionadoCodigo] = useState('')
    const [textoMassaDetalhe, setTextoMassaDetalhe] = useState('')
    const [popupSugestoesStyle, setPopupSugestoesStyle] = useState(null)
    const sugestoesAnchorRef = useRef(null)

    const [mostrarNovoForm, setMostrarNovoForm] = useState(false)
    const [novoNome, setNovoNome] = useState('')
    const [novoCidadeId, setNovoCidadeId] = useState('')
    const [cidadeIdsFiltroPlano, setCidadeIdsFiltroPlano] = useState(null)
    const [novoTipo, setNovoTipo] = useState('')
    const [vincularPrestador, setVincularPrestador] = useState(false)

    const [mostrarGerenciarForm, setMostrarGerenciarForm] = useState(false)
    const [editarNome, setEditarNome] = useState('')
    const [editarCidadeId, setEditarCidadeId] = useState('')
    const [editarTipo, setEditarTipo] = useState('')
    const [editarPrestadorId, setEditarPrestadorId] = useState('')
    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)
    const [salvandoVinculoListaId, setSalvandoVinculoListaId] = useState(null)

    const cidadePorId = useMemo(
        () => new Map(cidades.map((cidade) => [String(cidade.id), cidade])),
        [cidades]
    )

    const resolverIdTabelaCidade = useCallback(
        (prestador, veterinarioCidadeId = null) =>
            resolverCidadeIdTabelaNegociacao({
                prestador,
                veterinarioCidadeId,
                cidades,
                vinculos: municipiosVinculos,
                mapaCred: mapaCidadesCred,
            }),
        [cidades, municipiosVinculos, mapaCidadesCred],
    )

    const negociacaoSelecionada = useMemo(
        () => negociacoes.find((item) => Number(item.id) === Number(negociacaoSelecionadaId)) || null,
        [negociacoes, negociacaoSelecionadaId]
    )

    const mapaEspPrestadorNome = useMemo(
        () => new Map((especialidadesPrestador || []).map((e) => [Number(e.id), e.nome])),
        [especialidadesPrestador]
    )

    const rotuloOpcaoPrestador = (p) => {
        const esp = mapaEspPrestadorNome.get(Number(p.especialidade_id))
        const partes = [p.nome]
        if (esp) partes.push(esp)
        if (p.endereco_cidade) partes.push(p.endereco_cidade)
        return partes.join(' — ')
    }

    const planoSelecionadoNome = useMemo(() => {
        const plano = planos.find((item) => String(item.id) === String(planoId))
        return plano?.nome || 'Plano'
    }, [planos, planoId])

    const colunasDetalheWidths = useMemo(() => {
        const na = mostrarNomeAlternativo
        const c = mostrarCustos
        let w
        if (c && na) {
            w = { cod: '9%', nom: '22%', nalt: '12%', p: '9%', diff: '10%', custo: '10%', acao: '10%' }
        } else if (c && !na) {
            w = { cod: '11%', nom: '31%', p: '11%', diff: '12%', custo: '12%', acao: '12%' }
        } else if (!c && na) {
            w = { cod: '11%', nom: '34%', nalt: '13%', p: '10%', acao: '12%' }
        } else {
            w = { cod: '12%', nom: '48%', p: '11%', acao: '12%' }
        }
        if (somenteLeitura) {
            const acaoNum = parseFloat(w.acao || '0')
            const nomNum = parseFloat(w.nom || '0')
            const { acao: _acao, ...rest } = w
            return { ...rest, nom: `${nomNum + acaoNum}%` }
        }
        return w
    }, [mostrarCustos, mostrarNomeAlternativo, somenteLeitura])

    const mapaPlanosHierarquia = useMemo(() => mapearPlanosListaPorChave(planos || []), [planos])

    const cidadesParaSeletor = useMemo(() => {
        if (!cidadeIdsFiltroPlano?.size) return cidades
        return cidades.filter((c) => cidadeIdsFiltroPlano.has(Number(c.id)))
    }, [cidades, cidadeIdsFiltroPlano])

    useEffect(() => {
        if (!cidades.length) return undefined
        let cancelado = false
        void (async () => {
            try {
                const ids = await buscarCidadeIdsFiltroPlanoCredenciados(
                    supabase,
                    planoId,
                    buscarTodosPaginado,
                )
                if (cancelado) return
                setCidadeIdsFiltroPlano(ids)
                const lista = cidades.filter((c) => !ids.size || ids.has(Number(c.id)))
                if (lista.length && !lista.some((c) => String(c.id) === String(novoCidadeId))) {
                    setNovoCidadeId(String(lista[0].id))
                }
            } catch {
                /* mantém */
            }
        })()
        return () => {
            cancelado = true
        }
    }, [planoId, cidades, novoCidadeId])

    const mostrarErroToast = (mensagem) => {
        setErroDetalhe('')
        setTimeout(() => setErroDetalhe(mensagem), 0)
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

    const obterPorteIdPorLetra = (letra) => {
        const alvo = normalizarTexto(letra)
        const porte = portes.find((item) => {
            const nome = normalizarTexto(item.nome)
            return nome === alvo || nome.startsWith(alvo)
        })
        return porte ? String(porte.id) : ''
    }

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: cidadesData, error: errCidades },
                { data: planosData, error: errPlanos },
                { data: portesData, error: errPortes },
                { data: categoriasData, error: errCategorias },
                { data: procedimentosData, error: errProcedimentos },
                { data: negociacoesVetData, error: errNegociacoesVet },
                { data: prestadoresData },
                { data: cidadesCredData },
                { data: especialidadesData },
            ] = await Promise.all([
                supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                supabase.from('planos').select('id, nome').order('id', { ascending: true }),
                supabase.from('portes').select('id, nome').order('id', { ascending: true }),
                supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id', { ascending: true }),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('id, codigo, nome, categoria_id, plano_base_id')
                        .order('codigo', { ascending: true })
                ),
                buscarTodosPaginado(() =>
                    supabase.from('negociacoes_vet').select('veterinario_id, procedimento_id')
                ),
                supabase
                    .from('prestadores')
                    .select('id, nome, cidade_id, endereco_cidade, endereco_uf, especialidade_id, ativo')
                    .eq('ativo', true)
                    .order('nome'),
                supabase.from('cidades_credenciamento').select('id, nome'),
                supabase.from('especialidades').select('id, nome'),
            ])

            if (errCidades || errPlanos || errPortes || errCategorias || errProcedimentos || errNegociacoesVet) {
                const detalhes = [
                    errCidades?.message,
                    errPlanos?.message,
                    errPortes?.message,
                    errCategorias?.message,
                    errProcedimentos?.message,
                    errNegociacoesVet?.message,
                ]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao carregar dados base: ${detalhes}`)
                return
            }

            let veterinariosData = []
            let veterinariosError = null
            let temTipo = true
            let temPrestadorId = true

            const tentativaCompleta = await supabase
                .from('veterinarios')
                .select('id, nome, cidade_id, tipo, prestador_id')
                .order('nome', { ascending: true })

            veterinariosData = tentativaCompleta.data || []
            veterinariosError = tentativaCompleta.error

            if (veterinariosError) {
                const tentativaComTipo = await supabase
                    .from('veterinarios')
                    .select('id, nome, cidade_id, tipo')
                    .order('nome', { ascending: true })
                veterinariosData = tentativaComTipo.data || []
                veterinariosError = tentativaComTipo.error
                temPrestadorId = false
                if (veterinariosError) {
                    const tentativaSemTipo = await supabase
                        .from('veterinarios')
                        .select('id, nome, cidade_id')
                        .order('nome', { ascending: true })
                    veterinariosData = (tentativaSemTipo.data || []).map((item) => ({
                        ...item,
                        tipo: '-',
                    }))
                    veterinariosError = tentativaSemTipo.error
                    temTipo = false
                }
            }

            if (veterinariosError) {
                setErroDetalhe(`Erro ao carregar negociações: ${veterinariosError.message}`)
                return
            }

            let vinculos = []
            try {
                vinculos = await carregarVinculosMunicipios(supabase)
            } catch {
                vinculos = []
            }

            const cidadesLista = cidadesData || []
            const mapaCidades = new Map(cidadesLista.map((cidade) => [String(cidade.id), cidade.nome]))
            const mapaPrestadores = new Map((prestadoresData || []).map((p) => [Number(p.id), p]))
            const mapaProcedimentosIdParaCodigo = new Map(
                (procedimentosData || []).map((item) => [Number(item.id), String(item.codigo || '').trim()])
            )

            const mapaProcedimentosAtivos = new Map()
            ;(negociacoesVetData || []).forEach((item) => {
                const veterinarioId = Number(item.veterinario_id)
                const procedimentoRaw = item.procedimento_id
                const codigoProcedimento =
                    mapaProcedimentosIdParaCodigo.get(Number(procedimentoRaw)) ||
                    String(procedimentoRaw || '').trim() ||
                    null
                if (!veterinarioId || !codigoProcedimento) return
                if (!mapaProcedimentosAtivos.has(veterinarioId)) {
                    mapaProcedimentosAtivos.set(veterinarioId, new Set())
                }
                mapaProcedimentosAtivos.get(veterinarioId).add(codigoProcedimento)
            })

            const mapaCred = new Map((cidadesCredData || []).map((c) => [Number(c.id), c.nome]))
            const mapaEspLista = new Map((especialidadesData || []).map((e) => [Number(e.id), e.nome]))
            const rotuloPrestadorLista = (p) => {
                if (!p) return ''
                const esp = mapaEspLista.get(Number(p.especialidade_id))
                const partes = [p.nome]
                if (esp) partes.push(esp)
                if (p.endereco_cidade) partes.push(p.endereco_cidade)
                return partes.join(' — ')
            }
            const negociacoesLista = (veterinariosData || []).map((item) => {
                const prestador =
                    item.prestador_id != null ? mapaPrestadores.get(Number(item.prestador_id)) : null
                const cidadeIdTabela = resolverCidadeIdTabelaNegociacao({
                    prestador,
                    veterinarioCidadeId: item.cidade_id,
                    cidades: cidadesLista,
                    vinculos,
                    mapaCred,
                })
                const exibicaoPrestador = cidadeExibicaoNegociacaoPrestador(prestador, mapaCred)
                const cidadeNome =
                    exibicaoPrestador ||
                    mapaCidades.get(String(item.cidade_id)) ||
                    (cidadeIdTabela != null ? mapaCidades.get(String(cidadeIdTabela)) : null) ||
                    '-'

                return {
                    id: item.id,
                    nome: item.nome,
                    cidadeId: item.cidade_id,
                    cidadeIdTabela: cidadeIdTabela ?? item.cidade_id,
                    cidadeNome,
                    tipo: item.tipo || '-',
                    prestadorId: item.prestador_id != null ? Number(item.prestador_id) : null,
                    prestadorVinculoNome: rotuloPrestadorLista(prestador),
                    procedimentosAtivos: mapaProcedimentosAtivos.get(Number(item.id))?.size || 0,
                }
            })

            const idsFiltro = await buscarCidadeIdsFiltroPlanoCredenciados(
                supabase,
                null,
                buscarTodosPaginado,
            )
            setCidadeIdsFiltroPlano(idsFiltro)

            setCidades(cidadesLista)
            setMunicipiosVinculos(vinculos)
            setPrestadoresParaVinculo(prestadoresData || [])
            setEspecialidadesPrestador(especialidadesData || [])
            setMapaCidadesCred(mapaCred)
            setSuportaPrestadorId(temPrestadorId)
            setPlanos(planosData || [])
            setPortes(portesData || [])
            setCategorias(categoriasData || [])
            setProcedimentos(procedimentosData || [])
            setNegociacoes(negociacoesLista)
            setSuportaTipo(temTipo)

            if ((planosData || []).length > 0) setPlanoId((anterior) => anterior || String(planosData[0].id))
            if ((portesData || []).length > 0) setPorteSelecionado((anterior) => anterior || String(portesData[0].id))
            if (cidadesLista.length > 0) setNovoCidadeId((anterior) => anterior || String(cidadesLista[0].id))
        } catch (error) {
            setErroDetalhe(`Falha ao carregar base: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [])

    const carregarDetalheNegociacao = useCallback(async (negociacaoItem) => {
        if (!negociacaoItem) {
            setDetalheBase([])
            setDiferencasPorCodigo({})
            return
        }

        try {
            setLoading(true)
            setErroDetalhe('')

            const { data: negociacoesVetData, error: errNegVet } = await supabase
                .from('negociacoes_vet')
                .select('id, procedimento_id, porte_id, valor, nome_alternativo')
                .eq('veterinario_id', negociacaoItem.id)

            if (errNegVet) {
                setErroDetalhe(`Erro ao carregar negociação: ${errNegVet.message}`)
                setDetalheBase([])
                return
            }

            const mapaProcedimentos = new Map(
                procedimentos.map((item) => [
                    Number(item.id),
                    {
                        id: Number(item.id),
                        codigo: String(item.codigo),
                        nome: String(item.nome),
                        categoriaId: item.categoria_id,
                        planoBaseId: item.plano_base_id != null ? Number(item.plano_base_id) : null,
                    },
                ])
            )
            const mapaProcedimentosPorCodigo = new Map(
                procedimentos.map((item) => [String(item.codigo || '').trim(), mapaProcedimentos.get(Number(item.id))])
            )

            const porteIdP = obterPorteIdPorLetra('P')
            const porteIdM = obterPorteIdPorLetra('M')
            const porteIdG = obterPorteIdPorLetra('G')

            const mapaLinhas = new Map()
            ;(negociacoesVetData || []).forEach((item) => {
                const procedimentoRaw = item.procedimento_id
                const procedimento =
                    mapaProcedimentos.get(Number(procedimentoRaw)) ||
                    mapaProcedimentosPorCodigo.get(String(procedimentoRaw || '').trim())
                if (!procedimento) return
                const procedimentoDbId = Number(procedimento.id)

                if (!mapaLinhas.has(procedimentoDbId)) {
                    mapaLinhas.set(procedimentoDbId, {
                        rowId: `neg-${negociacaoItem.id}-${procedimentoDbId}`,
                        procedimentoDbId,
                        codigo: procedimento.codigo,
                        procedimento: procedimento.nome,
                        nomeAlternativo: '',
                        categoriaId: procedimento.categoriaId,
                        planoBaseId: procedimento.planoBaseId,
                        porteP: 0,
                        porteM: 0,
                        porteG: 0,
                        negociacaoIdP: null,
                        negociacaoIdM: null,
                        negociacaoIdG: null,
                        porteIdP,
                        porteIdM,
                        porteIdG,
                    })
                }
                const linha = mapaLinhas.get(procedimentoDbId)
                if (item.nome_alternativo != null) {
                    linha.nomeAlternativo = String(item.nome_alternativo)
                }
                const porteId = String(item.porte_id)
                const valor = Number(item.valor || 0)
                if (porteId === String(porteIdP)) {
                    linha.porteP = valor
                    linha.negociacaoIdP = item.id
                } else if (porteId === String(porteIdM)) {
                    linha.porteM = valor
                    linha.negociacaoIdM = item.id
                } else if (porteId === String(porteIdG)) {
                    linha.porteG = valor
                    linha.negociacaoIdG = item.id
                }
            })

            const prestadorIdMapaAlt =
                negociacaoItem.prestadorId != null ? Number(negociacaoItem.prestadorId) : negociacaoItem.id
            const mapaAltCadastro = await carregarMapaNomesAlternativosPrestador(prestadorIdMapaAlt)
            for (const linha of mapaLinhas.values()) {
                const cod = String(linha.codigo || '')
                    .trim()
                    .toUpperCase()
                const alt = mapaAltCadastro.get(cod)
                if (alt) linha.nomeAlternativo = alt
            }

            setDetalheBase([...mapaLinhas.values()])
        } catch (error) {
            setErroDetalhe(`Falha ao carregar detalhe: ${error.message}`)
            setDetalheBase([])
        } finally {
            setLoading(false)
        }
    }, [procedimentos, portes])

    const carregarDiferencasNegociacao = useCallback(async (negociacaoItem, codigos) => {
        if (!mostrarCustos || !negociacaoItem || codigos.length === 0 || !planoId) {
            setDiferencasPorCodigo({})
            return
        }

        const idTabela = negociacaoItem.cidadeIdTabela ?? negociacaoItem.cidadeId
        let mapaResultado = {}

        const { data, error } = await supabase
            .from('planos_cidade')
            .select('id, procedimento_cod, diferenca')
            .eq('cidade_id', idTabela)
            .eq('plano_id', planoId)
            .in('procedimento_cod', codigos)

        if (error) {
            setErroDetalhe(`Erro ao carregar diferenças da negociação: ${error.message}`)
            setDiferencasPorCodigo({})
            return
        }

        ;(data || []).forEach((item) => {
            mapaResultado[String(item.procedimento_cod)] = {
                planoCidadeId: item.id,
                diferenca: Number(item.diferenca || 0),
            }
        })

        setDiferencasPorCodigo(mapaResultado)
    }, [mostrarCustos, planoId, cidadePorId])

    const linhasDetalheComCustos = useMemo(() => {
        const chaveFiltroPlano = obterChavePlanoFiltroAtivo(planoId, planos, mapaPlanosHierarquia)

        return detalheBase.map((linha) => {
            const metaDif = diferencasPorCodigo[linha.codigo]
            const diferenca = Number(metaDif?.diferenca || 0)
            const valorSelecionado =
                String(porteSelecionado) === String(linha.porteIdP)
                    ? linha.porteP
                    : String(porteSelecionado) === String(linha.porteIdM)
                        ? linha.porteM
                        : String(porteSelecionado) === String(linha.porteIdG)
                            ? linha.porteG
                            : 0

            let mensagemPlanoAcima = null
            if (chaveFiltroPlano) {
                const chaveProc = obterChavePlanoProcedimento(linha.planoBaseId, mapaPlanosHierarquia, planos)
                const iF = ORDEM_PLANOS.indexOf(chaveFiltroPlano)
                const iP = ORDEM_PLANOS.indexOf(chaveProc)
                if (iP > iF) {
                    mensagemPlanoAcima = `${ROTULO_PLANO[chaveProc]} Acima`
                }
            }

            return {
                ...linha,
                planoCidadeId: metaDif?.planoCidadeId || null,
                diferenca,
                custo: Number(valorSelecionado || 0) - Number(diferenca || 0),
                mensagemPlanoAcima,
            }
        })
    }, [detalheBase, diferencasPorCodigo, porteSelecionado, planoId, planos, mapaPlanosHierarquia])

    const negociacoesFiltradas = useMemo(() => {
        if (!termoBuscaLista.trim() && !buscaNotAtiva) return negociacoes
        return negociacoes.filter((item) => {
            const blob = normalizarTextoBusca(
                [item.nome, item.cidadeNome, item.tipo, item.prestadorVinculoNome].filter(Boolean).join(' '),
            )
            return filtrarPorTermoBusca(blob, termoBuscaLista, buscaNotAtiva)
        })
    }, [negociacoes, termoBuscaLista, buscaNotAtiva])

    const negociacoesListaOrdenada = useMemo(() => {
        const resultado = [...negociacoesFiltradas]
        const atual = ordenacaoListaNegociacoes
        const fator = atual.direcao === 'asc' ? 1 : -1
        resultado.sort((a, b) => {
            const valorA = a[atual.coluna]
            const valorB = b[atual.coluna]
            if (typeof valorA === 'number' && typeof valorB === 'number') {
                return (valorA - valorB) * fator
            }
            return (
                String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
            )
        })
        return resultado
    }, [negociacoesFiltradas, ordenacaoListaNegociacoes])

    const totalPaginasLista = useMemo(() => {
        const total = Math.max(1, Math.ceil(negociacoesListaOrdenada.length / Number(itensPorPaginaLista || 20)))
        return total
    }, [negociacoesListaOrdenada.length, itensPorPaginaLista])

    const negociacoesListaPaginada = useMemo(() => {
        const inicio = (Math.max(1, paginaAtualLista) - 1) * Number(itensPorPaginaLista || 20)
        const fim = inicio + Number(itensPorPaginaLista || 20)
        return negociacoesListaOrdenada.slice(inicio, fim)
    }, [negociacoesListaOrdenada, paginaAtualLista, itensPorPaginaLista])

    const linhasDetalheFiltradas = useMemo(() => {
        if (!termoBuscaDetalhe.trim() && !buscaNotAtiva) return linhasDetalheComCustos
        return linhasDetalheComCustos.filter((linha) => {
            const categoriaNome = categorias.find((categoria) => Number(categoria.id) === Number(linha.categoriaId))?.nome || ''
            const blob = normalizarTextoBusca(
                [linha.codigo, linha.procedimento, linha.nomeAlternativo, categoriaNome].filter(Boolean).join(' '),
            )
            return filtrarPorTermoBusca(blob, termoBuscaDetalhe, buscaNotAtiva)
        })
    }, [linhasDetalheComCustos, termoBuscaDetalhe, categorias, buscaNotAtiva])

    const handleOrdenarListaNegociacoes = (coluna) => {
        setOrdenacaoListaNegociacoes((anterior) => {
            const proxima =
                anterior.coluna === coluna
                    ? {
                          coluna,
                          direcao: anterior.direcao === 'asc' ? 'desc' : 'asc',
                      }
                    : { coluna, direcao: 'asc' }
            return proxima
        })
    }

    const obterIndicadorOrdenacaoLista = (coluna) => {
        if (ordenacaoListaNegociacoes.coluna !== coluna) return ''
        return ordenacaoListaNegociacoes.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    const handleTrocarItensPorPaginaLista = (valor) => {
        const proximo = Number(valor)
        if (!proximo || proximo < 1) return
        setItensPorPaginaLista(proximo)
        setPaginaAtualLista(1)
    }

    const handleOrdenarCategoria = (categoriaId, coluna) => {
        setOrdenacaoPorCategoria((anterior) => {
            const atual = anterior[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
            const proxima =
                atual.coluna === coluna
                    ? {
                          coluna,
                          direcao: atual.direcao === 'asc' ? 'desc' : 'asc',
                      }
                    : { coluna, direcao: 'asc' }

            return {
                ...anterior,
                [categoriaId]: proxima,
            }
        })
    }

    const obterIndicadorOrdenacao = (categoriaId, coluna) => {
        const atual = ordenacaoPorCategoria[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
        if (atual.coluna !== coluna) return ''
        return atual.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    const ordenarLinhas = (linhasParaOrdenar, categoriaId) => {
        const resultado = [...linhasParaOrdenar]
        const atual = ordenacaoPorCategoria[categoriaId] || { coluna: 'codigo', direcao: 'asc' }

        resultado.sort((a, b) => {
            const valorA = a[atual.coluna]
            const valorB = b[atual.coluna]
            const fator = atual.direcao === 'asc' ? 1 : -1

            if (typeof valorA === 'number' && typeof valorB === 'number') {
                return (valorA - valorB) * fator
            }

            return (
                String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
            )
        })

        return resultado
    }

    const secoesDetalhePorCategoria = useMemo(() => {
        return categorias
            .map((categoria) => ({
                categoriaId: categoria.id,
                categoriaNome: categoria.nome,
                linhas: ordenarLinhas(
                    linhasDetalheFiltradas.filter((linha) => Number(linha.categoriaId) === Number(categoria.id)),
                    categoria.id
                ),
            }))
            .filter((secao) => secao.linhas.length > 0)
    }, [categorias, linhasDetalheFiltradas, ordenacaoPorCategoria])

    const obterValorInput = (linha, campo, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        if (Object.prototype.hasOwnProperty.call(edicoesLocais, chave)) return edicoesLocais[chave]
        return String(Number(linha[campo] || 0).toFixed(2))
    }

    const obterValorInputTexto = (linha, campo, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        if (Object.prototype.hasOwnProperty.call(edicoesLocais, chave)) return edicoesLocais[chave]
        return String(linha[campo] ?? '')
    }

    const atualizarEdicaoLocal = (linha, campo, categoriaId, valor) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        setEdicoesLocais((anterior) => ({ ...anterior, [chave]: valor }))
    }

    const salvarValorNegociado = async (linha, campo, valorNumerico) => {
        if (!negociacaoSelecionada) return false
        const metaPorCampo = {
            porteP: { id: linha.negociacaoIdP, porteId: linha.porteIdP },
            porteM: { id: linha.negociacaoIdM, porteId: linha.porteIdM },
            porteG: { id: linha.negociacaoIdG, porteId: linha.porteIdG },
        }
        const meta = metaPorCampo[campo]
        if (!meta?.porteId) {
            mostrarErroToast('Porte não identificado para salvar negociação.')
            return false
        }

        let novoRegistroId = meta.id
        let erroPersistencia = null

        if (meta.id) {
            const { error } = await supabase.from('negociacoes_vet').update({ valor: valorNumerico }).eq('id', meta.id)
            erroPersistencia = error
        } else {
            const { data, error } = await supabase
                .from('negociacoes_vet')
                .insert({
                    veterinario_id: Number(negociacaoSelecionada.id),
                    procedimento_id: Number(linha.procedimentoDbId),
                    porte_id: Number(meta.porteId),
                    valor: valorNumerico,
                    nome_alternativo: linha.nomeAlternativo?.trim() ? String(linha.nomeAlternativo).trim() : null,
                })
                .select('id')
                .single()
            novoRegistroId = data?.id || null
            erroPersistencia = error
        }

        if (erroPersistencia) {
            mostrarErroToast(`Erro ao salvar negociação: ${erroPersistencia.message}`)
            return false
        }

        setDetalheBase((anteriores) =>
            anteriores.map((item) => {
                if (item.rowId !== linha.rowId) return item
                return {
                    ...item,
                    [campo]: valorNumerico,
                    ...(campo === 'porteP' ? { negociacaoIdP: novoRegistroId } : {}),
                    ...(campo === 'porteM' ? { negociacaoIdM: novoRegistroId } : {}),
                    ...(campo === 'porteG' ? { negociacaoIdG: novoRegistroId } : {}),
                }
            })
        )
        return true
    }

    const salvarCampoNegociadoEditado = async (linha, campo, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        const bruto = edicoesLocais[chave]
        if (bruto === undefined) return
        const valorNumerico = normalizarNumeroEntrada(bruto)
        if (Number.isNaN(valorNumerico)) {
            mostrarErroToast('Valor inválido para negociação.')
            return
        }

        const salvou = await salvarValorNegociado(linha, campo, valorNumerico)
        if (!salvou) return
        setEdicoesLocais((anterior) => {
            const copia = { ...anterior }
            delete copia[chave]
            return copia
        })
    }

    const processarColagemRepasse = async (event, secao, linhaIndexInicial, campoInicial) => {
        event.preventDefault()
        if (!edicaoAtiva) return

        const texto = event.clipboardData?.getData('text') || ''
        const linhasColadas = texto
            .replace(/\r/g, '')
            .split('\n')
            .filter((linha) => linha.length > 0)
            .map((linha) => linha.split('\t'))

        if (linhasColadas.length === 0) return

        const camposPorte = ['porteP', 'porteM', 'porteG']
        const colunaInicial = camposPorte.indexOf(campoInicial)
        if (colunaInicial < 0) return

        for (let i = 0; i < linhasColadas.length; i += 1) {
            const linhaTabela = secao.linhas[linhaIndexInicial + i]
            if (!linhaTabela) break

            const colunas = linhasColadas[i]
            for (let j = 0; j < colunas.length; j += 1) {
                const colunaDestino = colunaInicial + j
                if (colunaDestino > 2) break

                const campoDestino = camposPorte[colunaDestino]
                const valorBruto = String(colunas[j] || '').trim()
                if (!valorBruto) continue

                const valorNumerico = normalizarNumeroEntrada(valorBruto)
                if (Number.isNaN(valorNumerico)) {
                    mostrarErroToast(`Valor inválido na colagem: "${valorBruto}"`)
                    continue
                }

                await salvarValorNegociado(linhaTabela, campoDestino, valorNumerico)
            }
        }
    }

    const excluirLinhaProcedimentoNegociacao = async (linha, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error } = await supabase
                .from('negociacoes_vet')
                .delete()
                .eq('veterinario_id', negociacaoSelecionada.id)
                .eq('procedimento_id', linha.procedimentoDbId)
            if (error) {
                mostrarErroToast(`Erro ao excluir procedimento da negociação: ${error.message}`)
                return
            }
            setDetalheBase((anteriores) => anteriores.filter((item) => item.rowId !== linha.rowId))
            setNegociacoes((anteriores) =>
                anteriores.map((item) =>
                    Number(item.id) === Number(negociacaoSelecionada.id)
                        ? { ...item, procedimentosAtivos: Math.max(Number(item.procedimentosAtivos || 0) - 1, 0) }
                        : item
                )
            )
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }
        abrirConfirmacaoExclusao(`Excluir o procedimento ${linha.codigo} desta negociação?`, executarExclusao)
    }

    const obterSugestoesProcedimentos = (categoriaId) => {
        const codigosPresentes = new Set(
            detalheBase
                .filter((linha) => Number(linha.categoriaId) === Number(categoriaId))
                .map((linha) => normalizarTexto(linha.codigo))
        )
        return procedimentos.filter(
            (item) =>
                Number(item.categoria_id) === Number(categoriaId) &&
                !codigosPresentes.has(normalizarTexto(item.codigo))
        )
    }

    const sugestoesFiltradasInclusao = useMemo(() => {
        if (!categoriaEmInclusao) return []
        const base = obterSugestoesProcedimentos(categoriaEmInclusao)
        const termo = normalizarTexto(textoNovoProcedimento)
        if (!termo) return base.slice(0, 30)
        return base
            .filter((item) => {
                const codigo = normalizarTexto(item.codigo)
                const nome = normalizarTexto(item.nome)
                return codigo.includes(termo) || nome.includes(termo)
            })
            .slice(0, 30)
    }, [categoriaEmInclusao, textoNovoProcedimento, detalheBase, procedimentos])

    const atualizarPosicaoPopupSugestoes = useCallback(() => {
        const ancora = sugestoesAnchorRef.current
        if (!ancora) return
        const rect = ancora.getBoundingClientRect()
        setPopupSugestoesStyle({
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
        })
    }, [])

    useEffect(() => {
        if (!categoriaEmInclusao) {
            setPopupSugestoesStyle(null)
            return
        }
        atualizarPosicaoPopupSugestoes()
        window.addEventListener('resize', atualizarPosicaoPopupSugestoes)
        window.addEventListener('scroll', atualizarPosicaoPopupSugestoes, true)
        return () => {
            window.removeEventListener('resize', atualizarPosicaoPopupSugestoes)
            window.removeEventListener('scroll', atualizarPosicaoPopupSugestoes, true)
        }
    }, [categoriaEmInclusao, textoNovoProcedimento, sugestoesFiltradasInclusao.length, atualizarPosicaoPopupSugestoes])

    const renderSugestoesPortal = (secao) => {
        if (categoriaEmInclusao !== secao.categoriaId) return null
        if (!popupSugestoesStyle || typeof document === 'undefined') return null
        return createPortal(
            <div
                className='row_add_suggest_list is-portal'
                style={{
                    position: 'fixed',
                    top: `${popupSugestoesStyle.top}px`,
                    left: `${popupSugestoesStyle.left}px`,
                    width: `${popupSugestoesStyle.width}px`,
                }}
            >
                {sugestoesFiltradasInclusao.length === 0 ? (
                    <div className='row_add_suggest_empty'>Nenhum procedimento disponível</div>
                ) : (
                    sugestoesFiltradasInclusao.map((item) => (
                        <button
                            key={`${secao.categoriaId}-${item.codigo}`}
                            type='button'
                            className={`row_add_suggest_item ${
                                normalizarTexto(novoProcedimentoSelecionadoCodigo) === normalizarTexto(item.codigo)
                                    ? 'is-active'
                                    : ''
                            }`}
                            onClick={() => {
                                setTextoNovoProcedimento(`${item.nome} - ${item.codigo}`)
                                setNovoProcedimentoSelecionadoCodigo(item.codigo)
                            }}
                        >
                            <span>{item.nome}</span>
                            <small>{item.codigo}</small>
                        </button>
                    ))
                )}
            </div>,
            document.body
        )
    }

    const inserirProcedimentoNaNegociacao = async (procedimentoItem, opcoes = {}) => {
        const reportarErro = (mensagem) => {
            if (!opcoes.silencioso) mostrarErroToast(mensagem)
        }

        const vetId = Number(opcoes.veterinarioId || negociacaoSelecionada?.id)
        if (!vetId) return { status: 'erro', mensagem: 'Negociação não selecionada.' }
        const porteIds = [obterPorteIdPorLetra('P'), obterPorteIdPorLetra('M'), obterPorteIdPorLetra('G')].filter(Boolean)
        if (porteIds.length === 0) {
            reportarErro('Portes P/M/G não encontrados para inclusão.')
            return { status: 'erro', mensagem: 'Portes P/M/G não encontrados.' }
        }

        const payload = porteIds.map((porteId) => ({
            veterinario_id: vetId,
            procedimento_id: Number(procedimentoItem.id),
            porte_id: Number(porteId),
            valor: 0,
            nome_alternativo: null,
        }))

        const { error } = await supabase.from('negociacoes_vet').upsert(payload, {
            onConflict: 'veterinario_id,procedimento_id,porte_id',
            ignoreDuplicates: true,
        })
        if (error) {
            const msg = String(error.message || '')
            if (msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
                return { status: 'ja_existia' }
            }
            reportarErro(`Erro ao incluir procedimento: ${error.message}`)
            return { status: 'erro', mensagem: error.message }
        }

        if (!opcoes.semRecarregar && negociacaoSelecionada) {
            await carregarDetalheNegociacao(negociacaoSelecionada)
        }
        setNegociacoes((anteriores) =>
            anteriores.map((item) =>
                Number(item.id) === vetId
                    ? { ...item, procedimentosAtivos: Number(item.procedimentosAtivos || 0) + 1 }
                    : item
            )
        )
        return { status: 'ok' }
    }

    const confirmarNovoProcedimentoCategoria = async (categoriaId) => {
        const sugestoes = obterSugestoesProcedimentos(categoriaId)
        const entrada = normalizarTexto(textoNovoProcedimento)
        if (!entrada) {
            mostrarErroToast('Digite ou selecione um procedimento da lista.')
            return
        }

        let encontrado = null
        if (novoProcedimentoSelecionadoCodigo) {
            encontrado = sugestoes.find(
                (item) => normalizarTexto(item.codigo) === normalizarTexto(novoProcedimentoSelecionadoCodigo)
            )
        }
        if (!encontrado) {
            encontrado = sugestoes.find((item) => {
                const codigo = normalizarTexto(item.codigo)
                const nome = normalizarTexto(item.nome)
                const op1 = normalizarTexto(`${item.codigo} - ${item.nome}`)
                const op2 = normalizarTexto(`${item.nome} - ${item.codigo}`)
                return entrada === codigo || entrada === nome || entrada === op1 || entrada === op2
            })
        }
        if (!encontrado) {
            mostrarErroToast('Selecione um procedimento sugerido da mesma categoria.')
            return
        }

        const resultado = await inserirProcedimentoNaNegociacao(encontrado)
        if (resultado.status !== 'ok') return

        setCategoriaEmInclusao(null)
        setTextoNovoProcedimento('')
        setNovoProcedimentoSelecionadoCodigo('')
    }

    const inserirProcedimentosEmMassaDetalhe = async () => {
        const codigos = extrairCodigosProcedimentoEmMassa(textoMassaDetalhe)
        if (codigos.length === 0) {
            mostrarErroToast('Informe ao menos um código (um por linha ou separados por vírgula).')
            return
        }

        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('procedimentos')
                .select('id, codigo, nome, categoria_id')
                .in('codigo', codigos)
            if (error) {
                mostrarErroToast(`Erro ao validar procedimentos: ${error.message}`)
                return
            }

            const codigosEncontrados = new Set((data || []).map((item) => normalizarTexto(item.codigo)))
            const codigosNaoEncontrados = codigos.filter((cod) => !codigosEncontrados.has(normalizarTexto(cod)))
            const existentes = new Set(detalheBase.map((item) => normalizarTexto(item.codigo)))
            const candidatos = data || []

            let totalInseridos = 0
            let totalIgnorados = 0
            const errosDetalhados = []

            for (let i = 0; i < candidatos.length; i += 1) {
                const candidato = candidatos[i]
                if (existentes.has(normalizarTexto(candidato.codigo))) {
                    totalIgnorados += 1
                    continue
                }
                const resultado = await inserirProcedimentoNaNegociacao(candidato, {
                    silencioso: true,
                    semRecarregar: true,
                })
                if (resultado.status === 'ok') totalInseridos += 1
                else if (resultado.status === 'ja_existia') totalIgnorados += 1
                else errosDetalhados.push(`${candidato.codigo}: ${resultado.mensagem || 'erro desconhecido'}`)
            }

            if (totalInseridos > 0 && negociacaoSelecionada) {
                await carregarDetalheNegociacao(negociacaoSelecionada)
            }

            setTextoMassaDetalhe('')

            const partes = []
            if (totalInseridos > 0) partes.push(`${totalInseridos} adicionado(s)`)
            if (totalIgnorados > 0) partes.push(`${totalIgnorados} já existente(s) ignorado(s)`)
            if (codigosNaoEncontrados.length > 0) partes.push(`${codigosNaoEncontrados.length} código(s) não encontrado(s): ${codigosNaoEncontrados.join(', ')}`)
            if (errosDetalhados.length > 0) partes.push(`${errosDetalhados.length} falhou(aram): ${errosDetalhados.join(' | ')}`)
            if (partes.length > 0) mostrarErroToast(`Adição em massa concluída — ${partes.join(' · ')}.`)
        } finally {
            setLoading(false)
        }
    }

    const importarProcedimentosPrestadorNaNegociacao = async (veterinarioId, prestadorId) => {
        const pid = Number(prestadorId)
        const vid = Number(veterinarioId)
        if (!pid || !vid) return 0
        let codigos = []
        try {
            codigos = await carregarCodigosPrestadorProcedimentos(pid)
        } catch {
            return 0
        }
        const mapaProc = new Map(
            procedimentos.map((p) => [normalizarTexto(p.codigo), p])
        )
        let inseridos = 0
        for (const cod of codigos) {
            const proc = mapaProc.get(normalizarTexto(cod))
            if (!proc) continue
            const r = await inserirProcedimentoNaNegociacao(proc, {
                silencioso: true,
                semRecarregar: true,
                veterinarioId: vid,
            })
            if (r.status === 'ok') inseridos += 1
        }
        return inseridos
    }

    const criarNegociacao = async () => {
        const prestadorSel =
            vincularPrestador && novoPrestadorId
                ? prestadoresParaVinculo.find((p) => String(p.id) === String(novoPrestadorId))
                : null
        let nome = String(novoNome || '').trim()
        let cidadeIdNum = Number(novoCidadeId)
        if (prestadorSel) {
            if (!nome) nome = String(prestadorSel.nome || '').trim()
            const cidResolvida = resolverIdTabelaCidade(prestadorSel)
            if (cidResolvida) cidadeIdNum = cidResolvida
        }
        if (!nome || !cidadeIdNum) {
            mostrarErroToast('Preencha nome e cidade (ou vincule um prestador com cidade válida).')
            return
        }

        setLoading(true)
        try {
            let payload = {
                nome,
                cidade_id: cidadeIdNum,
            }
            if (suportaTipo) payload = { ...payload, tipo: String(novoTipo || '').trim() || '-' }
            if (suportaPrestadorId && prestadorSel) payload = { ...payload, prestador_id: Number(prestadorSel.id) }

            let data = null
            let error = null
            ;({ data, error } = await supabase.from('veterinarios').insert(payload).select('id').single())
            if (error && suportaPrestadorId && prestadorSel && /prestador_id/i.test(error.message || '')) {
                const { prestador_id: _omit, ...semPrestador } = payload
                ;({ data, error } = await supabase.from('veterinarios').insert(semPrestador).select('id').single())
            }
            if (error) {
                mostrarErroToast(`Erro ao criar negociação: ${error.message}`)
                return
            }

            if (prestadorSel) {
                const qtd = await importarProcedimentosPrestadorNaNegociacao(data.id, prestadorSel.id)
                if (qtd > 0) {
                    mostrarErroToast(`${qtd} procedimento(s) importado(s) do perfil do prestador.`)
                }
            }

            await carregarBase()
            setMostrarNovoForm(false)
            setNovoNome('')
            setNovoTipo('')
            setNovoPrestadorId('')
            setVincularPrestador(false)
            setNegociacaoSelecionadaId(data.id)
        } finally {
            setLoading(false)
        }
    }

    const baixarExcelNegociacao = async () => {
        if (!negociacaoSelecionada || !detalheBase.length) {
            mostrarErroToast('Não há procedimentos para exportar nesta negociação.')
            return
        }
        if (!secoesDetalhePorCategoria.length) {
            mostrarErroToast('Não há procedimentos para exportar nesta negociação.')
            return
        }
        const nomeArquivo = `negociacao-${negociacaoSelecionada.nome || negociacaoSelecionada.id}`
        try {
            await exportarNegociacaoParaExcel(secoesDetalhePorCategoria, nomeArquivo)
        } catch (error) {
            mostrarErroToast(`Erro ao exportar Excel: ${error.message}`)
        }
    }

    const abrirGerenciarSelecionada = () => {
        if (somenteLeitura || !negociacaoSelecionada) return
        setEditarNome(negociacaoSelecionada.nome || '')
        setEditarCidadeId(String(negociacaoSelecionada.cidadeId || ''))
        setEditarTipo(negociacaoSelecionada.tipo || '')
        setEditarPrestadorId(
            negociacaoSelecionada.prestadorId != null ? String(negociacaoSelecionada.prestadorId) : ''
        )
        setMostrarGerenciarForm(true)
    }

    const importarProcedimentosVinculoAtual = async () => {
        if (!negociacaoSelecionada) return
        const pid = editarPrestadorId ? Number(editarPrestadorId) : null
        if (!pid) {
            mostrarErroToast('Selecione uma clínica ou prestador vinculado.')
            return
        }
        setLoading(true)
        try {
            const qtd = await importarProcedimentosPrestadorNaNegociacao(negociacaoSelecionada.id, pid)
            await carregarDetalheNegociacao(negociacaoSelecionada)
            await carregarBase()
            if (qtd > 0) {
                mostrarErroToast(`${qtd} procedimento(s) importado(s) do perfil do prestador.`)
            } else {
                mostrarErroToast('Nenhum procedimento novo foi importado (perfil vazio ou já na tabela).')
            }
        } finally {
            setLoading(false)
        }
    }

    const salvarVinculoPrestadorNaLista = async (negociacaoItem, prestadorSelecionado) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        if (!suportaPrestadorId) {
            mostrarErroToast('Execute o script SQL veterinarios_prestador_id no Supabase para vincular prestadores.')
            return
        }
        const novoId = prestadorSelecionado ? Number(prestadorSelecionado.id) : null
        if (Number(negociacaoItem.prestadorId) === novoId) return

        setSalvandoVinculoListaId(negociacaoItem.id)
        try {
            let { error } = await supabase
                .from('veterinarios')
                .update({ prestador_id: novoId })
                .eq('id', negociacaoItem.id)

            if (error && /prestador_id/i.test(error.message || '')) {
                mostrarErroToast(`Erro ao salvar vínculo: ${error.message}`)
                return
            }
            if (error) {
                mostrarErroToast(`Erro ao salvar vínculo: ${error.message}`)
                return
            }

            const rotulo = prestadorSelecionado ? rotuloOpcaoPrestador(prestadorSelecionado) : ''
            setNegociacoes((anteriores) =>
                anteriores.map((n) =>
                    Number(n.id) === Number(negociacaoItem.id)
                        ? { ...n, prestadorId: novoId, prestadorVinculoNome: rotulo }
                        : n,
                ),
            )
        } finally {
            setSalvandoVinculoListaId(null)
        }
    }

    const salvarGerenciarSelecionada = async () => {
        if (!negociacaoSelecionada) return
        const nome = String(editarNome || '').trim()
        if (!nome || !editarCidadeId) {
            mostrarErroToast('Preencha nome e cidade para salvar.')
            return
        }

        let cidadeIdSalvar = Number(editarCidadeId)
        if (suportaPrestadorId && editarPrestadorId) {
            const prestadorEd =
                prestadoresParaVinculo.find((p) => String(p.id) === String(editarPrestadorId)) || null
            const cidTab = resolverIdTabelaCidade(prestadorEd, editarCidadeId)
            if (cidTab) cidadeIdSalvar = cidTab
        }

        setLoading(true)
        try {
            let payload = {
                nome,
                cidade_id: cidadeIdSalvar,
            }
            if (suportaTipo) payload = { ...payload, tipo: String(editarTipo || '').trim() || '-' }
            if (suportaPrestadorId) {
                payload.prestador_id = editarPrestadorId ? Number(editarPrestadorId) : null
            }

            let { error } = await supabase.from('veterinarios').update(payload).eq('id', negociacaoSelecionada.id)

            if (error && suportaPrestadorId && /prestador_id/i.test(error.message || '')) {
                const { prestador_id: _omit, ...semPrestador } = payload
                ;({ error } = await supabase.from('veterinarios').update(semPrestador).eq('id', negociacaoSelecionada.id))
            }

            if (error) {
                mostrarErroToast(`Erro ao salvar negociação: ${error.message}`)
                return
            }
            await carregarBase()
            setMostrarGerenciarForm(false)
        } finally {
            setLoading(false)
        }
    }

    const excluirNegociacao = async (negociacaoItem, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error: errNeg } = await supabase
                .from('negociacoes_vet')
                .delete()
                .eq('veterinario_id', negociacaoItem.id)
            if (errNeg) {
                mostrarErroToast(`Erro ao excluir itens da negociação: ${errNeg.message}`)
                return
            }

            const { error: errVet } = await supabase.from('veterinarios').delete().eq('id', negociacaoItem.id)
            if (errVet) {
                mostrarErroToast(`Erro ao excluir negociação: ${errVet.message}`)
                return
            }

            setNegociacoes((anteriores) => anteriores.filter((item) => Number(item.id) !== Number(negociacaoItem.id)))
            if (Number(negociacaoSelecionadaId) === Number(negociacaoItem.id)) {
                setNegociacaoSelecionadaId(null)
                setDetalheBase([])
                setDiferencasPorCodigo({})
            }
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }
        abrirConfirmacaoExclusao(`Excluir a negociação "${negociacaoItem.nome}" e seus itens?`, executarExclusao)
    }

    useEffect(() => {
        carregarBase()
    }, [carregarBase])

    useEffect(() => {
        if (!negociacaoSelecionada) return
        carregarDetalheNegociacao(negociacaoSelecionada)
    }, [negociacaoSelecionadaId, carregarDetalheNegociacao])

    useEffect(() => {
        if (!negociacaoSelecionada) {
            setDiferencasPorCodigo({})
            return
        }
        const codigos = detalheBase.map((item) => item.codigo)
        carregarDiferencasNegociacao(negociacaoSelecionada, codigos)
    }, [negociacaoSelecionada, detalheBase, mostrarCustos, planoId, carregarDiferencasNegociacao])

    useEffect(() => {
        if (!erroDetalhe) return
        const timer = setTimeout(() => setErroDetalhe(''), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(timer)
    }, [erroDetalhe])

    useEffect(() => {
        setPaginaAtualLista(1)
    }, [termoBuscaLista])

    useEffect(() => {
        setPaginaAtualLista((anterior) => Math.min(Math.max(1, anterior), totalPaginasLista))
    }, [totalPaginasLista])

    useEffect(() => {
        const onScroll = () => {
            const proximoValor = window.scrollY > 40
            setHeaderCompacto((anterior) => (anterior === proximoValor ? anterior : proximoValor))
        }
        onScroll()
        window.addEventListener('scroll', onScroll)
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        document.body.classList.add('supertabelanegociacoes_no_bounce')
        return () => {
            document.body.classList.remove('supertabelanegociacoes_no_bounce')
        }
    }, [])

    return (
        <div className='supertabelanegociacoes'>
            <h1>Supertabela - Negociações</h1>
            <hr />

            <header className={`supertabelanegociacoes_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>

                {!negociacaoSelecionada ? (
                    <div className='supertabelanegociacoes_filters'>
                        <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_busca'>
                            <p>Busca por nome, cidade ou tipo</p>
                            <input
                                type='text'
                                className='supertabelanegociacoes_input'
                                placeholder='Nome, cidade ou tipo'
                                value={termoBuscaLista}
                                onChange={(event) => setTermoBuscaLista(event.target.value)}
                            />
                        </div>
                        {!somenteLeitura && (
                            <button
                                type='button'
                                className='supertabelanegociacoes_action_btn'
                                onClick={() => setMostrarNovoForm((anterior) => !anterior)}
                            >
                                ＋ Adicionar novo
                            </button>
                        )}
                    </div>
                ) : (
                    <div className='supertabelanegociacoes_filters'>
                        <button
                            type='button'
                            className='supertabelanegociacoes_back_btn'
                            onClick={() => {
                                setNegociacaoSelecionadaId(null)
                                setDetalheBase([])
                                setDiferencasPorCodigo({})
                                setMostrarGerenciarForm(false)
                                setEdicoesLocais({})
                                setCategoriaEmInclusao(null)
                                setTextoNovoProcedimento('')
                                setNovoProcedimentoSelecionadoCodigo('')
                                setInclusaoMassaAtiva(false)
                            }}
                        >
                            ← Voltar para lista
                        </button>
                        <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_busca'>
                            <p>Busca</p>
                            <input
                                type='text'
                                className='supertabelanegociacoes_input'
                                placeholder='Código, procedimento ou categoria'
                                value={termoBuscaDetalhe}
                                onChange={(event) => setTermoBuscaDetalhe(event.target.value)}
                            />
                        </div>
                        <button
                            type='button'
                            className='supertabelanegociacoes_action_btn secondary'
                            onClick={() => void baixarExcelNegociacao()}
                            title='Excel (.xlsx): cabeçalho Proposta Emerdog / Resposta Veterinario com p, m, g'
                        >
                            Baixar Excel
                        </button>
                        {!somenteLeitura && (
                            <button
                                type='button'
                                className='supertabelanegociacoes_action_btn'
                                onClick={abrirGerenciarSelecionada}
                            >
                                Gerenciar
                            </button>
                        )}
                        {!somenteLeitura && (
                            <label className='supertabelanegociacoes_edit_wrap'>
                                <input
                                    type='checkbox'
                                    checked={edicaoAtiva}
                                    onChange={(event) => setEdicaoAtiva(event.target.checked)}
                                />
                                <span>Habilitar edição</span>
                            </label>
                        )}
                        {!somenteLeitura && (
                            <label className='supertabelanegociacoes_edit_wrap'>
                                <input
                                    type='checkbox'
                                    checked={inclusaoMassaAtiva}
                                    onChange={(event) => setInclusaoMassaAtiva(event.target.checked)}
                                />
                                <span>Inclusão em massa</span>
                            </label>
                        )}
                        <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_pill'>
                            <p>Custos</p>
                            <button
                                type='button'
                                role='switch'
                                aria-checked={mostrarCustos}
                                className={`supertabelanegociacoes_pill_switch ${
                                    mostrarCustos ? 'is-on' : 'is-off'
                                }`}
                                onClick={() => setMostrarCustos((v) => !v)}
                            >
                                <span className='supertabelanegociacoes_pill_track' aria-hidden='true'>
                                    <span className='supertabelanegociacoes_pill_knob' />
                                </span>
                                <span className='supertabelanegociacoes_pill_label'>
                                    {mostrarCustos ? 'Esconder' : 'Mostrar'}
                                </span>
                            </button>
                        </div>
                        <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_pill'>
                            <p>Nome alt. (cadastro)</p>
                            <button
                                type='button'
                                role='switch'
                                aria-checked={mostrarNomeAlternativo}
                                className={`supertabelanegociacoes_pill_switch ${
                                    mostrarNomeAlternativo ? 'is-on' : 'is-off'
                                }`}
                                onClick={() => setMostrarNomeAlternativo((v) => !v)}
                            >
                                <span className='supertabelanegociacoes_pill_track' aria-hidden='true'>
                                    <span className='supertabelanegociacoes_pill_knob' />
                                </span>
                                <span className='supertabelanegociacoes_pill_label'>
                                    {mostrarNomeAlternativo ? 'Esconder' : 'Mostrar'}
                                </span>
                            </button>
                        </div>
                        {mostrarCustos && (
                            <>
                                <div className='supertabelanegociacoes_filter_break' aria-hidden='true' />
                                <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_item_plano'>
                                    <p>Plano</p>
                                    <select
                                        className='supertabelanegociacoes_select'
                                        value={planoId}
                                        onChange={(event) => setPlanoId(event.target.value)}
                                    >
                                        {planos.map((plano) => (
                                            <option key={plano.id} value={plano.id}>
                                                {plano.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className='supertabelanegociacoes_filter_item supertabelanegociacoes_filter_item_porte'>
                                    <p>Porte</p>
                                    <select
                                        className='supertabelanegociacoes_select'
                                        value={porteSelecionado}
                                        onChange={(event) => setPorteSelecionado(event.target.value)}
                                    >
                                        {portes.map((porte) => (
                                            <option key={porte.id} value={porte.id}>
                                                {porte.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {mostrarNovoForm && !negociacaoSelecionada && (
                    <div className='supertabelanegociacoes_form_box'>
                        <h3>Nova negociação</h3>
                        <label className='supertabelanegociacoes_edit_wrap' style={{ marginBottom: '0.75rem' }}>
                            <input
                                type='checkbox'
                                checked={vincularPrestador}
                                onChange={(e) => {
                                    setVincularPrestador(e.target.checked)
                                    if (!e.target.checked) setNovoPrestadorId('')
                                }}
                            />
                            <span>Vincular a clínica / prestador credenciado</span>
                        </label>
                        {vincularPrestador && (
                            <label className='supertabelanegociacoes_form_full' style={{ marginBottom: '0.75rem' }}>
                                <span>Clínica / prestador</span>
                                <PrestadorVinculoBusca
                                    prestadores={prestadoresParaVinculo}
                                    prestadorId={novoPrestadorId}
                                    rotuloFn={rotuloOpcaoPrestador}
                                    onChange={(p) => {
                                        setNovoPrestadorId(p ? String(p.id) : '')
                                        if (p) {
                                            setNovoNome(p.nome || '')
                                            const cid = resolverIdTabelaCidade(p)
                                            if (cid) setNovoCidadeId(String(cid))
                                        }
                                    }}
                                />
                                <small style={{ opacity: 0.85 }}>
                                    Ao salvar, os procedimentos habilitados no perfil do prestador serão incluídos na negociação.
                                </small>
                            </label>
                        )}
                        <div className='supertabelanegociacoes_form_grid'>
                            <label>
                                <span>Nome</span>
                                <input
                                    type='text'
                                    value={novoNome}
                                    onChange={(event) => setNovoNome(event.target.value)}
                                    placeholder='Nome da negociação'
                                />
                            </label>
                            <label>
                                <span>Cidade</span>
                                <select
                                    value={novoCidadeId}
                                    onChange={(event) => setNovoCidadeId(event.target.value)}
                                >
                                    {cidadesParaSeletor.map((cidade) => (
                                        <option key={`nova-neg-${cidade.id}`} value={cidade.id}>
                                            {cidade.uf ? `${cidade.nome} (${cidade.uf})` : cidade.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>Tipo</span>
                                <input
                                    type='text'
                                    value={novoTipo}
                                    onChange={(event) => setNovoTipo(event.target.value)}
                                    placeholder={suportaTipo ? 'Tipo da negociação' : 'Sem suporte a coluna tipo'}
                                    disabled={!suportaTipo}
                                />
                            </label>
                        </div>
                        <div className='supertabelanegociacoes_form_actions'>
                            <button type='button' className='supertabelanegociacoes_action_btn' onClick={criarNegociacao}>
                                Salvar
                            </button>
                            <button
                                type='button'
                                className='supertabelanegociacoes_action_btn secondary'
                                onClick={() => {
                                    setMostrarNovoForm(false)
                                    setNovoNome('')
                                    setNovoTipo('')
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}

                {mostrarGerenciarForm && negociacaoSelecionada && (
                    <div className='supertabelanegociacoes_form_box'>
                        <h3>Gerenciar negociação</h3>
                        <div className='supertabelanegociacoes_form_grid'>
                            <label>
                                <span>Nome</span>
                                <input
                                    type='text'
                                    value={editarNome}
                                    onChange={(event) => setEditarNome(event.target.value)}
                                    placeholder='Nome da negociação'
                                />
                            </label>
                            <label>
                                <span>Cidade</span>
                                <select
                                    value={editarCidadeId}
                                    onChange={(event) => setEditarCidadeId(event.target.value)}
                                >
                                    {cidades.map((cidade) => (
                                        <option key={`edita-neg-${cidade.id}`} value={cidade.id}>
                                            {cidade.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>Tipo</span>
                                <input
                                    type='text'
                                    value={editarTipo}
                                    onChange={(event) => setEditarTipo(event.target.value)}
                                    placeholder={suportaTipo ? 'Tipo da negociação' : 'Sem suporte a coluna tipo'}
                                    disabled={!suportaTipo}
                                />
                            </label>
                            <label className='supertabelanegociacoes_form_full'>
                                <span>Clínica / prestador vinculado</span>
                                <PrestadorVinculoBusca
                                    prestadores={prestadoresParaVinculo}
                                    prestadorId={editarPrestadorId}
                                    rotuloFn={rotuloOpcaoPrestador}
                                    disabled={!suportaPrestadorId}
                                    onChange={(p) => setEditarPrestadorId(p ? String(p.id) : '')}
                                />
                                {!suportaPrestadorId && (
                                    <small style={{ opacity: 0.85 }}>
                                        Execute o script SQL `veterinarios_prestador_id` no Supabase para persistir o vínculo.
                                    </small>
                                )}
                            </label>
                        </div>
                        <div className='supertabelanegociacoes_form_actions'>
                            <button type='button' className='supertabelanegociacoes_action_btn' onClick={salvarGerenciarSelecionada}>
                                Salvar
                            </button>
                            <button
                                type='button'
                                className='supertabelanegociacoes_action_btn secondary'
                                disabled={loading || !editarPrestadorId}
                                onClick={() => void importarProcedimentosVinculoAtual()}
                            >
                                Importar procedimentos do perfil
                            </button>
                            <button
                                type='button'
                                className='supertabelanegociacoes_action_btn secondary'
                                onClick={() => setMostrarGerenciarForm(false)}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}

                {inclusaoMassaAtiva && negociacaoSelecionada && (
                    <div className='supertabelanegociacoes_form_box'>
                        <h3>Inclusão em massa de procedimentos</h3>
                        <label className='supertabelanegociacoes_form_full'>
                            <span>Códigos (um por linha ou separados por vírgula)</span>
                            <textarea
                                rows={3}
                                value={textoMassaDetalhe}
                                onChange={(event) => setTextoMassaDetalhe(event.target.value)}
                                placeholder={`Ex.: CONS-001, EXAM-103
ou um código por linha`}
                            />
                        </label>
                        <div className='supertabelanegociacoes_form_actions'>
                            <button type='button' className='supertabelanegociacoes_action_btn' onClick={inserirProcedimentosEmMassaDetalhe}>
                                Inserir procedimentos em massa
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {erroDetalhe && (
                <div className='supertabelanegociacoes_alert' role='alert' aria-live='assertive'>
                    <div className='supertabelanegociacoes_alert_text'>
                        <strong>Aviso</strong>
                        <span>{erroDetalhe}</span>
                    </div>
                    <button
                        type='button'
                        className='supertabelanegociacoes_alert_close'
                        onClick={() => setErroDetalhe('')}
                        aria-label='Fechar aviso'
                    >
                        x
                    </button>
                </div>
            )}

            {confirmacaoExclusao && (
                <div className='supertabelanegociacoes_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div className='supertabelanegociacoes_confirm_text'>
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className='supertabelanegociacoes_confirm_actions'>
                        <button
                            type='button'
                            className='supertabelanegociacoes_confirm_btn danger'
                            onClick={async () => {
                                const acao = confirmacaoExclusao.onConfirmar
                                setConfirmacaoExclusao(null)
                                await acao()
                            }}
                        >
                            Confirmar
                        </button>
                        <button
                            type='button'
                            className='supertabelanegociacoes_confirm_btn'
                            onClick={() => setConfirmacaoExclusao(null)}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {!negociacaoSelecionada ? (
                <div className='supertabelanegociacoes_table_container'>
                    {loading ? (
                        <p>Carregando...</p>
                    ) : (
                        <>
                            <table className='table_main'>
                                <colgroup>
                                    <col
                                        style={{
                                            width: mostrarColunaVinculoLista
                                                ? '24%'
                                                : somenteLeitura
                                                  ? '40%'
                                                  : '34%',
                                        }}
                                    />
                                    <col style={{ width: '14%' }} />
                                    <col
                                        style={{
                                            width: mostrarColunaVinculoLista
                                                ? '18%'
                                                : somenteLeitura
                                                  ? '46%'
                                                  : '40%',
                                        }}
                                    />
                                    {mostrarColunaVinculoLista && (
                                        <col style={{ width: somenteLeitura ? '44%' : '36%' }} />
                                    )}
                                    {!somenteLeitura && <col style={{ width: '8%' }} />}
                                </colgroup>
                                <thead>
                                    <tr>
                                    <th
                                        className='table_header'
                                        onClick={() => handleOrdenarListaNegociacoes('nome')}
                                    >
                                        Nome{obterIndicadorOrdenacaoLista('nome')}
                                    </th>
                                    <th
                                        className='table_header'
                                        onClick={() => handleOrdenarListaNegociacoes('tipo')}
                                    >
                                        Tipo{obterIndicadorOrdenacaoLista('tipo')}
                                    </th>
                                    <th
                                        className='table_header'
                                        onClick={() => handleOrdenarListaNegociacoes('cidadeNome')}
                                    >
                                        Cidade{obterIndicadorOrdenacaoLista('cidadeNome')}
                                    </th>
                                    {mostrarColunaVinculoLista && (
                                        <th
                                            className='table_header'
                                            onClick={() => handleOrdenarListaNegociacoes('prestadorVinculoNome')}
                                        >
                                            Prestador vinculado
                                            {obterIndicadorOrdenacaoLista('prestadorVinculoNome')}
                                        </th>
                                    )}
                                    {!somenteLeitura && (
                                        <th className='table_header table_header_no_sort'>Ações</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {negociacoesListaPaginada.map((item) => (
                                    <tr key={`neg-lista-${item.id}`}>
                                        <td
                                            className='table_text_left supertabelanegociacoes_clickable'
                                            onClick={() => setNegociacaoSelecionadaId(item.id)}
                                        >
                                            {item.nome}
                                        </td>
                                        <td
                                            className='table_text_left supertabelanegociacoes_clickable'
                                            onClick={() => setNegociacaoSelecionadaId(item.id)}
                                        >
                                            {item.tipo || '-'}
                                        </td>
                                        <td
                                            className='table_text_left supertabelanegociacoes_clickable'
                                            onClick={() => setNegociacaoSelecionadaId(item.id)}
                                        >
                                            {item.cidadeNome}
                                        </td>
                                        {mostrarColunaVinculoLista && (
                                            <td
                                                className='table_text_left supertabelanegociacoes_lista_vinculo_cell'
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                {somenteLeitura ? (
                                                    <span className='supertabelanegociacoes_vinculo_readonly'>
                                                        {item.prestadorVinculoNome?.trim()
                                                            ? item.prestadorVinculoNome
                                                            : '—'}
                                                    </span>
                                                ) : (
                                                    <PrestadorVinculoBusca
                                                        usePortal
                                                        titleValor={item.prestadorVinculoNome || ''}
                                                        prestadores={prestadoresParaVinculo}
                                                        prestadorId={
                                                            item.prestadorId != null
                                                                ? String(item.prestadorId)
                                                                : ''
                                                        }
                                                        rotuloFn={rotuloOpcaoPrestador}
                                                        disabled={
                                                            !suportaPrestadorId ||
                                                            salvandoVinculoListaId === item.id
                                                        }
                                                        placeholder={
                                                            salvandoVinculoListaId === item.id
                                                                ? 'A guardar…'
                                                                : 'Buscar prestador…'
                                                        }
                                                        onChange={(p) =>
                                                            void salvarVinculoPrestadorNaLista(item, p)
                                                        }
                                                    />
                                                )}
                                            </td>
                                        )}
                                        {!somenteLeitura && (
                                            <td>
                                                <button
                                                    type='button'
                                                    className='table_delete_btn'
                                                    onClick={(event) =>
                                                        excluirNegociacao(item, { ignorarConfirmacao: event.shiftKey })
                                                    }
                                                    title='Excluir negociação, SHIFT = Excluir rápido'
                                                >
                                                    🗑️
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                                    {!loading && negociacoesListaPaginada.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={
                                                    (somenteLeitura ? 3 : 4) +
                                                    (mostrarColunaVinculoLista ? 1 : 0)
                                                }
                                            >
                                                Nenhuma negociação encontrada.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {!loading && negociacoesListaOrdenada.length > 0 && (
                                <div className='supertabelanegociacoes_paginacao'>
                                    <div className='supertabelanegociacoes_paginacao_info'>
                                        Exibindo{' '}
                                        <strong>
                                            {(paginaAtualLista - 1) * itensPorPaginaLista + 1}-
                                            {Math.min(paginaAtualLista * itensPorPaginaLista, negociacoesListaOrdenada.length)}
                                        </strong>{' '}
                                        de <strong>{negociacoesListaOrdenada.length}</strong>
                                    </div>
                                    <div className='supertabelanegociacoes_paginacao_controles'>
                                        <label className='supertabelanegociacoes_paginacao_label'>
                                            Por página
                                            <select
                                                className='supertabelanegociacoes_select'
                                                value={itensPorPaginaLista}
                                                onChange={(event) => handleTrocarItensPorPaginaLista(event.target.value)}
                                            >
                                                <option value={20}>20</option>
                                                <option value={30}>30</option>
                                                <option value={40}>40</option>
                                                <option value={100}>100</option>
                                            </select>
                                        </label>
                                        <button
                                            type='button'
                                            className='supertabelanegociacoes_action_btn secondary'
                                            onClick={() => setPaginaAtualLista((anterior) => Math.max(1, anterior - 1))}
                                            disabled={paginaAtualLista <= 1}
                                        >
                                            Anterior
                                        </button>
                                        <span className='supertabelanegociacoes_paginacao_page'>
                                            Página {paginaAtualLista} de {totalPaginasLista}
                                        </span>
                                        <button
                                            type='button'
                                            className='supertabelanegociacoes_action_btn secondary'
                                            onClick={() =>
                                                setPaginaAtualLista((anterior) => Math.min(totalPaginasLista, anterior + 1))
                                            }
                                            disabled={paginaAtualLista >= totalPaginasLista}
                                        >
                                            Próxima
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <div className='supertabelanegociacoes_table_container'>
                    {secoesDetalhePorCategoria.length === 0 ? (
                        <p>Nenhum procedimento ativo nesta negociação.</p>
                    ) : (
                        secoesDetalhePorCategoria.map((secao) => {
                            const totalLinhasSecao = secao.linhas.length
                            const usarVirtualizacao = totalLinhasSecao > MAX_LINHAS_VISIVEIS
                            const alturaVisivelCorpo = Math.min(totalLinhasSecao, MAX_LINHAS_VISIVEIS) * ALTURA_LINHA_TABELA
                            const janelaVirtual = calcularJanelaVirtualTabela({
                                scrollTop: scrollTopoPorCategoria[secao.categoriaId] ?? 0,
                                totalLinhas: totalLinhasSecao,
                                alturaLinha: ALTURA_LINHA_TABELA,
                                alturaVisivel: alturaVisivelCorpo,
                                overscan: LINHAS_OVERSCAN,
                            })
                            const { indiceInicial, indiceFinal, alturaEspacadorTopo, alturaEspacadorBase } =
                                janelaVirtual
                            const linhasVisiveis = secao.linhas.slice(indiceInicial, indiceFinal)
                            const colSpanDetalhe =
                                5 +
                                (mostrarNomeAlternativo ? 1 : 0) +
                                (mostrarCustos ? 2 : 0) +
                                (somenteLeitura ? 0 : 1)

                            const renderLinha = (linha, linhaIndex) => (
                                <tr key={linha.rowId}>
                                    <td className='table_text_left'>{linha.codigo}</td>
                                    <td className='table_text_left'>
                                        <span>{linha.procedimento}</span>
                                    </td>
                                    {mostrarNomeAlternativo && (
                                        <td
                                            className='table_text_left supertabelanegociacoes_nome_alt_readonly'
                                            title='Edite no cadastro do prestador (Serviços)'
                                        >
                                            <span>{linha.nomeAlternativo?.trim() ? linha.nomeAlternativo : '—'}</span>
                                        </td>
                                    )}
                                    <td>
                                        {edicaoAtiva ? (
                                            <input
                                                className='table_cell_input'
                                                type='number'
                                                step='0.01'
                                                value={obterValorInput(linha, 'porteP', secao.categoriaId)}
                                                onChange={(event) =>
                                                    atualizarEdicaoLocal(linha, 'porteP', secao.categoriaId, event.target.value)
                                                }
                                                onBlur={() => salvarCampoNegociadoEditado(linha, 'porteP', secao.categoriaId)}
                                                onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteP')}
                                            />
                                        ) : (
                                            Number(linha.porteP || 0).toFixed(2)
                                        )}
                                    </td>
                                    <td>
                                        {edicaoAtiva ? (
                                            <input
                                                className='table_cell_input'
                                                type='number'
                                                step='0.01'
                                                value={obterValorInput(linha, 'porteM', secao.categoriaId)}
                                                onChange={(event) =>
                                                    atualizarEdicaoLocal(linha, 'porteM', secao.categoriaId, event.target.value)
                                                }
                                                onBlur={() => salvarCampoNegociadoEditado(linha, 'porteM', secao.categoriaId)}
                                                onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteM')}
                                            />
                                        ) : (
                                            Number(linha.porteM || 0).toFixed(2)
                                        )}
                                    </td>
                                    <td>
                                        {edicaoAtiva ? (
                                            <input
                                                className='table_cell_input'
                                                type='number'
                                                step='0.01'
                                                value={obterValorInput(linha, 'porteG', secao.categoriaId)}
                                                onChange={(event) =>
                                                    atualizarEdicaoLocal(linha, 'porteG', secao.categoriaId, event.target.value)
                                                }
                                                onBlur={() => salvarCampoNegociadoEditado(linha, 'porteG', secao.categoriaId)}
                                                onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteG')}
                                            />
                                        ) : (
                                            Number(linha.porteG || 0).toFixed(2)
                                        )}
                                    </td>
                                    {mostrarCustos && (
                                        <td>
                                            {linha.mensagemPlanoAcima ? (
                                                <span
                                                    className='supertabelanegociacoes_plano_acima'
                                                    title='Plano mínimo do procedimento acima do plano selecionado no filtro.'
                                                >
                                                    {linha.mensagemPlanoAcima}
                                                </span>
                                            ) : (
                                                Number(linha.diferenca || 0).toFixed(2)
                                            )}
                                        </td>
                                    )}
                                    {mostrarCustos && (
                                        <td
                                            className={
                                                Number.isFinite(Number(linha.custo)) && Number(linha.custo) < 0
                                                    ? 'table_custo_negativo'
                                                    : ''
                                            }
                                        >
                                            {linha.mensagemPlanoAcima ? (
                                                <span
                                                    className={`supertabelanegociacoes_plano_acima${
                                                        Number.isFinite(Number(linha.custo)) && Number(linha.custo) < 0
                                                            ? ' supertabelanegociacoes_plano_acima_custo_neg'
                                                            : ''
                                                    }`}
                                                    title='Plano mínimo do procedimento acima do plano selecionado no filtro.'
                                                >
                                                    {linha.mensagemPlanoAcima}
                                                </span>
                                            ) : (
                                                Number(linha.custo || 0).toFixed(2)
                                            )}
                                        </td>
                                    )}
                                    {!somenteLeitura && (
                                        <td>
                                            <button
                                                type='button'
                                                className='table_delete_btn'
                                                onClick={(event) =>
                                                    excluirLinhaProcedimentoNegociacao(linha, {
                                                        ignorarConfirmacao: event.shiftKey,
                                                    })
                                                }
                                                title='Excluir procedimento, SHIFT = Excluir rápido'
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            )

                            const ordemVirtual =
                                ordenacaoPorCategoria[secao.categoriaId] || { coluna: 'codigo', direcao: 'asc' }

                            return (
                                <section key={`neg-sec-${secao.categoriaId}`} className='categoria_secao'>
                                    <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>
                                    {usarVirtualizacao ? (
                                        <>
                                            <table className='table_main table_main_virtual_header'>
                                                <colgroup>
                                                    <col style={{ width: colunasDetalheWidths.cod }} />
                                                    <col style={{ width: colunasDetalheWidths.nom }} />
                                                    {mostrarNomeAlternativo && (
                                                        <col style={{ width: colunasDetalheWidths.nalt }} />
                                                    )}
                                                    <col style={{ width: colunasDetalheWidths.p }} />
                                                    <col style={{ width: colunasDetalheWidths.p }} />
                                                    <col style={{ width: colunasDetalheWidths.p }} />
                                                    {mostrarCustos && (
                                                        <col style={{ width: colunasDetalheWidths.diff }} />
                                                    )}
                                                    {mostrarCustos && (
                                                        <col style={{ width: colunasDetalheWidths.custo }} />
                                                    )}
                                                    {!somenteLeitura && colunasDetalheWidths.acao && (
                                                        <col style={{ width: colunasDetalheWidths.acao }} />
                                                    )}
                                                </colgroup>
                                                <thead>
                                                    <tr>
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}
                                                        >
                                                            Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                                        </th>
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}
                                                        >
                                                            Nome{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                                        </th>
                                                        {mostrarNomeAlternativo && (
                                                            <th
                                                                className='table_header'
                                                                onClick={() =>
                                                                    handleOrdenarCategoria(
                                                                        secao.categoriaId,
                                                                        'nomeAlternativo'
                                                                    )
                                                                }
                                                            >
                                                                Nome alt. (cadastro)
                                                                {obterIndicadorOrdenacao(
                                                                    secao.categoriaId,
                                                                    'nomeAlternativo'
                                                                )}
                                                            </th>
                                                        )}
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteP')}
                                                        >
                                                            Porte P{obterIndicadorOrdenacao(secao.categoriaId, 'porteP')}
                                                        </th>
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteM')}
                                                        >
                                                            Porte M{obterIndicadorOrdenacao(secao.categoriaId, 'porteM')}
                                                        </th>
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteG')}
                                                        >
                                                            Porte G{obterIndicadorOrdenacao(secao.categoriaId, 'porteG')}
                                                        </th>
                                                        {mostrarCustos && (
                                                            <th
                                                                className='table_header'
                                                                onClick={() =>
                                                                    handleOrdenarCategoria(secao.categoriaId, 'diferenca')
                                                                }
                                                            >
                                                                <span className='supertabelanegociacoes_th_stack'>
                                                                    <span className='supertabelanegociacoes_th_main'>
                                                                        Diferença
                                                                        {obterIndicadorOrdenacao(secao.categoriaId, 'diferenca')}
                                                                    </span>
                                                                    <span
                                                                        className='supertabelanegociacoes_th_plan'
                                                                        title={planoSelecionadoNome}
                                                                    >
                                                                        {planoSelecionadoNome}
                                                                    </span>
                                                                </span>
                                                            </th>
                                                        )}
                                                        {mostrarCustos && (
                                                            <th
                                                                className='table_header'
                                                                onClick={() => handleOrdenarCategoria(secao.categoriaId, 'custo')}
                                                            >
                                                                <span className='supertabelanegociacoes_th_stack'>
                                                                    <span className='supertabelanegociacoes_th_main'>
                                                                        Custo
                                                                        {obterIndicadorOrdenacao(secao.categoriaId, 'custo')}
                                                                    </span>
                                                                    <span
                                                                        className='supertabelanegociacoes_th_plan'
                                                                        title={planoSelecionadoNome}
                                                                    >
                                                                        {planoSelecionadoNome}
                                                                    </span>
                                                                </span>
                                                            </th>
                                                        )}
                                                        {!somenteLeitura && (
                                                            <th className='table_header table_header_no_sort'>Ação</th>
                                                        )}
                                                    </tr>
                                                </thead>
                                            </table>
                                            <div
                                                key={`vscroll-${secao.categoriaId}-${ordemVirtual.coluna}-${ordemVirtual.direcao}-${
                                                    mostrarNomeAlternativo ? 'na1' : 'na0'
                                                }-${mostrarCustos ? 'c1' : 'c0'}`}
                                                className='table_main_virtual_body'
                                                style={{ maxHeight: `${Math.max(alturaVisivelCorpo, ALTURA_LINHA_TABELA)}px` }}
                                                onScroll={criarHandlerScrollVirtualTabela({
                                                    categoriaId: secao.categoriaId,
                                                    setScrollTopoPorCategoria,
                                                })}
                                            >
                                                <table className='table_main table_main_virtual_rows'>
                                                    <colgroup>
                                                        <col style={{ width: colunasDetalheWidths.cod }} />
                                                        <col style={{ width: colunasDetalheWidths.nom }} />
                                                        {mostrarNomeAlternativo && (
                                                            <col style={{ width: colunasDetalheWidths.nalt }} />
                                                        )}
                                                        <col style={{ width: colunasDetalheWidths.p }} />
                                                        <col style={{ width: colunasDetalheWidths.p }} />
                                                        <col style={{ width: colunasDetalheWidths.p }} />
                                                        {mostrarCustos && (
                                                            <col style={{ width: colunasDetalheWidths.diff }} />
                                                        )}
                                                        {mostrarCustos && (
                                                            <col style={{ width: colunasDetalheWidths.custo }} />
                                                        )}
                                                        {!somenteLeitura && colunasDetalheWidths.acao && (
                                                            <col style={{ width: colunasDetalheWidths.acao }} />
                                                        )}
                                                    </colgroup>
                                                    <tbody>
                                                        {alturaEspacadorTopo > 0 && (
                                                            <tr className='table_spacer_row' aria-hidden='true'>
                                                                <td colSpan={colSpanDetalhe} style={{ height: `${alturaEspacadorTopo}px` }} />
                                                            </tr>
                                                        )}
                                                        {linhasVisiveis.map((linha, indiceLocal) =>
                                                            renderLinha(linha, indiceInicial + indiceLocal)
                                                        )}
                                                        {alturaEspacadorBase > 0 && (
                                                            <tr className='table_spacer_row' aria-hidden='true'>
                                                                <td colSpan={colSpanDetalhe} style={{ height: `${alturaEspacadorBase}px` }} />
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    ) : (
                                        <table className='table_main'>
                                            <colgroup>
                                                <col style={{ width: colunasDetalheWidths.cod }} />
                                                <col style={{ width: colunasDetalheWidths.nom }} />
                                                {mostrarNomeAlternativo && (
                                                    <col style={{ width: colunasDetalheWidths.nalt }} />
                                                )}
                                                <col style={{ width: colunasDetalheWidths.p }} />
                                                <col style={{ width: colunasDetalheWidths.p }} />
                                                <col style={{ width: colunasDetalheWidths.p }} />
                                                {mostrarCustos && (
                                                    <col style={{ width: colunasDetalheWidths.diff }} />
                                                )}
                                                {mostrarCustos && (
                                                    <col style={{ width: colunasDetalheWidths.custo }} />
                                                )}
                                                {!somenteLeitura && colunasDetalheWidths.acao && (
                                                    <col style={{ width: colunasDetalheWidths.acao }} />
                                                )}
                                            </colgroup>
                                            <thead>
                                                <tr>
                                                    <th
                                                        className='table_header'
                                                        onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}
                                                    >
                                                        Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                                    </th>
                                                    <th
                                                        className='table_header'
                                                        onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}
                                                    >
                                                        Nome{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                                    </th>
                                                    {mostrarNomeAlternativo && (
                                                        <th
                                                            className='table_header'
                                                            onClick={() =>
                                                                handleOrdenarCategoria(
                                                                    secao.categoriaId,
                                                                    'nomeAlternativo'
                                                                )
                                                            }
                                                        >
                                                            Nome alt. (cadastro)
                                                            {obterIndicadorOrdenacao(
                                                                secao.categoriaId,
                                                                'nomeAlternativo'
                                                            )}
                                                        </th>
                                                    )}
                                                    <th
                                                        className='table_header'
                                                        onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteP')}
                                                    >
                                                        Porte P{obterIndicadorOrdenacao(secao.categoriaId, 'porteP')}
                                                    </th>
                                                    <th
                                                        className='table_header'
                                                        onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteM')}
                                                    >
                                                        Porte M{obterIndicadorOrdenacao(secao.categoriaId, 'porteM')}
                                                    </th>
                                                    <th
                                                        className='table_header'
                                                        onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteG')}
                                                    >
                                                        Porte G{obterIndicadorOrdenacao(secao.categoriaId, 'porteG')}
                                                    </th>
                                                    {mostrarCustos && (
                                                        <th
                                                            className='table_header'
                                                            onClick={() =>
                                                                handleOrdenarCategoria(secao.categoriaId, 'diferenca')
                                                            }
                                                        >
                                                            <span className='supertabelanegociacoes_th_stack'>
                                                                <span className='supertabelanegociacoes_th_main'>
                                                                    Diferença
                                                                    {obterIndicadorOrdenacao(secao.categoriaId, 'diferenca')}
                                                                </span>
                                                                <span
                                                                    className='supertabelanegociacoes_th_plan'
                                                                    title={planoSelecionadoNome}
                                                                >
                                                                    {planoSelecionadoNome}
                                                                </span>
                                                            </span>
                                                        </th>
                                                    )}
                                                    {mostrarCustos && (
                                                        <th
                                                            className='table_header'
                                                            onClick={() => handleOrdenarCategoria(secao.categoriaId, 'custo')}
                                                        >
                                                            <span className='supertabelanegociacoes_th_stack'>
                                                                <span className='supertabelanegociacoes_th_main'>
                                                                    Custo
                                                                    {obterIndicadorOrdenacao(secao.categoriaId, 'custo')}
                                                                </span>
                                                                <span
                                                                    className='supertabelanegociacoes_th_plan'
                                                                    title={planoSelecionadoNome}
                                                                >
                                                                    {planoSelecionadoNome}
                                                                </span>
                                                            </span>
                                                        </th>
                                                    )}
                                                    {!somenteLeitura && (
                                                        <th className='table_header table_header_no_sort'>Ação</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>{secao.linhas.map((linha, linhaIndex) => renderLinha(linha, linhaIndex))}</tbody>
                                        </table>
                                    )}

                                    <div className='row_add_line'>
                                        {categoriaEmInclusao === secao.categoriaId ? (
                                            <div className='row_add_inline'>
                                                <div
                                                    className='row_add_suggest_wrap'
                                                    ref={categoriaEmInclusao === secao.categoriaId ? sugestoesAnchorRef : null}
                                                >
                                                    <input
                                                        type='text'
                                                        className='row_add_input'
                                                        placeholder='Digite nome/código do procedimento'
                                                        value={textoNovoProcedimento}
                                                        onChange={(event) => {
                                                            setTextoNovoProcedimento(event.target.value)
                                                            setNovoProcedimentoSelecionadoCodigo('')
                                                        }}
                                                    />
                                                    {renderSugestoesPortal(secao)}
                                                </div>
                                                <button
                                                    type='button'
                                                    className='row_add_btn'
                                                    onClick={() => confirmarNovoProcedimentoCategoria(secao.categoriaId)}
                                                >
                                                    Salvar
                                                </button>
                                                <button
                                                    type='button'
                                                    className='row_add_cancel_btn'
                                                    onClick={() => {
                                                        setCategoriaEmInclusao(null)
                                                        setTextoNovoProcedimento('')
                                                        setNovoProcedimentoSelecionadoCodigo('')
                                                    }}
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        ) : !somenteLeitura ? (
                                            <button
                                                type='button'
                                                className='row_add_btn'
                                                onClick={() => {
                                                    setCategoriaEmInclusao(secao.categoriaId)
                                                    setTextoNovoProcedimento('')
                                                    setNovoProcedimentoSelecionadoCodigo('')
                                                }}
                                            >
                                                ＋ Adicionar procedimento nesta categoria
                                            </button>
                                        ) : null
                                        }
                                    </div>
                                </section>
                            )
                        })
                    )}
                </div>
            )}
        </div>
    )
}

export default Supertabelanegociacoes
