import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PERMISSION_KEYS, hasStoredPermission } from '../../../lib/accessControl'
import { useBuscaNotAtiva } from '../../../lib/devToolsUi'
import { filtrarPorTermoBusca, normalizarTextoBusca as normalizarTextoBuscaDev } from '../../../lib/prestadorCadastroHelpers'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { upsertPlanosCidadeCompat } from '../../../lib/planosCidadeCompat'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi.js'
import '../Supertabela_main/Supertabelamain.css'
import './Supertabelaprocedimentos.css'

const ORDEM_PLANOS = ['basico', 'classico', 'avancado', 'ultra']
const ROTULO_PLANO = {
    basico: 'Básico',
    classico: 'Clássico',
    avancado: 'Avançado',
    ultra: 'Ultra',
}

const normalizarNome = (texto) =>
    String(texto || '')
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

const normalizarCodigo = (codigo) =>
    String(codigo || '')
        .trim()
        .toUpperCase()

const mapearPlanos = (planos) => {
    const resultado = { basico: null, classico: null, avancado: null, ultra: null }
    const usados = new Set()

    const buscar = (chave, matcher) => {
        const encontrado = (planos || []).find((plano) => {
            if (usados.has(plano.id)) return false
            return matcher(normalizarNome(plano.nome))
        })
        if (encontrado) {
            usados.add(encontrado.id)
            resultado[chave] = { id: Number(encontrado.id), nome: encontrado.nome }
        }
    }

    buscar('basico', (nome) => nome.includes('BASICO') || nome.includes('BASIC'))
    buscar('classico', (nome) => nome.includes('CLASSICO'))
    buscar('avancado', (nome) => nome.includes('AVANCADO'))
    buscar('ultra', (nome) => nome.includes('ULTRA'))

    return resultado
}

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
    const [scrollTopoPorCategoria, setScrollTopoPorCategoria] = useState({})
    const [adicionarNovoAtivo, setAdicionarNovoAtivo] = useState(false)
    const [novoProcedimento, setNovoProcedimento] = useState({
        codigo: '',
        nome: '',
        categoriaId: '',
        planoBaseChave: 'basico',
    })

    const mapaPlanos = useMemo(() => mapearPlanos(planos), [planos])

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

    const obterChavePlanoPorId = (planoId, mapaPlanosLocal) => {
        const idNumerico = Number(planoId)
        if (!idNumerico) return null
        return ORDEM_PLANOS.find((chave) => Number(mapaPlanosLocal[chave]?.id) === idNumerico) || null
    }

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: planosData, error: errPlanos },
                { data: categoriasData, error: errCategorias },
                { data: procedimentosData, error: errProcedimentos },
                { data: planosCidadeData, error: errPlanosCidade },
            ] = await Promise.all([
                supabase.from('planos').select('id, nome').order('id', { ascending: true }),
                supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id', { ascending: true }),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('codigo, nome, categoria_id, plano_base_id')
                        .order('codigo', { ascending: true })
                ),
                buscarTodosPaginado(() =>
                    supabase.from('planos_cidade').select('procedimento_cod, plano_id')
                ),
            ])

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
            const idsPlanosMapeados = ORDEM_PLANOS
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
                const chavePorPlanoBase = obterChavePlanoPorId(item.plano_base_id, mapaPlanosLocal)
                return {
                    rowId: `proc-${codigo}`,
                    codigo,
                    codigoBanco: codigo,
                    procedimento: String(item.nome || codigo),
                    categoriaId: item.categoria_id != null ? Number(item.categoria_id) : null,
                    planoBaseChave: chavePorPlanoBase || planoBasePorQuantidade(quantidadePlanos),
                }
            })

            setPlanos(listaPlanos)
            setCategorias(categoriasData || [])
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
                [linha.codigo, linha.procedimento, categoriaNome, planoNome].filter(Boolean).join(' '),
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
        const indiceBase = ORDEM_PLANOS.indexOf(novaChavePlanoBase)
        if (indiceBase < 0) return
        const planoBaseId = Number(mapaPlanos[novaChavePlanoBase]?.id || 0)
        const planoBaseAnteriorId = Number(mapaPlanos[chaveAnterior]?.id || 0)
        if (!planoBaseId) {
            mostrarErroToast('Não foi possível mapear o plano base selecionado.')
            return
        }

        const planoIdsPermitidos = ORDEM_PLANOS
            .slice(indiceBase)
            .map((chave) => mapaPlanos[chave]?.id)
            .filter(Boolean)
            .map((id) => Number(id))

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
        <div className='supertabelaprocedimentos'>
            <h1>Supertabela - Procedimentos</h1>
            <hr />
            <header className={`supertabelaprocedimentos_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='supertabelaprocedimentos_filters'>
                    <div className='supertabelaprocedimentos_filter_item supertabelaprocedimentos_filter_busca'>
                        <p>Busca</p>
                        <input
                            type='text'
                            className='supertabelaprocedimentos_input'
                            placeholder='Código, procedimento, plano base ou categoria'
                            value={termoBusca}
                            onChange={(event) => setTermoBusca(event.target.value)}
                        />
                    </div>

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
                            />
                            <span>Adicionar novo</span>
                        </label>
                    )}
                </div>

                {adicionarNovoAtivo && (
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
                                    {ORDEM_PLANOS.map((chavePlano) => (
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

            <div className='supertabelaprocedimentos_table_container'>
                {loading ? (
                    <p>Carregando...</p>
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
                                const scrollTopoAtual = Number(scrollTopoPorCategoria[secao.categoriaId] || 0)
                                const indiceInicial = Math.max(
                                    0,
                                    Math.floor(scrollTopoAtual / ALTURA_LINHA_TABELA) - LINHAS_OVERSCAN
                                )
                                const quantidadeRenderizada =
                                    Math.ceil(alturaVisivelCorpo / ALTURA_LINHA_TABELA) + LINHAS_OVERSCAN * 2
                                const indiceFinal = Math.min(totalLinhasSecao, indiceInicial + quantidadeRenderizada)
                                const linhasVisiveis = secao.linhas.slice(indiceInicial, indiceFinal)
                                const alturaEspacadorTopo = indiceInicial * ALTURA_LINHA_TABELA
                                const alturaEspacadorBase = (totalLinhasSecao - indiceFinal) * ALTURA_LINHA_TABELA
                                const colSpanProc = somenteLeitura ? 4 : 5
                                const colProcWidths = somenteLeitura
                                    ? ['12%', '50%', '20%', '18%']
                                    : ['12%', '40%', '20%', '18%', '10%']

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
                                                    {ORDEM_PLANOS.map((chavePlano) => (
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
                                                    {!somenteLeitura && <th className='table_header'>Ação</th>}
                                                </tr>
                                            </thead>
                                        </table>
                                        <div
                                            className='table_main_virtual_body'
                                            style={{ maxHeight: `${Math.max(alturaVisivelCorpo, ALTURA_LINHA_TABELA)}px` }}
                                            onScroll={(event) => {
                                                const scrollTopAtual = event.currentTarget?.scrollTop ?? 0
                                                setScrollTopoPorCategoria((anterior) => ({
                                                    ...anterior,
                                                    [secao.categoriaId]: scrollTopAtual,
                                                }))
                                            }}
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
