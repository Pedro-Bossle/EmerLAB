import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { normalizarTextoBusca as normalizarTextoBuscaDev } from '../../../lib/prestadorCadastroHelpers'
import { filtrarLinhaSupertabelaPorBusca, partesValoresLinhaSupertabela } from '../../../lib/supertabelaBuscaValores.js'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { TOAST_AUTO_DISMISS_MS, useConfirmacaoExclusaoAutoDismiss } from '../../../lib/toastUi.js'
import { extrairCodigosProcedimentoEmMassa } from '../../../lib/parseCodigosEmMassa'
import CidadeTabelaIbgeForm from '../../../components/Supertabela/CidadeTabelaIbgeForm.jsx'
import GerenciarTabelasModal from '../../../components/Supertabela/GerenciarTabelasModal.jsx'
import { mapCidadeParaGerenciador, payloadCidadeComUf } from '../../../lib/cidadesSupertabelaHelpers.js'
import {
    buildOpcoesFiltroSupertabela,
    buscarCidadeIdsFiltroPlanoCredenciados,
    carregarVinculosMunicipios,
    extrairMunicipiosCredenciadosDePrestadores,
    isMissingVinculosTableError,
    listarMunicipiosForaDaMalhaPorUf,
    municipiosPorCidadeId,
    normalizarMunicipioChave,
    salvarVinculosDaCidade } from '../../../lib/cidadesSupertabelaVinculos.js'
import {
    CHAVE_PLANO_APENAS_LOJA,
    mapearPlanos,
    procedimentoPlanoBaseApenasLoja,
    ROTULO_PLANO } from '../../../lib/planosHierarquia.js'
import {
    carregarContagemESugestoesRealizadoresPlanos,
    montarCidadesAlvoContagemPrestadores } from '../../../lib/impressaoPlanos/contagemRealizadoresPlanosDev.js'
import { exportarTabelaCidadeParaExcel } from '../../../lib/exportNegociacaoExcel.js'
import ModalImpressaoHonorariosCidade from '../../../components/Supertabela/ModalImpressaoHonorariosCidade.jsx'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import '../Supertabela_main/Supertabelamain.css'
import './Supertabelacidades.css'
import { PageHeader } from '../../../components/ui'

const Supertabelacidades = () => {
    const [somenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT))
    const mostrarContagemRealizadores = true
    const [cidades, setCidades] = useState([])
    const [municipiosVinculos, setMunicipiosVinculos] = useState([])
    const [municipiosCredenciados, setMunicipiosCredenciados] = useState([])
    const [suportaVinculosMunicipios, setSuportaVinculosMunicipios] = useState(true)
    const [valorFiltroCidade, setValorFiltroCidade] = useState('')
    const [cidadeIdsFiltroPlano, setCidadeIdsFiltroPlano] = useState(null)
    const [categorias, setCategorias] = useState([])
    const [portes, setPortes] = useState([])
    const [procedimentos, setProcedimentos] = useState([])
    const [planosTodos, setPlanosTodos] = useState([])
    const [linhas, setLinhas] = useState([])

    const [cidadeId, setCidadeId] = useState('')
    const [termoBusca, setTermoBusca] = useState('')
    const [edicaoAtiva, setEdicaoAtiva] = useState(false)
    const [loading, setLoading] = useState(false)
    const [erroDetalhe, setErroDetalhe] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})
    const [contagemRealizadoresPorCodigo, setContagemRealizadoresPorCodigo] = useState(() => new Map())
    const [nomesRealizadoresPorCodigo, setNomesRealizadoresPorCodigo] = useState(() => new Map())
    const [sugestoesRealizadores, setSugestoesRealizadores] = useState([])
    const [carregandoContagemRealizadores, setCarregandoContagemRealizadores] = useState(false)
    const [adicionandoSugestaoCodigo, setAdicionandoSugestaoCodigo] = useState('')
    const [valoresEdicaoSugestoes, setValoresEdicaoSugestoes] = useState({})

    const [mostrarGerenciarModal, setMostrarGerenciarModal] = useState(false)
    const [exportandoExcelCidadeId, setExportandoExcelCidadeId] = useState(null)
    const [exportandoExcelTela, setExportandoExcelTela] = useState(false)
    const [modalPdfHonorariosAberto, setModalPdfHonorariosAberto] = useState(false)
    const [repassesResumo, setRepassesResumo] = useState([])
    const [cidadeDuplicarOrigem, setCidadeDuplicarOrigem] = useState(null)
    const [novoNomeCidadeDuplicada, setNovoNomeCidadeDuplicada] = useState('')
    const [ordenacaoGerenciador, setOrdenacaoGerenciador] = useState({ coluna: 'nome', direcao: 'asc' })
    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)
    const [mostrarAdicionarCidade, setMostrarAdicionarCidade] = useState(false)
    const [novaCidadeUf, setNovaCidadeUf] = useState('')
    const [novaCidadeMunicipio, setNovaCidadeMunicipio] = useState('')
    const [novaCidadeEnglobados, setNovaCidadeEnglobados] = useState([])
    const [cidadeEdicao, setCidadeEdicao] = useState(null)
    const [cidadeEdicaoUf, setCidadeEdicaoUf] = useState('')
    const [cidadeEdicaoMunicipio, setCidadeEdicaoMunicipio] = useState('')
    const [cidadeEdicaoEnglobados, setCidadeEdicaoEnglobados] = useState([])
    const [codigosInicializacaoCidade, setCodigosInicializacaoCidade] = useState('')
    const [adicaoMassaAtiva, setAdicaoMassaAtiva] = useState(false)
    const [categoriaEmInclusao, setCategoriaEmInclusao] = useState(null)
    const [textoNovoProcedimento, setTextoNovoProcedimento] = useState('')
    const [novoProcedimentoSelecionadoCodigo, setNovoProcedimentoSelecionadoCodigo] = useState('')
    const [popupSugestoesStyle, setPopupSugestoesStyle] = useState(null)
    const sugestoesAnchorRef = useRef(null)

    const normalizarPorteNome = (nome) =>
        String(nome || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase()

    const normalizarTextoBusca = (texto) =>
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
        if (temPonto && temVirgula) {
            return Number(texto.replace(/\./g, '').replace(',', '.'))
        }

        if (temVirgula) {
            return Number(texto.replace(',', '.'))
        }

        return Number(texto)
    }

    const mostrarErroToast = (mensagem) => {
        setErroDetalhe('')
        setTimeout(() => setErroDetalhe(mensagem), 0)
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

    const obterPorteIdPorLetra = (letra) => {
        const alvo = String(letra || '').toUpperCase()
        const porte = portes.find((item) => {
            const nome = normalizarPorteNome(item.nome)
            return nome === alvo || nome.startsWith(alvo)
        })
        return porte ? String(porte.id) : ''
    }

    const carregarResumoRepasses = useCallback(async () => {
        const { data, error } = await buscarTodosPaginado(() =>
            supabase.from('repasses').select('cidade_id, procedimento_id')
        )

        if (error) {
            mostrarErroToast(`Erro ao atualizar contagem de procedimentos: ${error.message}`)
            return
        }

        setRepassesResumo(data || [])
    }, [])

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: cidadesData, error: errCidades },
                { data: categoriasData, error: errCategorias },
                { data: portesData, error: errPortes },
                { data: procedimentosData, error: errProcedimentos },
                { data: planosData, error: errPlanos },
            ] = await Promise.all([
                supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id', { ascending: true }),
                supabase.from('portes').select('id, nome').order('id', { ascending: true }),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('codigo, nome, categoria_id, plano_base_id')
                        .order('codigo', { ascending: true })
                ),
                supabase.from('planos').select('id, nome').order('id'),
            ])

            let vinculos = []
            try {
                vinculos = await carregarVinculosMunicipios(supabase)
                setSuportaVinculosMunicipios(true)
            } catch (errV) {
                if (isMissingVinculosTableError(errV)) {
                    setSuportaVinculosMunicipios(false)
                    vinculos = []
                } else {
                    throw errV
                }
            }

            if (errCidades || errCategorias || errPortes || errProcedimentos || errPlanos) {
                const detalhes = [
                    errCidades?.message,
                    errCategorias?.message,
                    errPortes?.message,
                    errProcedimentos?.message,
                    errPlanos?.message,
                ]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao carregar dados base: ${detalhes}`)
                return
            }

            const listaCidades = cidadesData || []
            setCidades(listaCidades)
            setMunicipiosVinculos(vinculos)
            setCategorias(categoriasData || [])
            setPortes(portesData || [])
            setProcedimentos(procedimentosData || [])
            setPlanosTodos(planosData || [])

            const idsFiltro = await buscarCidadeIdsFiltroPlanoCredenciados(
                supabase,
                null,
                buscarTodosPaginado,
            )
            setCidadeIdsFiltroPlano(idsFiltro)
            const opcoes = buildOpcoesFiltroSupertabela(listaCidades, vinculos, idsFiltro)
            if (!valorFiltroCidade && opcoes.length > 0) {
                setValorFiltroCidade(opcoes[0].value)
                setCidadeId(String(opcoes[0].cidadeId))
            } else if (cidadeId && opcoes.length > 0) {
                const hit = opcoes.find((o) => String(o.cidadeId) === String(cidadeId))
                if (hit) {
                    setValorFiltroCidade(hit.value)
                } else {
                    setValorFiltroCidade(opcoes[0].value)
                    setCidadeId(String(opcoes[0].cidadeId))
                }
            }
        } catch (error) {
            setErroDetalhe(`Falha ao carregar dados base: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [cidadeId, valorFiltroCidade])

    const carregarLinhasRepassesParaCidadeId = useCallback(
        async (idAlvo) => {
            if (!idAlvo || portes.length === 0) return []

            const { data: repassesData, error: errRepasses } = await buscarTodosPaginado(() =>
                supabase
                    .from('repasses')
                    .select('id, procedimento_id, porte_id, valor')
                    .eq('cidade_id', idAlvo),
            )

            if (errRepasses) {
                throw new Error(errRepasses.message)
            }

            const repasses = repassesData || []
            if (repasses.length === 0) return []

            const codigos = [...new Set(repasses.map((item) => String(item.procedimento_id)))]
            const { data: procedimentosData, error: errProcedimentos } = await supabase
                .from('procedimentos')
                .select('codigo, nome, categoria_id, plano_base_id')
                .in('codigo', codigos)

            if (errProcedimentos) {
                throw new Error(errProcedimentos.message)
            }

            const mapaPlanosCompletoLocal = mapearPlanos(planosTodos)
            const mapaProcedimentos = new Map(
                (procedimentosData || []).map((item) => [
                    String(item.codigo),
                    {
                        nome: String(item.nome),
                        categoriaId: item.categoria_id,
                        planoBaseId: item.plano_base_id,
                        apenasLoja: procedimentoPlanoBaseApenasLoja(item.plano_base_id, mapaPlanosCompletoLocal) },
                ]),
            )

            const mapaRepasses = new Map()
            repasses.forEach((item) => {
                const codigo = String(item.procedimento_id)
                const porteId = String(item.porte_id)
                if (!mapaRepasses.has(codigo)) mapaRepasses.set(codigo, {})
                mapaRepasses.get(codigo)[porteId] = {
                    repasseId: item.id,
                    valor: Number(item.valor || 0) }
            })

            const porteIdP = obterPorteIdPorLetra('P')
            const porteIdM = obterPorteIdPorLetra('M')
            const porteIdG = obterPorteIdPorLetra('G')

            return [...mapaRepasses.entries()].map(([codigo, valoresPorPorte]) => {
                const meta = mapaProcedimentos.get(codigo) || {}
                return {
                    codigo,
                    procedimento: meta.nome || codigo,
                    categoriaId: meta.categoriaId || null,
                    planoBaseId: meta.planoBaseId || null,
                    apenasLoja: !!meta.apenasLoja,
                    porteP: porteIdP ? Number(valoresPorPorte[porteIdP]?.valor || 0) : 0,
                    porteM: porteIdM ? Number(valoresPorPorte[porteIdM]?.valor || 0) : 0,
                    porteG: porteIdG ? Number(valoresPorPorte[porteIdG]?.valor || 0) : 0,
                    repasseIdP: porteIdP ? valoresPorPorte[porteIdP]?.repasseId || null : null,
                    repasseIdM: porteIdM ? valoresPorPorte[porteIdM]?.repasseId || null : null,
                    repasseIdG: porteIdG ? valoresPorPorte[porteIdG]?.repasseId || null : null,
                    porteIdP,
                    porteIdM,
                    porteIdG }
            })
        },
        [portes, planosTodos],
    )

    const buscarTabelaCidade = useCallback(async () => {
        if (!cidadeId || portes.length === 0) {
            setLinhas([])
            return
        }

        try {
            setLoading(true)
            setErroDetalhe('')
            const linhasMontadas = await carregarLinhasRepassesParaCidadeId(cidadeId)
            setLinhas(linhasMontadas)
        } catch (error) {
            setErroDetalhe(`Falha ao carregar tabela da cidade: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [cidadeId, portes, carregarLinhasRepassesParaCidadeId])

    const linhasFiltradas = useMemo(() => {
        if (!termoBusca.trim()) return linhas
        return linhas.filter((linha) => {
            const categoriaNome = categorias.find((categoria) => Number(categoria.id) === Number(linha.categoriaId))?.nome || ''
            const blob = normalizarTextoBuscaDev(
                [linha.codigo, linha.procedimento, categoriaNome, ...partesValoresLinhaSupertabela(linha)]
                    .filter(Boolean)
                    .join(' '),
            )
            return filtrarLinhaSupertabelaPorBusca(linha, blob, termoBusca)
        })
    }, [linhas, termoBusca, categorias])

    const mapaPlanosCompleto = useMemo(() => mapearPlanos(planosTodos), [planosTodos])

    const handleOrdenarCategoria = (categoriaId, coluna) => {
        setOrdenacaoPorCategoria((anterior) => {
            const atual = anterior[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
            const proxima =
                atual.coluna === coluna
                    ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
                    : { coluna, direcao: 'asc' }
            return { ...anterior, [categoriaId]: proxima }
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
        const fator = atual.direcao === 'asc' ? 1 : -1

        resultado.sort((a, b) => {
            let valorA = a[atual.coluna]
            let valorB = b[atual.coluna]
            if (atual.coluna === 'prestadores') {
                const codA = String(a.codigo || '').trim().toUpperCase()
                const codB = String(b.codigo || '').trim().toUpperCase()
                valorA = Number(contagemRealizadoresPorCodigo.get(codA) || 0)
                valorB = Number(contagemRealizadoresPorCodigo.get(codB) || 0)
            }
            if (typeof valorA === 'number' && typeof valorB === 'number') {
                return (valorA - valorB) * fator
            }
            return String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })

        return resultado
    }

    const montarSecoesExportDeLinhas = useCallback(
        (linhasLista) =>
            categorias
                .map((categoria) => ({
                    categoriaId: categoria.id,
                    categoriaNome: categoria.nome,
                    linhas: ordenarLinhas(
                        linhasLista.filter((linha) => Number(linha.categoriaId) === Number(categoria.id)),
                        categoria.id,
                    ) }))
                .filter((secao) => secao.linhas.length > 0),
        [categorias, ordenacaoPorCategoria, contagemRealizadoresPorCodigo],
    )

    const secoesPorCategoria = useMemo(
        () => montarSecoesExportDeLinhas(linhasFiltradas),
        [linhasFiltradas, montarSecoesExportDeLinhas, contagemRealizadoresPorCodigo, ordenacaoPorCategoria],
    )

    const totalProcedimentosPorCategoria = useMemo(() => {
        const mapa = new Map()
        procedimentos.forEach((item) => {
            const categoriaId = Number(item.categoria_id)
            if (!mapa.has(categoriaId)) {
                mapa.set(categoriaId, 0)
            }
            mapa.set(categoriaId, mapa.get(categoriaId) + 1)
        })
        return mapa
    }, [procedimentos])

    const atualizarValorLocal = (codigo, campo, valor) => {
        setLinhas((anteriores) =>
            anteriores.map((linha) =>
                linha.codigo === codigo
                    ? {
                        ...linha,
                        [campo]: valor === '' ? '' : Number(valor) }
                    : linha
            )
        )
    }

    const salvarRepasse = async (linha, campo) => {
        const metaPorCampo = {
            porteP: { porteId: linha.porteIdP, repasseId: linha.repasseIdP },
            porteM: { porteId: linha.porteIdM, repasseId: linha.repasseIdM },
            porteG: { porteId: linha.porteIdG, repasseId: linha.repasseIdG } }
        const meta = metaPorCampo[campo]
        if (!meta?.porteId) return

        const valor = Number(linha[campo] || 0)
        if (Number.isNaN(valor)) {
            mostrarErroToast('Valor inválido para repasse.')
            return
        }

        if (meta.repasseId) {
            const { error } = await supabase.from('repasses').update({ valor }).eq('id', meta.repasseId)
            if (error) mostrarErroToast(`Erro ao salvar valor: ${error.message}`)
            return
        }

        const { data, error } = await supabase
            .from('repasses')
            .insert({
                cidade_id: Number(cidadeId),
                procedimento_id: linha.codigo,
                porte_id: Number(meta.porteId),
                valor })
            .select('id')
            .single()

        if (error) {
            mostrarErroToast(`Erro ao criar repasse: ${error.message}`)
            return
        }

        setLinhas((anteriores) =>
            anteriores.map((item) => {
                if (item.codigo !== linha.codigo) return item
                if (campo === 'porteP') return { ...item, repasseIdP: data.id }
                if (campo === 'porteM') return { ...item, repasseIdM: data.id }
                return { ...item, repasseIdG: data.id }
            })
        )
    }

    const processarColagemRepasse = async (event, secao, linhaIndexInicial, campoInicial) => {
        event.preventDefault()

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

                setLinhas((anteriores) =>
                    anteriores.map((item) =>
                        item.codigo === linhaTabela.codigo
                            ? { ...item, [campoDestino]: valorNumerico }
                            : item
                    )
                )

                const linhaAtualizada = {
                    ...linhaTabela,
                    [campoDestino]: valorNumerico }
                await salvarRepasse(linhaAtualizada, campoDestino)
            }
        }
    }

    const excluirProcedimento = async (linha, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error } = await supabase
                .from('repasses')
                .delete()
                .eq('cidade_id', cidadeId)
                .eq('procedimento_id', linha.codigo)

            if (error) {
                mostrarErroToast(`Erro ao excluir procedimento da cidade: ${error.message}`)
                return
            }

            setLinhas((anteriores) => anteriores.filter((item) => item.codigo !== linha.codigo))
            setRepassesResumo((anteriores) =>
                anteriores.filter(
                    (item) =>
                        !(
                            String(item.cidade_id) === String(cidadeId) &&
                            String(item.procedimento_id).toUpperCase() === String(linha.codigo).toUpperCase()
                        )
                )
            )
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(
            `Excluir o procedimento ${linha.codigo} desta cidade?`,
            executarExclusao
        )
    }

    const obterSugestoesProcedimentos = (categoriaId) => {
        const codigosDaCidade = new Set(
            linhas
                .filter((linha) => Number(linha.categoriaId) === Number(categoriaId))
                .map((linha) => String(linha.codigo).toUpperCase())
        )

        return procedimentos.filter(
            (item) =>
                Number(item.categoria_id) === Number(categoriaId) &&
                !codigosDaCidade.has(String(item.codigo).toUpperCase())
        )
    }

    const sugestoesFiltradasInclusao = useMemo(() => {
        if (!categoriaEmInclusao) return []
        const base = obterSugestoesProcedimentos(categoriaEmInclusao)
        const termo = normalizarTextoBusca(textoNovoProcedimento)
        if (!termo) return base.slice(0, 30)

        return base
            .filter((item) => {
                const codigo = normalizarTextoBusca(item.codigo)
                const nome = normalizarTextoBusca(item.nome)
                return codigo.includes(termo) || nome.includes(termo)
            })
            .slice(0, 30)
    }, [categoriaEmInclusao, textoNovoProcedimento, linhas, procedimentos])

    const atualizarPosicaoPopupSugestoes = useCallback(() => {
        const ancora = sugestoesAnchorRef.current
        if (!ancora) return
        const rect = ancora.getBoundingClientRect()
        setPopupSugestoesStyle({
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width })
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
                    width: `${popupSugestoesStyle.width}px` }}
            >
                {sugestoesFiltradasInclusao.length === 0 ? (
                    <div className='row_add_suggest_empty'>Nenhum procedimento disponível</div>
                ) : (
                    sugestoesFiltradasInclusao.map((item) => (
                        <button
                            key={`${secao.categoriaId}-${item.codigo}`}
                            type='button'
                            className={`row_add_suggest_item ${normalizarTextoBusca(novoProcedimentoSelecionadoCodigo) === normalizarTextoBusca(item.codigo) ? 'is-active' : ''
                                }`}
                            onClick={() => {
                                setTextoNovoProcedimento(`${item.nome} - ${item.codigo}`)
                                setNovoProcedimentoSelecionadoCodigo(item.codigo)
                            }}
                        >
                            <span className='supertabelacidades_nome_com_flag'>
                                {item.nome}
                                {procedimentoPlanoBaseApenasLoja(item.plano_base_id, mapaPlanosCompleto) ? (
                                    <span
                                        className='supertabelacidades_flag_loja'
                                        title={ROTULO_PLANO[CHAVE_PLANO_APENAS_LOJA]}
                                    >
                                        Loja
                                    </span>
                                ) : null}
                            </span>
                            <small>{item.codigo}</small>
                        </button>
                    ))
                )}
            </div>,
            document.body
        )
    }

    const confirmarNovoProcedimentoCategoria = async (categoriaId) => {
        const sugestoes = obterSugestoesProcedimentos(categoriaId)
        const entrada = normalizarTextoBusca(textoNovoProcedimento)
        if (!entrada) {
            mostrarErroToast('Digite ou selecione um procedimento da lista.')
            return
        }

        let encontrado = null
        if (novoProcedimentoSelecionadoCodigo) {
            encontrado = sugestoes.find(
                (item) => normalizarTextoBusca(item.codigo) === normalizarTextoBusca(novoProcedimentoSelecionadoCodigo)
            )
        }

        if (!encontrado) {
            encontrado = sugestoes.find((item) => {
                const codigo = normalizarTextoBusca(item.codigo)
                const nome = normalizarTextoBusca(item.nome)
                const opcaoCodigoNome = normalizarTextoBusca(`${item.codigo} - ${item.nome}`)
                const opcaoNomeCodigo = normalizarTextoBusca(`${item.nome} - ${item.codigo}`)
                return entrada === codigo || entrada === nome || entrada === opcaoCodigoNome || entrada === opcaoNomeCodigo
            })
        }

        if (!encontrado) {
            mostrarErroToast('Selecione um procedimento sugerido da mesma categoria.')
            return
        }

        const codigoNormalizado = String(encontrado.codigo).toUpperCase()

        const porteIds = [obterPorteIdPorLetra('P'), obterPorteIdPorLetra('M'), obterPorteIdPorLetra('G')].filter(Boolean)
        if (porteIds.length === 0) {
            mostrarErroToast('Portes P/M/G não encontrados para criação do procedimento.')
            return
        }

        const payload = porteIds.map((porteId) => ({
            cidade_id: Number(cidadeId),
            procedimento_id: codigoNormalizado,
            porte_id: Number(porteId),
            valor: 0 }))

        const { data: repassesCriados, error } = await supabase
            .from('repasses')
            .upsert(payload, { onConflict: 'procedimento_id,cidade_id,porte_id' })
            .select('id, porte_id, valor')
        if (error) {
            mostrarErroToast(`Erro ao adicionar procedimento na categoria: ${error.message}`)
            return
        }

        const mapaPorPorte = new Map((repassesCriados || []).map((item) => [String(item.porte_id), item]))
        const porteIdP = obterPorteIdPorLetra('P')
        const porteIdM = obterPorteIdPorLetra('M')
        const porteIdG = obterPorteIdPorLetra('G')

        setLinhas((anteriores) => {
            const idx = anteriores.findIndex((item) => String(item.codigo).toUpperCase() === codigoNormalizado)
            if (idx >= 0) {
                const atual = anteriores[idx]
                const atualizado = {
                    ...atual,
                    porteP: porteIdP ? Number(mapaPorPorte.get(String(porteIdP))?.valor ?? atual.porteP ?? 0) : atual.porteP,
                    porteM: porteIdM ? Number(mapaPorPorte.get(String(porteIdM))?.valor ?? atual.porteM ?? 0) : atual.porteM,
                    porteG: porteIdG ? Number(mapaPorPorte.get(String(porteIdG))?.valor ?? atual.porteG ?? 0) : atual.porteG,
                    repasseIdP: porteIdP ? mapaPorPorte.get(String(porteIdP))?.id ?? atual.repasseIdP : atual.repasseIdP,
                    repasseIdM: porteIdM ? mapaPorPorte.get(String(porteIdM))?.id ?? atual.repasseIdM : atual.repasseIdM,
                    repasseIdG: porteIdG ? mapaPorPorte.get(String(porteIdG))?.id ?? atual.repasseIdG : atual.repasseIdG }
                const copia = [...anteriores]
                copia[idx] = atualizado
                return copia
            }

            return [
                ...anteriores,
                {
                    codigo: codigoNormalizado,
                    procedimento: String(encontrado.nome || codigoNormalizado),
                    categoriaId: encontrado.categoria_id,
                    planoBaseId: encontrado.plano_base_id != null ? Number(encontrado.plano_base_id) : null,
                    apenasLoja: procedimentoPlanoBaseApenasLoja(encontrado.plano_base_id, mapaPlanosCompleto),
                    porteP: porteIdP ? Number(mapaPorPorte.get(String(porteIdP))?.valor || 0) : 0,
                    porteM: porteIdM ? Number(mapaPorPorte.get(String(porteIdM))?.valor || 0) : 0,
                    porteG: porteIdG ? Number(mapaPorPorte.get(String(porteIdG))?.valor || 0) : 0,
                    repasseIdP: porteIdP ? mapaPorPorte.get(String(porteIdP))?.id || null : null,
                    repasseIdM: porteIdM ? mapaPorPorte.get(String(porteIdM))?.id || null : null,
                    repasseIdG: porteIdG ? mapaPorPorte.get(String(porteIdG))?.id || null : null,
                    porteIdP,
                    porteIdM,
                    porteIdG },
            ]
        })

        setCategoriaEmInclusao(null)
        setTextoNovoProcedimento('')
        setNovoProcedimentoSelecionadoCodigo('')
    }

    const mapaMunicipiosPorCidade = useMemo(() => municipiosPorCidadeId(municipiosVinculos), [municipiosVinculos])

    const opcoesFiltroCidade = useMemo(
        () => buildOpcoesFiltroSupertabela(cidades, municipiosVinculos, cidadeIdsFiltroPlano),
        [cidades, municipiosVinculos, cidadeIdsFiltroPlano],
    )

    const baixarExcelCidadeGerenciador = async (cidade) => {
        if (!cidade?.id) return
        if (portes.length === 0) {
            mostrarErroToast('Aguarde o carregamento dos portes (P/M/G) e tente novamente.')
            return
        }
        setExportandoExcelCidadeId(cidade.id)
        try {
            const linhasLista = await carregarLinhasRepassesParaCidadeId(cidade.id)
            const secoes = montarSecoesExportDeLinhas(linhasLista)
            if (!secoes.length) {
                mostrarErroToast('Esta tabela não tem procedimentos para exportar.')
                return
            }
            await exportarTabelaCidadeParaExcel(secoes, {
                nomeArquivoBase: `cidade-${cidade.nome || cidade.id}` })
        } catch (error) {
            mostrarErroToast(`Erro ao exportar Excel: ${error.message}`)
        } finally {
            setExportandoExcelCidadeId(null)
        }
    }

    const cidadeSelecionada = useMemo(
        () => cidades.find((c) => String(c.id) === String(cidadeId)) || null,
        [cidades, cidadeId],
    )

    const vinculosDaCidadeSelecionada = useMemo(() => {
        const cid = Number(cidadeId)
        if (!cid) return []
        return (municipiosVinculos || []).filter((v) => Number(v.cidade_id) === cid)
    }, [municipiosVinculos, cidadeId])

    const codigosNaTabelaCidade = useMemo(
        () => [...new Set(linhas.map((l) => String(l.codigo || '').trim().toUpperCase()).filter(Boolean))],
        [linhas],
    )

    useEffect(() => {
        if (!mostrarContagemRealizadores || !cidadeId || !cidadeSelecionada) {
            setContagemRealizadoresPorCodigo(new Map())
            setNomesRealizadoresPorCodigo(new Map())
            setSugestoesRealizadores([])
            setCarregandoContagemRealizadores(false)
            return undefined
        }

        let cancelado = false
        const run = async () => {
            setCarregandoContagemRealizadores(true)
            try {
                const cidadesAlvo = montarCidadesAlvoContagemPrestadores(
                    cidadeSelecionada,
                    vinculosDaCidadeSelecionada,
                )
                const { contagemPorCodigo, nomesPorCodigo, sugestoes } =
                    await carregarContagemESugestoesRealizadoresPlanos(supabase, {
                        cidadesAlvo,
                        incluirCidadesParalelas: true,
                        codigosNaTabela: codigosNaTabelaCidade })
                if (cancelado) return
                setContagemRealizadoresPorCodigo(contagemPorCodigo)
                setNomesRealizadoresPorCodigo(nomesPorCodigo)
                setSugestoesRealizadores(sugestoes)
            } catch (error) {
                if (cancelado) return
                setContagemRealizadoresPorCodigo(new Map())
                setNomesRealizadoresPorCodigo(new Map())
                setSugestoesRealizadores([])
                setErroDetalhe(`Falha ao contar realizadores: ${error?.message || 'erro desconhecido'}`)
            } finally {
                if (!cancelado) setCarregandoContagemRealizadores(false)
            }
        }
        void run()
        return () => {
            cancelado = true
        }
    }, [
        mostrarContagemRealizadores,
        cidadeId,
        cidadeSelecionada,
        vinculosDaCidadeSelecionada,
        codigosNaTabelaCidade,
    ])

    const qtdPrestadoresCodigo = (codigo) => {
        const cod = String(codigo || '').trim().toUpperCase()
        return Number(contagemRealizadoresPorCodigo.get(cod) || 0)
    }

    const nomesPrestadoresCodigo = (codigo) => {
        const cod = String(codigo || '').trim().toUpperCase()
        return nomesRealizadoresPorCodigo.get(cod) || []
    }

    const renderCelulaPrestadores = (codigo, qtdOverride = null, nomesOverride = null) => {
        const qtd = qtdOverride != null ? Number(qtdOverride) : qtdPrestadoresCodigo(codigo)
        const nomes = nomesOverride || nomesPrestadoresCodigo(codigo)
        if (carregandoContagemRealizadores && qtdOverride == null) {
            return (
                <td className='supertabelacidades_td_centro supertabelacidades_td_prestadores'>…</td>
            )
        }
        if (!qtd) {
            return <td className='supertabelacidades_td_centro supertabelacidades_td_prestadores'>0</td>
        }
        return (
            <td className='supertabelacidades_td_centro supertabelacidades_td_prestadores'>
                <span title={(nomes || []).join(', ')}>{qtd}</span>
            </td>
        )
    }

    const adicionarSugestaoNaTabela = async (item) => {
        const codigoNormalizado = String(item?.codigo || '').trim().toUpperCase()
        if (!codigoNormalizado || somenteLeitura || !cidadeId) return

        const paresPorte = [
            { letra: 'P', campo: 'porteP' },
            { letra: 'M', campo: 'porteM' },
            { letra: 'G', campo: 'porteG' },
        ]
        const drafts = valoresEdicaoSugestoes[codigoNormalizado] || {}
        const payload = []
        for (const { letra, campo } of paresPorte) {
            const porteId = obterPorteIdPorLetra(letra)
            if (!porteId) continue
            const bruto = drafts[campo]
            let valor = 0
            if (bruto != null && String(bruto).trim() !== '') {
                valor = normalizarNumeroEntrada(bruto)
                if (Number.isNaN(valor)) {
                    mostrarErroToast(`Valor inválido em Porte ${letra} para ${codigoNormalizado}.`)
                    return
                }
            }
            payload.push({
                cidade_id: Number(cidadeId),
                procedimento_id: codigoNormalizado,
                porte_id: Number(porteId),
                valor })
        }
        if (payload.length === 0) {
            mostrarErroToast('Portes P/M/G não encontrados para criação do procedimento.')
            return
        }

        setAdicionandoSugestaoCodigo(codigoNormalizado)
        try {
            const { error } = await supabase
                .from('repasses')
                .upsert(payload, { onConflict: 'procedimento_id,cidade_id,porte_id' })
            if (error) {
                mostrarErroToast(`Erro ao adicionar procedimento: ${error.message}`)
                return
            }
            setValoresEdicaoSugestoes((anterior) => {
                const proximo = { ...anterior }
                delete proximo[codigoNormalizado]
                return proximo
            })
            await buscarTabelaCidade()
        } finally {
            setAdicionandoSugestaoCodigo('')
        }
    }

    const atualizarValorEdicaoSugestao = (codigo, campo, valor) => {
        const codigoNormalizado = String(codigo || '').trim().toUpperCase()
        if (!codigoNormalizado) return
        setValoresEdicaoSugestoes((anterior) => ({
            ...anterior,
            [codigoNormalizado]: {
                ...(anterior[codigoNormalizado] || {}),
                [campo]: valor } }))
    }

    const baixarExcelTelaCidades = async () => {
        if (!cidadeId) {
            mostrarErroToast('Selecione uma cidade para exportar.')
            return
        }
        if (!secoesPorCategoria.length) {
            mostrarErroToast('Não há procedimentos na tela para exportar (verifique filtros e busca).')
            return
        }
        setExportandoExcelTela(true)
        try {
            await exportarTabelaCidadeParaExcel(secoesPorCategoria, {
                nomeArquivoBase: `cidade-${cidadeSelecionada?.nome || cidadeId}` })
        } catch (error) {
            mostrarErroToast(`Erro ao exportar Excel: ${error.message}`)
        } finally {
            setExportandoExcelTela(false)
        }
    }

    const abrirModalPdfHonorarios = () => {
        if (!cidadeId) {
            mostrarErroToast('Selecione uma cidade para exportar.')
            return
        }
        if (!secoesPorCategoria.length) {
            mostrarErroToast('Não há procedimentos na tela para exportar (verifique filtros e busca).')
            return
        }
        setModalPdfHonorariosAberto(true)
    }

    const cidadesGerenciaveis = useMemo(() => {
        const mapaProcedimentosAtivos = new Map()

        repassesResumo.forEach((item) => {
            const cidade = Number(item.cidade_id)
            if (!cidade) return
            const procedimento = String(item.procedimento_id || '').trim().toUpperCase()
            if (!procedimento) return
            if (!mapaProcedimentosAtivos.has(cidade)) {
                mapaProcedimentosAtivos.set(cidade, new Set())
            }
            mapaProcedimentosAtivos.get(cidade).add(procedimento)
        })

        return cidades
            .map((cidade) => ({
                ...mapCidadeParaGerenciador(cidade),
                procedimentosAtivos: mapaProcedimentosAtivos.get(Number(cidade.id))?.size || 0 }))
            .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
    }, [cidades, repassesResumo])

    const cidadesGerenciaveisOrdenadas = useMemo(() => {
        const lista = [...cidadesGerenciaveis]
        const { coluna, direcao } = ordenacaoGerenciador
        const fator = direcao === 'asc' ? 1 : -1

        lista.sort((a, b) => {
            const valorA = a[coluna]
            const valorB = b[coluna]
            if (typeof valorA === 'number' && typeof valorB === 'number') {
                return (valorA - valorB) * fator
            }
            return String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })

        return lista
    }, [cidadesGerenciaveis, ordenacaoGerenciador])

    const ordenarGerenciador = (coluna) => {
        setOrdenacaoGerenciador((anterior) =>
            anterior.coluna === coluna
                ? { coluna, direcao: anterior.direcao === 'asc' ? 'desc' : 'asc' }
                : { coluna, direcao: 'asc' }
        )
    }

    const indicadorOrdenacaoGerenciador = (coluna) => {
        if (ordenacaoGerenciador.coluna !== coluna) return ''
        return ordenacaoGerenciador.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    const acessarCidadeNoGerenciador = (id) => {
        setCidadeId(String(id))
        setValorFiltroCidade(`c-${id}`)
        setMostrarGerenciarModal(false)
        setCidadeDuplicarOrigem(null)
        setNovoNomeCidadeDuplicada('')
        setMostrarAdicionarCidade(false)
        setCidadeEdicao(null)
    }

    const excluirCidadeNoGerenciador = async (cidade, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error: errRepasses } = await supabase.from('repasses').delete().eq('cidade_id', cidade.id)
            if (errRepasses) {
                mostrarErroToast(`Erro ao excluir tabela da cidade: ${errRepasses.message}`)
                return
            }

            const { error: errVets } = await supabase.from('veterinarios').delete().eq('cidade_id', cidade.id)
            if (errVets) {
                mostrarErroToast(`Erro ao remover vínculos da cidade: ${errVets.message}`)
                return
            }

            const { error: errCidade } = await supabase.from('cidades').delete().eq('id', cidade.id)
            if (errCidade) {
                mostrarErroToast(`Erro ao excluir cidade: ${errCidade.message}`)
                return
            }

            await carregarBase()
            if (String(cidadeId) === String(cidade.id)) {
                const proxima = cidadesGerenciaveis.find((item) => String(item.id) !== String(cidade.id))
                setCidadeId(proxima ? String(proxima.id) : '')
                setLinhas([])
            }
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(
            `Excluir a cidade "${cidade.nome}" e toda a tabela vinculada?`,
            executarExclusao
        )
    }

    const iniciarDuplicacaoCidade = (cidade) => {
        setMostrarAdicionarCidade(false)
        setCidadeEdicao(null)
        setCidadeDuplicarOrigem(cidade)
        setNovoNomeCidadeDuplicada(`${cidade.nome} - Cópia`)
    }

    const selecionarCidadeGerenciador = (cidade) => {
        setCidadeDuplicarOrigem(null)
        setMostrarAdicionarCidade(false)
        iniciarEdicaoCidade(cidade)
    }

    const abrirAdicionarCidade = () => {
        setCidadeDuplicarOrigem(null)
        setCidadeEdicao(null)
        setNovaCidadeUf('')
        setNovaCidadeMunicipio('')
        setNovaCidadeEnglobados([])
        setMostrarAdicionarCidade(true)
    }

    const fecharGerenciarModal = () => {
        setMostrarGerenciarModal(false)
        setCidadeDuplicarOrigem(null)
        setNovoNomeCidadeDuplicada('')
        setMostrarAdicionarCidade(false)
        setCidadeEdicao(null)
    }

    const renderPainelGerenciarDireito = () => {
        if (mostrarAdicionarCidade) {
            return (
                <div className='manager_edit_panel'>
                    <h4 className='manager_edit_panel_title'>Nova tabela</h4>
                    <CidadeTabelaIbgeForm
                        uf={novaCidadeUf}
                        onUfChange={(v) => {
                            setNovaCidadeUf(v)
                            setNovaCidadeMunicipio('')
                            setNovaCidadeEnglobados([])
                        }}
                        municipioPrincipal={novaCidadeMunicipio}
                        onMunicipioPrincipalChange={setNovaCidadeMunicipio}
                        municipiosEnglobados={novaCidadeEnglobados}
                        onMunicipiosEnglobadosChange={setNovaCidadeEnglobados}
                        municipiosForaMalha={listarMunicipiosForaDaMalhaPorUf({
                            uf: novaCidadeUf,
                            cidades,
                            vinculos: municipiosVinculos,
                            municipiosCredenciados,
                        })}
                        disabled={!suportaVinculosMunicipios}
                    />
                    {!suportaVinculosMunicipios && (
                        <small>Execute `cidades_municipios_vinculo.sql` no Supabase.</small>
                    )}
                    <div className='manager_add_bar_actions'>
                        <button type='button' className='manager_action_btn save' onClick={salvarNovaCidade}>
                            Salvar
                        </button>
                        <button
                            type='button'
                            className='manager_action_btn'
                            onClick={() => {
                                setMostrarAdicionarCidade(false)
                                setNovaCidadeUf('')
                                setNovaCidadeMunicipio('')
                                setNovaCidadeEnglobados([])
                            }}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )
        }
        if (cidadeDuplicarOrigem) {
            return (
                <div className='manager_edit_panel'>
                    <h4 className='manager_edit_panel_title'>
                        Duplicar tabela <strong>{cidadeDuplicarOrigem.nome}</strong>
                    </h4>
                    <label className='manager_duplicate_field'>
                        <span>Nome da nova tabela</span>
                        <input
                            type='text'
                            value={novoNomeCidadeDuplicada}
                            onChange={(event) => setNovoNomeCidadeDuplicada(event.target.value)}
                            placeholder='Nome da nova tabela'
                        />
                    </label>
                    <div className='manager_add_bar_actions'>
                        <button type='button' className='manager_action_btn save' onClick={duplicarCidadeSelecionada}>
                            Confirmar
                        </button>
                        <button
                            type='button'
                            className='manager_action_btn'
                            onClick={() => {
                                setCidadeDuplicarOrigem(null)
                                setNovoNomeCidadeDuplicada('')
                            }}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )
        }
        if (cidadeEdicao) {
            return (
                <div className='manager_edit_panel'>
                    <h4 className='manager_edit_panel_title'>
                        Editar tabela <strong>{cidadeEdicao.nome}</strong>
                    </h4>
                    <CidadeTabelaIbgeForm
                        uf={cidadeEdicaoUf}
                        onUfChange={(v) => {
                            setCidadeEdicaoUf(v)
                            setCidadeEdicaoMunicipio('')
                            setCidadeEdicaoEnglobados([])
                        }}
                        municipioPrincipal={cidadeEdicaoMunicipio}
                        onMunicipioPrincipalChange={setCidadeEdicaoMunicipio}
                        municipiosEnglobados={cidadeEdicaoEnglobados}
                        onMunicipiosEnglobadosChange={setCidadeEdicaoEnglobados}
                        municipiosForaMalha={listarMunicipiosForaDaMalhaPorUf({
                            uf: cidadeEdicaoUf,
                            cidades,
                            vinculos: municipiosVinculos,
                            municipiosCredenciados,
                        })}
                        disabled={!suportaVinculosMunicipios}
                    />
                    <div className='manager_add_bar_actions'>
                        <button type='button' className='manager_action_btn save' onClick={salvarEdicaoCidade}>
                            Salvar
                        </button>
                        <button
                            type='button'
                            className='manager_action_btn'
                            onClick={() => {
                                setCidadeEdicao(null)
                                setCidadeEdicaoUf('')
                                setCidadeEdicaoMunicipio('')
                                setCidadeEdicaoEnglobados([])
                            }}
                        >
                            Fechar edição
                        </button>
                    </div>
                </div>
            )
        }
        return null
    }

    const edicaoGerenciarAberta =
        mostrarAdicionarCidade || Boolean(cidadeEdicao) || Boolean(cidadeDuplicarOrigem)

    const salvarNovaCidade = async () => {
        const nome = String(novaCidadeMunicipio || '').trim()
        if (!nome || !novaCidadeUf) {
            mostrarErroToast('Selecione UF e o município principal da tabela.')
            return
        }

        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('cidades')
                .insert(payloadCidadeComUf({ nome, uf: novaCidadeUf }))
                .select('id')
                .single()

            if (error) {
                mostrarErroToast(`Erro ao adicionar cidade: ${error.message}`)
                return
            }

            if (suportaVinculosMunicipios) {
                try {
                    await salvarVinculosDaCidade(
                        supabase,
                        data.id,
                        novaCidadeUf,
                        nome,
                        novaCidadeEnglobados,
                    )
                } catch (errV) {
                    mostrarErroToast(`Cidade criada, mas falha nos vínculos: ${errV.message}`)
                }
            }

            await carregarBase()
            setCidadeId(String(data.id))
            setCodigosInicializacaoCidade('')
            setMostrarAdicionarCidade(false)
            setNovaCidadeUf('')
            setNovaCidadeMunicipio('')
            setNovaCidadeEnglobados([])
        } catch (error) {
            mostrarErroToast(`Falha ao adicionar cidade: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const iniciarEdicaoCidade = (cidade) => {
        setCidadeDuplicarOrigem(null)
        setMostrarAdicionarCidade(false)
        setCidadeEdicao(cidade)
        const vincs = mapaMunicipiosPorCidade.get(Number(cidade.id)) || []
        const uf = cidade.uf || vincs[0]?.uf || ''
        const principal =
            vincs.find((v) => normalizarMunicipioChave(v.municipio_nome) === normalizarMunicipioChave(cidade.nome))
                ?.municipio_nome ||
            vincs[0]?.municipio_nome ||
            cidade.nome
        const chavePrincipal = normalizarMunicipioChave(principal)
        const englobados = vincs
            .map((v) => v.municipio_nome)
            .filter((n) => normalizarMunicipioChave(n) !== chavePrincipal)
        setCidadeEdicaoUf(uf)
        setCidadeEdicaoMunicipio(principal)
        setCidadeEdicaoEnglobados(englobados)
    }

    const salvarEdicaoCidade = async () => {
        if (!cidadeEdicao) return
        const nome = String(cidadeEdicaoMunicipio || '').trim()
        if (!nome || !cidadeEdicaoUf) {
            mostrarErroToast('Selecione UF e o município principal da tabela.')
            return
        }

        setLoading(true)
        try {
            const { error } = await supabase
                .from('cidades')
                .update(payloadCidadeComUf({ nome, uf: cidadeEdicaoUf }))
                .eq('id', cidadeEdicao.id)

            if (error) {
                mostrarErroToast(`Erro ao editar cidade: ${error.message}`)
                return
            }

            if (suportaVinculosMunicipios) {
                try {
                    await salvarVinculosDaCidade(
                        supabase,
                        cidadeEdicao.id,
                        cidadeEdicaoUf,
                        nome,
                        cidadeEdicaoEnglobados,
                    )
                } catch (errV) {
                    mostrarErroToast(`Dados salvos, mas falha nos vínculos: ${errV.message}`)
                }
            }

            await carregarBase()
            setCidadeEdicao(null)
            setCidadeEdicaoUf('')
            setCidadeEdicaoMunicipio('')
            setCidadeEdicaoEnglobados([])
        } catch (error) {
            mostrarErroToast(`Falha ao editar cidade: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const preencherProcedimentosCidadeAtual = async () => {
        if (!cidadeId) {
            mostrarErroToast('Selecione uma cidade para preencher os procedimentos.')
            return
        }

        const codigos = extrairCodigosProcedimentoEmMassa(codigosInicializacaoCidade)

        if (codigos.length === 0) {
            mostrarErroToast('Informe ao menos um código (um por linha ou separados por vírgula).')
            return
        }

        const porteIds = [obterPorteIdPorLetra('P'), obterPorteIdPorLetra('M'), obterPorteIdPorLetra('G')].filter(Boolean)
        if (porteIds.length === 0) {
            mostrarErroToast('Portes P/M/G não encontrados.')
            return
        }

        setLoading(true)
        try {
            const { data: procedimentosValidos, error: errProcedimentos } = await supabase
                .from('procedimentos')
                .select('codigo')
                .in('codigo', codigos)

            if (errProcedimentos) {
                mostrarErroToast(`Erro ao validar procedimentos: ${errProcedimentos.message}`)
                return
            }

            const codigosValidos = (procedimentosValidos || []).map((item) => String(item.codigo).toUpperCase())
            const codigosNaoEncontrados = codigos.filter(
                (cod) => !codigosValidos.includes(String(cod).toUpperCase())
            )
            if (codigosValidos.length === 0) {
                mostrarErroToast('Nenhum código informado foi encontrado na base.')
                return
            }

            const { data: existentes, error: errExistentes } = await buscarTodosPaginado(() =>
                supabase
                    .from('repasses')
                    .select('procedimento_id')
                    .eq('cidade_id', Number(cidadeId))
                    .in('procedimento_id', codigosValidos)
            )

            if (errExistentes) {
                mostrarErroToast(`Erro ao verificar procedimentos existentes: ${errExistentes.message}`)
                return
            }

            const codigosExistentes = new Set(
                (existentes || []).map((item) => String(item.procedimento_id).toUpperCase())
            )
            const codigosNovos = codigosValidos.filter((cod) => !codigosExistentes.has(cod))
            const totalIgnorados = codigosValidos.length - codigosNovos.length

            let totalInseridos = 0
            let mensagemErro = ''
            if (codigosNovos.length > 0) {
                const payload = codigosNovos.flatMap((codigo) =>
                    porteIds.map((porteId) => ({
                        cidade_id: Number(cidadeId),
                        procedimento_id: codigo,
                        porte_id: Number(porteId),
                        valor: 0 }))
                )

                const { error: errInsert } = await supabase.from('repasses').upsert(payload, {
                    onConflict: 'procedimento_id,cidade_id,porte_id',
                    ignoreDuplicates: true })
                if (errInsert) {
                    mensagemErro = errInsert.message
                } else {
                    totalInseridos = codigosNovos.length
                }
            }

            setCodigosInicializacaoCidade('')
            await Promise.all([carregarBase(), buscarTabelaCidade(), carregarResumoRepasses()])

            const partes = []
            if (totalInseridos > 0) partes.push(`${totalInseridos} adicionado(s)`)
            if (totalIgnorados > 0) partes.push(`${totalIgnorados} já existente(s) ignorado(s)`)
            if (codigosNaoEncontrados.length > 0) partes.push(`${codigosNaoEncontrados.length} código(s) não encontrado(s): ${codigosNaoEncontrados.join(', ')}`)
            if (mensagemErro) partes.push(`falha ao inserir: ${mensagemErro}`)
            if (partes.length > 0) mostrarErroToast(`Adição em massa concluída — ${partes.join(' · ')}.`)
        } catch (error) {
            mostrarErroToast(`Falha ao inserir procedimentos em massa: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const duplicarCidadeSelecionada = async () => {
        if (!cidadeDuplicarOrigem) return
        const nomeCidade = novoNomeCidadeDuplicada.trim()
        if (!nomeCidade) {
            mostrarErroToast('Informe o nome da nova cidade para duplicação.')
            return
        }

        setLoading(true)
        try {
            const { data: cidadeNova, error: errCidadeNova } = await supabase
                .from('cidades')
                .insert(
                    payloadCidadeComUf({
                        nome: nomeCidade,
                        uf: cidadeDuplicarOrigem.uf }),
                )
                .select('id')
                .single()

            if (errCidadeNova) {
                const msg = String(errCidadeNova.message || '')
                if (msg.toLowerCase().includes('row-level security')) {
                    mostrarErroToast('Sem permissão para criar cidades (RLS). Peça liberação da policy INSERT em cidades.')
                } else {
                    mostrarErroToast(`Erro ao duplicar cidade: ${errCidadeNova.message}`)
                }
                return
            }

            const { data: repassesOrigem, error: errRepassesOrigem } = await buscarTodosPaginado(() =>
                supabase
                    .from('repasses')
                    .select('procedimento_id, porte_id, valor')
                    .eq('cidade_id', cidadeDuplicarOrigem.id)
            )

            if (errRepassesOrigem) {
                mostrarErroToast(`Cidade criada, mas houve erro ao copiar tabela: ${errRepassesOrigem.message}`)
                return
            }

            const payload = (repassesOrigem || []).map((item) => ({
                cidade_id: cidadeNova.id,
                procedimento_id: item.procedimento_id,
                porte_id: item.porte_id,
                valor: item.valor }))

            if (payload.length > 0) {
                const { error: errInsert } = await supabase
                    .from('repasses')
                    .upsert(payload, { onConflict: 'procedimento_id,cidade_id,porte_id' })
                if (errInsert) {
                    mostrarErroToast(`Cidade criada, mas houve erro ao copiar repasses: ${errInsert.message}`)
                    return
                }
            }

            await carregarBase()
            setCidadeId(String(cidadeNova.id))
            setCidadeDuplicarOrigem(null)
            setNovoNomeCidadeDuplicada('')
            setMostrarGerenciarModal(false)
        } catch (error) {
            mostrarErroToast(`Falha ao duplicar tabela: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        carregarBase()
    }, [carregarBase])

    useEffect(() => {
        carregarResumoRepasses()
    }, [carregarResumoRepasses])

    useEffect(() => {
        if (!mostrarGerenciarModal) return
        carregarResumoRepasses()
        let cancelado = false
        ;(async () => {
            try {
                const [
                    { data: prestadoresData, error: errP },
                    { data: pcData, error: errPc },
                    { data: credData, error: errCred },
                ] = await Promise.all([
                    buscarTodosPaginado(() =>
                        supabase
                            .from('prestadores')
                            .select('id, endereco_cidade, endereco_uf, ativo')
                            .eq('ativo', true),
                    ),
                    buscarTodosPaginado(() =>
                        supabase.from('prestador_cidades').select('prestador_id, cidade_id'),
                    ),
                    buscarTodosPaginado(() =>
                        supabase.from('cidades_credenciamento').select('id, nome'),
                    ),
                ])
                const erro = errP || errPc || errCred
                if (erro) throw erro
                if (!cancelado) {
                    setMunicipiosCredenciados(
                        extrairMunicipiosCredenciadosDePrestadores(prestadoresData || [], {
                            prestadorCidades: pcData || [],
                            cidadesCredenciamento: credData || [],
                        }),
                    )
                }
            } catch {
                if (!cancelado) setMunicipiosCredenciados([])
            }
        })()
        return () => {
            cancelado = true
        }
    }, [mostrarGerenciarModal, carregarResumoRepasses])

    useEffect(() => {
        buscarTabelaCidade()
    }, [buscarTabelaCidade])

    useEffect(() => {
        if (!erroDetalhe) return
        const timer = setTimeout(() => setErroDetalhe(''), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(timer)
    }, [erroDetalhe])

    useEffect(() => {
        const onScroll = () => {
            setHeaderCompacto(window.scrollY > 40)
        }
        onScroll()
        window.addEventListener('scroll', onScroll)
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    return (
        <div className='el-page supertabelacidades'>
            <PageHeader
                kicker="SuperTabela"
                title="Cidades"
                description="Valores de procedimentos por município e porte."
            />
            <header className={`supertabelacidades_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='supertabelacidades_filters'>
                    <div className='supertabelacidades_filter_item supertabelacidades_filter_busca'>
                        <p>Busca</p>
                        <CampoBuscaComLimpar
                            className='supertabelacidades_input'
                            inputClassName='supertabelacidades_input'
                            placeholder='Código, procedimento, categoria ou valor'
                            value={termoBusca}
                            onChange={(event) => setTermoBusca(event.target.value)}
                        />
                    </div>

                    <div className='supertabelacidades_filter_item'>
                        <p>Cidade</p>
                        <select
                            className='supertabelacidades_select'
                            value={valorFiltroCidade}
                            onChange={(event) => {
                                const valor = event.target.value
                                setValorFiltroCidade(valor)
                                const op = opcoesFiltroCidade.find((o) => o.value === valor)
                                if (op) setCidadeId(String(op.cidadeId))
                            }}
                        >
                            {opcoesFiltroCidade.map((op) => (
                                <option key={op.value} value={op.value}>
                                    {op.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {!somenteLeitura && (
                        <button
                            type='button'
                            className='supertabelacidades_action_btn'
                            onClick={() => {
                                setMostrarGerenciarModal(true)
                                setCidadeDuplicarOrigem(null)
                                setNovoNomeCidadeDuplicada('')
                            }}
                        >
                            <span className='ico'>⚙️</span> Gerenciar tabelas
                        </button>
                    )}

                    {!somenteLeitura && (
                        <label className='supertabelacidades_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={edicaoAtiva}
                                onChange={(event) => setEdicaoAtiva(event.target.checked)}
                            />
                            <span>Ativar edição</span>
                        </label>
                    )}

                    {!somenteLeitura && (
                        <label className='supertabelacidades_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={adicaoMassaAtiva}
                                onChange={(event) => setAdicaoMassaAtiva(event.target.checked)}
                            />
                            <span>Adição em massa</span>
                        </label>
                    )}

                    <button
                        type='button'
                        className='supertabelacidades_action_btn'
                        disabled={!cidadeId || loading || exportandoExcelTela}
                        onClick={() => void baixarExcelTelaCidades()}
                    >
                        <span className='ico'>📊</span>{' '}
                        {exportandoExcelTela ? 'Gerando Excel…' : 'Exportar Excel'}
                    </button>

                    <button
                        type='button'
                        className='supertabelacidades_action_btn'
                        disabled={!cidadeId || loading || exportandoExcelTela}
                        onClick={abrirModalPdfHonorarios}
                    >
                        <span className='ico'>📄</span> Exportar PDF
                    </button>
                </div>

                {adicaoMassaAtiva && (
                    <div className='cidade_vazia_wrap'>
                        <p>Adicionar procedimentos em massa na cidade selecionada</p>
                        <div className='cidade_vazia_form'>
                            <label htmlFor='codigos-adicao-massa'>
                                IDs de procedimentos (um por linha ou separados por vírgula)
                            </label>
                            <textarea
                                id='codigos-adicao-massa'
                                rows={3}
                                value={codigosInicializacaoCidade}
                                onChange={(event) => setCodigosInicializacaoCidade(event.target.value)}
                                placeholder={`Ex.: CONS-00N, EXAM-103
ou um código por linha`}
                            />
                            <button
                                type='button'
                                className='cidade_vazia_btn'
                                onClick={preencherProcedimentosCidadeAtual}
                            >
                                Inserir procedimentos em massa
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {erroDetalhe && (
                <div className='supertabelacidades_alert' role='alert' aria-live='assertive'>
                    <div className='supertabelacidades_alert_text'>
                        <strong>Aviso</strong>
                        <span>{erroDetalhe}</span>
                    </div>
                    <button
                        type='button'
                        className='supertabelacidades_alert_close'
                        onClick={() => setErroDetalhe('')}
                        aria-label='Fechar aviso'
                    >
                        x
                    </button>
                </div>
            )}

            {confirmacaoExclusao && (
                <div className='supertabelacidades_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div className='supertabelacidades_confirm_text'>
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className='supertabelacidades_confirm_actions'>
                        <button
                            type='button'
                            className='supertabelacidades_confirm_btn danger'
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
                            className='supertabelacidades_confirm_btn'
                            onClick={() => setConfirmacaoExclusao(null)}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {mostrarGerenciarModal && (
                <GerenciarTabelasModal
                    onClose={fecharGerenciarModal}
                    somenteLeitura={somenteLeitura}
                    onNovaCidade={abrirAdicionarCidade}
                    cidadesOrdenadas={cidadesGerenciaveisOrdenadas}
                    ordenarGerenciador={ordenarGerenciador}
                    indicadorOrdenacaoGerenciador={indicadorOrdenacaoGerenciador}
                    idCidadeEmEdicao={cidadeEdicao?.id}
                    emModoNova={mostrarAdicionarCidade}
                    onSelecionarCidade={selecionarCidadeGerenciador}
                    onAcessarCidade={acessarCidadeNoGerenciador}
                    onEditarCidade={selecionarCidadeGerenciador}
                    onDuplicarCidade={iniciarDuplicacaoCidade}
                    onExcluirCidade={excluirCidadeNoGerenciador}
                    onBaixarExcelCidade={(cidade) => void baixarExcelCidadeGerenciador(cidade)}
                    exportandoExcelCidadeId={exportandoExcelCidadeId}
                    colunaProcedimentos
                    edicaoAberta={edicaoGerenciarAberta}
                    painelDireito={renderPainelGerenciarDireito()}
                />
            )}

            <div className='supertabelacidades_table_container overflow-x-auto'>
                {loading ? (
                    <p>Carregando...</p>
                ) : secoesPorCategoria.length === 0 ? (
                    <div className='cidade_vazia_wrap'>
                        <p>Nenhum procedimento encontrado para a cidade selecionada.</p>
                        <div className='cidade_vazia_form'>
                            <label htmlFor='codigos-cidade-vazia'>
                                IDs de procedimentos (um por linha ou separados por vírgula)
                            </label>
                            <textarea
                                id='codigos-cidade-vazia'
                                rows={3}
                                value={codigosInicializacaoCidade}
                                onChange={(event) => setCodigosInicializacaoCidade(event.target.value)}
                                placeholder={`Ex.: CONS-00N, EXAM-103
ou um código por linha`}
                            />
                            <button
                                type='button'
                                className='cidade_vazia_btn'
                                onClick={preencherProcedimentosCidadeAtual}
                            >
                                Criar lista de procedimentos para a cidade
                            </button>
                        </div>
                    </div>
                ) : (
                    secoesPorCategoria.map((secao) => (
                        <section key={secao.categoriaId} className='categoria_secao'>
                            <div className='categoria_header'>
                                <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>
                                <span className='categoria_contagem'>
                                    {secao.linhas.length}/{totalProcedimentosPorCategoria.get(Number(secao.categoriaId)) || 0}
                                </span>
                            </div>
                            <table className='table_main'>
                                <colgroup>
                                    <col style={{ width: '11%' }} />
                                    <col
                                        style={{
                                            width: mostrarContagemRealizadores
                                                ? somenteLeitura
                                                    ? '36%'
                                                    : '30%'
                                                : somenteLeitura
                                                  ? '44%'
                                                  : '36%' }}
                                    />
                                    {mostrarContagemRealizadores && <col style={{ width: '8%' }} />}
                                    <col style={{ width: '15%' }} />
                                    <col style={{ width: '15%' }} />
                                    <col style={{ width: '15%' }} />
                                    {!somenteLeitura && <col style={{ width: '8%' }} />}
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>
                                            Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                        </th>
                                        <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>
                                            Procedimento{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                        </th>
                                        {mostrarContagemRealizadores && (
                                            <th
                                                className='table_header supertabelacidades_th_centro'
                                                onClick={() =>
                                                    handleOrdenarCategoria(secao.categoriaId, 'prestadores')
                                                }
                                                title='Credenciados na região (inclui cidades paralelas), mesmo critério da impressão de planos'
                                            >
                                                Prestadores
                                                {obterIndicadorOrdenacao(secao.categoriaId, 'prestadores')}
                                            </th>
                                        )}
                                        <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteP')}>
                                            Porte P{obterIndicadorOrdenacao(secao.categoriaId, 'porteP')}
                                        </th>
                                        <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteM')}>
                                            Porte M{obterIndicadorOrdenacao(secao.categoriaId, 'porteM')}
                                        </th>
                                        <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteG')}>
                                            Porte G{obterIndicadorOrdenacao(secao.categoriaId, 'porteG')}
                                        </th>
                                        {!somenteLeitura && <th className='table_header'>Excluir</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {secao.linhas.map((linha, linhaIndex) => (
                                        <tr key={`${secao.categoriaId}-${linha.codigo}`}>
                                            <td className='table_text_left'>{linha.codigo}</td>
                                            <td className='table_text_left'>
                                                <span className='supertabelacidades_nome_com_flag'>
                                                    {linha.procedimento}
                                                    {linha.apenasLoja ? (
                                                        <span
                                                            className='supertabelacidades_flag_loja'
                                                            title={ROTULO_PLANO[CHAVE_PLANO_APENAS_LOJA]}
                                                        >
                                                            Loja
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </td>
                                            {mostrarContagemRealizadores &&
                                                renderCelulaPrestadores(linha.codigo)}
                                            <td>
                                                {edicaoAtiva ? (
                                                    <input
                                                        className='table_cell_input'
                                                        type='number'
                                                        step='0.01'
                                                        value={linha.porteP}
                                                        onChange={(event) => atualizarValorLocal(linha.codigo, 'porteP', event.target.value)}
                                                        onBlur={() => salvarRepasse(linha, 'porteP')}
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
                                                        value={linha.porteM}
                                                        onChange={(event) => atualizarValorLocal(linha.codigo, 'porteM', event.target.value)}
                                                        onBlur={() => salvarRepasse(linha, 'porteM')}
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
                                                        value={linha.porteG}
                                                        onChange={(event) => atualizarValorLocal(linha.codigo, 'porteG', event.target.value)}
                                                        onBlur={() => salvarRepasse(linha, 'porteG')}
                                                        onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteG')}
                                                    />
                                                ) : (
                                                    Number(linha.porteG || 0).toFixed(2)
                                                )}
                                            </td>
                                            {!somenteLeitura && (
                                                <td>
                                                    <button
                                                        type='button'
                                                        className='table_delete_btn'
                                                        onClick={(event) =>
                                                            excluirProcedimento(linha, {
                                                                ignorarConfirmacao: event.shiftKey })
                                                        }
                                                        title='Excluir proc., SHIFT = Excluir Rápido'
                                                    >
                                                        🗑️
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    <tr className='row_add_line'>
                                        <td
                                            colSpan={
                                                (somenteLeitura ? 5 : 6) +
                                                (mostrarContagemRealizadores ? 1 : 0)
                                            }
                                        >
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
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </section>
                    ))
                )}

                {mostrarContagemRealizadores && !loading && cidadeId ? (
                    <section
                        className='supertabelacidades_sugestoes_rede'
                        aria-live='polite'
                        tabIndex={0}
                        role='region'
                        aria-label='Sugestões com realizador — tabela com rolagem horizontal'
                    >
                        <div className='supertabelacidades_sugestoes_rede_head'>
                            <h2 className='categoria_titulo'>Sugestões — com realizador, fora da tabela</h2>
                            <p className='supertabelacidades_sugestoes_rede_hint'>
                                Procedimentos no perfil de credenciados da região (cidade + paralelas), no mesmo critério
                                da impressão de planos, que ainda não estão em <code>repasses</code> desta cidade.
                                Com a edição ativa, informe os valores de porte antes de clicar em Adicionar (vazio = 0).
                                {carregandoContagemRealizadores ? ' A carregar contagens…' : ''}
                            </p>
                        </div>
                        {!carregandoContagemRealizadores && sugestoesRealizadores.length === 0 ? (
                            <p className='supertabelacidades_sugestoes_rede_vazio'>
                                Nenhuma sugestão para a cidade atual.
                            </p>
                        ) : (
                            <table className='table_main'>
                                <colgroup>
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: somenteLeitura ? '40%' : '32%' }} />
                                    <col style={{ width: '10%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '12%' }} />
                                    {!somenteLeitura && <col style={{ width: '10%' }} />}
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className='table_header table_header_no_sort'>Código</th>
                                        <th className='table_header table_header_no_sort'>Nome</th>
                                        <th className='table_header table_header_no_sort supertabelacidades_th_centro'>
                                            Prestadores
                                        </th>
                                        <th className='table_header table_header_no_sort'>Porte P</th>
                                        <th className='table_header table_header_no_sort'>Porte M</th>
                                        <th className='table_header table_header_no_sort'>Porte G</th>
                                        {!somenteLeitura && (
                                            <th className='table_header table_header_no_sort'>Ação</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sugestoesRealizadores.map((item) => (
                                        <tr key={`sug-rede-${item.codigo}`}>
                                            <td className='table_text_left'>{item.codigo}</td>
                                            <td className='table_text_left'>
                                                <span className='supertabelacidades_nome_com_flag'>
                                                    {item.nome}
                                                    {procedimentoPlanoBaseApenasLoja(
                                                        item.planoBaseId,
                                                        mapaPlanosCompleto,
                                                    ) ? (
                                                        <span
                                                            className='supertabelacidades_flag_loja'
                                                            title={ROTULO_PLANO[CHAVE_PLANO_APENAS_LOJA]}
                                                        >
                                                            Loja
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </td>
                                            {renderCelulaPrestadores(
                                                item.codigo,
                                                item.prestadores,
                                                item.nomesPrestadores,
                                            )}
                                            <td className='supertabelacidades_td_centro'>
                                                {edicaoAtiva ? (
                                                    <input
                                                        className='table_cell_input'
                                                        type='number'
                                                        step='0.01'
                                                        value={
                                                            valoresEdicaoSugestoes[
                                                                String(item.codigo || '')
                                                                    .trim()
                                                                    .toUpperCase()
                                                            ]?.porteP ?? ''
                                                        }
                                                        onChange={(event) =>
                                                            atualizarValorEdicaoSugestao(
                                                                item.codigo,
                                                                'porteP',
                                                                event.target.value,
                                                            )
                                                        }
                                                        placeholder='0'
                                                    />
                                                ) : (
                                                    <span className='table_cell_readonly'>—</span>
                                                )}
                                            </td>
                                            <td className='supertabelacidades_td_centro'>
                                                {edicaoAtiva ? (
                                                    <input
                                                        className='table_cell_input'
                                                        type='number'
                                                        step='0.01'
                                                        value={
                                                            valoresEdicaoSugestoes[
                                                                String(item.codigo || '')
                                                                    .trim()
                                                                    .toUpperCase()
                                                            ]?.porteM ?? ''
                                                        }
                                                        onChange={(event) =>
                                                            atualizarValorEdicaoSugestao(
                                                                item.codigo,
                                                                'porteM',
                                                                event.target.value,
                                                            )
                                                        }
                                                        placeholder='0'
                                                    />
                                                ) : (
                                                    <span className='table_cell_readonly'>—</span>
                                                )}
                                            </td>
                                            <td className='supertabelacidades_td_centro'>
                                                {edicaoAtiva ? (
                                                    <input
                                                        className='table_cell_input'
                                                        type='number'
                                                        step='0.01'
                                                        value={
                                                            valoresEdicaoSugestoes[
                                                                String(item.codigo || '')
                                                                    .trim()
                                                                    .toUpperCase()
                                                            ]?.porteG ?? ''
                                                        }
                                                        onChange={(event) =>
                                                            atualizarValorEdicaoSugestao(
                                                                item.codigo,
                                                                'porteG',
                                                                event.target.value,
                                                            )
                                                        }
                                                        placeholder='0'
                                                    />
                                                ) : (
                                                    <span className='table_cell_readonly'>—</span>
                                                )}
                                            </td>
                                            {!somenteLeitura && (
                                                <td className='supertabelacidades_td_centro'>
                                                    <button
                                                        type='button'
                                                        className='supertabelacidades_sugestoes_add_btn'
                                                        disabled={Boolean(adicionandoSugestaoCodigo)}
                                                        onClick={() => void adicionarSugestaoNaTabela(item)}
                                                        title={
                                                            edicaoAtiva
                                                                ? 'Incluir com os valores informados (vazio = 0)'
                                                                : 'Incluir procedimento na tabela desta cidade'
                                                        }
                                                    >
                                                        {adicionandoSugestaoCodigo ===
                                                        String(item.codigo || '')
                                                            .trim()
                                                            .toUpperCase()
                                                            ? '…'
                                                            : 'Adicionar'}
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                ) : null}
            </div>

            <ModalImpressaoHonorariosCidade
                aberto={modalPdfHonorariosAberto}
                onClose={() => setModalPdfHonorariosAberto(false)}
                cidadeNome={cidadeSelecionada?.nome || ''}
                secoes={secoesPorCategoria}
                onErro={(mensagem) => mostrarErroToast(mensagem)}
            />
        </div>
    )
}

export default Supertabelacidades
