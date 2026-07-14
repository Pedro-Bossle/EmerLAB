import React, { useEffect, useMemo, useState } from 'react'
import './Supertabelamain.css'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { useBuscaNotAtiva } from '../../../lib/devToolsUi'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import { filtrarLinhaSupertabelaPorBusca, partesValoresLinhaSupertabela } from '../../../lib/supertabelaBuscaValores.js'
import {
    buscarTodosPlanosCidadeCompat,
    consultarPlanoCidadeUnicoCompat,
    contextoPlanosCidadeFromCidades,
    upsertPlanosCidadeCompat,
} from '../../../lib/planosCidadeCompat'
import {
    buscarCidadeIdsFiltroPlanoCredenciados,
    buildOpcoesFiltroSupertabela,
} from '../../../lib/cidadesSupertabelaVinculos.js'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi.js'
import { calcularJanelaVirtualTabela, criarHandlerScrollVirtualTabela } from '../../../lib/tabelaVirtualScroll.js'
import { filtrarPlanosParaSelecaoGeral, mapearPlanos } from '../../../lib/planosHierarquia.js'

const Supertabelamain = () => {
    const ALTURA_LINHA_TABELA = 42
    const MAX_LINHAS_VISIVEIS = 10
    const LINHAS_OVERSCAN = 6
    const ORDEM_PLANOS = ['basico', 'classico', 'avancado', 'ultra']

    const [cidades, setCidades] = useState([])
    const [planos, setPlanos] = useState([])
    const [portes, setPortes] = useState([])
    const [categorias, setCategorias] = useState([])
    const [linhas, setLinhas] = useState([])

    const [cidadeId, setCidadeId] = useState('')
    const [cidadeIdsFiltroPlano, setCidadeIdsFiltroPlano] = useState(null)
    const [planoId, setPlanoId] = useState('')
    const [porteSelecionado, setPorteSelecionado] = useState('')

    const [termoBusca, setTermoBusca] = useState('')
    const [, setLoading] = useState(false)
    const [erroDetalhe, setErroDetalhe] = useState('')
    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})
    const [headerCompactProgress, setHeaderCompactProgress] = useState(0)
    const [edicaoAtiva, setEdicaoAtiva] = useState(false)
    const [somenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT))
    const buscaNotAtiva = useBuscaNotAtiva()
    const [edicoesLocais, setEdicoesLocais] = useState({})
    const [scrollTopoPorCategoria, setScrollTopoPorCategoria] = useState({})

    /**
     * Resolve a cidade ativa e o respectivo ID de região.
     */
    const cidadeSelecionada = useMemo(
        () => cidades.find((cidade) => String(cidade.id) === String(cidadeId)) || null,
        [cidades, cidadeId]
    )

    const cidadesNoFiltroPlano = useMemo(() => {
        if (!cidadeIdsFiltroPlano?.size) return cidades
        return cidades.filter((c) => cidadeIdsFiltroPlano.has(Number(c.id)))
    }, [cidades, cidadeIdsFiltroPlano])

    /**
     * Formata valores numéricos para moeda BRL.
     */
    const formatarMoeda = (valor) =>
        new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(Number(valor || 0))

    /**
     * Normaliza o nome do porte para facilitar comparação textual.
     */
    const normalizarPorteNome = (nome) =>
        String(nome || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase()

    /**
     * Normaliza nomes para facilitar mapeamento dos planos por chave lógica.
     */
    const normalizarPlanoNome = (nome) =>
        String(nome || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase()

    /**
     * Mapeia planos da base para as chaves de hierarquia (Básico -> Ultra).
     */
    const mapearPlanosPorChave = () => {
        const usados = new Set()
        const resultado = {}
        const lista = planos || []

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

    const obterChavePlanoSelecionado = (mapaPlanos) => {
        const planoIdNumerico = Number(planoId)
        const entrada = ORDEM_PLANOS.find((chave) => Number(mapaPlanos[chave]?.id) === planoIdNumerico)
        if (entrada) return entrada

        const indicePorPosicao = planos.findIndex((plano) => Number(plano.id) === planoIdNumerico)
        if (indicePorPosicao >= 0 && indicePorPosicao < ORDEM_PLANOS.length) {
            return ORDEM_PLANOS[indicePorPosicao]
        }
        return null
    }

    /**
     * Obtém um ID de porte pela letra (P/M/G) usando a lista da tabela portes.
     */
    const obterPorteIdPorLetra = (letra) => {
        const alvo = String(letra || '').toUpperCase()
        const porte = portes.find((item) => {
            const nome = normalizarPorteNome(item.nome)
            return nome === alvo || nome.startsWith(alvo)
        })

        return porte ? String(porte.id) : ''
    }

    /**
     * Carrega listas base dos filtros (cidades, planos e portes) e define valores padrão.
     */
    const carregarFiltros = async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: cidadesData, error: errCidades },
                { data: planosData, error: errPlanos },
                { data: portesData, error: errPortes },
                { data: categoriasData, error: errCategorias },
            ] = await Promise.all([
                supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                supabase.from('planos').select('id, nome').order('id', { ascending: true }),
                supabase.from('portes').select('id, nome').order('id', { ascending: true }),
                supabase
                    .from('categorias')
                    .select('id, nome')
                    .gte('id', 3)
                    .lte('id', 25)
                    .order('id', { ascending: true }),
            ])

            if (errCidades || errPlanos || errPortes || errCategorias) {
                const detalhes = [errCidades?.message, errPlanos?.message, errPortes?.message, errCategorias?.message]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao carregar filtros: ${detalhes}`)
                return
            }

            const cidadesLista = cidadesData || []
            const planosLista = filtrarPlanosParaSelecaoGeral(
                planosData || [],
                mapearPlanos(planosData || []),
            )
            const portesLista = portesData || []

            const idsFiltro = await buscarCidadeIdsFiltroPlanoCredenciados(
                supabase,
                null,
                buscarTodosPaginado,
            )
            setCidadeIdsFiltroPlano(idsFiltro)
            const opcoesCidade = buildOpcoesFiltroSupertabela(cidadesLista, [], idsFiltro)

            setCidades(cidadesLista)
            setPlanos(planosLista)
            setPortes(portesLista)
            setCategorias(categoriasData || [])

            if (opcoesCidade.length > 0) {
                setCidadeId(String(opcoesCidade[0].cidadeId))
            }
            if (planosLista.length > 0) {
                setPlanoId(String(planosLista[0].id))
            }
            if (portesLista.length > 0) {
                setPorteSelecionado(String(portesLista[0].id))
            }
        } catch (error) {
            setErroDetalhe(`Falha inesperada ao carregar filtros: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    /**
     * Busca procedimentos elegíveis por plano_base_id e cruza com dados locais da cidade/região.
     */
    const buscarLinhasTabela = async () => {
        if (!cidadeId || !planoId || portes.length === 0) return
        try {
            setLoading(true)
            setErroDetalhe('')

            if (!cidadeSelecionada) {
                setErroDetalhe('Cidade selecionada não encontrada na lista.')
                return
            }

            const mapaPlanos = mapearPlanosPorChave()
            const chavePlanoSelecionado = obterChavePlanoSelecionado(mapaPlanos)
            if (!chavePlanoSelecionado) {
                setErroDetalhe('Não foi possível mapear o plano selecionado para a hierarquia de plano base.')
                return
            }

            const indicePlanoSelecionado = ORDEM_PLANOS.indexOf(chavePlanoSelecionado)
            const planosBaseElegiveis = ORDEM_PLANOS
                .slice(0, indicePlanoSelecionado + 1)
                .map((chave) => mapaPlanos[chave]?.id)
                .filter(Boolean)
                .map((id) => Number(id))

            const procedimentosResp = await buscarTodosPaginado(() =>
                supabase
                    .from('procedimentos')
                    .select('codigo, nome, categoria_id, plano_base_id')
                    .in('plano_base_id', planosBaseElegiveis)
            )

            const ctxPlanosCidade = contextoPlanosCidadeFromCidades(cidadeId)

            const [planosCidadeResp, repassesPorCidadeResp] = await Promise.all([
                buscarTodosPlanosCidadeCompat(
                    supabase,
                    buscarTodosPaginado,
                    ctxPlanosCidade,
                    'id, procedimento_cod, diferenca, plano_id',
                    (q) => q.eq('plano_id', planoId),
                ),
                buscarTodosPaginado(() =>
                    supabase
                        .from('repasses')
                        .select('id, procedimento_id, porte_id, valor')
                        .eq('cidade_id', cidadeId)
                ),
            ])

            const planosCidade = planosCidadeResp.data
            const errPlanosCidade = planosCidadeResp.error

            const repasses = repassesPorCidadeResp.data
            const errRepasses = repassesPorCidadeResp.error

            const procedimentosData = procedimentosResp.data
            const errProcedimentos = procedimentosResp.error

            if (errPlanosCidade || errRepasses || errProcedimentos) {
                const detalhes = [errPlanosCidade?.message, errRepasses?.message, errProcedimentos?.message]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao buscar tabela principal: ${detalhes}`)
                return
            }

            const porteIdP = obterPorteIdPorLetra('P')
            const porteIdM = obterPorteIdPorLetra('M')
            const porteIdG = obterPorteIdPorLetra('G')

            const mapaRepassesPorProcedimento = new Map()
                ; (repasses || []).forEach((item) => {
                    const procId = String(item.procedimento_id)
                    const porteId = String(item.porte_id)
                    const valor = Number(item.valor || 0)

                    if (!mapaRepassesPorProcedimento.has(procId)) {
                        mapaRepassesPorProcedimento.set(procId, {})
                    }
                    mapaRepassesPorProcedimento.get(procId)[porteId] = {
                        repasseId: item.id,
                        valor,
                    }
                })

            const mapaPlanosCidade = new Map(
                (planosCidade || []).map((item) => [
                    String(item.procedimento_cod),
                    {
                        planoCidadeId: item.id,
                        diferenca: Number(item.diferenca || 0),
                    },
                ])
            )

            const linhasMontadas = (procedimentosData || []).map((item) => {
                const procId = String(item.codigo)
                const valoresPorPorte = mapaRepassesPorProcedimento.get(procId) || {}
                const diferenca = Number(mapaPlanosCidade.get(procId)?.diferenca || 0)

                const valorP = porteIdP ? Number(valoresPorPorte[porteIdP]?.valor || 0) : 0
                const valorM = porteIdM ? Number(valoresPorPorte[porteIdM]?.valor || 0) : 0
                const valorG = porteIdG ? Number(valoresPorPorte[porteIdG]?.valor || 0) : 0
                const valorPorteSelecionado = Number(valoresPorPorte[String(porteSelecionado)]?.valor || 0)

                return {
                    planoCidadeId: mapaPlanosCidade.get(procId)?.planoCidadeId || null,
                    codigo: procId,
                    procedimento: String(item.nome || procId),
                    categoriaId: item.categoria_id || null,
                    parceiro: '',
                    porteP: valorP,
                    porteM: valorM,
                    porteG: valorG,
                    repasseIdP: porteIdP ? valoresPorPorte[porteIdP]?.repasseId || null : null,
                    repasseIdM: porteIdM ? valoresPorPorte[porteIdM]?.repasseId || null : null,
                    repasseIdG: porteIdG ? valoresPorPorte[porteIdG]?.repasseId || null : null,
                    porteIdP,
                    porteIdM,
                    porteIdG,
                    diferenca,
                    custo: valorPorteSelecionado - diferenca,
                }
            })

            setLinhas(linhasMontadas)
        } catch (error) {
            setErroDetalhe(`Falha inesperada ao buscar tabela principal: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    /**
     * Filtra localmente por texto para facilitar busca por código/procedimento/parceiro.
     */
    const linhasFiltradas = useMemo(() => {
        if (!termoBusca.trim() && !buscaNotAtiva) return linhas

        return linhas.filter((linha) => {
            const categoriaNome = categorias.find((categoria) => Number(categoria.id) === Number(linha.categoriaId))?.nome || ''
            const blob = normalizarTextoBusca(
                [linha.codigo, linha.procedimento, linha.parceiro, categoriaNome, ...partesValoresLinhaSupertabela(linha)]
                    .filter(Boolean)
                    .join(' '),
            )
            return filtrarLinhaSupertabelaPorBusca(linha, blob, termoBusca, buscaNotAtiva)
        })
    }, [linhas, termoBusca, categorias, buscaNotAtiva])

    /**
     * Retorna um valor textual para input de edição do repasse.
     */
    const obterValorInputRepasse = (linha, campo, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        if (Object.prototype.hasOwnProperty.call(edicoesLocais, chave)) {
            return edicoesLocais[chave]
        }
        return String(Number(linha[campo] || 0).toFixed(2))
    }

    /**
     * Atualiza o cache local do input enquanto o usuário digita.
     */
    const atualizarEdicaoLocal = (linha, campo, categoriaId, valor) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        setEdicoesLocais((anterior) => ({
            ...anterior,
            [chave]: valor,
        }))
    }

    /**
     * Converte texto de entrada (pt-BR/en-US) em número válido.
     */
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

    /**
     * Persiste no banco o valor de repasse para cidade/porte/procedimento e atualiza estado local.
     */
    const salvarRepasseValor = async (linha, campo, valorNumerico) => {
        if (!cidadeId) {
            setErroDetalhe('Cidade selecionada não identificada para salvar repasse.')
            return false
        }

        const metaPorCampo = {
            porteP: { repasseId: linha.repasseIdP, porteId: linha.porteIdP },
            porteM: { repasseId: linha.repasseIdM, porteId: linha.porteIdM },
            porteG: { repasseId: linha.repasseIdG, porteId: linha.porteIdG },
        }
        const meta = metaPorCampo[campo]
        if (!meta?.porteId) {
            setErroDetalhe('Porte não identificado para salvar repasse.')
            return
        }

        let erroPersistencia = null
        let novoRepasseId = meta.repasseId

        if (meta.repasseId) {
            const { error } = await supabase
                .from('repasses')
                .update({ valor: valorNumerico })
                .eq('id', meta.repasseId)
            erroPersistencia = error
        } else {
            const tentativaPorCidade = await supabase
                .from('repasses')
                .upsert(
                    {
                        procedimento_id: linha.codigo,
                        cidade_id: Number(cidadeId),
                        porte_id: Number(meta.porteId),
                        valor: valorNumerico,
                    },
                    {
                        onConflict: 'procedimento_id,cidade_id,porte_id',
                    }
                )
                .select('id')
                .single()

            erroPersistencia = tentativaPorCidade.error
            novoRepasseId = tentativaPorCidade.data?.id || null
        }

        if (erroPersistencia) {
            setErroDetalhe(`Erro ao salvar repasse: ${erroPersistencia.message}`)
            return false
        }

        setLinhas((anteriores) =>
            anteriores.map((item) => {
                if (item.codigo !== linha.codigo) return item

                const atualizado = {
                    ...item,
                    [campo]: valorNumerico,
                    ...(campo === 'porteP' ? { repasseIdP: novoRepasseId } : {}),
                    ...(campo === 'porteM' ? { repasseIdM: novoRepasseId } : {}),
                    ...(campo === 'porteG' ? { repasseIdG: novoRepasseId } : {}),
                }

                const valorSelecionado =
                    String(porteSelecionado) === String(item.porteIdP)
                        ? atualizado.porteP
                        : String(porteSelecionado) === String(item.porteIdM)
                            ? atualizado.porteM
                            : String(porteSelecionado) === String(item.porteIdG)
                                ? atualizado.porteG
                                : 0

                atualizado.custo = Number(valorSelecionado || 0) - Number(atualizado.diferenca || 0)
                return atualizado
            })
        )

        return true
    }

    /**
     * Persiste no banco o valor de repasse editado para a cidade/porte/procedimento.
     */
    const salvarRepasseEditado = async (linha, campo, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-${campo}`
        const bruto = edicoesLocais[chave]
        if (bruto === undefined) return

        const valorNumerico = normalizarNumeroEntrada(bruto)
        if (Number.isNaN(valorNumerico)) {
            setErroDetalhe('Valor inválido para repasse.')
            return
        }

        const salvou = await salvarRepasseValor(linha, campo, valorNumerico)
        if (!salvou) return

        setEdicoesLocais((anterior) => {
            const copia = { ...anterior }
            delete copia[chave]
            return copia
        })
    }

    /** Resolve o ID de planos_cidade para o procedimento/plano/cidade atuais. */
    const resolverPlanoCidadeId = async (linha) => {
        const ctx = contextoPlanosCidadeFromCidades(cidadeId, cidades)
        const { data, error } = await consultarPlanoCidadeUnicoCompat(supabase, ctx, {
            planoId,
            procedimentoCod: linha.codigo,
        })

        if (error) {
            setErroDetalhe(`Erro ao localizar registro de diferença: ${error.message}`)
            return null
        }

        return data?.id ?? null
    }

    /**
     * Persiste no banco o valor de diferença e atualiza estado local.
     */
    const salvarDiferencaValor = async (linha, valorNumerico) => {
        let planoCidadeId = linha.planoCidadeId ?? await resolverPlanoCidadeId(linha)
        let error = null

        if (planoCidadeId == null) {
            const ctx = contextoPlanosCidadeFromCidades(cidadeId)
            const insercao = await upsertPlanosCidadeCompat(
                supabase,
                [
                    {
                        plano_id: Number(planoId),
                        procedimento_cod: linha.codigo,
                        diferenca: valorNumerico,
                    },
                ],
                ctx,
                'id',
            )
            planoCidadeId = insercao.data?.[0]?.id ?? null
            error = insercao.error
        } else {
            const atualizacao = await supabase
                .from('planos_cidade')
                .update({ diferenca: valorNumerico })
                .eq('id', planoCidadeId)

            error = atualizacao.error
        }

        if (error) {
            setErroDetalhe(`Erro ao salvar diferença: ${error.message}`)
            return false
        }

        setLinhas((anteriores) =>
            anteriores.map((item) => {
                if (item.codigo !== linha.codigo) return item

                const atualizado = {
                    ...item,
                    planoCidadeId,
                    diferenca: valorNumerico,
                }
                atualizado.custo = Number(
                    String(porteSelecionado) === String(item.porteIdP)
                        ? atualizado.porteP
                        : String(porteSelecionado) === String(item.porteIdM)
                            ? atualizado.porteM
                            : String(porteSelecionado) === String(item.porteIdG)
                                ? atualizado.porteG
                                : 0
                ) - Number(valorNumerico || 0)

                return atualizado
            })
        )

        return true
    }

    /**
     * Persiste no banco o valor de diferença do plano para o procedimento da região/cidade selecionada.
     */
    const salvarDiferencaEditada = async (linha, categoriaId) => {
        const chave = `${categoriaId}-${linha.codigo}-diferenca`
        const bruto = edicoesLocais[chave]
        if (bruto === undefined) return

        const valorNumerico = normalizarNumeroEntrada(bruto)
        if (Number.isNaN(valorNumerico)) {
            setErroDetalhe('Valor inválido para diferença.')
            return
        }

        const salvou = await salvarDiferencaValor(linha, valorNumerico)
        if (!salvou) return

        setEdicoesLocais((anterior) => {
            const copia = { ...anterior }
            delete copia[chave]
            return copia
        })
    }

    /**
     * Aplica colagem de grade (horizontal e vertical) iniciando na célula selecionada.
     */
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
                    setErroDetalhe(`Valor inválido na colagem: "${valorBruto}"`)
                    continue
                }

                // Persistência imediata célula a célula.
                // await em sequência evita corrida de estado/atualização.
                await salvarRepasseValor(linhaTabela, campoDestino, valorNumerico)
            }
        }
    }

    /**
     * Aplica colagem vertical na coluna de diferença (uma célula por linha).
     */
    const processarColagemDiferenca = async (event, secao, linhaIndexInicial) => {
        event.preventDefault()

        const texto = event.clipboardData?.getData('text') || ''
        const linhasColadas = texto
            .replace(/\r/g, '')
            .split('\n')
            .filter((linha) => linha.length > 0)

        if (linhasColadas.length === 0) return

        for (let i = 0; i < linhasColadas.length; i += 1) {
            const linhaTabela = secao.linhas[linhaIndexInicial + i]
            if (!linhaTabela) break

            const primeiraColuna = String(linhasColadas[i].split('\t')[0] || '').trim()
            if (!primeiraColuna) continue

            const valorNumerico = normalizarNumeroEntrada(primeiraColuna)
            if (Number.isNaN(valorNumerico)) {
                setErroDetalhe(`Valor inválido na colagem de diferença: "${primeiraColuna}"`)
                continue
            }

            await salvarDiferencaValor(linhaTabela, valorNumerico)
        }
    }

    /**
     * Alterna a ordenacao de uma categoria especifica ao clicar no header.
     */
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

    /**
     * Retorna o indicador visual da ordenacao atual para uma coluna em uma categoria.
     */
    const obterIndicadorOrdenacao = (categoriaId, coluna) => {
        const atual = ordenacaoPorCategoria[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
        if (atual.coluna !== coluna) return ''
        return atual.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    /**
     * Ordena um conjunto de linhas com base na configuracao de uma categoria.
     */
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

            return String(valorA ?? '')
                .localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })

        return resultado
    }

    /**
     * Recupera os nomes selecionados de plano e porte para exibir nos headers.
     */
    const planoSelecionadoNome = useMemo(() => {
        const plano = planos.find((item) => String(item.id) === String(planoId))
        return plano?.nome || 'Plano'
    }, [planos, planoId])

    const porteSelecionadoNome = useMemo(() => {
        const porte = portes.find((item) => String(item.id) === String(porteSelecionado))
        return porte?.nome || 'Porte'
    }, [portes, porteSelecionado])

    /**
     * Agrupa as linhas por categoria seguindo a ordem da tabela categorias (id 3..25).
     */
    const secoesPorCategoria = useMemo(() => {
        return categorias
            .map((categoria) => ({
                categoriaId: categoria.id,
                categoriaNome: categoria.nome,
                linhas: ordenarLinhas(
                    linhasFiltradas.filter((linha) => Number(linha.categoriaId) === Number(categoria.id)),
                    categoria.id
                ),
            }))
            .filter((secao) => secao.linhas.length > 0)
    }, [categorias, linhasFiltradas, ordenacaoPorCategoria])

    /**
     * Retorna classe de tamanho para procedimento longo, reduzindo fonte para caber.
     */
    const obterClasseProcedimento = (texto) => {
        const tamanho = String(texto || '').length
        if (tamanho > 42) return 'table_text_proc table_text_proc_xs'
        if (tamanho > 34) return 'table_text_proc table_text_proc_sm'
        if (tamanho > 26) return 'table_text_proc table_text_proc_md'
        return 'table_text_proc'
    }

    useEffect(() => {
        carregarFiltros()
    }, [])

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
                const opcoes = buildOpcoesFiltroSupertabela(cidades, [], ids)
                if (opcoes.length && !opcoes.some((o) => String(o.cidadeId) === String(cidadeId))) {
                    setCidadeId(String(opcoes[0].cidadeId))
                }
            } catch {
                /* mantém filtro anterior */
            }
        })()
        return () => {
            cancelado = true
        }
    }, [planoId, cidades, cidadeId])

    useEffect(() => {
        buscarLinhasTabela()
    }, [cidadeId, planoId, porteSelecionado, cidades, portes])

    /**
     * Fecha automaticamente mensagens de aviso/erro após 15 segundos.
     */
    useEffect(() => {
        if (!erroDetalhe) return

        const timer = setTimeout(() => {
            setErroDetalhe('')
        }, TOAST_AUTO_DISMISS_MS)

        return () => clearTimeout(timer)
    }, [erroDetalhe])

    /**
     * Compacta o header de filtros quando a página está rolada.
     */
    useEffect(() => {
        let rafId = null

        const onScroll = () => {
            if (rafId) return

            rafId = window.requestAnimationFrame(() => {
                const progress = Math.min(Math.max(window.scrollY, 0) / 64, 1)
                setHeaderCompactProgress((anterior) => {
                    if (Math.abs(anterior - progress) < 0.01) return anterior
                    return progress
                })
                rafId = null
            })
        }

        onScroll()
        window.addEventListener('scroll', onScroll)
        return () => {
            window.removeEventListener('scroll', onScroll)
            if (rafId) {
                window.cancelAnimationFrame(rafId)
            }
        }
    }, [])

    return (
        <div className='supertabelamain'>
            <h1>Supertabela - Visão Geral</h1>
            <hr />
            <header
                className='supertabelamain_header'
                style={{ '--compact-progress': headerCompactProgress }}
            >
                <h2>Filtros</h2>

                <div className='supertabelamain_filters'>
                    <div className='supertabelamain_filters_input'>
                        <p>Busca</p>
                        <input
                            className='supertabelamain_filters_input_text'
                            type="text"
                            placeholder='Código, procedimento, categoria ou valor'
                            value={termoBusca}
                            onChange={(event) => setTermoBusca(event.target.value)}
                        />
                    </div>

                    <div className='supertabelamain_filters_select'>
                        <p>Cidade</p>
                        <select
                            className='supertabelamain_filters_select_select'
                            name="cidade"
                            id="cidade"
                            value={cidadeId}
                            onChange={(event) => setCidadeId(event.target.value)}
                        >
                            {cidadesNoFiltroPlano.map((cidade) => (
                                <option key={cidade.id} value={cidade.id}>
                                    {cidade.uf ? `${cidade.nome} (${cidade.uf})` : cidade.nome}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className='supertabelamain_filters_select'>
                        <p>Plano</p>
                        <select
                            className='supertabelamain_filters_select_select'
                            name="plano"
                            id="plano"
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

                    <div className='supertabelamain_filters_select'>
                        <p>Tamanho</p>
                        <select
                            className='supertabelamain_filters_select_select'
                            name="porte"
                            id="porte"
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

                    {!somenteLeitura && (
                        <div className='supertabelamain_filters_select'>
                            <label className='supertabelamain_filters_checkbox_wrap'>
                                <input
                                    type="checkbox"
                                    checked={edicaoAtiva}
                                    onChange={(event) => setEdicaoAtiva(event.target.checked)}
                                />
                                <span>Ativar edição</span>
                            </label>
                        </div>
                    )}
                </div>
            </header>

            {erroDetalhe && (
                <div className='supertabelamain_alert' role='alert' aria-live='assertive'>
                    <div className='supertabelamain_alert_text'>
                        <strong>Aviso</strong>
                        <span>{erroDetalhe}</span>
                    </div>
                    <button
                        type='button'
                        className='supertabelamain_alert_close'
                        onClick={() => setErroDetalhe('')}
                        aria-label='Fechar aviso'
                    >
                        x
                    </button>
                </div>
            )}

            <div className='table_container'>
                {secoesPorCategoria.length === 0 ? (
                    <p>Nenhum registro encontrado para os filtros selecionados.</p>
                ) : (
                    secoesPorCategoria.map((secao) => {
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
                        const { indiceInicial, indiceFinal, alturaEspacadorTopo, alturaEspacadorBase } = janelaVirtual
                        const linhasVisiveis = secao.linhas.slice(indiceInicial, indiceFinal)

                        return (
                            <section className='categoria_secao' key={secao.categoriaId}>
                                <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>

                                {usarVirtualizacao ? (
                                    <>
                                        <table className='table_main table_main_virtual_header'>
                                            <colgroup>
                                                <col className='supertabelamain_col_codigo' style={{ width: '11%' }} />
                                                <col className='supertabelamain_col_nome' style={{ width: '33%' }} />
                                                <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                            </colgroup>
                                            <thead>
                                                <tr>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>Procedimento{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteP')}>Porte P{obterIndicadorOrdenacao(secao.categoriaId, 'porteP')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteM')}>Porte M{obterIndicadorOrdenacao(secao.categoriaId, 'porteM')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteG')}>Porte G{obterIndicadorOrdenacao(secao.categoriaId, 'porteG')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'diferenca')}>Diferença {planoSelecionadoNome}{obterIndicadorOrdenacao(secao.categoriaId, 'diferenca')}</th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'custo')}>Custo {porteSelecionadoNome}{obterIndicadorOrdenacao(secao.categoriaId, 'custo')}</th>
                                                </tr>
                                            </thead>
                                        </table>

                                        <div
                                            className='table_main_virtual_body'
                                            style={{ maxHeight: `${Math.max(alturaVisivelCorpo, ALTURA_LINHA_TABELA)}px` }}
                                            onScroll={criarHandlerScrollVirtualTabela({
                                                categoriaId: secao.categoriaId,
                                                setScrollTopoPorCategoria,
                                            })}
                                        >
                                            <table className='table_main table_main_virtual_rows'>
                                                <colgroup>
                                                    <col className='supertabelamain_col_codigo' style={{ width: '11%' }} />
                                                    <col className='supertabelamain_col_nome' style={{ width: '33%' }} />
                                                    <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                    <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                    <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                    <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                    <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                                </colgroup>
                                                <tbody>
                                                    {alturaEspacadorTopo > 0 && (
                                                        <tr className='table_spacer_row' aria-hidden='true'>
                                                            <td colSpan={7} style={{ height: `${alturaEspacadorTopo}px` }} />
                                                        </tr>
                                                    )}

                                                    {linhasVisiveis.map((linha, indiceLocal) => {
                                                        const linhaIndex = indiceInicial + indiceLocal
                                                        const linhaPar = linhaIndex % 2 === 1
                                                        return (
                                                            <tr
                                                                key={`${secao.categoriaId}-${linha.codigo}`}
                                                                className={linhaPar ? 'table_row_even' : ''}
                                                            >
                                                                <td className='table_text_left'>{linha.codigo}</td>
                                                                <td className={`table_text_left ${obterClasseProcedimento(linha.procedimento)}`}>{linha.procedimento}</td>
                                                                <td>
                                                                    {edicaoAtiva ? (
                                                                        <input
                                                                            className='table_cell_input'
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={obterValorInputRepasse(linha, 'porteP', secao.categoriaId)}
                                                                            onChange={(event) => atualizarEdicaoLocal(linha, 'porteP', secao.categoriaId, event.target.value)}
                                                                            onBlur={() => salvarRepasseEditado(linha, 'porteP', secao.categoriaId)}
                                                                            onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteP')}
                                                                        />
                                                                    ) : (
                                                                        formatarMoeda(linha.porteP)
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {edicaoAtiva ? (
                                                                        <input
                                                                            className='table_cell_input'
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={obterValorInputRepasse(linha, 'porteM', secao.categoriaId)}
                                                                            onChange={(event) => atualizarEdicaoLocal(linha, 'porteM', secao.categoriaId, event.target.value)}
                                                                            onBlur={() => salvarRepasseEditado(linha, 'porteM', secao.categoriaId)}
                                                                            onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteM')}
                                                                        />
                                                                    ) : (
                                                                        formatarMoeda(linha.porteM)
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {edicaoAtiva ? (
                                                                        <input
                                                                            className='table_cell_input'
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={obterValorInputRepasse(linha, 'porteG', secao.categoriaId)}
                                                                            onChange={(event) => atualizarEdicaoLocal(linha, 'porteG', secao.categoriaId, event.target.value)}
                                                                            onBlur={() => salvarRepasseEditado(linha, 'porteG', secao.categoriaId)}
                                                                            onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteG')}
                                                                        />
                                                                    ) : (
                                                                        formatarMoeda(linha.porteG)
                                                                    )}
                                                                </td>
                                                                <td>
                                                                    {edicaoAtiva ? (
                                                                        <input
                                                                            className='table_cell_input'
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={obterValorInputRepasse(linha, 'diferenca', secao.categoriaId)}
                                                                            onChange={(event) => atualizarEdicaoLocal(linha, 'diferenca', secao.categoriaId, event.target.value)}
                                                                            onBlur={() => salvarDiferencaEditada(linha, secao.categoriaId)}
                                                                            onPaste={(event) => processarColagemDiferenca(event, secao, linhaIndex)}
                                                                        />
                                                                    ) : (
                                                                        formatarMoeda(linha.diferenca)
                                                                    )}
                                                                </td>
                                                                <td className={linha.custo < 0 ? 'table_custo_negativo' : ''}>{formatarMoeda(linha.custo)}</td>
                                                            </tr>
                                                        )
                                                    })}

                                                    {alturaEspacadorBase > 0 && (
                                                        <tr className='table_spacer_row' aria-hidden='true'>
                                                            <td colSpan={7} style={{ height: `${alturaEspacadorBase}px` }} />
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : (
                                    <table className='table_main'>
                                        <colgroup>
                                            <col className='supertabelamain_col_codigo' style={{ width: '11%' }} />
                                            <col className='supertabelamain_col_nome' style={{ width: '33%' }} />
                                            <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                            <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                            <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                            <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                            <col className='supertabelamain_col_valor' style={{ width: '11.2%' }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>Procedimento{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteP')}>Porte P{obterIndicadorOrdenacao(secao.categoriaId, 'porteP')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteM')}>Porte M{obterIndicadorOrdenacao(secao.categoriaId, 'porteM')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'porteG')}>Porte G{obterIndicadorOrdenacao(secao.categoriaId, 'porteG')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'diferenca')}>Diferença {planoSelecionadoNome}{obterIndicadorOrdenacao(secao.categoriaId, 'diferenca')}</th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'custo')}>Custo {porteSelecionadoNome}{obterIndicadorOrdenacao(secao.categoriaId, 'custo')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {secao.linhas.map((linha, linhaIndex) => {
                                                const linhaPar = linhaIndex % 2 === 1
                                                return (
                                                    <tr
                                                        key={`${secao.categoriaId}-${linha.codigo}`}
                                                        className={linhaPar ? 'table_row_even' : ''}
                                                    >
                                                        <td className='table_text_left'>{linha.codigo}</td>
                                                        <td className={`table_text_left ${obterClasseProcedimento(linha.procedimento)}`}>{linha.procedimento}</td>
                                                        <td>
                                                            {edicaoAtiva ? (
                                                                <input
                                                                    className='table_cell_input'
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={obterValorInputRepasse(linha, 'porteP', secao.categoriaId)}
                                                                    onChange={(event) => atualizarEdicaoLocal(linha, 'porteP', secao.categoriaId, event.target.value)}
                                                                    onBlur={() => salvarRepasseEditado(linha, 'porteP', secao.categoriaId)}
                                                                    onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteP')}
                                                                />
                                                            ) : (
                                                                formatarMoeda(linha.porteP)
                                                            )}
                                                        </td>
                                                        <td>
                                                            {edicaoAtiva ? (
                                                                <input
                                                                    className='table_cell_input'
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={obterValorInputRepasse(linha, 'porteM', secao.categoriaId)}
                                                                    onChange={(event) => atualizarEdicaoLocal(linha, 'porteM', secao.categoriaId, event.target.value)}
                                                                    onBlur={() => salvarRepasseEditado(linha, 'porteM', secao.categoriaId)}
                                                                    onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteM')}
                                                                />
                                                            ) : (
                                                                formatarMoeda(linha.porteM)
                                                            )}
                                                        </td>
                                                        <td>
                                                            {edicaoAtiva ? (
                                                                <input
                                                                    className='table_cell_input'
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={obterValorInputRepasse(linha, 'porteG', secao.categoriaId)}
                                                                    onChange={(event) => atualizarEdicaoLocal(linha, 'porteG', secao.categoriaId, event.target.value)}
                                                                    onBlur={() => salvarRepasseEditado(linha, 'porteG', secao.categoriaId)}
                                                                    onPaste={(event) => processarColagemRepasse(event, secao, linhaIndex, 'porteG')}
                                                                />
                                                            ) : (
                                                                formatarMoeda(linha.porteG)
                                                            )}
                                                        </td>
                                                        <td>
                                                            {edicaoAtiva ? (
                                                                <input
                                                                    className='table_cell_input'
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={obterValorInputRepasse(linha, 'diferenca', secao.categoriaId)}
                                                                    onChange={(event) => atualizarEdicaoLocal(linha, 'diferenca', secao.categoriaId, event.target.value)}
                                                                    onBlur={() => salvarDiferencaEditada(linha, secao.categoriaId)}
                                                                    onPaste={(event) => processarColagemDiferenca(event, secao, linhaIndex)}
                                                                />
                                                            ) : (
                                                                formatarMoeda(linha.diferenca)
                                                            )}
                                                        </td>
                                                        <td className={linha.custo < 0 ? 'table_custo_negativo' : ''}>{formatarMoeda(linha.custo)}</td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </section>
                        )
                    })
                )}
            </div>
        </div>
    )
}

export default Supertabelamain