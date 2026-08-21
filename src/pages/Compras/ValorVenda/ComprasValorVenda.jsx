import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    PERMISSION_KEYS,
    hasPermission,
    hasStoredPermission,
    normalizarProfileAcesso,
    setStoredAccessProfile } from '../../../lib/accessControl'
import { filtrarPorTermoBusca, normalizarTextoBusca as normalizarTextoBuscaDev } from '../../../lib/prestadorCadastroHelpers'
import { extrairCodigosProcedimentoEmMassa } from '../../../lib/parseCodigosEmMassa'
import { buscarTodosPaginado, getReadOnlyFlag, supabase } from '../../../lib/supabase'
import { bloquearSeSomenteLeitura } from '../../../lib/readOnlyGuard'
import { TOAST_AUTO_DISMISS_MS, useConfirmacaoExclusaoAutoDismiss } from '../../../lib/toastUi.js'
import { PageHeader } from '../../../components/ui'
import './ComprasValorVenda.css'

const normalizarTexto = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const normalizarCod = (cod) => String(cod || '').trim().toUpperCase()

/** Lojinha: um valor por código, sem UF/cidade. */
const linhaLegadaLojinha = (row) => {
    const uf = row?.uf
    const cid = row?.cidade_id
    return (uf == null || uf === '') && (cid == null || cid === '')
}

const mesmaChaveLojinha = (a, b) =>
    normalizarCod(a.cod_procedimento) === normalizarCod(b.cod_procedimento)

const CHAVE_OUTROS = 'outros'

const ComprasValorVenda = () => {
    const [somenteLeitura, setSomenteLeitura] = useState(() => getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.COMPRAS_EDIT))
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [headerCompacto, setHeaderCompacto] = useState(false)

    const [vendas, setVendas] = useState([])
    const [procedimentos, setProcedimentos] = useState([])
    const [categorias, setCategorias] = useState([])
    const [termoBusca, setTermoBusca] = useState('')

    const [ordenacaoPorCategoria, setOrdenacaoPorCategoria] = useState({})

    const [edicaoAtiva, setEdicaoAtiva] = useState(false)

    const [modalAberto, setModalAberto] = useState(false)
    const [formCod, setFormCod] = useState('')
    const [formValor, setFormValor] = useState('')

    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)

    const [adicaoMassaAtiva, setAdicaoMassaAtiva] = useState(false)
    const [massaTexto, setMassaTexto] = useState('')
    const [salvandoValorId, setSalvandoValorId] = useState(null)
    const valorTabRefs = useRef({})

    const [categoriaEmInclusao, setCategoriaEmInclusao] = useState(null)
    const [textoNovoProcedimento, setTextoNovoProcedimento] = useState('')
    const [novoProcedimentoSelecionadoCodigo, setNovoProcedimentoSelecionadoCodigo] = useState('')
    const [popupSugestoesStyle, setPopupSugestoesStyle] = useState(null)
    const sugestoesAnchorRef = useRef(null)

    const podeEditar = !somenteLeitura && edicaoAtiva

    const idsCategoriasLista = useMemo(() => new Set(categorias.map((c) => Number(c.id))), [categorias])

    const mapaProcByCod = useMemo(() => {
        const m = new Map()
        ;(procedimentos || []).forEach((p) => m.set(normalizarCod(p.codigo), p))
        return m
    }, [procedimentos])

    const vendasLojinha = useMemo(() => (vendas || []).filter(linhaLegadaLojinha), [vendas])

    const qtdRegistrosEscopoRegional = useMemo(
        () => (vendas || []).filter((row) => !linhaLegadaLojinha(row)).length,
        [vendas],
    )

    const mostrarAviso = (mensagem) => {
        setAviso('')
        setTimeout(() => setAviso(mensagem), 0)
    }

    const carregarBase = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [
                { data: vendasData, error: errVendas },
                { data: procData, error: errProc },
                { data: categoriasData, error: errCat },
            ] = await Promise.all([
                buscarTodosPaginado(() =>
                    supabase
                        .from('servico_valor_venda')
                        .select('id, cod_procedimento, valor_venda, uf, cidade_id')
                        .order('id', { ascending: true })
                ),
                buscarTodosPaginado(() =>
                    supabase.from('procedimentos').select('codigo, nome, categoria_id').order('codigo', { ascending: true })
                ),
                supabase.from('categorias').select('id, nome').gte('id', 3).lte('id', 25).order('id', { ascending: true }),
            ])

            const mensagens = []
            if (errVendas) {
                mensagens.push(
                    `Valores de venda: ${errVendas.message}. Confira se o schema em db_supertabela.sql está aplicado no Supabase (tabela servico_valor_venda).`
                )
                setVendas([])
            } else {
                setVendas(vendasData || [])
            }

            if (errProc) mensagens.push(`Procedimentos: ${errProc.message}`)
            else setProcedimentos(procData || [])

            if (errCat) mensagens.push(`Categorias: ${errCat.message}`)
            else setCategorias(categoriasData || [])

            if (mensagens.length) setErro(mensagens.join(' | '))
            else setErro('')
        } catch (error) {
            setErro(error?.message || 'Falha ao carregar dados.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        carregarBase()
    }, [carregarBase])

    useEffect(() => {
        const carregarPermissoes = async () => {
            const { data: authData } = await supabase.auth.getUser()
            const userId = authData?.user?.id
            if (!userId) return
            let { data, error } = await supabase
                .from('profiles')
                .select('id, name, email, permissions')
                .eq('id', userId)
                .single()
            if (error && String(error.message || '').includes('email')) {
                const fallback = await supabase
                    .from('profiles')
                    .select('id, name, permissions')
                    .eq('id', userId)
                    .single()
                data = fallback.data
                error = fallback.error
            }
            if (!error) {
                const profile = normalizarProfileAcesso(data)
                setStoredAccessProfile(profile)
                setSomenteLeitura(getReadOnlyFlag() || !hasPermission(profile, PERMISSION_KEYS.COMPRAS_EDIT))
            }
        }
        carregarPermissoes()
    }, [])

    useEffect(() => {
        const onScroll = () => setHeaderCompacto(window.scrollY > 22)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        if (!aviso) return
        const t = setTimeout(() => setAviso(''), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(t)
    }, [aviso])

    const linhasMontadas = useMemo(() => {
        return vendasLojinha.map((row) => {
            const p = mapaProcByCod.get(normalizarCod(row.cod_procedimento))
            const categoriaId = p?.categoria_id != null ? Number(p.categoria_id) : null
            const cat = categoriaId != null ? categorias.find((c) => Number(c.id) === categoriaId) : null
            return {
                ...row,
                procedimentoNome: p?.nome || row.cod_procedimento,
                categoriaId,
                categoriaNome: cat?.nome || '' }
        })
    }, [vendasLojinha, mapaProcByCod, categorias])

    const linhasFiltradas = useMemo(() => {
        let base = linhasMontadas
        if (!termoBusca.trim()) return base

        return base.filter((row) => {
            const blob = normalizarTextoBuscaDev(
                [row.cod_procedimento, row.procedimentoNome, String(row.valor_venda ?? ''), row.categoriaNome]
                    .filter(Boolean)
                    .join(' '),
            )
            return filtrarPorTermoBusca(blob, termoBusca)
        })
    }, [linhasMontadas, termoBusca])

    const totalProcedimentosPorCategoria = useMemo(() => {
        const mapa = new Map()
        ;(procedimentos || []).forEach((item) => {
            const raw = item.categoria_id
            const id = raw != null ? Number(raw) : null
            if (id == null || !idsCategoriasLista.has(id)) {
                const atual = mapa.get(CHAVE_OUTROS) || 0
                mapa.set(CHAVE_OUTROS, atual + 1)
                return
            }
            mapa.set(id, (mapa.get(id) || 0) + 1)
        })
        return mapa
    }, [procedimentos, idsCategoriasLista])

    const ordenarLinhas = useCallback(
        (linhasParaOrdenar, categoriaChave) => {
            const resultado = [...linhasParaOrdenar]
            const atual = ordenacaoPorCategoria[categoriaChave] || { coluna: 'cod_procedimento', direcao: 'asc' }
            const fator = atual.direcao === 'asc' ? 1 : -1
            resultado.sort((a, b) => {
                const col = atual.coluna
                const av = col === 'procedimentoNome' ? a.procedimentoNome : a[col]
                const bv = col === 'procedimentoNome' ? b.procedimentoNome : b[col]
                if (col === 'valor_venda') {
                    return (Number(av || 0) - Number(bv || 0)) * fator
                }
                return String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { sensitivity: 'base' }) * fator
            })
            return resultado
        },
        [ordenacaoPorCategoria]
    )

    const secoesPorCategoria = useMemo(() => {
        const secoes = categorias
            .map((categoria) => {
                const categoriaId = categoria.id
                const chave = String(categoriaId)
                const linhasCat = linhasFiltradas.filter((linha) => Number(linha.categoriaId) === Number(categoriaId))
                return {
                    categoriaId,
                    categoriaChave: chave,
                    categoriaNome: categoria.nome,
                    linhas: ordenarLinhas(linhasCat, chave) }
            })
            .filter((secao) => secao.linhas.length > 0)

        const linhasOutros = linhasFiltradas.filter((linha) => {
            const id = linha.categoriaId != null ? Number(linha.categoriaId) : null
            return id == null || !idsCategoriasLista.has(id)
        })
        if (linhasOutros.length > 0) {
            secoes.push({
                categoriaId: CHAVE_OUTROS,
                categoriaChave: CHAVE_OUTROS,
                categoriaNome: 'Outros',
                linhas: ordenarLinhas(linhasOutros, CHAVE_OUTROS) })
        }
        return secoes
    }, [categorias, linhasFiltradas, ordenarLinhas, idsCategoriasLista])

    const ordemIdsTab = useMemo(() => secoesPorCategoria.flatMap((s) => s.linhas.map((r) => r.id)), [secoesPorCategoria])

    const handleOrdenarCategoria = (categoriaChave, coluna) => {
        setOrdenacaoPorCategoria((anterior) => {
            const atual = anterior[categoriaChave] || { coluna: 'cod_procedimento', direcao: 'asc' }
            const proxima =
                atual.coluna === coluna ? { coluna, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' } : { coluna, direcao: 'asc' }
            return { ...anterior, [categoriaChave]: proxima }
        })
    }

    const obterIndicadorOrdenacao = (categoriaChave, coluna) => {
        const atual = ordenacaoPorCategoria[categoriaChave] || { coluna: 'cod_procedimento', direcao: 'asc' }
        if (atual.coluna !== coluna) return ''
        return atual.direcao === 'asc' ? ' ▲' : ' ▼'
    }

    const setValorTabRef = (id, el) => {
        if (el) valorTabRefs.current[id] = el
        else delete valorTabRefs.current[id]
    }

    const salvarValorCelula = async (row, valorStr) => {
        const bruto = String(valorStr ?? '').trim().replace(',', '.')
        if (bruto === '') return
        const n = Number(bruto)
        if (Number.isNaN(n)) {
            mostrarAviso('Valor inválido.')
            return
        }
        if (Number(n) === Number(row.valor_venda)) return

        setSalvandoValorId(row.id)
        try {
            const { error } = await supabase.from('servico_valor_venda').update({ valor_venda: n }).eq('id', row.id)
            if (error) {
                mostrarAviso(`Erro ao salvar: ${error.message}`)
                return
            }
            setVendas((prev) => prev.map((v) => (Number(v.id) === Number(row.id) ? { ...v, valor_venda: n } : v)))
        } finally {
            setSalvandoValorId(null)
        }
    }

    const onValorTabKeyDown = useCallback(
        (e, rowId) => {
            if (e.key !== 'Tab' || !podeEditar) return
            const idx = ordemIdsTab.indexOf(rowId)
            if (idx < 0) return
            const destino = idx + (e.shiftKey ? -1 : 1)
            if (destino < 0 || destino >= ordemIdsTab.length) return
            e.preventDefault()
            const alvo = valorTabRefs.current[ordemIdsTab[destino]]
            if (alvo) {
                alvo.focus()
                if (typeof alvo.select === 'function') alvo.select()
            }
        },
        [ordemIdsTab, podeEditar]
    )

    const abrirNovo = () => {
        setFormCod('')
        setFormValor('')
        setModalAberto(true)
    }

    const fecharModal = () => {
        setModalAberto(false)
    }

    const salvarModal = async () => {
        const cod = normalizarCod(formCod)
        const valorNum = Number(String(formValor).replace(',', '.'))
        if (!cod || Number.isNaN(valorNum)) {
            mostrarAviso('Informe código de procedimento válido e valor numérico.')
            return
        }

        const payload = {
            cod_procedimento: cod,
            valor_venda: valorNum,
            uf: null,
            cidade_id: null }

        const candidato = { cod_procedimento: cod }
        const duplicado = vendasLojinha.some((v) => mesmaChaveLojinha(v, candidato))
        if (duplicado) {
            mostrarAviso('Este procedimento já possui valor na lojinha.')
            return
        }

        setLoading(true)
        try {
            const { error } = await supabase.from('servico_valor_venda').insert(payload)
            if (error) {
                mostrarAviso(`Erro ao inserir: ${error.message}`)
                return
            }
            fecharModal()
            await carregarBase()
        } finally {
            setLoading(false)
        }
    }

    const excluirLinha = async (row, opcoes = {}) => {
        if (bloquearSeSomenteLeitura(mostrarAviso)) return
        const executar = async () => {
            setLoading(true)
            try {
                const { error } = await supabase.from('servico_valor_venda').delete().eq('id', row.id)
                if (error) {
                    mostrarAviso(`Erro ao excluir: ${error.message}`)
                    return
                }
                await carregarBase()
            } finally {
                setLoading(false)
            }
        }
        if (opcoes.ignorarConfirmacao) {
            await executar()
            return
        }
        setConfirmacaoExclusao({
            mensagem: `Excluir o valor de venda do procedimento ${row.cod_procedimento}?`,
            onConfirmar: executar })
    }

    const aplicarMassa = async () => {
        const codigos = extrairCodigosProcedimentoEmMassa(massaTexto)
        if (!codigos.length) {
            mostrarAviso('Informe ao menos um código (um por linha ou separados por vírgula ou tabulação).')
            return
        }

        setLoading(true)
        try {
            const { data: validos, error: errVal } = await supabase.from('procedimentos').select('codigo').in('codigo', codigos)
            if (errVal) {
                mostrarAviso(`Erro ao validar procedimentos: ${errVal.message}`)
                return
            }
            const setOk = new Set((validos || []).map((p) => normalizarCod(p.codigo)))
            const naoEncontrados = codigos.filter((c) => !setOk.has(c))

            let inseridos = 0
            let jaExistiam = 0
            let ignorados = 0
            const erros = []

            for (const codigo of codigos) {
                if (!setOk.has(codigo)) {
                    ignorados += 1
                    continue
                }
                const candidato = {
                    cod_procedimento: codigo,
                    valor_venda: 0,
                    uf: null,
                    cidade_id: null }
                const existente = vendasLojinha.find((v) => mesmaChaveLojinha(v, candidato))
                if (existente) {
                    jaExistiam += 1
                    continue
                }
                const { error } = await supabase.from('servico_valor_venda').upsert(candidato, {
                    onConflict: 'cod_procedimento',
                    ignoreDuplicates: true })
                if (error) erros.push(`${codigo}: ${error.message}`)
                else inseridos += 1
            }

            setMassaTexto('')
            await carregarBase()

            const partes = []
            if (inseridos) partes.push(`${inseridos} inserido(s) com valor zerado`)
            if (jaExistiam) partes.push(`${jaExistiam} já existente(s) na base (ignorados)`)
            if (ignorados) partes.push(`${ignorados} código(s) inválido(s)`)
            if (naoEncontrados.length) partes.push(`Não encontrados: ${naoEncontrados.slice(0, 12).join(', ')}${naoEncontrados.length > 12 ? '…' : ''}`)
            if (erros.length) partes.push(`${erros.length} erro(s): ${erros.slice(0, 4).join(' | ')}`)
            mostrarAviso(`Adição em massa concluída — ${partes.join(' · ')}.`)
        } finally {
            setLoading(false)
        }
    }

    const codigosJaEmVenda = useMemo(
        () => new Set(vendasLojinha.map((v) => normalizarCod(v.cod_procedimento))),
        [vendasLojinha],
    )

    const obterSugestoesProcedimentos = useCallback(
        (categoriaId) => {
            return procedimentos.filter((item) => {
                if (codigosJaEmVenda.has(normalizarCod(item.codigo))) return false
                const pid = item.categoria_id != null ? Number(item.categoria_id) : null
                if (categoriaId === CHAVE_OUTROS) {
                    return pid == null || !idsCategoriasLista.has(pid)
                }
                return pid === Number(categoriaId)
            })
        },
        [procedimentos, codigosJaEmVenda, idsCategoriasLista]
    )

    const sugestoesFiltradasInclusao = useMemo(() => {
        if (categoriaEmInclusao === null || categoriaEmInclusao === undefined) return []
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
    }, [categoriaEmInclusao, textoNovoProcedimento, obterSugestoesProcedimentos])

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
        if (String(categoriaEmInclusao) !== String(secao.categoriaId)) return null
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
                            key={`${secao.categoriaChave}-${item.codigo}`}
                            type='button'
                            className={`row_add_suggest_item ${
                                normalizarCod(novoProcedimentoSelecionadoCodigo) === normalizarCod(item.codigo) ? 'is-active' : ''
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

    const confirmarNovoProcedimentoCategoria = async (secao) => {
        const sugestoes = obterSugestoesProcedimentos(secao.categoriaId)
        const entrada = normalizarTexto(textoNovoProcedimento)
        if (!entrada) {
            mostrarAviso('Digite ou selecione um procedimento da lista.')
            return
        }

        let encontrado = null
        if (novoProcedimentoSelecionadoCodigo) {
            encontrado = sugestoes.find((item) => normalizarCod(item.codigo) === normalizarCod(novoProcedimentoSelecionadoCodigo))
        }

        if (!encontrado) {
            encontrado = sugestoes.find((item) => {
                const codigo = normalizarTexto(item.codigo)
                const nome = normalizarTexto(item.nome)
                const opcaoCodigoNome = normalizarTexto(`${item.codigo} - ${item.nome}`)
                const opcaoNomeCodigo = normalizarTexto(`${item.nome} - ${item.codigo}`)
                return entrada === codigo || entrada === nome || entrada === opcaoCodigoNome || entrada === opcaoNomeCodigo
            })
        }

        if (!encontrado) {
            mostrarAviso('Selecione um procedimento sugerido da mesma categoria.')
            return
        }

        const codigoNormalizado = normalizarCod(encontrado.codigo)
        if (codigosJaEmVenda.has(codigoNormalizado)) {
            mostrarAviso('Este procedimento já possui valor de venda cadastrado.')
            return
        }

        setLoading(true)
        try {
            const { error } = await supabase.from('servico_valor_venda').upsert(
                {
                    cod_procedimento: encontrado.codigo,
                    valor_venda: 0,
                    uf: null,
                    cidade_id: null },
                {
                    onConflict: 'cod_procedimento',
                    ignoreDuplicates: true }
            )
            if (error) {
                mostrarAviso(`Erro ao adicionar procedimento: ${error.message}`)
                return
            }
            setCategoriaEmInclusao(null)
            setTextoNovoProcedimento('')
            setNovoProcedimentoSelecionadoCodigo('')
            await carregarBase()
            mostrarAviso(`Procedimento ${encontrado.codigo} adicionado com valor zerado.`)
        } finally {
            setLoading(false)
        }
    }

    const totalNaCategoria = (secao) => {
        if (secao.categoriaId === CHAVE_OUTROS) {
            return totalProcedimentosPorCategoria.get(CHAVE_OUTROS) || 0
        }
        return totalProcedimentosPorCategoria.get(Number(secao.categoriaId)) || 0
    }

    const colSpanTabela = !somenteLeitura ? 4 : 3

    return (
        <div className='el-legacy-wrap compras_vv'>
            <PageHeader
                kicker='Compras'
                title='Valor de Venda'
                description='Gerencie os valores de venda da lojinha por procedimento e categoria.'
            />

            <header className={`compras_vv_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='compras_vv_header_body'>
                    <div className='compras_vv_filters'>
                        <div className='compras_vv_filter_item compras_vv_filter_busca'>
                            <p>Busca</p>
                            <input
                                type='text'
                                className='compras_vv_input compras_vv_input_filter'
                                placeholder='Código, nome ou categoria'
                                value={termoBusca}
                                onChange={(e) => setTermoBusca(e.target.value)}
                            />
                        </div>

                        {!somenteLeitura && (
                            <label className='compras_vv_edit_wrap'>
                                <input type='checkbox' checked={edicaoAtiva} onChange={(e) => setEdicaoAtiva(e.target.checked)} />
                                <span>Habilitar edição</span>
                            </label>
                        )}

                        {!somenteLeitura && (
                            <label className='compras_vv_edit_wrap'>
                                <input type='checkbox' checked={adicaoMassaAtiva} onChange={(e) => setAdicaoMassaAtiva(e.target.checked)} />
                                <span>Adição em massa</span>
                            </label>
                        )}

                        {!somenteLeitura && (
                            <button type='button' className='compras_vv_filters_action_btn' onClick={abrirNovo}>
                                ＋ Novo registro
                            </button>
                        )}
                    </div>

                    {adicaoMassaAtiva && !somenteLeitura && (
                        <div className='compras_vv_massa_panel'>
                            <p>Adicionar procedimentos em massa na tabela de valores de venda</p>
                            <div className='compras_vv_massa_form'>
                                <label htmlFor='compras-vv-codigos-massa'>
                                    IDs de procedimentos (um por linha ou separados por vírgula)
                                </label>
                                <textarea
                                    id='compras-vv-codigos-massa'
                                    rows={3}
                                    value={massaTexto}
                                    onChange={(e) => setMassaTexto(e.target.value)}
                                    placeholder={`Ex.: CONS-00N, EXAM-103 ou um código por linha`}
                                />
                                <button type='button' className='compras_vv_massa_btn' disabled={loading} onClick={aplicarMassa}>
                                    Inserir procedimentos em massa
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </header>

            {erro && (
                <div className='compras_vv_alert' role='alert'>
                    <span>{erro}</span>
                    <button type='button' onClick={() => setErro('')}>
                        x
                    </button>
                </div>
            )}

            {qtdRegistrosEscopoRegional > 0 && (
                <div className='compras_vv_alert compras_vv_alert_info' role='status'>
                    <span>
                        Existem {qtdRegistrosEscopoRegional} registro(s) antigos com UF/cidade no banco; não entram na
                        lojinha nem no orçamento.
                    </span>
                </div>
            )}

            {aviso && (
                <div className='compras_vv_alert' role='status'>
                    <span>{aviso}</span>
                    <button type='button' onClick={() => setAviso('')}>
                        x
                    </button>
                </div>
            )}

            {somenteLeitura && (
                <p style={{ margin: '8px 0', fontSize: '0.88rem' }}>
                    Perfil somente leitura: visualização e busca liberadas; criação, edição e exclusão bloqueadas.
                </p>
            )}

            {confirmacaoExclusao && (
                <div className='compras_vv_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div>
                        <strong>Confirmar exclusão</strong>
                        <div>{confirmacaoExclusao.mensagem}</div>
                    </div>
                    <div className='compras_vv_confirm_actions'>
                        <button
                            type='button'
                            className='compras_vv_confirm_btn danger'
                            onClick={async () => {
                                const fn = confirmacaoExclusao.onConfirmar
                                setConfirmacaoExclusao(null)
                                await fn()
                            }}
                        >
                            Confirmar
                        </button>
                        <button type='button' className='compras_vv_confirm_btn' onClick={() => setConfirmacaoExclusao(null)}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            <div className='compras_vv_table_container overflow-x-auto'>
                {loading ? (
                    <p>Carregando...</p>
                ) : linhasFiltradas.length === 0 ? (
                    <p>Nenhum registro encontrado com a busca atual.</p>
                ) : (
                    <>
                        {podeEditar && (
                            <p className='compras_vv_valor_tab_hint'>
                                Edite o valor diretamente na tabela; ao sair do campo o valor é salvo. Use <kbd>Tab</kbd> para ir ao próximo valor na ordem
                                das categorias (Shift+Tab volta).
                            </p>
                        )}
                        <div className='compras_vv_secoes'>
                            {secoesPorCategoria.map((secao) => (
                                <section key={`vv-cat-${secao.categoriaChave}`} className='categoria_secao'>
                                    <div className='categoria_header'>
                                        <h2 className='categoria_titulo'>{secao.categoriaNome}</h2>
                                        <span className='categoria_contagem'>
                                            {secao.linhas.length}/{totalNaCategoria(secao)}
                                        </span>
                                    </div>
                                    <table className='table_main compras_vv_table_cat'>
                                        <colgroup>
                                            <col className='compras_vv_col_cod' />
                                            <col className='compras_vv_col_nome' />
                                            <col className='compras_vv_col_valor' />
                                            {!somenteLeitura && <col className='compras_vv_col_acao' />}
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaChave, 'cod_procedimento')}>
                                                    Código{obterIndicadorOrdenacao(secao.categoriaChave, 'cod_procedimento')}
                                                </th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaChave, 'procedimentoNome')}>
                                                    Procedimento{obterIndicadorOrdenacao(secao.categoriaChave, 'procedimentoNome')}
                                                </th>
                                                <th className='table_header' onClick={() => handleOrdenarCategoria(secao.categoriaChave, 'valor_venda')}>
                                                    Valor venda{obterIndicadorOrdenacao(secao.categoriaChave, 'valor_venda')}
                                                </th>
                                                {!somenteLeitura && <th className='table_header table_header_no_sort'>Ações</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {secao.linhas.map((row) => (
                                                <tr key={row.id}>
                                                    <td className='table_text_left compras_vv_cell_cod'>
                                                        <strong>{row.cod_procedimento}</strong>
                                                    </td>
                                                    <td className='table_text_left compras_vv_cell_nome'>{row.procedimentoNome}</td>
                                                    <td className='compras_vv_cell_valor'>
                                                        {podeEditar ? (
                                                            <input
                                                                type='text'
                                                                inputMode='decimal'
                                                                className='compras_vv_valor_tab'
                                                                aria-label={`Valor de venda ${row.cod_procedimento}`}
                                                                key={`valor-${row.id}-${String(row.valor_venda ?? '')}`}
                                                                ref={(el) => setValorTabRef(row.id, el)}
                                                                defaultValue={
                                                                    row.valor_venda == null || row.valor_venda === ''
                                                                        ? '0'
                                                                        : String(row.valor_venda)
                                                                }
                                                                disabled={salvandoValorId === row.id}
                                                                onKeyDown={(e) => onValorTabKeyDown(e, row.id)}
                                                                onBlur={(e) => {
                                                                    const v = e.target.value
                                                                    if (!String(v).trim()) {
                                                                        e.target.value =
                                                                            row.valor_venda == null || row.valor_venda === ''
                                                                                ? '0'
                                                                                : String(Number(row.valor_venda))
                                                                        return
                                                                    }
                                                                    salvarValorCelula(row, v)
                                                                }}
                                                            />
                                                        ) : (
                                                            Number(row.valor_venda || 0).toFixed(2)
                                                        )}
                                                    </td>
                                                    {!somenteLeitura && (
                                                        <td className='compras_vv_cell_acao'>
                                                            <div className='compras_vv_acoes_linha'>
                                                                <button
                                                                    type='button'
                                                                    className='table_delete_btn'
                                                                    onClick={(e) => excluirLinha(row, { ignorarConfirmacao: e.shiftKey })}
                                                                    title='Excluir valor de venda (Shift = excluir rápido)'
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                            <tr className='row_add_line'>
                                                <td colSpan={colSpanTabela}>
                                                    {String(categoriaEmInclusao) === String(secao.categoriaId) ? (
                                                        <div className='row_add_inline'>
                                                            <div
                                                                className='row_add_suggest_wrap'
                                                                ref={String(categoriaEmInclusao) === String(secao.categoriaId) ? sugestoesAnchorRef : null}
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
                                                            <button type='button' className='row_add_btn' onClick={() => confirmarNovoProcedimentoCategoria(secao)}>
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
                                                    ) : null}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </section>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {modalAberto && (
                <div className='compras_vv_modal_backdrop' onClick={fecharModal}>
                    <div className='compras_vv_modal' onClick={(e) => e.stopPropagation()}>
                        <h3>Novo valor de venda</h3>
                        <div className='compras_vv_modal_grid'>
                            <label className='compras_vv_modal_full'>
                                <span>Procedimento (código)</span>
                                <select className='compras_vv_select' value={formCod} onChange={(e) => setFormCod(e.target.value)}>
                                    <option value=''>Selecione</option>
                                    {procedimentos.map((p) => (
                                        <option key={p.codigo} value={normalizarCod(p.codigo)}>
                                            {p.codigo} — {p.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className='compras_vv_modal_full'>
                                <span>Valor de venda (R$)</span>
                                <input className='compras_vv_input' value={formValor} onChange={(e) => setFormValor(e.target.value)} />
                            </label>
                        </div>
                        <div className='compras_vv_modal_actions'>
                            <button type='button' className='compras_vv_action_btn secondary' onClick={fecharModal}>
                                Cancelar
                            </button>
                            <button type='button' className='compras_vv_action_btn' disabled={loading} onClick={salvarModal}>
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ComprasValorVenda
