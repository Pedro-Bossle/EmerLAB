import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { useBuscaNotAtiva } from '../../../lib/devToolsUi'
import { filtrarPorTermoBusca, normalizarTextoBusca as normalizarTextoBuscaDev } from '../../../lib/prestadorCadastroHelpers'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { calcularJanelaVirtualTabela, criarHandlerScrollVirtualTabela } from '../../../lib/tabelaVirtualScroll.js'
import { upsertPlanosCidadeCompat } from '../../../lib/planosCidadeCompat'
import {
    buscarCategoriaLimitesGrupo,
    categoriaPermiteLimiteGrupoNaChavePlano,
    isMissingCategoriaLimitesGrupoTable,
    montarLimitesGrupoPorCategoriaEChavePlano,
    montarPlanosChaveDisponiveisPorCategoria,
    salvarLimiteGrupoCategoria,
} from '../../../lib/categoriaLimitesGrupo'
import {
    CHAVE_PLANO_APENAS_LOJA,
    ORDEM_PLANOS,
    ORDEM_PLANOS_BASE_PROCEDIMENTOS,
    ROTULO_PLANO,
    mapearPlanos,
    obterChavePlanoPorId,
    obterPlanoIdsPermitidosDesdeChaveBase,
} from '../../../lib/planosHierarquia.js'
import { TOAST_AUTO_DISMISS_MS, useConfirmacaoExclusaoAutoDismiss } from '../../../lib/toastUi.js'
import '../Supertabela_main/Supertabelamain.css'
import './Supertabelaprocedimentos.css'
import SupertabelaBeneficiosCatalogo from './SupertabelaBeneficiosCatalogo.jsx'

const normalizarTextoBusca = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const normalizarCodigo = (codigo) =>
    String(codigo || '')
        .trim()
        .toUpperCase()

const Supertabelaprocedimentos = () => {
    const ALTURA_LINHA_TABELA = 42
    const MAX_LINHAS_VISIVEIS = 10
    const LINHAS_OVERSCAN = 6
    const [somenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT))
    const buscaNotAtiva = useBuscaNotAtiva()

    const [planos, setPlanos] = useState([])
    const [categorias, setCategorias] = useState([])
    const [linhas, setLinhas] = useState([])

    const [termoBusca, setTermoBusca] = useState('')
    const [edicaoAtiva, setEdicaoAtiva] = useState(false)
    const [loading, setLoading] = useState(false)
    const [erroDetalhe, setErroDetalhe] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})
    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)
    const [scrollTopoPorCategoria, setScrollTopoPorCategoria] = useState({})
    const [adicionarNovoAtivo, setAdicionarNovoAtivo] = useState(false)
    const [modoCategorias, setModoCategorias] = useState(false)
    /** 'procedimentos' | 'descontos' — switch no estilo Quem Realiza */
    const [modoCatalogo, setModoCatalogo] = useState('procedimentos')
    const modoDescontos = modoCatalogo === 'descontos'
    const [limitesGrupoRows, setLimitesGrupoRows] = useState([])
    const [edicoesLimiteGrupo, setEdicoesLimiteGrupo] = useState({})
    const [edicoesNomeCategoria, setEdicoesNomeCategoria] = useState({})
    const [adicionarCategoriaAtivo, setAdicionarCategoriaAtivo] = useState(false)
    const [novaCategoriaNome, setNovaCategoriaNome] = useState('')
    const [ordenacaoCategorias, setOrdenacaoCategorias] = useState({ coluna: 'id', direcao: 'asc' })
    const [novoProcedimento, setNovoProcedimento] = useState({
        codigo: '',
        nome: '',
        categoriaId: '',
        planoBaseChave: 'basico',
    })

    const mapaPlanos = useMemo(() => mapearPlanos(planos), [planos])

    const limitesGrupoPorCategoria = useMemo(
        () => montarLimitesGrupoPorCategoriaEChavePlano(limitesGrupoRows, mapaPlanos),
        [limitesGrupoRows, mapaPlanos]
    )

    const contagemProcedimentosPorCategoria = useMemo(() => {
        const mapa = new Map()
        linhas.forEach((linha) => {
            const id = Number(linha.categoriaId)
            if (!id) return
            mapa.set(id, (mapa.get(id) || 0) + 1)
        })
        return mapa
    }, [linhas])

    const planosChaveDisponiveisPorCategoria = useMemo(
        () => montarPlanosChaveDisponiveisPorCategoria(linhas, mapaPlanos, ORDEM_PLANOS),
        [linhas, mapaPlanos]
    )

    const categoriaPermiteLimiteGrupoNoPlano = (categoriaId, chavePlano) =>
        categoriaPermiteLimiteGrupoNaChavePlano(
            planosChaveDisponiveisPorCategoria,
            categoriaId,
            chavePlano,
            mapaPlanos
        )

    const mostrarErroToast = (mensagem) => {
        setErroDetalhe('')
        setTimeout(() => setErroDetalhe(mensagem), 0)
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

    const planoBasePorQuantidade = (quantidadePlanos) => {
        if (quantidadePlanos >= 4) return 'basico'
        if (quantidadePlanos === 3) return 'classico'
        if (quantidadePlanos === 2) return 'avancado'
        return 'ultra'
    }

    const obterChavePlanoPorIdLocal = (planoId, mapaPlanosLocal) => obterChavePlanoPorId(planoId, mapaPlanosLocal)

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: planosData, error: errPlanos },
                { data: categoriasData, error: errCategorias },
                { data: procedimentosData, error: errProcedimentos },
                { data: planosCidadeData, error: errPlanosCidade },
                resultadoLimitesGrupo,
            ] = await Promise.all([
                supabase.from('planos').select('id, nome').order('id', { ascending: true }),
                supabase.from('categorias').select('id, nome, usa_limite_grupo').gte('id', 3).order('id', { ascending: true }),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('codigo, nome, categoria_id, plano_base_id, publicado_formulario')
                        .order('codigo', { ascending: true })
                ),
                buscarTodosPaginado(() =>
                    supabase.from('planos_cidade').select('procedimento_cod, plano_id')
                ),
                buscarCategoriaLimitesGrupo(supabase),
            ])

            const errLimitesGrupo = resultadoLimitesGrupo?.error
            if (errLimitesGrupo && !isMissingCategoriaLimitesGrupoTable(errLimitesGrupo)) {
                setErroDetalhe(`Erro ao carregar limites de grupo: ${errLimitesGrupo.message}`)
            }
            setLimitesGrupoRows(resultadoLimitesGrupo?.data || [])

            if (errPlanos || errCategorias || errProcedimentos || errPlanosCidade) {
                const detalhes = [errPlanos?.message, errCategorias?.message, errProcedimentos?.message, errPlanosCidade?.message]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao carregar dados base: ${detalhes}`)
                return
            }

            const listaPlanos = planosData || []
            const listaProcedimentos = procedimentosData || []
            const mapaPlanosLocal = mapearPlanos(listaPlanos)
            const idsPlanosMapeados = ORDEM_PLANOS_BASE_PROCEDIMENTOS
                .map((chave) => mapaPlanosLocal[chave]?.id)
                .filter(Boolean)
                .map((id) => Number(id))

            const mapaQuantidadePlanosPorProcedimento = new Map()
            ;(planosCidadeData || []).forEach((item) => {
                const codigo = String(item.procedimento_cod || '').toUpperCase()
                const planoId = Number(item.plano_id)
                if (!codigo || !idsPlanosMapeados.includes(planoId)) return
                if (!mapaQuantidadePlanosPorProcedimento.has(codigo)) {
                    mapaQuantidadePlanosPorProcedimento.set(codigo, new Set())
                }
                mapaQuantidadePlanosPorProcedimento.get(codigo).add(planoId)
            })

            const linhasMontadas = listaProcedimentos.map((item) => {
                const codigo = String(item.codigo || '').toUpperCase()
                const quantidadePlanos = mapaQuantidadePlanosPorProcedimento.get(codigo)?.size || 1
                const chavePorPlanoBase = obterChavePlanoPorIdLocal(item.plano_base_id, mapaPlanosLocal)
                return {
                    rowId: `proc-${codigo}`,
                    codigo,
                    codigoBanco: codigo,
                    procedimento: String(item.nome || codigo),
                    categoriaId: item.categoria_id != null ? Number(item.categoria_id) : null,
                    planoBaseChave: chavePorPlanoBase || planoBasePorQuantidade(quantidadePlanos),
                    publicadoFormulario: Boolean(item.publicado_formulario),
                }
            })

            setPlanos(listaPlanos)
            setCategorias(
                (categoriasData || []).map((item) => ({
                    ...item,
                    usa_limite_grupo: Boolean(item.usa_limite_grupo),
                }))
            )
            setLinhas(linhasMontadas)
        } catch (error) {
            setErroDetalhe(`Falha ao carregar dados base: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [])

    const linhasFiltradas = useMemo(() => {
        if (!termoBusca.trim() && !buscaNotAtiva) return linhas
        return linhas.filter((linha) => {
            const categoriaNome = categorias.find((c) => Number(c.id) === Number(linha.categoriaId))?.nome || ''
            const planoNome = ROTULO_PLANO[linha.planoBaseChave] || ''
            const blob = normalizarTextoBuscaDev(
                [
                    linha.codigo,
                    linha.procedimento,
                    categoriaNome,
                    planoNome,
                    linha.publicadoFormulario ? 'formulario sim' : 'formulario nao',
                ]
                    .filter(Boolean)
                    .join(' '),
            )
            return filtrarPorTermoBusca(blob, termoBusca, buscaNotAtiva)
        })
    }, [linhas, termoBusca, categorias, buscaNotAtiva])

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
        const atual = ordenacaoPorCategoria[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
        const fator = atual.direcao === 'asc' ? 1 : -1
        const resultado = [...linhasParaOrdenar]
        resultado.sort((a, b) => {
            const valorA = a[atual.coluna]
            const valorB = b[atual.coluna]
            if (typeof valorA === 'boolean' || typeof valorB === 'boolean') {
                return (Number(Boolean(valorA)) - Number(Boolean(valorB))) * fator
            }
            return String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })
        return resultado
    }

    const secoesPorCategoria = useMemo(
        () =>
            categorias
                .map((categoria) => ({
                    categoriaId: categoria.id,
                    categoriaNome: categoria.nome,
                    linhas: ordenarLinhas(
                        linhasFiltradas.filter((linha) => Number(linha.categoriaId) === Number(categoria.id)),
                        categoria.id
                    ),
                }))
                .filter((secao) => secao.linhas.length > 0),
        [categorias, linhasFiltradas, ordenacaoPorCategoria]
    )

    const linhasTabelaCategorias = useMemo(() => {
        const termo = normalizarTextoBusca(termoBusca)
        let lista = categorias.map((categoria) => {
            const id = Number(categoria.id)
            const limites = limitesGrupoPorCategoria.get(id) || {
                basico: '',
                classico: '',
                avancado: '',
                ultra: '',
            }
            return {
                categoriaId: id,
                nome: categoria.nome,
                quantidadeProcedimentos: contagemProcedimentosPorCategoria.get(id) || 0,
                usaLimiteGrupo: Boolean(categoria.usa_limite_grupo),
                limitesGrupo: limites,
            }
        })

        if (termo || buscaNotAtiva) {
            lista = lista.filter((linha) => {
                const blob = normalizarTextoBuscaDev(
                    [linha.categoriaId, linha.nome, linha.quantidadeProcedimentos].join(' ')
                )
                return filtrarPorTermoBusca(blob, termoBusca, buscaNotAtiva)
            })
        }

        const { coluna, direcao } = ordenacaoCategorias
        const fator = direcao === 'asc' ? 1 : -1
        lista.sort((a, b) => {
            if (coluna === 'quantidadeProcedimentos') {
                return (a.quantidadeProcedimentos - b.quantidadeProcedimentos) * fator
            }
            if (coluna === 'id') {
                return (a.categoriaId - b.categoriaId) * fator
            }
            return String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })

        return lista
    }, [
        categorias,
        contagemProcedimentosPorCategoria,
        limitesGrupoPorCategoria,
        termoBusca,
        buscaNotAtiva,
        ordenacaoCategorias,
    ])

    const chaveEdicaoLimiteGrupo = (categoriaId, chavePlano) => `${categoriaId}-${chavePlano}`

    const obterValorLimiteGrupoInput = (categoriaId, chavePlano) => {
        const chave = chaveEdicaoLimiteGrupo(categoriaId, chavePlano)
        if (Object.prototype.hasOwnProperty.call(edicoesLimiteGrupo, chave)) {
            return edicoesLimiteGrupo[chave]
        }
        const bucket = limitesGrupoPorCategoria.get(Number(categoriaId))
        return bucket?.[chavePlano] ?? ''
    }

    const obterValorNomeCategoriaInput = (categoriaId, nomeAtual) => {
        const chave = `nome-${categoriaId}`
        if (Object.prototype.hasOwnProperty.call(edicoesNomeCategoria, chave)) {
            return edicoesNomeCategoria[chave]
        }
        return nomeAtual ?? ''
    }

    const handleOrdenarTabelaCategorias = (coluna) => {
        setOrdenacaoCategorias((anterior) =>
            anterior.coluna === coluna
                ? { coluna, direcao: anterior.direcao === 'asc' ? 'desc' : 'asc' }
                : { coluna, direcao: 'asc' }
        )
    }

    const indicadorOrdenacaoCategorias = (coluna) => {
        if (ordenacaoCategorias.coluna !== coluna) return ''
        return ordenacaoCategorias.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    const salvarLimiteGrupoCategoriaCampo = async (categoriaId, chavePlano) => {
        if (!categoriaPermiteLimiteGrupoNoPlano(categoriaId, chavePlano)) return

        const chave = chaveEdicaoLimiteGrupo(categoriaId, chavePlano)
        if (!Object.prototype.hasOwnProperty.call(edicoesLimiteGrupo, chave)) return

        const planoId = mapaPlanos[chavePlano]?.id
        if (!planoId) {
            mostrarErroToast(`Plano «${ROTULO_PLANO[chavePlano]}» não encontrado na base.`)
            return
        }

        const valor = edicoesLimiteGrupo[chave]
        const { error } = await salvarLimiteGrupoCategoria(supabase, {
            categoriaId,
            planoId,
            limite: valor,
        })

        if (error) {
            if (isMissingCategoriaLimitesGrupoTable(error)) {
                mostrarErroToast('Tabela categoria_limites_grupo não existe. Execute o SQL em sql/categoria_limites_grupo.sql.')
            } else {
                mostrarErroToast(`Erro ao salvar limite de grupo: ${error.message}`)
            }
            return
        }

        setLimitesGrupoRows((anteriores) => {
            const catNum = Number(categoriaId)
            const planoNum = Number(planoId)
            const semPar = anteriores.filter(
                (row) => !(Number(row.categoria_id) === catNum && Number(row.plano_id) === planoNum)
            )
            const texto = String(valor ?? '').trim()
            if (!texto) return semPar
            return [...semPar, { categoria_id: catNum, plano_id: planoNum, limite: texto }]
        })

        setEdicoesLimiteGrupo((anterior) => {
            const copia = { ...anterior }
            delete copia[chave]
            return copia
        })
    }

    const salvarNomeCategoria = async (categoriaId, nomeAnterior) => {
        const chave = `nome-${categoriaId}`
        if (!Object.prototype.hasOwnProperty.call(edicoesNomeCategoria, chave)) return

        const nomeNovo = String(edicoesNomeCategoria[chave] ?? '').trim()
        if (!nomeNovo) {
            setEdicoesNomeCategoria((anterior) => {
                const copia = { ...anterior }
                delete copia[chave]
                return copia
            })
            mostrarErroToast('O nome da categoria não pode ficar vazio.')
            return
        }

        if (nomeNovo === nomeAnterior) {
            setEdicoesNomeCategoria((anterior) => {
                const copia = { ...anterior }
                delete copia[chave]
                return copia
            })
            return
        }

        const { error } = await supabase.from('categorias').update({ nome: nomeNovo }).eq('id', categoriaId)
        if (error) {
            mostrarErroToast(`Erro ao atualizar categoria: ${error.message}`)
            return
        }

        setCategorias((anteriores) =>
            anteriores.map((item) => (Number(item.id) === Number(categoriaId) ? { ...item, nome: nomeNovo } : item))
        )
        setEdicoesNomeCategoria((anterior) => {
            const copia = { ...anterior }
            delete copia[chave]
            return copia
        })
    }

    const atualizarUsaLimiteGrupoCategoria = async (categoriaId, valor) => {
        if (valor && !somenteLeitura) {
            setEdicaoAtiva(true)
        }

        const anterior = categorias.find((item) => Number(item.id) === Number(categoriaId))?.usa_limite_grupo
        setCategorias((prev) =>
            prev.map((item) =>
                Number(item.id) === Number(categoriaId) ? { ...item, usa_limite_grupo: valor } : item
            )
        )

        const { error } = await supabase
            .from('categorias')
            .update({ usa_limite_grupo: valor })
            .eq('id', categoriaId)

        if (error) {
            setCategorias((prev) =>
                prev.map((item) =>
                    Number(item.id) === Number(categoriaId) ? { ...item, usa_limite_grupo: anterior } : item
                )
            )
            const msg = String(error.message || '')
            if (msg.toLowerCase().includes('usa_limite_grupo')) {
                mostrarErroToast(
                    'Coluna usa_limite_grupo ausente. Execute o trecho ALTER TABLE em sql/categoria_limites_grupo.sql.'
                )
            } else {
                mostrarErroToast(`Erro ao atualizar tipo de limite: ${error.message}`)
            }
        }
    }

    const inserirNovaCategoria = async () => {
        const nome = String(novaCategoriaNome || '').trim()
        if (!nome) {
            mostrarErroToast('Informe o nome da nova categoria.')
            return
        }

        setLoading(true)
        try {
            const { data: ultima, error: errUltima } = await supabase
                .from('categorias')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (errUltima) {
                mostrarErroToast(`Erro ao gerar ID da categoria: ${errUltima.message}`)
                return
            }

            const proximoId = (ultima?.id ? Number(ultima.id) : 2) + 1
            const { error: errInsert } = await supabase.from('categorias').insert({ id: proximoId, nome })
            if (errInsert) {
                mostrarErroToast(`Erro ao criar categoria: ${errInsert.message}`)
                return
            }

            setNovaCategoriaNome('')
            setAdicionarCategoriaAtivo(false)
            await carregarBase()
        } catch (error) {
            mostrarErroToast(`Falha ao criar categoria: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    const atualizarPublicadoFormulario = async (linha, valor) => {
        const anterior = Boolean(linha.publicadoFormulario)
        setLinhas((prev) =>
            prev.map((item) =>
                item.rowId === linha.rowId ? { ...item, publicadoFormulario: valor } : item,
            ),
        )
        const { error } = await supabase
            .from('procedimentos')
            .update({ publicado_formulario: valor })
            .eq('codigo', linha.codigoBanco)
        if (error) {
            setLinhas((prev) =>
                prev.map((item) =>
                    item.rowId === linha.rowId ? { ...item, publicadoFormulario: anterior } : item,
                ),
            )
            mostrarErroToast(`Erro ao atualizar formulário: ${error.message}`)
        }
    }

    const atualizarCategoriaProcedimento = async (linha, novaCategoriaId) => {
        const categoriaIdNumerico = novaCategoriaId ? Number(novaCategoriaId) : null
        const valorAnterior = linha.categoriaId

        setLinhas((anteriores) =>
            anteriores.map((item) =>
                item.codigo === linha.codigo ? { ...item, categoriaId: categoriaIdNumerico } : item
            )
        )

        const { error } = await supabase
            .from('procedimentos')
            .update({ categoria_id: categoriaIdNumerico })
            .eq('codigo', linha.codigo)

        if (!error) return

        setLinhas((anteriores) =>
            anteriores.map((item) =>
                item.codigo === linha.codigo ? { ...item, categoriaId: valorAnterior } : item
            )
        )
        mostrarErroToast(`Erro ao atualizar categoria: ${error.message}`)
    }

    const atualizarCampoLinha = (rowId, campo, valor) => {
        setLinhas((anteriores) =>
            anteriores.map((item) =>
                item.rowId === rowId ? { ...item, [campo]: valor } : item
            )
        )
    }

    const salvarNomeProcedimento = async (linha) => {
        const nomeNovo = String(linha.procedimento || '').trim()
        if (!nomeNovo) {
            await carregarBase()
            mostrarErroToast('O nome do procedimento não pode ficar vazio.')
            return
        }

        const { error } = await supabase
            .from('procedimentos')
            .update({ nome: nomeNovo })
            .eq('codigo', linha.codigoBanco)

        if (!error) return

        mostrarErroToast(`Erro ao atualizar nome: ${error.message}`)
        await carregarBase()
    }

    const salvarCodigoProcedimento = async (linha) => {
        const codigoNovo = normalizarCodigo(linha.codigo)
        const codigoAtualBanco = normalizarCodigo(linha.codigoBanco)

        if (!codigoNovo) {
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            mostrarErroToast('O código do procedimento não pode ficar vazio.')
            return
        }

        if (codigoNovo === codigoAtualBanco) {
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            return
        }

        const { data: existente, error: errExiste } = await supabase
            .from('procedimentos')
            .select('codigo')
            .eq('codigo', codigoNovo)
            .maybeSingle()

        if (errExiste) {
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            mostrarErroToast(`Erro ao validar código: ${errExiste.message}`)
            return
        }

        if (existente) {
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            mostrarErroToast(`Já existe um procedimento com o código ${codigoNovo}.`)
            return
        }

        const { error: errProc } = await supabase
            .from('procedimentos')
            .update({ codigo: codigoNovo })
            .eq('codigo', codigoAtualBanco)

        if (errProc) {
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            mostrarErroToast(`Erro ao atualizar código: ${errProc.message}`)
            return
        }

        const acoes = [
            () => supabase.from('repasses').update({ procedimento_id: codigoNovo }).eq('procedimento_id', codigoAtualBanco),
            () => supabase.from('planos_cidade').update({ procedimento_cod: codigoNovo }).eq('procedimento_cod', codigoAtualBanco),
            () => supabase.from('planos_config').update({ procedimento: codigoNovo }).eq('procedimento', codigoAtualBanco),
        ]

        for (let i = 0; i < acoes.length; i += 1) {
            const { error } = await acoes[i]()
            if (!error) continue

            // Tenta voltar o código principal caso alguma atualização relacionada falhe.
            await supabase.from('procedimentos').update({ codigo: codigoAtualBanco }).eq('codigo', codigoNovo)
            atualizarCampoLinha(linha.rowId, 'codigo', codigoAtualBanco)
            mostrarErroToast(`Erro ao propagar novo código: ${error.message}`)
            return
        }

        setLinhas((anteriores) =>
            anteriores.map((item) =>
                item.rowId === linha.rowId
                    ? { ...item, codigo: codigoNovo, codigoBanco: codigoNovo }
                    : item
            )
        )
    }

    const atualizarPlanoBaseProcedimento = async (linha, novaChavePlanoBase) => {
        const chaveAnterior = linha.planoBaseChave
        if (!ORDEM_PLANOS_BASE_PROCEDIMENTOS.includes(novaChavePlanoBase)) return
        const planoBaseId = Number(mapaPlanos[novaChavePlanoBase]?.id || 0)
        const planoBaseAnteriorId = Number(mapaPlanos[chaveAnterior]?.id || 0)
        if (!planoBaseId) {
            mostrarErroToast(
                novaChavePlanoBase === CHAVE_PLANO_APENAS_LOJA
                    ? 'Plano «Apenas loja» não encontrado na tabela de planos. Cadastre um plano com esse nome.'
                    : 'Não foi possível mapear o plano base selecionado.',
            )
            return
        }

        const planoIdsPermitidos = obterPlanoIdsPermitidosDesdeChaveBase(novaChavePlanoBase, mapaPlanos)

        if (planoIdsPermitidos.length === 0) {
            mostrarErroToast('Não foi possível mapear os planos para aplicar o plano base.')
            return
        }

        setLinhas((anteriores) =>
            anteriores.map((item) =>
                item.codigo === linha.codigo ? { ...item, planoBaseChave: novaChavePlanoBase } : item
            )
        )

        const { error: errPlanoBase } = await supabase
            .from('procedimentos')
            .update({ plano_base_id: planoBaseId })
            .eq('codigo', linha.codigo)

        if (errPlanoBase) {
            setLinhas((anteriores) =>
                anteriores.map((item) =>
                    item.codigo === linha.codigo ? { ...item, planoBaseChave: chaveAnterior } : item
                )
            )
            mostrarErroToast(`Erro ao salvar plano base: ${errPlanoBase.message}`)
            return
        }

        const { data: registros, error: errBuscar } = await supabase
            .from('planos_cidade')
            .select('id, plano_id, cidade_id')
            .eq('procedimento_cod', linha.codigo)

        if (errBuscar) {
            if (planoBaseAnteriorId) {
                await supabase.from('procedimentos').update({ plano_base_id: planoBaseAnteriorId }).eq('codigo', linha.codigo)
            }
            setLinhas((anteriores) =>
                anteriores.map((item) =>
                    item.codigo === linha.codigo ? { ...item, planoBaseChave: chaveAnterior } : item
                )
            )
            mostrarErroToast(`Erro ao aplicar plano base: ${errBuscar.message}`)
            return
        }

        const listaRegistros = registros || []
        const idsExcluir = listaRegistros
            .filter((item) => !planoIdsPermitidos.includes(Number(item.plano_id)))
            .map((item) => Number(item.id))

        if (idsExcluir.length > 0) {
            const { error: errExcluir } = await supabase.from('planos_cidade').delete().in('id', idsExcluir)
            if (errExcluir) {
                if (planoBaseAnteriorId) {
                    await supabase.from('procedimentos').update({ plano_base_id: planoBaseAnteriorId }).eq('codigo', linha.codigo)
                }
                setLinhas((anteriores) =>
                    anteriores.map((item) =>
                        item.codigo === linha.codigo ? { ...item, planoBaseChave: chaveAnterior } : item
                    )
                )
                mostrarErroToast(`Erro ao atualizar plano base: ${errExcluir.message}`)
                return
            }
        }

        const agrupadoPorOrigem = new Map()
        listaRegistros.forEach((item) => {
            const cidadeIdRow = item.cidade_id != null ? Number(item.cidade_id) : null
            if (cidadeIdRow == null) return
            const chaveOrigem = `C-${cidadeIdRow}`
            if (!agrupadoPorOrigem.has(chaveOrigem)) {
                agrupadoPorOrigem.set(chaveOrigem, {
                    cidade_id: cidadeIdRow,
                    planos: new Set(),
                })
            }
            agrupadoPorOrigem.get(chaveOrigem).planos.add(Number(item.plano_id))
        })

        const payloadInsercao = []
        agrupadoPorOrigem.forEach((origem) => {
            planoIdsPermitidos.forEach((planoId) => {
                if (origem.planos.has(planoId)) return
                payloadInsercao.push({
                    cidade_id: origem.cidade_id,
                    plano_id: planoId,
                    procedimento_cod: linha.codigo,
                    diferenca: 0,
                })
            })
        })

        if (payloadInsercao.length > 0) {
            const { error: errInserir } = await upsertPlanosCidadeCompat(supabase, payloadInsercao, {
                cidadeId: payloadInsercao[0]?.cidade_id,
            })
            if (errInserir) {
                if (planoBaseAnteriorId) {
                    await supabase.from('procedimentos').update({ plano_base_id: planoBaseAnteriorId }).eq('codigo', linha.codigo)
                }
                setLinhas((anteriores) =>
                    anteriores.map((item) =>
                        item.codigo === linha.codigo ? { ...item, planoBaseChave: chaveAnterior } : item
                    )
                )
                mostrarErroToast(`Erro ao complementar plano base: ${errInserir.message}`)
                return
            }
        }
    }

    const excluirProcedimento = async (linha, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error: errRepasses } = await supabase.from('repasses').delete().eq('procedimento_id', linha.codigo)
            if (errRepasses) {
                mostrarErroToast(`Erro ao remover repasses: ${errRepasses.message}`)
                return
            }

            const { error: errPlanosCidade } = await supabase
                .from('planos_cidade')
                .delete()
                .eq('procedimento_cod', linha.codigo)
            if (errPlanosCidade) {
                mostrarErroToast(`Erro ao remover vínculos de plano: ${errPlanosCidade.message}`)
                return
            }

            const { error: errPlanosConfig } = await supabase.from('planos_config').delete().eq('procedimento', linha.codigo)
            if (errPlanosConfig) {
                mostrarErroToast(`Erro ao remover limitações do plano: ${errPlanosConfig.message}`)
                return
            }

            const { error: errProcedimento } = await supabase.from('procedimentos').delete().eq('codigo', linha.codigo)
            if (errProcedimento) {
                mostrarErroToast(`Erro ao excluir procedimento: ${errProcedimento.message}`)
                return
            }

            setLinhas((anteriores) => anteriores.filter((item) => item.codigo !== linha.codigo))
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(
            `Excluir o procedimento ${linha.codigo} e todos os vínculos relacionados?`,
            executarExclusao
        )
    }

    const inserirNovoProcedimento = async () => {
        const codigo = normalizarCodigo(novoProcedimento.codigo)
        const nome = String(novoProcedimento.nome || '').trim()
        const categoriaId = Number(novoProcedimento.categoriaId || categorias[0]?.id || 0)
        const planoBaseId = Number(mapaPlanos[novoProcedimento.planoBaseChave]?.id || 0)

        if (!codigo || !nome) {
            mostrarErroToast('Preencha código e nome para adicionar o procedimento.')
            return
        }
        if (!categoriaId) {
            mostrarErroToast('Selecione uma categoria válida.')
            return
        }
        if (!planoBaseId) {
            mostrarErroToast('Selecione um plano base válido.')
            return
        }

        setLoading(true)
        try {
            const { data: existente, error: errExistente } = await supabase
                .from('procedimentos')
                .select('codigo')
                .eq('codigo', codigo)
                .maybeSingle()

            if (errExistente) {
                mostrarErroToast(`Erro ao validar código existente: ${errExistente.message}`)
                return
            }
            if (existente?.codigo) {
                mostrarErroToast(`O código ${codigo} já existe.`)
                return
            }

            const { error: errInsercao } = await supabase.from('procedimentos').insert({
                codigo,
                nome,
                categoria_id: categoriaId,
                plano_base_id: planoBaseId,
                publicado_formulario: false,
            })
            if (errInsercao) {
                mostrarErroToast(`Erro ao inserir procedimento: ${errInsercao.message}`)
                return
            }

            setNovoProcedimento({
                codigo: '',
                nome: '',
                categoriaId: String(categoriaId),
                planoBaseChave: novoProcedimento.planoBaseChave,
            })
            await carregarBase()
        } catch (error) {
            mostrarErroToast(`Falha ao inserir procedimento: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        carregarBase()
    }, [carregarBase])

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

    useEffect(() => {
        if (!categorias.length) return
        setNovoProcedimento((anterior) =>
            anterior.categoriaId
                ? anterior
                : { ...anterior, categoriaId: String(categorias[0].id) }
        )
    }, [categorias])

    return (
        <div
            className={`supertabelaprocedimentos ${modoCategorias && !modoDescontos ? 'is-modo-categorias' : ''}`}
        >
            <h1>Supertabela - Procedimentos</h1>
            <hr />

            <div className="supertabelaprocedimentos_catalogo_modo" role="tablist" aria-label="Catálogo">
                <button
                    type="button"
                    role="tab"
                    aria-selected={!modoDescontos}
                    className={`supertabelaprocedimentos_catalogo_modo_btn ${!modoDescontos ? 'is-on' : ''}`}
                    onClick={() => setModoCatalogo('procedimentos')}
                >
                    Procedimentos
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={modoDescontos}
                    className={`supertabelaprocedimentos_catalogo_modo_btn ${modoDescontos ? 'is-on' : ''}`}
                    onClick={() => {
                        setModoCatalogo('descontos')
                        setModoCategorias(false)
                    }}
                >
                    Descontos
                </button>
            </div>

            <header className={`supertabelaprocedimentos_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='supertabelaprocedimentos_filters'>
                    <div className='supertabelaprocedimentos_filter_item supertabelaprocedimentos_filter_busca'>
                        <p>Busca</p>
                        <input
                            type='text'
                            className='supertabelaprocedimentos_input'
                            placeholder={
                                modoDescontos
                                    ? 'Código, tipo ou grupo de desconto'
                                    : modoCategorias
                                      ? 'ID, nome da categoria ou quantidade de procedimentos'
                                      : 'Código, procedimento, plano base ou categoria'
                            }
                            value={termoBusca}
                            onChange={(event) => setTermoBusca(event.target.value)}
                        />
                    </div>

                    {!modoDescontos ? (
                    <div className='supertabelaprocedimentos_filter_item supertabelaprocedimentos_filter_mode'>
                        <p className='supertabelaprocedimentos_filter_mode_label'>Visualização</p>
                        <div
                            className='supertabelaprocedimentos_mode_rail'
                            role='group'
                            aria-label='Tipo de visualização'
                        >
                            <span
                                className={`supertabelaprocedimentos_mode_thumb ${modoCategorias ? 'is-right' : 'is-left'}`}
                                aria-hidden
                            />
                            <button
                                type='button'
                                className={`supertabelaprocedimentos_mode_btn ${!modoCategorias ? 'is-active' : ''}`}
                                onClick={() => setModoCategorias(false)}
                            >
                                Procedimentos
                            </button>
                            <button
                                type='button'
                                className={`supertabelaprocedimentos_mode_btn ${modoCategorias ? 'is-active' : ''}`}
                                onClick={() => setModoCategorias(true)}
                            >
                                Categorias
                            </button>
                        </div>
                    </div>
                    ) : null}

                    {!somenteLeitura && (
                        <label className='supertabelaprocedimentos_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={edicaoAtiva}
                                onChange={(event) => setEdicaoAtiva(event.target.checked)}
                            />
                            <span>Ativar edição</span>
                        </label>
                    )}

                    {!somenteLeitura && (
                        <label className='supertabelaprocedimentos_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={adicionarNovoAtivo}
                                onChange={(event) => setAdicionarNovoAtivo(event.target.checked)}
                                disabled={!modoDescontos && modoCategorias}
                            />
                            <span>Adicionar novo</span>
                        </label>
                    )}

                    {!somenteLeitura && modoCategorias && !modoDescontos && (
                        <label className='supertabelaprocedimentos_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={adicionarCategoriaAtivo}
                                onChange={(event) => setAdicionarCategoriaAtivo(event.target.checked)}
                            />
                            <span>Nova categoria</span>
                        </label>
                    )}
                </div>

                {adicionarCategoriaAtivo && modoCategorias && !modoDescontos && (
                    <div className='supertabelaprocedimentos_massa_wrap'>
                        <p>Adicionar categoria</p>
                        <div className='supertabelaprocedimentos_massa_form'>
                            <div className='supertabelaprocedimentos_novo_grid supertabelaprocedimentos_novo_grid_cat'>
                                <input
                                    type='text'
                                    className='supertabelaprocedimentos_input'
                                    placeholder='Nome da categoria'
                                    value={novaCategoriaNome}
                                    onChange={(event) => setNovaCategoriaNome(event.target.value)}
                                />
                            </div>
                            <button
                                type='button'
                                className='supertabelaprocedimentos_massa_btn'
                                onClick={inserirNovaCategoria}
                                disabled={loading}
                            >
                                Criar categoria
                            </button>
                        </div>
                    </div>
                )}

                {adicionarNovoAtivo && !modoCategorias && !modoDescontos && (
                    <div className='supertabelaprocedimentos_massa_wrap'>
                        <p>Adicionar novo procedimento</p>
                        <div className='supertabelaprocedimentos_massa_form'>
                            <div className='supertabelaprocedimentos_novo_grid'>
                                <input
                                    type='text'
                                    className='supertabelaprocedimentos_input'
                                    placeholder='Código (ex.: CONS-001)'
                                    value={novoProcedimento.codigo}
                                    onChange={(event) =>
                                        setNovoProcedimento((anterior) => ({
                                            ...anterior,
                                            codigo: normalizarCodigo(event.target.value),
                                        }))
                                    }
                                />
                                <input
                                    type='text'
                                    className='supertabelaprocedimentos_input'
                                    placeholder='Nome do procedimento'
                                    value={novoProcedimento.nome}
                                    onChange={(event) =>
                                        setNovoProcedimento((anterior) => ({
                                            ...anterior,
                                            nome: event.target.value,
                                        }))
                                    }
                                />
                                <select
                                    className='supertabelaprocedimentos_input'
                                    value={novoProcedimento.categoriaId}
                                    onChange={(event) =>
                                        setNovoProcedimento((anterior) => ({
                                            ...anterior,
                                            categoriaId: event.target.value,
                                        }))
                                    }
                                >
                                    {categorias.map((categoria) => (
                                        <option key={`novo-cat-${categoria.id}`} value={categoria.id}>
                                            {categoria.nome}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className='supertabelaprocedimentos_input'
                                    value={novoProcedimento.planoBaseChave}
                                    onChange={(event) =>
                                        setNovoProcedimento((anterior) => ({
                                            ...anterior,
                                            planoBaseChave: event.target.value,
                                        }))
                                    }
                                >
                                    {ORDEM_PLANOS_BASE_PROCEDIMENTOS.map((chavePlano) => (
                                        <option key={`novo-plano-${chavePlano}`} value={chavePlano}>
                                            {ROTULO_PLANO[chavePlano]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type='button'
                                className='supertabelaprocedimentos_massa_btn'
                                onClick={inserirNovoProcedimento}
                            >
                                Adicionar novo procedimento
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {erroDetalhe && (
                <div className='supertabelaprocedimentos_alert' role='alert' aria-live='assertive'>
                    <div className='supertabelaprocedimentos_alert_text'>
                        <strong>Aviso</strong>
                        <span>{erroDetalhe}</span>
                    </div>
                    <button
                        type='button'
                        className='supertabelaprocedimentos_alert_close'
                        onClick={() => setErroDetalhe('')}
                        aria-label='Fechar aviso'
                    >
                        x
                    </button>
                </div>
            )}

            {confirmacaoExclusao && (
                <div className='supertabelaprocedimentos_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div className='supertabelaprocedimentos_confirm_text'>
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className='supertabelaprocedimentos_confirm_actions'>
                        <button
                            type='button'
                            className='supertabelaprocedimentos_confirm_btn danger'
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
                            className='supertabelaprocedimentos_confirm_btn'
                            onClick={() => setConfirmacaoExclusao(null)}
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            <div
                className={`supertabelaprocedimentos_table_container ${
                    modoCategorias && !modoDescontos ? 'is-categorias-full' : ''
                }`}
            >
                {modoDescontos ? (
                    <SupertabelaBeneficiosCatalogo
                        somenteLeitura={somenteLeitura}
                        edicaoAtiva={edicaoAtiva}
                        adicionarNovoAtivo={adicionarNovoAtivo}
                        termoBusca={termoBusca}
                        onErro={mostrarErroToast}
                    />
                ) : loading ? (
                    <p>Carregando...</p>
                ) : modoCategorias ? (
                    linhasTabelaCategorias.length === 0 ? (
                        <p>Nenhuma categoria encontrada com os filtros atuais.</p>
                    ) : (
                        <section className='categoria_secao supertabelaprocedimentos_categorias_secao'>
                            <h2 className='categoria_titulo'>Categorias de procedimentos</h2>
                            <table
                                className={`table_main supertabelaprocedimentos_categorias_table ${
                                    edicaoAtiva ? 'is-editing' : ''
                                }`}
                            >
                                <colgroup>
                                    <col style={{ width: '4%' }} />
                                    <col style={{ width: '35%' }} />
                                    <col style={{ width: '9%' }} />
                                    <col style={{ width: '12%' }} />
                                    {ORDEM_PLANOS.map((chave) => (
                                        <col key={`col-lim-${chave}`} style={{ width: '10%' }} />
                                    ))}
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th
                                            className='table_header'
                                            onClick={() => handleOrdenarTabelaCategorias('id')}
                                        >
                                            ID{indicadorOrdenacaoCategorias('id')}
                                        </th>
                                        <th
                                            className='table_header'
                                            onClick={() => handleOrdenarTabelaCategorias('nome')}
                                        >
                                            Categoria{indicadorOrdenacaoCategorias('nome')}
                                        </th>
                                        <th
                                            className='table_header supertabelaprocedimentos_col_center'
                                            onClick={() => handleOrdenarTabelaCategorias('quantidadeProcedimentos')}
                                        >
                                            Procedimentos{indicadorOrdenacaoCategorias('quantidadeProcedimentos')}
                                        </th>
                                        <th className='table_header table_header_no_sort supertabelaprocedimentos_col_center'>
                                            Tipo de limite
                                        </th>
                                        {ORDEM_PLANOS.map((chavePlano) => (
                                            <th key={`th-lim-${chavePlano}`} className='table_header table_header_no_sort'>
                                                <span className='supertabelaprocedimentos_th_stack'>
                                                    <span className='supertabelaprocedimentos_th_main'>Limite de grupo</span>
                                                    <span className='supertabelaprocedimentos_th_plan'>{ROTULO_PLANO[chavePlano]}</span>
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {linhasTabelaCategorias.map((linha) => (
                                        <tr
                                            key={`cat-row-${linha.categoriaId}`}
                                            className={!linha.usaLimiteGrupo ? 'is-limite-individual' : ''}
                                        >
                                            <td>{linha.categoriaId}</td>
                                            <td className='table_text_left'>
                                                {edicaoAtiva ? (
                                                    <input
                                                        className='table_cell_input_text supertabelaprocedimentos_categorias_input'
                                                        type='text'
                                                        value={obterValorNomeCategoriaInput(linha.categoriaId, linha.nome)}
                                                        onChange={(e) => {
                                                            const chave = `nome-${linha.categoriaId}`
                                                            setEdicoesNomeCategoria((a) => ({
                                                                ...a,
                                                                [chave]: e.target.value,
                                                            }))
                                                        }}
                                                        onBlur={() => salvarNomeCategoria(linha.categoriaId, linha.nome)}
                                                    />
                                                ) : (
                                                    linha.nome
                                                )}
                                            </td>
                                            <td className='supertabelaprocedimentos_col_center'>
                                                {linha.quantidadeProcedimentos}
                                            </td>
                                            <td className='supertabelaprocedimentos_col_tipo_limite supertabelaprocedimentos_col_center'>
                                                {somenteLeitura ? (
                                                    <span className='supertabelaprocedimentos_tipo_limite_label'>
                                                        {linha.usaLimiteGrupo ? 'Grupo' : 'Individual'}
                                                    </span>
                                                ) : (
                                                    <button
                                                        type='button'
                                                        role='switch'
                                                        aria-checked={linha.usaLimiteGrupo}
                                                        className={`supertabelaprocedimentos_form_switch supertabelaprocedimentos_limite_tipo_switch ${
                                                            linha.usaLimiteGrupo ? 'is-on' : 'is-off'
                                                        }`}
                                                        title={
                                                            linha.usaLimiteGrupo
                                                                ? 'Limite de grupo — clique para individual'
                                                                : 'Limite individual — clique para grupo'
                                                        }
                                                        onClick={() => {
                                                            void atualizarUsaLimiteGrupoCategoria(
                                                                linha.categoriaId,
                                                                !linha.usaLimiteGrupo
                                                            )
                                                        }}
                                                    >
                                                        <span className='supertabelaprocedimentos_form_switch_track'>
                                                            <span className='supertabelaprocedimentos_form_switch_knob' />
                                                        </span>
                                                        <span className='supertabelaprocedimentos_form_switch_label'>
                                                            {linha.usaLimiteGrupo ? 'Grupo' : 'Individual'}
                                                        </span>
                                                    </button>
                                                )}
                                            </td>
                                            {ORDEM_PLANOS.map((chavePlano) => {
                                                const planoDisponivel = categoriaPermiteLimiteGrupoNoPlano(
                                                    linha.categoriaId,
                                                    chavePlano
                                                )
                                                const celulaInativa =
                                                    !linha.usaLimiteGrupo || !planoDisponivel
                                                const valorLimite = linha.limitesGrupo[chavePlano] || ''

                                                return (
                                                <td
                                                    key={`lim-${linha.categoriaId}-${chavePlano}`}
                                                    className={
                                                        celulaInativa
                                                            ? 'supertabelaprocedimentos_limite_grupo_inativo'
                                                            : ''
                                                    }
                                                    title={
                                                        linha.usaLimiteGrupo && !planoDisponivel
                                                            ? `Nenhum procedimento desta categoria com plano base que inclua ${ROTULO_PLANO[chavePlano]}`
                                                            : undefined
                                                    }
                                                >
                                                    {!linha.usaLimiteGrupo ? (
                                                        <span className='supertabelaprocedimentos_limite_individual_muted'>—</span>
                                                    ) : !planoDisponivel ? (
                                                        <span className='supertabelaprocedimentos_limite_individual_muted'>—</span>
                                                    ) : edicaoAtiva ? (
                                                        <input
                                                            className='table_cell_input_text supertabelaprocedimentos_categorias_input supertabelaprocedimentos_categorias_input_limite'
                                                            type='text'
                                                            placeholder='—'
                                                            value={obterValorLimiteGrupoInput(linha.categoriaId, chavePlano)}
                                                            onChange={(e) => {
                                                                const chave = chaveEdicaoLimiteGrupo(
                                                                    linha.categoriaId,
                                                                    chavePlano
                                                                )
                                                                setEdicoesLimiteGrupo((a) => ({
                                                                    ...a,
                                                                    [chave]: e.target.value,
                                                                }))
                                                            }}
                                                            onBlur={() =>
                                                                salvarLimiteGrupoCategoriaCampo(linha.categoriaId, chavePlano)
                                                            }
                                                        />
                                                    ) : (
                                                        <span>{valorLimite || '\u00a0'}</span>
                                                    )}
                                                </td>
                                                )
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )
                ) : secoesPorCategoria.length === 0 ? (
                    <p>Nenhum procedimento encontrado com os filtros atuais.</p>
                ) : (
                    secoesPorCategoria.map((secao) => (
                        <section key={secao.categoriaId} className='categoria_secao'>
                            <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>
                            {(() => {
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
                                const colSpanProc = somenteLeitura ? 5 : 6
                                const colProcWidths = somenteLeitura
                                    ? ['10%', '36%', '14%', '16%', '12%']
                                    : ['10%', '30%', '13%', '15%', '12%', '8%']

                                const renderLinha = (linha) => (
                                    <tr key={linha.rowId}>
                                        <td className='table_text_left'>
                                            {edicaoAtiva ? (
                                                <input
                                                    type='text'
                                                    className='supertabelaprocedimentos_cell_input'
                                                    value={linha.codigo}
                                                    onChange={(event) =>
                                                        atualizarCampoLinha(linha.rowId, 'codigo', normalizarCodigo(event.target.value))
                                                    }
                                                    onBlur={() => salvarCodigoProcedimento(linha)}
                                                />
                                            ) : (
                                                linha.codigo
                                            )}
                                        </td>
                                        <td className='table_text_left'>
                                            {edicaoAtiva ? (
                                                <input
                                                    type='text'
                                                    className='supertabelaprocedimentos_cell_input'
                                                    value={linha.procedimento}
                                                    onChange={(event) =>
                                                        atualizarCampoLinha(linha.rowId, 'procedimento', event.target.value)
                                                    }
                                                    onBlur={() => salvarNomeProcedimento(linha)}
                                                />
                                            ) : (
                                                linha.procedimento
                                            )}
                                        </td>
                                        <td>
                                            {edicaoAtiva ? (
                                                <select
                                                    className='supertabelaprocedimentos_cell_select'
                                                    value={linha.planoBaseChave}
                                                    onChange={(event) =>
                                                        atualizarPlanoBaseProcedimento(linha, event.target.value)
                                                    }
                                                >
                                                    {ORDEM_PLANOS_BASE_PROCEDIMENTOS.map((chavePlano) => (
                                                        <option key={`${linha.codigo}-${chavePlano}`} value={chavePlano}>
                                                            {ROTULO_PLANO[chavePlano]}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                ROTULO_PLANO[linha.planoBaseChave]
                                            )}
                                        </td>
                                        <td>
                                            {edicaoAtiva ? (
                                                <select
                                                    className='supertabelaprocedimentos_cell_select'
                                                    value={linha.categoriaId ?? ''}
                                                    onChange={(event) =>
                                                        atualizarCategoriaProcedimento(linha, event.target.value)
                                                    }
                                                >
                                                    {categorias.map((categoria) => (
                                                        <option key={`${linha.codigo}-${categoria.id}`} value={categoria.id}>
                                                            {categoria.nome}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                categorias.find((categoria) => Number(categoria.id) === Number(linha.categoriaId))?.nome ||
                                                '-'
                                            )}
                                        </td>
                                        <td className='supertabelaprocedimentos_col_formulario'>
                                            {somenteLeitura ? (
                                                <span className='supertabelaprocedimentos_formulario_label'>
                                                    {linha.publicadoFormulario ? 'Sim' : 'Não'}
                                                </span>
                                            ) : (
                                                <button
                                                    type='button'
                                                    role='switch'
                                                    aria-checked={linha.publicadoFormulario}
                                                    className={`supertabelaprocedimentos_form_switch ${linha.publicadoFormulario ? 'is-on' : 'is-off'}`}
                                                    title={
                                                        linha.publicadoFormulario
                                                            ? 'Publicado no formulário — clique para desativar'
                                                            : 'Não publicado — clique para incluir no formulário'
                                                    }
                                                    onClick={() =>
                                                        void atualizarPublicadoFormulario(
                                                            linha,
                                                            !linha.publicadoFormulario,
                                                        )
                                                    }
                                                >
                                                    <span className='supertabelaprocedimentos_form_switch_track'>
                                                        <span className='supertabelaprocedimentos_form_switch_knob' />
                                                    </span>
                                                    <span className='supertabelaprocedimentos_form_switch_label'>
                                                        {linha.publicadoFormulario ? 'Sim' : 'Não'}
                                                    </span>
                                                </button>
                                            )}
                                        </td>
                                        {!somenteLeitura && (
                                            <td>
                                                <button
                                                    type='button'
                                                    className='table_delete_btn'
                                                    onClick={(event) =>
                                                        excluirProcedimento(linha, { ignorarConfirmacao: event.shiftKey })
                                                    }
                                                    title='Excluir procedimento, SHIFT = Excluir rápido'
                                                >
                                                    🗑️
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                )

                                return usarVirtualizacao ? (
                                    <>
                                        <table className='table_main table_main_virtual_header'>
                                            <colgroup>
                                                {colProcWidths.map((w, i) => (
                                                    <col key={`vh-${i}`} style={{ width: w }} />
                                                ))}
                                            </colgroup>
                                            <thead>
                                                <tr>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>
                                                        Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                                    </th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>
                                                        Procedimento{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                                    </th>
                                                    <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'planoBaseChave')}>
                                                        Plano Base{obterIndicadorOrdenacao(secao.categoriaId, 'planoBaseChave')}
                                                    </th>
                                                    <th className='table_header'>Categoria</th>
                                                    <th
                                                        className='table_header'
                                                        onClick={() =>
                                                            handleOrdenarCategoria(secao.categoriaId, 'publicadoFormulario')
                                                        }
                                                    >
                                                        Formulário
                                                        {obterIndicadorOrdenacao(secao.categoriaId, 'publicadoFormulario')}
                                                    </th>
                                                    {!somenteLeitura && <th className='table_header'>Ação</th>}
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
                                                    {colProcWidths.map((w, i) => (
                                                        <col key={`vr-${i}`} style={{ width: w }} />
                                                    ))}
                                                </colgroup>
                                                <tbody>
                                                    {alturaEspacadorTopo > 0 && (
                                                        <tr className='table_spacer_row' aria-hidden='true'>
                                                            <td colSpan={colSpanProc} style={{ height: `${alturaEspacadorTopo}px` }} />
                                                        </tr>
                                                    )}
                                                    {linhasVisiveis.map(renderLinha)}
                                                    {alturaEspacadorBase > 0 && (
                                                        <tr className='table_spacer_row' aria-hidden='true'>
                                                            <td colSpan={colSpanProc} style={{ height: `${alturaEspacadorBase}px` }} />
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : (
                                    <table className='table_main'>
                                        <colgroup>
                                            {colProcWidths.map((w, i) => (
                                                <col key={`t-${i}`} style={{ width: w }} />
                                            ))}
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>
                                                    Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                                </th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>
                                                    Procedimento{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                                </th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'planoBaseChave')}>
                                                    Plano Base{obterIndicadorOrdenacao(secao.categoriaId, 'planoBaseChave')}
                                                </th>
                                                <th className='table_header'>Categoria</th>
                                                <th
                                                    className='table_header'
                                                    onClick={() =>
                                                        handleOrdenarCategoria(secao.categoriaId, 'publicadoFormulario')
                                                    }
                                                >
                                                    Formulário
                                                    {obterIndicadorOrdenacao(secao.categoriaId, 'publicadoFormulario')}
                                                </th>
                                                {!somenteLeitura && <th className='table_header'>Ação</th>}
                                            </tr>
                                        </thead>
                                        <tbody>{secao.linhas.map(renderLinha)}</tbody>
                                    </table>
                                )
                            })()}
                        </section>
                    ))
                )}
            </div>
        </div>
    )
}

export default Supertabelaprocedimentos
