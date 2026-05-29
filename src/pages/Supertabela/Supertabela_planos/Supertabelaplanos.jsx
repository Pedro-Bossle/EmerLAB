import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PERMISSION_KEYS, hasStoredDevTools, hasStoredPermission } from '../../../lib/accessControl'
import { useBuscaNotAtiva, useDevToolsUi } from '../../../lib/devToolsUi'
import { filtrarPorTermoBusca, normalizarTextoBusca as normalizarTextoBuscaDev } from '../../../lib/prestadorCadastroHelpers'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { extrairCodigosProcedimentoEmMassa } from '../../../lib/parseCodigosEmMassa'
import {
    buscarTodosPlanosCidadeCompat,
    consultarPlanosCidadeExistentesCompat,
    contextoPlanosCidadeFromCidades,
    excluirPlanosCidadeCompat,
    upsertPlanosCidadeCompat,
} from '../../../lib/planosCidadeCompat'
import { inserirPlanoConfigSeNaoExiste } from '../../../lib/planosConfigCompat'
import CidadeTabelaIbgeForm from '../../../components/Supertabela/CidadeTabelaIbgeForm.jsx'
import GerenciarTabelasModal from '../../../components/Supertabela/GerenciarTabelasModal.jsx'
import { mapCidadeParaGerenciador, payloadCidadeComUf } from '../../../lib/cidadesSupertabelaHelpers.js'
import {
    buildOpcoesFiltroSupertabela,
    carregarVinculosMunicipios,
    isMissingVinculosTableError,
    municipiosPorCidadeId,
    normalizarMunicipioChave,
    salvarVinculosDaCidade,
} from '../../../lib/cidadesSupertabelaVinculos.js'
import { TOAST_AUTO_DISMISS_MS } from '../../../lib/toastUi.js'
import '../Supertabela_main/Supertabelamain.css'
import './Supertabelaplanos.css'

const COLUNAS_PLANO = [
    { chave: 'basico', titulo: 'Básico', match: (n) => n.includes('BASICO') || n.includes('BASIC') },
    { chave: 'classico', titulo: 'Clássico', match: (n) => n.includes('CLASSICO') },
    { chave: 'avancado', titulo: 'Avançado', match: (n) => n.includes('AVANCADO') },
    { chave: 'ultra', titulo: 'Ultra', match: (n) => n.includes('ULTRA') },
]

const CAMPOS_DIF_COLAGEM = ['basico', 'classico', 'avancado', 'ultra']
const CAMPOS_LIM_COLAGEM = ['limite', 'carencia']
const ORDEM_PLANOS = COLUNAS_PLANO.map((plano) => plano.chave)

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

const mapearPlanosPorChave = (planos) => {
    const usados = new Set()
    const resultado = {}
    const lista = planos || []

    COLUNAS_PLANO.forEach(({ chave, match }) => {
        const encontrado = lista.find((p) => {
            if (usados.has(p.id)) return false
            return match(normalizarNome(p.nome))
        })
        if (encontrado) usados.add(encontrado.id)
        resultado[chave] = encontrado ? { id: encontrado.id, nome: encontrado.nome } : null
    })

    return resultado
}

const obterChavePlanoPorId = (planoId, mapaPlanos) => {
    const idNumerico = Number(planoId)
    if (!idNumerico) return null
    return ORDEM_PLANOS.find((chave) => Number(mapaPlanos[chave]?.id) === idNumerico) || null
}

const obterPlanoIdsPermitidos = (planoBaseId, mapaPlanos) => {
    const chaveBase = obterChavePlanoPorId(planoBaseId, mapaPlanos) || 'basico'
    const indiceBase = ORDEM_PLANOS.indexOf(chaveBase)
    return ORDEM_PLANOS
        .slice(indiceBase < 0 ? 0 : indiceBase)
        .map((chave) => mapaPlanos[chave]?.id)
        .filter(Boolean)
        .map((id) => Number(id))
}

const Supertabelaplanos = () => {
    const [somenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT))
    const { ui: devToolsUi } = useDevToolsUi()
    const buscaNotAtiva = useBuscaNotAtiva()
    const podeExclusaoPorLista =
        !getReadOnlyFlag() &&
        hasStoredPermission(PERMISSION_KEYS.SUPERTABELA_EDIT) &&
        hasStoredDevTools() &&
        devToolsUi.exclusaoMassa
    const [cidades, setCidades] = useState([])
    const [municipiosVinculos, setMunicipiosVinculos] = useState([])
    const [suportaVinculosMunicipios, setSuportaVinculosMunicipios] = useState(true)
    const [valorFiltroCidade, setValorFiltroCidade] = useState('')
    const [planos, setPlanos] = useState([])
    const [categorias, setCategorias] = useState([])
    const [procedimentos, setProcedimentos] = useState([])

    const [cidadeId, setCidadeId] = useState('')
    const [termoBusca, setTermoBusca] = useState('')
    const [edicaoAtiva, setEdicaoAtiva] = useState(false)
    const [modoLimitacoes, setModoLimitacoes] = useState(false)
    const [planoDetalheId, setPlanoDetalheId] = useState('')

    const [linhasDiferencas, setLinhasDiferencas] = useState([])
    const [linhasLimitacoes, setLinhasLimitacoes] = useState([])

    const [loading, setLoading] = useState(false)
    const [erroDetalhe, setErroDetalhe] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})
    const [edicoesLocais, setEdicoesLocais] = useState({})
    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    const [codigosInicializacaoPlanos, setCodigosInicializacaoPlanos] = useState('')
    const [adicaoMassaAtiva, setAdicaoMassaAtiva] = useState(false)
    const [progressoMassa, setProgressoMassa] = useState({ ativo: false, atual: 0, total: 0, label: '' })

    const [mostrarExclusaoListaModal, setMostrarExclusaoListaModal] = useState(false)
    const [codigosManterLista, setCodigosManterLista] = useState('')
    const [categoriaEmInclusao, setCategoriaEmInclusao] = useState(null)
    const [textoNovoProcedimento, setTextoNovoProcedimento] = useState('')
    const [novoProcedimentoSelecionadoCodigo, setNovoProcedimentoSelecionadoCodigo] = useState('')
    const [popupSugestoesStyle, setPopupSugestoesStyle] = useState(null)
    const sugestoesAnchorRef = useRef(null)

    const [mostrarGerenciarModal, setMostrarGerenciarModal] = useState(false)
    const [ordenacaoGerenciador, setOrdenacaoGerenciador] = useState({ coluna: 'nome', direcao: 'asc' })
    const [cidadeDuplicarOrigem, setCidadeDuplicarOrigem] = useState(null)
    const [novoNomeCidadeDuplicada, setNovoNomeCidadeDuplicada] = useState('')
    const [mostrarAdicionarCidade, setMostrarAdicionarCidade] = useState(false)
    const [novaCidadeUf, setNovaCidadeUf] = useState('')
    const [novaCidadeMunicipio, setNovaCidadeMunicipio] = useState('')
    const [novaCidadeEnglobados, setNovaCidadeEnglobados] = useState([])
    const [cidadeEdicao, setCidadeEdicao] = useState(null)
    const [cidadeEdicaoUf, setCidadeEdicaoUf] = useState('')
    const [cidadeEdicaoMunicipio, setCidadeEdicaoMunicipio] = useState('')
    const [cidadeEdicaoEnglobados, setCidadeEdicaoEnglobados] = useState([])

    const cidadeSelecionada = useMemo(
        () => cidades.find((c) => String(c.id) === String(cidadeId)) || null,
        [cidades, cidadeId]
    )

    const planoDetalheNome = useMemo(() => {
        const p = planos.find((item) => String(item.id) === String(planoDetalheId))
        return p?.nome || 'Plano'
    }, [planos, planoDetalheId])

    const percentualProgressoMassa = useMemo(() => {
        if (!progressoMassa.total) return 0
        return Math.min(100, Math.round((Number(progressoMassa.atual || 0) / Number(progressoMassa.total)) * 100))
    }, [progressoMassa.atual, progressoMassa.total])

    const previewExclusaoLista = useMemo(() => {
        const codigosColados = extrairCodigosProcedimentoEmMassa(codigosManterLista || '')
        const setManter = new Set(codigosColados.map((cod) => String(cod).toUpperCase()))
        const codigosAtuais = [...new Set(linhasDiferencas.map((linha) => String(linha.codigo).toUpperCase()))]

        const aExcluir = codigosAtuais.filter((cod) => !setManter.has(cod))
        const aManter = codigosAtuais.filter((cod) => setManter.has(cod))
        const naoEncontradosNaTabela = [...setManter].filter((cod) => !codigosAtuais.includes(cod))

        return {
            totalAtuais: codigosAtuais.length,
            totalColados: setManter.size,
            aExcluir,
            aManter,
            naoEncontradosNaTabela,
        }
    }, [codigosManterLista, linhasDiferencas])

    const formatarMoeda = (valor) =>
        new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(Number(valor || 0))

    const mostrarErroToast = (mensagem) => {
        setErroDetalhe('')
        setTimeout(() => setErroDetalhe(mensagem), 0)
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

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

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErroDetalhe('')

            const [
                { data: cidadesData, error: errCidades },
                { data: planosData, error: errPlanos },
                { data: categoriasData, error: errCategorias },
                { data: procedimentosData, error: errProcedimentos },
            ] = await Promise.all([
                supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                supabase.from('planos').select('id, nome').order('id', { ascending: true }),
                supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id', { ascending: true }),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('codigo, nome, categoria_id, plano_base_id')
                        .order('codigo', { ascending: true })
                ),
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

            if (errCidades || errPlanos || errCategorias || errProcedimentos) {
                const detalhes = [
                    errCidades?.message,
                    errPlanos?.message,
                    errCategorias?.message,
                    errProcedimentos?.message,
                ]
                    .filter(Boolean)
                    .join(' | ')
                setErroDetalhe(`Erro ao carregar dados base: ${detalhes}`)
                return
            }

            const listaCidades = cidadesData || []
            setCidades(listaCidades)
            setMunicipiosVinculos(vinculos)
            setPlanos(planosData || [])
            setCategorias(categoriasData || [])
            setProcedimentos(procedimentosData || [])

            const opcoes = buildOpcoesFiltroSupertabela(listaCidades, vinculos)
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

            const listaPlanos = planosData || []
            if (!cidadeId && opcoes.length > 0) {
                setCidadeId(String(opcoes[0].cidadeId))
            }
            if (listaPlanos.length > 0) {
                setPlanoDetalheId((prev) => prev || String(listaPlanos[0].id))
            }
        } catch (error) {
            setErroDetalhe(`Falha ao carregar dados base: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [])

    const contextoPlanosCidade = useMemo(
        () => contextoPlanosCidadeFromCidades(cidadeId),
        [cidadeId, cidades],
    )

    const buscarPlanosCidadePorCidade = useCallback(async () => {
        if (!cidadeId) return { data: [], error: null }

        return buscarTodosPlanosCidadeCompat(
            supabase,
            buscarTodosPaginado,
            contextoPlanosCidade,
            'id, plano_id, procedimento_cod, diferenca',
        )
    }, [cidadeId, contextoPlanosCidade])

    const buscarLinhasDiferencas = useCallback(async () => {
        if (!cidadeId || planos.length === 0) {
            setLinhasDiferencas([])
            return
        }

        try {
            setLoading(true)
            setErroDetalhe('')

            const { data: planosCidade, error: errPc } = await buscarPlanosCidadePorCidade()
            if (errPc) {
                setErroDetalhe(`Erro ao buscar planos da tabela: ${errPc.message}`)
                setLinhasDiferencas([])
                return
            }

            const codigos = [...new Set((planosCidade || []).map((item) => String(item.procedimento_cod)))]
            if (codigos.length === 0) {
                setLinhasDiferencas([])
                return
            }

            const { data: procedimentosData, error: errProc } = await supabase
                .from('procedimentos')
                .select('codigo, nome, categoria_id, plano_base_id')
                .in('codigo', codigos)

            if (errProc) {
                setErroDetalhe(`Erro ao carregar procedimentos: ${errProc.message}`)
                setLinhasDiferencas([])
                return
            }

            const mapaPlanos = mapearPlanosPorChave(planos)
            const mapaProc = new Map(
                (procedimentosData || []).map((item) => [
                    String(item.codigo),
                    { nome: String(item.nome), categoriaId: item.categoria_id, planoBaseId: item.plano_base_id },
                ])
            )
            let planosCidadeCompletos = planosCidade || []
            const planosPorCodigo = new Map()
            planosCidadeCompletos.forEach((item) => {
                const cod = String(item.procedimento_cod)
                if (!planosPorCodigo.has(cod)) planosPorCodigo.set(cod, new Set())
                planosPorCodigo.get(cod).add(Number(item.plano_id))
            })

            const payloadComplemento = []
            mapaProc.forEach((meta, cod) => {
                const planosExistentes = planosPorCodigo.get(cod) || new Set()
                obterPlanoIdsPermitidos(meta.planoBaseId, mapaPlanos).forEach((planoId) => {
                    if (planosExistentes.has(Number(planoId))) return
                    payloadComplemento.push({
                        cidade_id: Number(cidadeId),
                        plano_id: Number(planoId),
                        procedimento_cod: cod,
                        diferenca: 0,
                    })
                })
            })

            if (!somenteLeitura && payloadComplemento.length > 0) {
                const { data: inseridos, error: errComplemento } = await upsertPlanosCidadeCompat(
                    supabase,
                    payloadComplemento,
                    contextoPlanosCidade,
                    'id, plano_id, procedimento_cod, diferenca',
                )
                if (errComplemento) {
                    setErroDetalhe(`Erro ao completar planos do procedimento: ${errComplemento.message}`)
                    setLinhasDiferencas([])
                    return
                }
                planosCidadeCompletos = [...planosCidadeCompletos, ...(inseridos || [])]
            }
            const mapaLinhas = new Map()

            for (const item of planosCidadeCompletos) {
                const cod = String(item.procedimento_cod)
                if (!mapaLinhas.has(cod)) {
                    const meta = mapaProc.get(cod) || { nome: cod, categoriaId: null }
                    mapaLinhas.set(cod, {
                        codigo: cod,
                        procedimento: meta.nome,
                        categoriaId: meta.categoriaId,
                        basico: null,
                        classico: null,
                        avancado: null,
                        ultra: null,
                    })
                }
                const linha = mapaLinhas.get(cod)
                const pid = Number(item.plano_id)

                COLUNAS_PLANO.forEach(({ chave }) => {
                    const metaPlano = mapaPlanos[chave]
                    if (metaPlano && Number(metaPlano.id) === pid) {
                        linha[chave] = {
                            planoCidadeId: item.id,
                            valor: Number(item.diferenca || 0),
                        }
                    }
                })
            }

            setLinhasDiferencas([...mapaLinhas.values()])
        } catch (error) {
            setErroDetalhe(`Falha ao montar tabela de diferenças: ${error.message}`)
            setLinhasDiferencas([])
        } finally {
            setLoading(false)
        }
    }, [buscarPlanosCidadePorCidade, cidadeId, planos, somenteLeitura])

    const buscarLinhasLimitacoes = useCallback(async () => {
        if (!planoDetalheId || planos.length === 0) {
            setLinhasLimitacoes([])
            return
        }

        try {
            setLoading(true)
            setErroDetalhe('')

            const { data: configs, error: errCfg } = await buscarTodosPaginado(() =>
                supabase
                    .from('planos_config')
                    .select('id, procedimento, limite, carencia')
                    .eq('plano_id', planoDetalheId)
            )

            if (errCfg) {
                setErroDetalhe(`Erro ao buscar limitações: ${errCfg.message}`)
                setLinhasLimitacoes([])
                return
            }

            const listaCfg = configs || []
            if (listaCfg.length === 0) {
                setLinhasLimitacoes([])
                return
            }

            const codigos = [...new Set(listaCfg.map((row) => String(row.procedimento)))]

            const { data: procedimentosData, error: errProc } = await supabase
                .from('procedimentos')
                .select('codigo, nome, categoria_id')
                .in('codigo', codigos)

            if (errProc) {
                setErroDetalhe(`Erro ao carregar procedimentos: ${errProc.message}`)
                setLinhasLimitacoes([])
                return
            }

            const mapaProc = new Map(
                (procedimentosData || []).map((item) => [
                    String(item.codigo),
                    { nome: String(item.nome), categoriaId: item.categoria_id },
                ])
            )

            const linhas = listaCfg.map((row) => {
                const cod = String(row.procedimento)
                const meta = mapaProc.get(cod) || { nome: cod, categoriaId: null }
                return {
                    codigo: cod,
                    procedimento: meta.nome,
                    categoriaId: meta.categoriaId,
                    planosConfigId: row.id,
                    limite: row.limite != null ? String(row.limite) : '',
                    carencia: row.carencia != null ? String(row.carencia) : '',
                }
            })

            linhas.sort((a, b) => {
                const ca = Number(a.categoriaId) || 0
                const cb = Number(b.categoriaId) || 0
                if (ca !== cb) return ca - cb
                return String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { sensitivity: 'base' })
            })

            setLinhasLimitacoes(linhas)
        } catch (error) {
            setErroDetalhe(`Falha ao montar limitações: ${error.message}`)
            setLinhasLimitacoes([])
        } finally {
            setLoading(false)
        }
    }, [planoDetalheId, planos])

    const inserirPlanosCidadeParaCodigo = async (codigoNormalizado, opcoes = {}) => {
        const reportarErro = (mensagem) => {
            if (!opcoes.silencioso) mostrarErroToast(mensagem)
        }

        if (!cidadeId) {
            reportarErro('Selecione uma cidade.')
            return { status: 'erro', mensagem: 'Cidade não selecionada.' }
        }

        const mapaPlanosCol = mapearPlanosPorChave(planos)
        const procedimentoMeta = procedimentos.find((item) => String(item.codigo).toUpperCase() === String(codigoNormalizado).toUpperCase())
        const planosPermitidos = new Set(obterPlanoIdsPermitidos(procedimentoMeta?.plano_base_id, mapaPlanosCol))
        const candidatos = []
        COLUNAS_PLANO.forEach(({ chave }) => {
            const meta = mapaPlanosCol[chave]
            if (!meta?.id) return
            if (!planosPermitidos.has(Number(meta.id))) return
            candidatos.push({
                cidade_id: Number(cidadeId),
                plano_id: Number(meta.id),
                procedimento_cod: codigoNormalizado,
                diferenca: 0,
            })
        })

        if (candidatos.length === 0) {
            reportarErro('Nenhum plano mapeado (Básico, Clássico, Avançado, Ultra).')
            return { status: 'erro', mensagem: 'Sem planos mapeados.' }
        }

        const consultaExistentes = await consultarPlanosCidadeExistentesCompat(
            supabase,
            contextoPlanosCidade,
            codigoNormalizado,
        )

        if (consultaExistentes.error) {
            reportarErro(`Erro ao verificar registros: ${consultaExistentes.error.message}`)
            return { status: 'erro', mensagem: consultaExistentes.error.message }
        }

        const idsEx = new Set((consultaExistentes.data || []).map((e) => Number(e.plano_id)))
        const novos = candidatos.filter((c) => !idsEx.has(Number(c.plano_id)))
        if (novos.length === 0) {
            reportarErro('O procedimento já está vinculado a todos os planos esperados para esta cidade.')
            return { status: 'ja_existia' }
        }

        const { error } = await upsertPlanosCidadeCompat(supabase, novos, contextoPlanosCidade)

        if (error) {
            const msg = String(error.message || '')
            if (msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
                reportarErro('O procedimento já está vinculado a todos os planos esperados para esta cidade.')
                return { status: 'ja_existia' }
            }
            reportarErro(`Erro ao inserir na tabela planos por cidade: ${error.message}`)
            return { status: 'erro', mensagem: error.message }
        }

        if (!opcoes.semRecarregar) {
            await buscarLinhasDiferencas()
        }
        return { status: 'ok' }
    }

    const inserirPlanoConfigParaCodigo = async (codigoNormalizado, opcoes = {}) => {
        const reportarErro = (mensagem) => {
            if (!opcoes.silencioso) mostrarErroToast(mensagem)
        }

        if (!planoDetalheId) {
            reportarErro('Selecione um plano.')
            return { status: 'erro', mensagem: 'Plano não selecionado.' }
        }

        const resultadoCfg = await inserirPlanoConfigSeNaoExiste(supabase, {
            planoId: planoDetalheId,
            procedimento: codigoNormalizado,
        })

        if (resultadoCfg.status === 'ja_existia') {
            reportarErro('Este procedimento já possui registro para o plano selecionado.')
            return { status: 'ja_existia' }
        }

        if (resultadoCfg.status === 'erro') {
            const error = resultadoCfg.error
            reportarErro(`Erro ao inserir: ${error.message}`)
            return { status: 'erro', mensagem: error.message }
        }

        if (!opcoes.semRecarregar) {
            await buscarLinhasLimitacoes()
        }
        return { status: 'ok' }
    }

    useEffect(() => {
        carregarBase()
        // Carregamento único ao montar (listas globais de filtros).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const linhasAtivas = modoLimitacoes ? linhasLimitacoes : linhasDiferencas

    const linhasFiltradas = useMemo(() => {
        if (!termoBusca.trim() && !buscaNotAtiva) return linhasAtivas

        return linhasAtivas.filter((linha) => {
            const categoriaNome = categorias.find((c) => Number(c.id) === Number(linha.categoriaId))?.nome || ''
            const partes = [linha.codigo, linha.procedimento, categoriaNome]
            if (modoLimitacoes) {
                partes.push(linha.limite, linha.carencia)
            }
            const blob = normalizarTextoBuscaDev(partes.filter(Boolean).join(' '))
            return filtrarPorTermoBusca(blob, termoBusca, buscaNotAtiva)
        })
    }, [linhasAtivas, termoBusca, categorias, modoLimitacoes, buscaNotAtiva])

    const obterSugestoesProcedimentos = (categoriaId) => {
        const lista = modoLimitacoes ? linhasLimitacoes : linhasDiferencas
        const codigosPresentes = new Set(
            lista
                .filter((linha) => Number(linha.categoriaId) === Number(categoriaId))
                .map((linha) => String(linha.codigo).toUpperCase())
        )

        return procedimentos.filter(
            (item) =>
                Number(item.categoria_id) === Number(categoriaId) &&
                !codigosPresentes.has(String(item.codigo).toUpperCase())
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
    }, [categoriaEmInclusao, textoNovoProcedimento, modoLimitacoes, linhasDiferencas, linhasLimitacoes, procedimentos])

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

    const renderSugestoesPortal = (secao, chaveSufixo = '') => {
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
                            key={`${secao.categoriaId}${chaveSufixo}-${item.codigo}`}
                            type='button'
                            className={`row_add_suggest_item ${
                                normalizarTextoBusca(novoProcedimentoSelecionadoCodigo) === normalizarTextoBusca(item.codigo)
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

        const resultado = modoLimitacoes
            ? await inserirPlanoConfigParaCodigo(codigoNormalizado)
            : await inserirPlanosCidadeParaCodigo(codigoNormalizado)
        if (resultado.status !== 'ok') return

        setCategoriaEmInclusao(null)
        setTextoNovoProcedimento('')
        setNovoProcedimentoSelecionadoCodigo('')
    }

    const preencherProcedimentosMassaPlanos = async () => {
        if (modoLimitacoes) {
            if (!planoDetalheId) {
                mostrarErroToast('Selecione um plano.')
                return
            }
        } else if (!cidadeId) {
            mostrarErroToast('Selecione uma cidade.')
            return
        }

        const codigos = extrairCodigosProcedimentoEmMassa(codigosInicializacaoPlanos)

        if (codigos.length === 0) {
            mostrarErroToast('Informe ao menos um código (um por linha ou separados por vírgula).')
            return
        }

        setLoading(true)
        setProgressoMassa({ ativo: true, atual: 0, total: codigos.length, label: 'Validando códigos...' })
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
            if (codigosValidos.length === 0) {
                mostrarErroToast('Nenhum código informado foi encontrado na base.')
                return
            }

            const codigosNaoEncontrados = codigos.filter(
                (cod) => !codigosValidos.includes(String(cod).toUpperCase())
            )
            setProgressoMassa({
                ativo: true,
                atual: codigosNaoEncontrados.length,
                total: codigos.length,
                label: 'Inserindo procedimentos...',
            })
            let totalInseridos = 0
            let totalIgnorados = 0
            const errosDetalhados = []

            for (let i = 0; i < codigosValidos.length; i += 1) {
                const cod = codigosValidos[i]
                const resultado = modoLimitacoes
                    ? await inserirPlanoConfigParaCodigo(cod, { semRecarregar: true, silencioso: true })
                    : await inserirPlanosCidadeParaCodigo(cod, { semRecarregar: true, silencioso: true })
                if (resultado.status === 'ok') totalInseridos += 1
                else if (resultado.status === 'ja_existia') totalIgnorados += 1
                else errosDetalhados.push(`${cod}: ${resultado.mensagem || 'erro desconhecido'}`)
                setProgressoMassa({
                    ativo: true,
                    atual: codigosNaoEncontrados.length + i + 1,
                    total: codigos.length,
                    label: `Processando ${i + 1} de ${codigosValidos.length} código(s) válido(s)...`,
                })
            }

            setProgressoMassa({
                ativo: true,
                atual: codigos.length,
                total: codigos.length,
                label: 'Atualizando tabela...',
            })
            if (modoLimitacoes) {
                await buscarLinhasLimitacoes()
            } else {
                await buscarLinhasDiferencas()
            }

            setCodigosInicializacaoPlanos('')

            const partes = []
            if (totalInseridos > 0) partes.push(`${totalInseridos} adicionado(s)`)
            if (totalIgnorados > 0) partes.push(`${totalIgnorados} já existente(s) ignorado(s)`)
            if (codigosNaoEncontrados.length > 0) partes.push(`${codigosNaoEncontrados.length} código(s) não encontrado(s): ${codigosNaoEncontrados.join(', ')}`)
            if (errosDetalhados.length > 0) partes.push(`${errosDetalhados.length} falhou(aram): ${errosDetalhados.join(' | ')}`)
            if (partes.length > 0) mostrarErroToast(`Adição em massa concluída — ${partes.join(' · ')}.`)
        } catch (error) {
            mostrarErroToast(`Falha ao inserir procedimentos em massa: ${error.message}`)
        } finally {
            setLoading(false)
            setProgressoMassa({ ativo: false, atual: 0, total: 0, label: '' })
        }
    }

    const abrirExclusaoListaModal = () => {
        if (modoLimitacoes) {
            mostrarErroToast('A exclusão por lista está disponível apenas no modo "Ver diferenças".')
            return
        }
        if (!podeExclusaoPorLista) {
            mostrarErroToast(
                'Ative «Exclusão por lista» no Dev Tool (🔧) e confira se você pode editar a Super-Tabela.',
            )
            return
        }
        if (!cidadeId) {
            mostrarErroToast('Selecione uma cidade.')
            return
        }
        setCodigosManterLista('')
        setMostrarExclusaoListaModal(true)
    }

    const fecharExclusaoListaModal = () => {
        setMostrarExclusaoListaModal(false)
        setCodigosManterLista('')
    }

    const executarExclusaoMassaPorLista = async () => {
        if (somenteLeitura) {
            mostrarErroToast('Perfil somente leitura: exclusão bloqueada.')
            return
        }
        if (!podeExclusaoPorLista) {
            mostrarErroToast(
                'Ative «Exclusão por lista» no Dev Tool (🔧) e confira se você pode editar a Super-Tabela.',
            )
            return
        }
        const codigosParaExcluir = previewExclusaoLista.aExcluir
        if (codigosParaExcluir.length === 0) {
            mostrarErroToast('Nada a excluir: todos os procedimentos atuais já estão na lista informada.')
            return
        }

        setLoading(true)
        setProgressoMassa({
            ativo: true,
            atual: 0,
            total: codigosParaExcluir.length,
            label: 'Excluindo procedimentos fora da lista...',
        })

        try {
            const TAMANHO_LOTE = 200
            let totalExcluidos = 0

            for (let inicio = 0; inicio < codigosParaExcluir.length; inicio += TAMANHO_LOTE) {
                const lote = codigosParaExcluir.slice(inicio, inicio + TAMANHO_LOTE)
                const { error } = await excluirPlanosCidadeCompat(supabase, contextoPlanosCidade, (q) =>
                    q.in('procedimento_cod', lote),
                )

                if (error) {
                    mostrarErroToast(`Erro ao excluir procedimentos em massa: ${error.message}`)
                    return
                }

                totalExcluidos += lote.length
                setProgressoMassa({
                    ativo: true,
                    atual: Math.min(totalExcluidos, codigosParaExcluir.length),
                    total: codigosParaExcluir.length,
                    label: `Excluindo lote ${Math.ceil((inicio + TAMANHO_LOTE) / TAMANHO_LOTE)} de ${Math.ceil(codigosParaExcluir.length / TAMANHO_LOTE)}...`,
                })
            }

            fecharExclusaoListaModal()
            setProgressoMassa({
                ativo: true,
                atual: codigosParaExcluir.length,
                total: codigosParaExcluir.length,
                label: 'Atualizando tabela...',
            })
            await buscarLinhasDiferencas()
            mostrarErroToast(`Exclusão concluída — ${totalExcluidos} procedimento(s) removido(s) da região.`)
        } catch (error) {
            mostrarErroToast(`Falha ao excluir em massa: ${error.message}`)
        } finally {
            setLoading(false)
            setProgressoMassa({ ativo: false, atual: 0, total: 0, label: '' })
        }
    }

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

    const valorOrdenavelDif = (linha, coluna) => {
        if (coluna === 'codigo' || coluna === 'procedimento') return linha[coluna]
        const cel = linha[coluna]
        if (cel && typeof cel === 'object' && 'valor' in cel) return Number(cel.valor || 0)
        return Number.NEGATIVE_INFINITY
    }

    const ordenarLinhas = (lista, categoriaId) => {
        const resultado = [...lista]
        const atual = ordenacaoPorCategoria[categoriaId] || { coluna: 'codigo', direcao: 'asc' }
        const fator = atual.direcao === 'asc' ? 1 : -1

        resultado.sort((a, b) => {
            let valorA
            let valorB
            if (modoLimitacoes) {
                valorA = a[atual.coluna]
                valorB = b[atual.coluna]
            } else {
                valorA = atual.coluna === 'codigo' || atual.coluna === 'procedimento' ? a[atual.coluna] : valorOrdenavelDif(a, atual.coluna)
                valorB = atual.coluna === 'codigo' || atual.coluna === 'procedimento' ? b[atual.coluna] : valorOrdenavelDif(b, atual.coluna)
            }

            if (typeof valorA === 'number' && typeof valorB === 'number') {
                return (valorA - valorB) * fator
            }

            return String(valorA ?? '').localeCompare(String(valorB ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })

        return resultado
    }

    const secoesPorCategoria = useMemo(() => {
        const idsCategoria = new Set(categorias.map((c) => Number(c.id)))
        const secoes = categorias
            .map((categoria) => ({
                categoriaId: categoria.id,
                categoriaNome: categoria.nome,
                linhas: ordenarLinhas(
                    linhasFiltradas.filter((linha) => Number(linha.categoriaId) === Number(categoria.id)),
                    categoria.id
                ),
            }))
            .filter((secao) => secao.linhas.length > 0)

        const outrosLinhas = linhasFiltradas.filter(
            (linha) =>
                linha.categoriaId == null ||
                Number.isNaN(Number(linha.categoriaId)) ||
                !idsCategoria.has(Number(linha.categoriaId))
        )
        if (outrosLinhas.length > 0) {
            secoes.push({
                categoriaId: 'outros',
                categoriaNome: 'Outros',
                linhas: ordenarLinhas(outrosLinhas, 'outros'),
            })
        }
        return secoes
    }, [categorias, linhasFiltradas, ordenacaoPorCategoria, modoLimitacoes])

    const obterClasseProcedimento = (texto) => {
        const tamanho = String(texto || '').length
        if (tamanho > 42) return 'table_text_proc table_text_proc_xs'
        if (tamanho > 34) return 'table_text_proc table_text_proc_sm'
        if (tamanho > 26) return 'table_text_proc table_text_proc_md'
        return 'table_text_proc'
    }

    const chaveEdicaoDif = (categoriaId, codigo, colunaPlano) =>
        `${categoriaId}-${codigo}-${colunaPlano}`

    const obterValorInputDif = (linha, colunaPlano, categoriaId) => {
        const chave = chaveEdicaoDif(categoriaId, linha.codigo, colunaPlano)
        if (Object.prototype.hasOwnProperty.call(edicoesLocais, chave)) {
            return edicoesLocais[chave]
        }
        const cel = linha[colunaPlano]
        if (!cel) return ''
        return String(Number(cel.valor || 0).toFixed(2))
    }

    const atualizarEdicaoLocal = (linha, colunaPlano, categoriaId, valor) => {
        const chave = chaveEdicaoDif(categoriaId, linha.codigo, colunaPlano)
        setEdicoesLocais((anterior) => ({ ...anterior, [chave]: valor }))
    }

    const persistirDiferencaDireto = async (linha, colunaPlano, valorNumerico, categoriaId) => {
        const cel = linha[colunaPlano]
        if (!cel?.planoCidadeId) {
            return false
        }

        const { error } = await supabase.from('planos_cidade').update({ diferenca: valorNumerico }).eq('id', cel.planoCidadeId)

        if (error) {
            mostrarErroToast(`Erro ao salvar: ${error.message}`)
            return false
        }

        setLinhasDiferencas((anteriores) =>
            anteriores.map((item) => {
                if (item.codigo !== linha.codigo) return item
                const copia = { ...item }
                if (copia[colunaPlano]) {
                    copia[colunaPlano] = { ...copia[colunaPlano], valor: valorNumerico }
                }
                return copia
            })
        )

        if (categoriaId != null && categoriaId !== '') {
            const chave = chaveEdicaoDif(categoriaId, linha.codigo, colunaPlano)
            setEdicoesLocais((anterior) => {
                const c = { ...anterior }
                delete c[chave]
                return c
            })
        }

        return true
    }

    const salvarDiferencaCelula = async (linha, colunaPlano, categoriaId) => {
        const chave = chaveEdicaoDif(categoriaId, linha.codigo, colunaPlano)
        const bruto = edicoesLocais[chave]
        if (bruto === undefined) return

        const valorNumerico = normalizarNumeroEntrada(bruto)
        if (Number.isNaN(valorNumerico)) {
            mostrarErroToast('Valor inválido.')
            return
        }

        const cel = linha[colunaPlano]
        if (!cel?.planoCidadeId) {
            mostrarErroToast('Sem registro neste plano para editar.')
            return
        }

        await persistirDiferencaDireto(linha, colunaPlano, valorNumerico, categoriaId)
    }

    const processarColagemPlanosDif = async (event, secao, linhaIndexInicial, campoInicial) => {
        event.preventDefault()
        if (!edicaoAtiva) return

        const texto = event.clipboardData?.getData('text') || ''
        const linhasColadas = texto
            .replace(/\r/g, '')
            .split('\n')
            .filter((linha) => linha.length > 0)
            .map((linha) => linha.split('\t'))

        if (linhasColadas.length === 0) return

        const colunaInicial = CAMPOS_DIF_COLAGEM.indexOf(campoInicial)
        if (colunaInicial < 0) return

        for (let i = 0; i < linhasColadas.length; i += 1) {
            const linhaTabela = secao.linhas[linhaIndexInicial + i]
            if (!linhaTabela) break

            const colunas = linhasColadas[i]
            for (let j = 0; j < colunas.length; j += 1) {
                const colunaDestino = colunaInicial + j
                if (colunaDestino > CAMPOS_DIF_COLAGEM.length - 1) break

                const campoDestino = CAMPOS_DIF_COLAGEM[colunaDestino]
                const valorBruto = String(colunas[j] || '').trim()
                if (!valorBruto) continue

                const valorNumerico = normalizarNumeroEntrada(valorBruto)
                if (Number.isNaN(valorNumerico)) {
                    mostrarErroToast(`Valor inválido na colagem: "${valorBruto}"`)
                    continue
                }

                const cel = linhaTabela[campoDestino]
                if (!cel?.planoCidadeId) continue

                await persistirDiferencaDireto(linhaTabela, campoDestino, valorNumerico, secao.categoriaId)
            }
        }
    }

    const chaveEdicaoLim = (categoriaId, codigo, campo) => `${categoriaId}-${codigo}-${campo}`

    const obterValorInputLim = (linha, campo, categoriaId) => {
        const chave = chaveEdicaoLim(categoriaId, linha.codigo, campo)
        if (Object.prototype.hasOwnProperty.call(edicoesLocais, chave)) {
            return edicoesLocais[chave]
        }
        return linha[campo] ?? ''
    }

    const persistLimiteCarenciaDireto = async (linha, campo, valorTexto, categoriaId) => {
        if (!linha.planosConfigId) {
            return false
        }

        const payload = campo === 'limite' ? { limite: valorTexto } : { carencia: valorTexto }
        const { error } = await supabase.from('planos_config').update(payload).eq('id', linha.planosConfigId)

        if (error) {
            mostrarErroToast(`Erro ao salvar: ${error.message}`)
            return false
        }

        setLinhasLimitacoes((anteriores) =>
            anteriores.map((item) => (item.codigo === linha.codigo ? { ...item, [campo]: valorTexto } : item))
        )

        if (categoriaId != null && categoriaId !== '') {
            const chave = chaveEdicaoLim(categoriaId, linha.codigo, campo)
            setEdicoesLocais((anterior) => {
                const c = { ...anterior }
                delete c[chave]
                return c
            })
        }

        return true
    }

    const salvarLimiteCarencia = async (linha, campo, categoriaId) => {
        const chave = chaveEdicaoLim(categoriaId, linha.codigo, campo)
        const bruto = edicoesLocais[chave]
        if (bruto === undefined) return

        if (!linha.planosConfigId) {
            mostrarErroToast('Sem registro de configuração para este procedimento.')
            return
        }

        await persistLimiteCarenciaDireto(linha, campo, bruto, categoriaId)
    }

    const processarColagemLimCarencia = async (event, secao, linhaIndexInicial, campoInicial) => {
        event.preventDefault()
        if (!edicaoAtiva) return

        const texto = event.clipboardData?.getData('text') || ''
        const linhasColadas = texto
            .replace(/\r/g, '')
            .split('\n')
            .filter((linha) => linha.length > 0)
            .map((linha) => linha.split('\t'))

        if (linhasColadas.length === 0) return

        const colunaInicial = CAMPOS_LIM_COLAGEM.indexOf(campoInicial)
        if (colunaInicial < 0) return

        for (let i = 0; i < linhasColadas.length; i += 1) {
            const linhaTabela = secao.linhas[linhaIndexInicial + i]
            if (!linhaTabela) break

            const colunas = linhasColadas[i]
            for (let j = 0; j < colunas.length; j += 1) {
                const colunaDestino = colunaInicial + j
                if (colunaDestino > CAMPOS_LIM_COLAGEM.length - 1) break

                const campoDestino = CAMPOS_LIM_COLAGEM[colunaDestino]
                const valorTexto = String(colunas[j] ?? '')
                if (!valorTexto.trim()) continue

                if (!linhaTabela.planosConfigId) continue

                await persistLimiteCarenciaDireto(linhaTabela, campoDestino, valorTexto, secao.categoriaId)
            }
        }
    }

    const excluirPlanoConfigRow = async (linha, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            if (!linha.planosConfigId) return
            const { error } = await supabase.from('planos_config').delete().eq('id', linha.planosConfigId)
            if (error) {
                mostrarErroToast(`Erro ao excluir registro: ${error.message}`)
                return
            }
            setLinhasLimitacoes((anteriores) => anteriores.filter((item) => item.codigo !== linha.codigo))
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(
            `Excluir limite e carência do procedimento ${linha.codigo} neste plano?`,
            executarExclusao
        )
    }

    const excluirProcedimentoCidadePlanos = async (linha, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarErroToast)) return
        const executarExclusao = async () => {
            const { error } = await excluirPlanosCidadeCompat(supabase, contextoPlanosCidade, (q) =>
                q.eq('procedimento_cod', linha.codigo),
            )

            if (error) {
                mostrarErroToast(`Erro ao excluir registros de plano: ${error.message}`)
                return
            }

            setLinhasDiferencas((anteriores) => anteriores.filter((item) => item.codigo !== linha.codigo))
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(`Excluir o procedimento ${linha.codigo} de todos os planos desta cidade?`, executarExclusao)
    }

    const mapaMunicipiosPorCidade = useMemo(() => municipiosPorCidadeId(municipiosVinculos), [municipiosVinculos])

    const opcoesFiltroCidade = useMemo(
        () => buildOpcoesFiltroSupertabela(cidades, municipiosVinculos),
        [cidades, municipiosVinculos],
    )

    const cidadesGerenciaveis = useMemo(() => {
        return cidades
            .map((cidade) => mapCidadeParaGerenciador(cidade))
            .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
    }, [cidades])

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
                setLinhasDiferencas([])
                setLinhasLimitacoes([])
            }
        }

        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }

        abrirConfirmacaoExclusao(`Excluir a cidade "${cidade.nome}" e os vínculos próprios dela? A tabela de planos da região será mantida.`, executarExclusao)
    }

    const iniciarDuplicacaoCidade = (cidade) => {
        setMostrarAdicionarCidade(false)
        setCidadeEdicao(null)
        setCidadeDuplicarOrigem(cidade)
        setNovoNomeCidadeDuplicada(`${cidade.nome} - Cópia`)
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

    const selecionarCidadeGerenciador = (cidade) => {
        setCidadeDuplicarOrigem(null)
        setMostrarAdicionarCidade(false)
        iniciarEdicaoCidade(cidade)
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
                        uf: cidadeDuplicarOrigem.uf,
                    }),
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

            const { data: repassesOrigem, error: errRepassesOrigem } = await supabase
                .from('repasses')
                .select('procedimento_id, porte_id, valor')
                .eq('cidade_id', cidadeDuplicarOrigem.id)

            if (errRepassesOrigem) {
                mostrarErroToast(`Cidade criada, mas houve erro ao copiar tabela: ${errRepassesOrigem.message}`)
                return
            }

            const payload = (repassesOrigem || []).map((item) => ({
                cidade_id: cidadeNova.id,
                procedimento_id: item.procedimento_id,
                porte_id: item.porte_id,
                valor: item.valor,
            }))

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
        if (!erroDetalhe) return
        const timer = setTimeout(() => setErroDetalhe(''), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(timer)
    }, [erroDetalhe])

    useEffect(() => {
        const onScroll = () => setHeaderCompacto(window.scrollY > 40)
        onScroll()
        window.addEventListener('scroll', onScroll)
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        if (modoLimitacoes) {
            buscarLinhasLimitacoes()
        } else {
            buscarLinhasDiferencas()
        }
    }, [cidadeId, modoLimitacoes, planoDetalheId, buscarLinhasDiferencas, buscarLinhasLimitacoes])

    const definirModoLimitacoes = (ativo) => {
        setModoLimitacoes(ativo)
        setCategoriaEmInclusao(null)
        setTextoNovoProcedimento('')
        setNovoProcedimentoSelecionadoCodigo('')
        setAdicaoMassaAtiva(false)
        setCodigosInicializacaoPlanos('')
        if (ativo && planos.length > 0 && !planoDetalheId) {
            setPlanoDetalheId(String(planos[0].id))
        }
    }

    return (
        <div className='supertabelaplanos'>
            <h1>Supertabela - Planos</h1>
            <hr />
            <header className={`supertabelaplanos_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='supertabelaplanos_filters'>
                    <div className='supertabelaplanos_filter_item supertabelaplanos_filter_busca'>
                        <p>Pesquisa</p>
                        <input
                            type='text'
                            className='supertabelaplanos_input'
                            placeholder={
                                modoLimitacoes
                                    ? 'Código, procedimento, categoria, limite ou carência'
                                    : 'Código, procedimento ou categoria'
                            }
                            value={termoBusca}
                            onChange={(e) => setTermoBusca(e.target.value)}
                        />
                    </div>

                    {!modoLimitacoes && (
                        <div className='supertabelaplanos_filter_item'>
                            <p>Cidade</p>
                            <select
                                className='supertabelaplanos_select'
                                value={valorFiltroCidade}
                                onChange={(e) => {
                                    const valor = e.target.value
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
                    )}

                    {!somenteLeitura && (
                        <button
                            type='button'
                            className='supertabelaplanos_action_btn'
                            onClick={() => {
                                setMostrarGerenciarModal(true)
                                setCidadeDuplicarOrigem(null)
                                setNovoNomeCidadeDuplicada('')
                            }}
                        >
                            <span className='supertabelaplanos_action_btn_ico'>⚙️</span> Gerenciar tabelas
                        </button>
                    )}

                    {!somenteLeitura && (
                        <label className='supertabelaplanos_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={edicaoAtiva}
                                onChange={(e) => setEdicaoAtiva(e.target.checked)}
                            />
                            <span>Ativar edição</span>
                        </label>
                    )}

                    {!somenteLeitura && (
                        <label className='supertabelaplanos_edit_wrap'>
                            <input
                                type='checkbox'
                                checked={adicaoMassaAtiva}
                                onChange={(e) => setAdicaoMassaAtiva(e.target.checked)}
                            />
                            <span>Adição em massa</span>
                        </label>
                    )}

                    {!somenteLeitura && podeExclusaoPorLista && !modoLimitacoes && (
                        <button
                            type='button'
                            className='supertabelaplanos_action_btn'
                            onClick={abrirExclusaoListaModal}
                            disabled={loading || !cidadeId}
                            title='Excluir procedimentos que NÃO estão na lista informada'
                        >
                            <span className='supertabelaplanos_action_btn_ico'>🗑️</span> Exclusão por lista
                        </button>
                    )}

                    <div className='supertabelaplanos_filter_item supertabelaplanos_filter_mode'>
                        <p className='supertabelaplanos_filter_mode_label'>Visualização</p>
                        <div className='supertabelaplanos_mode_rail' role='group' aria-label='Tipo de visualização da tabela'>
                            <span
                                className={`supertabelaplanos_mode_thumb ${modoLimitacoes ? 'is-right' : 'is-left'}`}
                                aria-hidden
                            />
                            <button
                                type='button'
                                className={`supertabelaplanos_mode_btn ${!modoLimitacoes ? 'is-active' : ''}`}
                                onClick={() => definirModoLimitacoes(false)}
                            >
                                Ver diferenças
                            </button>
                            <button
                                type='button'
                                className={`supertabelaplanos_mode_btn ${modoLimitacoes ? 'is-active' : ''}`}
                                onClick={() => definirModoLimitacoes(true)}
                            >
                                Ver carências e limites
                            </button>
                        </div>
                    </div>

                    <div
                        className={`supertabelaplanos_filter_plano_wrap ${modoLimitacoes ? 'is-visible' : ''}`}
                        aria-hidden={!modoLimitacoes}
                    >
                        <div className='supertabelaplanos_filter_item'>
                            <p>Plano</p>
                            <select
                                className='supertabelaplanos_select'
                                value={planoDetalheId}
                                onChange={(e) => setPlanoDetalheId(e.target.value)}
                                disabled={!modoLimitacoes}
                            >
                                {planos.map((plano) => (
                                    <option key={plano.id} value={plano.id}>
                                        {plano.nome}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {adicaoMassaAtiva && (
                    <div className='supertabelaplanos_cidade_vazia_wrap'>
                        <p>
                            {modoLimitacoes
                                ? `Adicionar procedimentos em massa no plano «${planoDetalheNome}» (limites/carências).`
                                : 'Adicionar procedimentos em massa na cidade selecionada (vínculo nos quatro planos mapeados).'}
                        </p>
                        <div className='supertabelaplanos_cidade_vazia_form'>
                            <label htmlFor='codigos-adicao-massa-planos'>
                                Códigos de procedimentos (um por linha ou separados por vírgula)
                            </label>
                            <textarea
                                id='codigos-adicao-massa-planos'
                                rows={3}
                                value={codigosInicializacaoPlanos}
                                onChange={(e) => setCodigosInicializacaoPlanos(e.target.value)}
                                placeholder={`Ex.: CONS-00N, EXAM-103
ou um código por linha`}
                            />
                            <button
                                type='button'
                                className='supertabelaplanos_cidade_vazia_btn'
                                onClick={preencherProcedimentosMassaPlanos}
                                disabled={loading}
                            >
                                Inserir procedimentos em massa
                            </button>
                            {progressoMassa.ativo && (
                                <div className='supertabelaplanos_progress_wrap' role='status' aria-live='polite'>
                                    <div className='supertabelaplanos_progress_meta'>
                                        <span>{progressoMassa.label || 'Processando...'}</span>
                                        <strong>
                                            {progressoMassa.atual}/{progressoMassa.total} ({percentualProgressoMassa}%)
                                        </strong>
                                    </div>
                                    <div
                                        className='supertabelaplanos_progress_bar'
                                        role='progressbar'
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percentualProgressoMassa}
                                    >
                                        <span style={{ width: `${percentualProgressoMassa}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </header>

            {erroDetalhe && (
                <div className='supertabelaplanos_alert' role='alert' aria-live='assertive'>
                    <div className='supertabelaplanos_alert_text'>
                        <strong>Aviso</strong>
                        <span>{erroDetalhe}</span>
                    </div>
                    <button
                        type='button'
                        className='supertabelaplanos_alert_close'
                        onClick={() => setErroDetalhe('')}
                        aria-label='Fechar aviso'
                    >
                        x
                    </button>
                </div>
            )}

            {confirmacaoExclusao && (
                <div className='supertabelaplanos_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div className='supertabelaplanos_confirm_text'>
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className='supertabelaplanos_confirm_actions'>
                        <button
                            type='button'
                            className='supertabelaplanos_confirm_btn danger'
                            onClick={async () => {
                                const acao = confirmacaoExclusao.onConfirmar
                                setConfirmacaoExclusao(null)
                                await acao()
                            }}
                        >
                            Confirmar
                        </button>
                        <button type='button' className='supertabelaplanos_confirm_btn' onClick={() => setConfirmacaoExclusao(null)}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {mostrarExclusaoListaModal && (
                <div className='manager_modal_overlay' onClick={fecharExclusaoListaModal}>
                    <div
                        className='manager_modal supertabelaplanos_exclusao_lista_modal'
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className='manager_modal_header'>
                            <h3>Exclusão em massa por lista</h3>
                            <button
                                type='button'
                                className='manager_close_btn'
                                onClick={fecharExclusaoListaModal}
                                title='Fechar'
                            >
                                x
                            </button>
                        </div>

                        <div className='supertabelaplanos_exclusao_lista_body'>
                            <p className='supertabelaplanos_exclusao_lista_info'>
                                Cole abaixo a lista de códigos que devem permanecer na cidade
                                <strong> {cidadeSelecionada?.nome || ''}</strong>. Todos os procedimentos
                                atualmente vinculados que <strong>NÃO estiverem</strong> na lista serão removidos
                                de todos os planos desta região.
                            </p>

                            <label htmlFor='codigos-exclusao-lista'>
                                Códigos a manter (um por linha ou separados por vírgula)
                            </label>
                            <textarea
                                id='codigos-exclusao-lista'
                                rows={6}
                                value={codigosManterLista}
                                onChange={(e) => setCodigosManterLista(e.target.value)}
                                placeholder={`Ex.: CONS-001, EXAM-103
ou um código por linha`}
                            />

                            <div className='supertabelaplanos_exclusao_lista_preview'>
                                <div className='supertabelaplanos_exclusao_lista_preview_row'>
                                    <span>Procedimentos atuais na cidade</span>
                                    <strong>{previewExclusaoLista.totalAtuais}</strong>
                                </div>
                                <div className='supertabelaplanos_exclusao_lista_preview_row'>
                                    <span>Códigos informados na lista</span>
                                    <strong>{previewExclusaoLista.totalColados}</strong>
                                </div>
                                <div className='supertabelaplanos_exclusao_lista_preview_row is-positive'>
                                    <span>Serão mantidos</span>
                                    <strong>{previewExclusaoLista.aManter.length}</strong>
                                </div>
                                <div className='supertabelaplanos_exclusao_lista_preview_row is-danger'>
                                    <span>Serão excluídos</span>
                                    <strong>{previewExclusaoLista.aExcluir.length}</strong>
                                </div>
                                {previewExclusaoLista.naoEncontradosNaTabela.length > 0 && (
                                    <div className='supertabelaplanos_exclusao_lista_preview_row is-warning'>
                                        <span>
                                            Códigos da lista que não estão na cidade (serão ignorados)
                                        </span>
                                        <strong>{previewExclusaoLista.naoEncontradosNaTabela.length}</strong>
                                    </div>
                                )}
                            </div>

                            {previewExclusaoLista.aExcluir.length > 0 && (
                                <details className='supertabelaplanos_exclusao_lista_detalhes'>
                                    <summary>
                                        Ver {previewExclusaoLista.aExcluir.length} código(s) que serão excluídos
                                    </summary>
                                    <div className='supertabelaplanos_exclusao_lista_detalhes_body'>
                                        {previewExclusaoLista.aExcluir.join(', ')}
                                    </div>
                                </details>
                            )}

                            {progressoMassa.ativo && (
                                <div className='supertabelaplanos_progress_wrap' role='status' aria-live='polite'>
                                    <div className='supertabelaplanos_progress_meta'>
                                        <span>{progressoMassa.label || 'Processando...'}</span>
                                        <strong>
                                            {progressoMassa.atual}/{progressoMassa.total} ({percentualProgressoMassa}%)
                                        </strong>
                                    </div>
                                    <div
                                        className='supertabelaplanos_progress_bar'
                                        role='progressbar'
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percentualProgressoMassa}
                                    >
                                        <span style={{ width: `${percentualProgressoMassa}%` }} />
                                    </div>
                                </div>
                            )}

                            <div className='supertabelaplanos_exclusao_lista_actions'>
                                <button
                                    type='button'
                                    className='supertabelaplanos_confirm_btn'
                                    onClick={fecharExclusaoListaModal}
                                    disabled={loading}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type='button'
                                    className='supertabelaplanos_confirm_btn danger'
                                    disabled={
                                        loading ||
                                        previewExclusaoLista.totalColados === 0 ||
                                        previewExclusaoLista.aExcluir.length === 0
                                    }
                                    onClick={() =>
                                        abrirConfirmacaoExclusao(
                                            `Excluir ${previewExclusaoLista.aExcluir.length} procedimento(s) da cidade ${cidadeSelecionada?.nome || ''}? Esta ação não pode ser desfeita.`,
                                            executarExclusaoMassaPorLista
                                        )
                                    }
                                >
                                    Excluir {previewExclusaoLista.aExcluir.length} procedimento(s)
                                </button>
                            </div>
                        </div>
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
                    edicaoAberta={edicaoGerenciarAberta}
                    painelDireito={renderPainelGerenciarDireito()}
                />
            )}

            <div className='supertabelaplanos_table_container'>
                {loading && <p>Carregando...</p>}
                {!loading && secoesPorCategoria.length === 0 ? (
                    <div className='supertabelaplanos_cidade_vazia_wrap'>
                        <p>
                            {modoLimitacoes
                                ? `Nenhum procedimento em planos_config para o plano «${planoDetalheNome}» com os filtros atuais.`
                                : 'Nenhum vínculo em planos_cidade para a cidade selecionada com os filtros atuais.'}
                        </p>
                        <div className='supertabelaplanos_cidade_vazia_form'>
                            <label htmlFor='codigos-planos-vazio'>
                                Preencha os códigos de procedimentos (separados por vírgula) para criar registros
                            </label>
                            <textarea
                                id='codigos-planos-vazio'
                                rows={3}
                                value={codigosInicializacaoPlanos}
                                onChange={(e) => setCodigosInicializacaoPlanos(e.target.value)}
                                placeholder='Ex.: CONS-00N, EXAM-103, LAB-9A'
                            />
                            <button
                                type='button'
                                className='supertabelaplanos_cidade_vazia_btn'
                                onClick={preencherProcedimentosMassaPlanos}
                                disabled={loading}
                            >
                                {modoLimitacoes ? 'Inserir na lista do plano' : 'Inserir vínculos na cidade'}
                            </button>
                            {progressoMassa.ativo && (
                                <div className='supertabelaplanos_progress_wrap' role='status' aria-live='polite'>
                                    <div className='supertabelaplanos_progress_meta'>
                                        <span>{progressoMassa.label || 'Processando...'}</span>
                                        <strong>
                                            {progressoMassa.atual}/{progressoMassa.total} ({percentualProgressoMassa}%)
                                        </strong>
                                    </div>
                                    <div
                                        className='supertabelaplanos_progress_bar'
                                        role='progressbar'
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percentualProgressoMassa}
                                    >
                                        <span style={{ width: `${percentualProgressoMassa}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    !loading && (
                        <div
                            className='supertabelaplanos_table_stage'
                            key={modoLimitacoes ? 'lim' : 'dif'}
                        >
                            {secoesPorCategoria.map((secao) => (
                        <section className='categoria_secao' key={secao.categoriaId}>
                            <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>
                            {!modoLimitacoes ? (
                                <table className='table_main'>
                                    <colgroup>
                                        <col style={{ width: '14%' }} />
                                        <col style={{ width: somenteLeitura ? '53%' : '42%' }} />
                                        <col style={{ width: '11%' }} />
                                        <col style={{ width: '11%' }} />
                                        <col style={{ width: '11%' }} />
                                        <col style={{ width: '11%' }} />
                                        {!somenteLeitura && <col style={{ width: '11%' }} />}
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>
                                                Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                            </th>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>
                                                Nome{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                            </th>
                                            {COLUNAS_PLANO.map(({ chave, titulo }) => (
                                                <th
                                                    key={chave}
                                                    className='table_header'
                                                    onClick={() => handleOrdenarCategoria(secao.categoriaId, chave)}
                                                >
                                                    {titulo}
                                                    {obterIndicadorOrdenacao(secao.categoriaId, chave)}
                                                </th>
                                            ))}
                                            {!somenteLeitura && (
                                                <th className='table_header table_header_no_sort'>Ação</th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {secao.linhas.map((linha, linhaIndex) => (
                                            <tr key={`${secao.categoriaId}-${linha.codigo}`}>
                                                <td className='table_text_left'>{linha.codigo}</td>
                                                <td className={`table_text_left ${obterClasseProcedimento(linha.procedimento)}`}>
                                                    {linha.procedimento}
                                                </td>
                                                {COLUNAS_PLANO.map(({ chave }) => {
                                                    const cel = linha[chave]
                                                    const editavel = edicaoAtiva && cel?.planoCidadeId
                                                    return (
                                                        <td key={chave}>
                                                            {editavel ? (
                                                                <input
                                                                    className='table_cell_input'
                                                                    type='number'
                                                                    step='0.01'
                                                                    value={obterValorInputDif(linha, chave, secao.categoriaId)}
                                                                    onChange={(e) => atualizarEdicaoLocal(linha, chave, secao.categoriaId, e.target.value)}
                                                                    onBlur={() => salvarDiferencaCelula(linha, chave, secao.categoriaId)}
                                                                    onPaste={(e) =>
                                                                        processarColagemPlanosDif(e, secao, linhaIndex, chave)
                                                                    }
                                                                />
                                                            ) : cel ? (
                                                                formatarMoeda(cel.valor)
                                                            ) : (
                                                                <span className='table_cell_readonly'>—</span>
                                                            )}
                                                        </td>
                                                    )
                                                })}
                                                {!somenteLeitura && (
                                                    <td>
                                                        <button
                                                            type='button'
                                                            className='table_delete_btn'
                                                            onClick={(event) =>
                                                                excluirProcedimentoCidadePlanos(linha, {
                                                                    ignorarConfirmacao: event.shiftKey,
                                                                })
                                                            }
                                                            title='Excluir proc., SHIFT = Excluir rápido'
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                        <tr className='row_add_line'>
                                            <td colSpan={somenteLeitura ? 6 : 7}>
                                                {categoriaEmInclusao === secao.categoriaId ? (
                                                    <div className='row_add_inline'>
                                                        <div
                                                            className='row_add_suggest_wrap'
                                                            ref={categoriaEmInclusao === secao.categoriaId ? sugestoesAnchorRef : null}
                                                        >
                                                            <input
                                                                type='text'
                                                                className='row_add_input'
                                                                placeholder='Digite nome ou código do procedimento'
                                                                value={textoNovoProcedimento}
                                                                onChange={(e) => {
                                                                    setTextoNovoProcedimento(e.target.value)
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
                            ) : (
                                <table className='table_main'>
                                    <colgroup>
                                        <col style={{ width: '13%' }} />
                                        <col style={{ width: somenteLeitura ? '51%' : '40%' }} />
                                        <col style={{ width: '18%' }} />
                                        <col style={{ width: '18%' }} />
                                        {!somenteLeitura && <col style={{ width: '11%' }} />}
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'codigo')}>
                                                Código{obterIndicadorOrdenacao(secao.categoriaId, 'codigo')}
                                            </th>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'procedimento')}>
                                                Nome{obterIndicadorOrdenacao(secao.categoriaId, 'procedimento')}
                                            </th>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'limite')}>
                                                <span className='supertabelaplanos_th_stack'>
                                                    <span className='supertabelaplanos_th_main'>Limite</span>
                                                    <span className='supertabelaplanos_th_plan'>{planoDetalheNome}</span>
                                                </span>
                                                {obterIndicadorOrdenacao(secao.categoriaId, 'limite')}
                                            </th>
                                            <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaId, 'carencia')}>
                                                <span className='supertabelaplanos_th_stack'>
                                                    <span className='supertabelaplanos_th_main'>Carência</span>
                                                    <span className='supertabelaplanos_th_plan'>{planoDetalheNome}</span>
                                                </span>
                                                {obterIndicadorOrdenacao(secao.categoriaId, 'carencia')}
                                            </th>
                                            {!somenteLeitura && (
                                                <th className='table_header table_header_no_sort'>Ação</th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {secao.linhas.map((linha, linhaIndex) => (
                                            <tr key={`${secao.categoriaId}-${linha.codigo}-lim`}>
                                                <td className='table_text_left'>{linha.codigo}</td>
                                                <td className={`table_text_left ${obterClasseProcedimento(linha.procedimento)}`}>
                                                    {linha.procedimento}
                                                </td>
                                                <td>
                                                    {edicaoAtiva && linha.planosConfigId ? (
                                                        <input
                                                            className='table_cell_input_text'
                                                            type='text'
                                                            value={obterValorInputLim(linha, 'limite', secao.categoriaId)}
                                                            onChange={(e) => {
                                                                const chave = chaveEdicaoLim(secao.categoriaId, linha.codigo, 'limite')
                                                                setEdicoesLocais((a) => ({ ...a, [chave]: e.target.value }))
                                                            }}
                                                            onBlur={() => salvarLimiteCarencia(linha, 'limite', secao.categoriaId)}
                                                            onPaste={(e) =>
                                                                processarColagemLimCarencia(e, secao, linhaIndex, 'limite')
                                                            }
                                                        />
                                                    ) : (
                                                        <span>{linha.limite || '\u00a0'}</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {edicaoAtiva && linha.planosConfigId ? (
                                                        <input
                                                            className='table_cell_input_text'
                                                            type='text'
                                                            value={obterValorInputLim(linha, 'carencia', secao.categoriaId)}
                                                            onChange={(e) => {
                                                                const chave = chaveEdicaoLim(secao.categoriaId, linha.codigo, 'carencia')
                                                                setEdicoesLocais((a) => ({ ...a, [chave]: e.target.value }))
                                                            }}
                                                            onBlur={() => salvarLimiteCarencia(linha, 'carencia', secao.categoriaId)}
                                                            onPaste={(e) =>
                                                                processarColagemLimCarencia(e, secao, linhaIndex, 'carencia')
                                                            }
                                                        />
                                                    ) : (
                                                        <span>{linha.carencia || '\u00a0'}</span>
                                                    )}
                                                </td>
                                                {!somenteLeitura && (
                                                    <td>
                                                        <button
                                                            type='button'
                                                            className='table_delete_btn'
                                                            onClick={(event) =>
                                                                excluirPlanoConfigRow(linha, {
                                                                    ignorarConfirmacao: event.shiftKey,
                                                                })
                                                            }
                                                            title='Excluir registro, SHIFT = Excluir rápido'
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                        <tr className='row_add_line'>
                                            <td colSpan={somenteLeitura ? 4 : 5}>
                                                {categoriaEmInclusao === secao.categoriaId ? (
                                                    <div className='row_add_inline'>
                                                        <div
                                                            className='row_add_suggest_wrap'
                                                            ref={categoriaEmInclusao === secao.categoriaId ? sugestoesAnchorRef : null}
                                                        >
                                                            <input
                                                                type='text'
                                                                className='row_add_input'
                                                                placeholder='Digite nome ou código do procedimento'
                                                                value={textoNovoProcedimento}
                                                                onChange={(e) => {
                                                                    setTextoNovoProcedimento(e.target.value)
                                                                    setNovoProcedimentoSelecionadoCodigo('')
                                                                }}
                                                            />
                                                            {renderSugestoesPortal(secao, '-lim')}
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
                            )}
                        </section>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    )
}

export default Supertabelaplanos
