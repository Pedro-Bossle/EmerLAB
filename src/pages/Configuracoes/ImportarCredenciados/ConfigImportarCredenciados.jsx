import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    usuarioPodeEditarFerramenta,
} from '../../../lib/accessControl'
import {
    carregarCodigosPerfilPorPrestadores,
    classificarLinhasImportCredenciados,
    listarOrfaosPerfilForaDaPlanilha,
    parsearExcelImportCredenciados,
    removerProcedimentoDoPerfil,
    vincularProcedimentoAoPerfil,
} from '../../../lib/configuracoes/importCredenciadosProcedimentos.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import PrestadorVinculoBusca from '../../Supertabela/Supertabela_negociacoes/PrestadorVinculoBusca.jsx'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigImportarCredenciados.css'

const ROTULO_STATUS = {
    ja_vinculado: 'No perfil',
    fora_perfil: 'Fora do perfil',
    revisar_credenciado: 'Revisar credenciado',
    revisar_procedimento: 'Revisar procedimento',
    sem_credenciado: 'Sem credenciado',
    sem_procedimento: 'Sem procedimento',
    ok: 'OK',
}

const TAMANHO_PAGINA = 100

function statusComPerfil(linha, mapaCodigos) {
    const codigo = String(linha.procedimentoCodigoResolvido || '').trim().toUpperCase()
    const pid = Number(linha.prestadorId)
    if (!pid || !codigo) return linha
    const noPerfil = Boolean(mapaCodigos.get(pid)?.has(codigo))
    return {
        ...linha,
        noPerfil,
        status: noPerfil ? 'ja_vinculado' : 'fora_perfil',
        sugestoesPrestador: [],
    }
}

const ConfigImportarCredenciados = () => {
    const profile = getStoredAccessProfile()
    const somenteLeitura = useMemo(() => {
        if (!profile) return true
        if (usuarioPodeEditarFerramenta(profile.permissions, 'configuracoes.importar_credenciados')) {
            return false
        }
        return !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
    }, [profile])

    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [prestadores, setPrestadores] = useState([])
    const [procedimentos, setProcedimentos] = useState([])
    const [nomeArquivo, setNomeArquivo] = useState('')
    const [linhas, setLinhas] = useState([])
    const [codigosPorPrestador, setCodigosPorPrestador] = useState(() => new Map())
    const [orfaosMantidos, setOrfaosMantidos] = useState(() => new Set())
    const [processando, setProcessando] = useState(false)
    const [acaoId, setAcaoId] = useState('')
    const [paginaLinhas, setPaginaLinhas] = useState(1)
    const [paginaOrfaos, setPaginaOrfaos] = useState(1)
    const [somenteForaDoPerfil, setSomenteForaDoPerfil] = useState(false)
    const [vinculandoLote, setVinculandoLote] = useState(false)
    const [arrastandoArquivo, setArrastandoArquivo] = useState(false)
    const orfaosRef = useRef(null)
    const inputArquivoRef = useRef(null)

    const chaveOrfao = (prestadorId, codigo) =>
        `${Number(prestadorId)}|${String(codigo || '').trim().toUpperCase()}`

    const carregarBase = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [{ data: prestadoresData, error: errP }, { data: procsData, error: errProc }] =
                await Promise.all([
                    buscarTodosPaginado(() =>
                        supabase
                            .from('prestadores')
                            .select('id, nome, ativo')
                            .eq('ativo', true)
                            .order('nome', { ascending: true }),
                    ),
                    buscarTodosPaginado(() =>
                        supabase
                            .from('procedimentos')
                            .select('id, codigo, nome, categoria_id')
                            .order('codigo', { ascending: true }),
                    ),
                ])
            if (errP) throw new Error(errP.message)
            if (errProc) throw new Error(errProc.message)
            setPrestadores(prestadoresData || [])
            setProcedimentos(procsData || [])
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregarBase()
    }, [carregarBase])

    const prestadoresPorId = useMemo(() => {
        const m = new Map()
        for (const p of prestadores) m.set(Number(p.id), p)
        return m
    }, [prestadores])

    const procedimentosPorCodigo = useMemo(() => {
        const m = new Map()
        for (const p of procedimentos) {
            const cod = String(p.codigo || '')
                .trim()
                .toUpperCase()
            if (cod) m.set(cod, p)
        }
        return m
    }, [procedimentos])

    const garantirCodigosPrestador = async (pid, { forcar = false } = {}) => {
        const id = Number(pid)
        if (!id) return codigosPorPrestador
        if (!forcar && codigosPorPrestador.has(id)) return codigosPorPrestador
        const carregado = await carregarCodigosPerfilPorPrestadores([
            ...new Set([...codigosPorPrestador.keys(), id]),
        ])
        setCodigosPorPrestador(carregado)
        return carregado
    }

    const processarArquivo = async (file) => {
        if (!file) return
        const nome = String(file.name || '').toLowerCase()
        if (!nome.endsWith('.xlsx') && !nome.endsWith('.xls')) {
            setErro('Selecione um arquivo Excel (.xlsx ou .xls).')
            return
        }
        setProcessando(true)
        setErro('')
        setFeedback('')
        setOrfaosMantidos(new Set())
        setPaginaLinhas(1)
        setPaginaOrfaos(1)
        setNomeArquivo(file.name)
        try {
            const buffer = await file.arrayBuffer()
            const { linhas: brutas, erro: erroParse } = await parsearExcelImportCredenciados(buffer)
            if (erroParse) {
                setErro(erroParse)
                setLinhas([])
                return
            }

            const pre = classificarLinhasImportCredenciados({
                linhasBrutas: brutas,
                prestadores,
                procedimentos,
                codigosPorPrestadorId: new Map(),
            })
            const ids = [
                ...new Set(
                    pre
                        .flatMap((l) => [
                            l.prestadorId,
                            ...(l.sugestoesPrestador || []).map((s) => s.id),
                        ])
                        .map(Number)
                        .filter(Boolean),
                ),
            ]
            const mapaCodigos = await carregarCodigosPerfilPorPrestadores(ids)
            setCodigosPorPrestador(mapaCodigos)
            const classificadas = classificarLinhasImportCredenciados({
                linhasBrutas: brutas,
                prestadores,
                procedimentos,
                codigosPorPrestadorId: mapaCodigos,
            })
            setLinhas(classificadas)
            const orfaosIniciais = listarOrfaosPerfilForaDaPlanilha({
                linhasClassificadas: classificadas,
                codigosPorPrestadorId: mapaCodigos,
                procedimentosPorCodigo: new Map(
                    (procedimentos || []).map((p) => [
                        String(p.codigo || '')
                            .trim()
                            .toUpperCase(),
                        p,
                    ]),
                ),
                prestadoresPorId: new Map((prestadores || []).map((p) => [Number(p.id), p])),
            })
            const msgBase = `${brutas.length} linha(s) carregada(s) de ${file.name}.`
            setFeedback(
                orfaosIniciais.length
                    ? `${msgBase} ${orfaosIniciais.length} procedimento(s) no perfil estão fora da planilha — revise ao final.`
                    : msgBase,
            )
        } catch (e) {
            setErro(e?.message || String(e))
            setLinhas([])
        } finally {
            setProcessando(false)
        }
    }

    const onArquivo = (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        void processarArquivo(file)
    }

    const onDropArquivo = (event) => {
        event.preventDefault()
        event.stopPropagation()
        setArrastandoArquivo(false)
        if (loading || processando) return
        const file = event.dataTransfer?.files?.[0]
        void processarArquivo(file)
    }

    const contarOrfaosNoMapa = (prestadorId, mapa, linhasAtuais) => {
        const pid = Number(prestadorId)
        const noExcel = new Set()
        for (const l of linhasAtuais || []) {
            if (Number(l.prestadorId) !== pid) continue
            const cod = String(l.procedimentoCodigoResolvido || '')
                .trim()
                .toUpperCase()
            if (cod) noExcel.add(cod)
        }
        const noPerfil = mapa.get(pid) || new Set()
        let qtd = 0
        for (const cod of noPerfil) {
            if (!noExcel.has(cod)) qtd += 1
        }
        return qtd
    }

    const fixarPrestador = async (idLocal, prestador) => {
        if (!prestador?.id) return
        const mapa = await garantirCodigosPrestador(prestador.id, { forcar: true })
        const origem = linhas.find((l) => l.idLocal === idLocal)
        const chaveNome = normalizarTextoBusca(origem?.nomeCredenciado)
        const totalMesmoNome = chaveNome
            ? linhas.filter((l) => normalizarTextoBusca(l.nomeCredenciado) === chaveNome).length
            : 1

        const linhasAtualizadas = linhas.map((l) => {
            const mesmoNome =
                chaveNome && normalizarTextoBusca(l.nomeCredenciado) === chaveNome
            if (l.idLocal !== idLocal && !mesmoNome) return l
            return statusComPerfil(
                {
                    ...l,
                    prestadorId: Number(prestador.id),
                    prestadorNome: prestador.nome || '',
                    sugestoesPrestador: [],
                },
                mapa,
            )
        })
        setLinhas(linhasAtualizadas)

        const qtdOrfaos = contarOrfaosNoMapa(prestador.id, mapa, linhasAtualizadas)
        const partes = []
        if (totalMesmoNome > 1) {
            partes.push(
                `Credenciado “${prestador.nome}” aplicado a ${totalMesmoNome} linha(s) com o mesmo nome na planilha.`,
            )
        } else {
            partes.push(`Credenciado “${prestador.nome}” vinculado.`)
        }
        if (qtdOrfaos > 0) {
            partes.push(
                `${qtdOrfaos} procedimento(s) no perfil não estão na planilha — revise abaixo (remover ou manter).`,
            )
            requestAnimationFrame(() => {
                orfaosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
        }
        setFeedback(partes.join(' '))
    }

    const fixarProcedimento = async (idLocal, proc) => {
        if (!proc) return
        const cod = String(proc.codigo || '')
            .trim()
            .toUpperCase()
        setLinhas((anteriores) => {
            const alvo = anteriores.find((l) => l.idLocal === idLocal)
            const mapa = codigosPorPrestador
            return anteriores.map((l) => {
                if (l.idLocal !== idLocal) return l
                const next = {
                    ...l,
                    procedimentoId: proc.id ?? null,
                    procedimentoCodigoResolvido: cod,
                    procedimentoNomeResolvido: proc.nome || '',
                    procedimentoCodigo: cod,
                    procedimentoNome: proc.nome || l.procedimentoNome,
                    sugestoesProcedimento: [],
                }
                if (!alvo?.prestadorId) {
                    return { ...next, status: 'revisar_credenciado', noPerfil: false }
                }
                return statusComPerfil(next, mapa)
            })
        })
    }

    const excluirRegistro = (idLocal) => {
        setLinhas((anteriores) => {
            const next = anteriores.filter((l) => l.idLocal !== idLocal)
            const totalPaginas = Math.max(1, Math.ceil(next.length / TAMANHO_PAGINA))
            setPaginaLinhas((p) => Math.min(p, totalPaginas))
            return next
        })
        setFeedback('Linha removida só desta lista de revisão (nada foi alterado no cadastro).')
    }

    const vincular = async (linha) => {
        if (somenteLeitura || !linha.prestadorId || !linha.procedimentoCodigoResolvido) return
        setAcaoId(linha.idLocal)
        setErro('')
        try {
            await vincularProcedimentoAoPerfil(linha.prestadorId, linha.procedimentoCodigoResolvido)
            const cod = String(linha.procedimentoCodigoResolvido).toUpperCase()
            setCodigosPorPrestador((anterior) => {
                const next = new Map(anterior)
                const set = new Set(next.get(Number(linha.prestadorId)) || [])
                set.add(cod)
                next.set(Number(linha.prestadorId), set)
                return next
            })
            setLinhas((anteriores) =>
                anteriores.map((l) =>
                    l.idLocal === linha.idLocal
                        ? { ...l, noPerfil: true, status: 'ja_vinculado' }
                        : l,
                ),
            )
            setFeedback(`Vinculado ${cod} a ${linha.prestadorNome}.`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAcaoId('')
        }
    }

    const removerDoPerfil = async (prestadorId, codigo, idLocal) => {
        if (somenteLeitura) return
        setAcaoId(idLocal)
        setErro('')
        try {
            await removerProcedimentoDoPerfil(prestadorId, codigo)
            const cod = String(codigo).toUpperCase()
            setCodigosPorPrestador((anterior) => {
                const next = new Map(anterior)
                const set = new Set(next.get(Number(prestadorId)) || [])
                set.delete(cod)
                next.set(Number(prestadorId), set)
                return next
            })
            setLinhas((anteriores) =>
                anteriores.map((l) => {
                    if (
                        Number(l.prestadorId) === Number(prestadorId) &&
                        String(l.procedimentoCodigoResolvido).toUpperCase() === cod
                    ) {
                        return { ...l, noPerfil: false, status: 'fora_perfil' }
                    }
                    return l
                }),
            )
            setFeedback(`Removido ${cod} do perfil.`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAcaoId('')
        }
    }

    const orfaos = useMemo(() => {
        const todos = listarOrfaosPerfilForaDaPlanilha({
            linhasClassificadas: linhas,
            codigosPorPrestadorId: codigosPorPrestador,
            procedimentosPorCodigo,
            prestadoresPorId,
        })
        return todos.filter((o) => !orfaosMantidos.has(chaveOrfao(o.prestadorId, o.procedimentoCodigo)))
    }, [linhas, codigosPorPrestador, procedimentosPorCodigo, prestadoresPorId, orfaosMantidos])

    const manterOrfao = (prestadorId, codigo) => {
        const chave = chaveOrfao(prestadorId, codigo)
        setOrfaosMantidos((anterior) => new Set([...anterior, chave]))
        setFeedback(`Procedimento ${codigo} mantido no perfil.`)
    }

    const resumo = useMemo(() => {
        const r = { total: linhas.length, noPerfil: 0, fora: 0, revisar: 0, sem: 0 }
        for (const l of linhas) {
            if (l.status === 'ja_vinculado' || l.noPerfil) r.noPerfil += 1
            else if (l.status === 'fora_perfil') r.fora += 1
            else if (String(l.status).startsWith('revisar')) r.revisar += 1
            else r.sem += 1
        }
        return r
    }, [linhas])

    const linhasExibidas = useMemo(() => {
        if (!somenteForaDoPerfil) return linhas
        return linhas.filter((l) => !(l.noPerfil || l.status === 'ja_vinculado'))
    }, [linhas, somenteForaDoPerfil])

    const candidatosVincularLote = useMemo(
        () =>
            linhasExibidas.filter(
                (l) =>
                    l.prestadorId &&
                    l.procedimentoCodigoResolvido &&
                    !l.noPerfil &&
                    l.status === 'fora_perfil',
            ),
        [linhasExibidas],
    )

    const totalPaginasLinhas = Math.max(1, Math.ceil(linhasExibidas.length / TAMANHO_PAGINA) || 1)
    const linhasPagina = useMemo(() => {
        const pagina = Math.min(Math.max(1, paginaLinhas), totalPaginasLinhas)
        const ini = (pagina - 1) * TAMANHO_PAGINA
        return linhasExibidas.slice(ini, ini + TAMANHO_PAGINA)
    }, [linhasExibidas, paginaLinhas, totalPaginasLinhas])

    const totalPaginasOrfaos = Math.max(1, Math.ceil(orfaos.length / TAMANHO_PAGINA) || 1)
    const orfaosPagina = useMemo(() => {
        const pagina = Math.min(Math.max(1, paginaOrfaos), totalPaginasOrfaos)
        const ini = (pagina - 1) * TAMANHO_PAGINA
        return orfaos.slice(ini, ini + TAMANHO_PAGINA)
    }, [orfaos, paginaOrfaos, totalPaginasOrfaos])

    useEffect(() => {
        if (paginaLinhas > totalPaginasLinhas) setPaginaLinhas(totalPaginasLinhas)
    }, [paginaLinhas, totalPaginasLinhas])

    useEffect(() => {
        if (paginaOrfaos > totalPaginasOrfaos) setPaginaOrfaos(totalPaginasOrfaos)
    }, [paginaOrfaos, totalPaginasOrfaos])

    useEffect(() => {
        setPaginaLinhas(1)
    }, [somenteForaDoPerfil])

    const vincularLoteForaPerfil = async () => {
        if (somenteLeitura || !candidatosVincularLote.length) return
        setVinculandoLote(true)
        setErro('')
        let ok = 0
        let falhas = 0
        try {
            for (const linha of candidatosVincularLote) {
                try {
                    await vincularProcedimentoAoPerfil(
                        linha.prestadorId,
                        linha.procedimentoCodigoResolvido,
                    )
                    const cod = String(linha.procedimentoCodigoResolvido).toUpperCase()
                    const pid = Number(linha.prestadorId)
                    setCodigosPorPrestador((anterior) => {
                        const next = new Map(anterior)
                        const set = new Set(next.get(pid) || [])
                        set.add(cod)
                        next.set(pid, set)
                        return next
                    })
                    setLinhas((anteriores) =>
                        anteriores.map((l) =>
                            l.idLocal === linha.idLocal
                                ? { ...l, noPerfil: true, status: 'ja_vinculado' }
                                : l,
                        ),
                    )
                    ok += 1
                } catch {
                    falhas += 1
                }
            }
            setFeedback(
                falhas
                    ? `Vinculados ${ok} procedimento(s). ${falhas} falha(s).`
                    : `Vinculados ${ok} procedimento(s) que estavam fora do perfil.`,
            )
        } finally {
            setVinculandoLote(false)
        }
    }

    const renderPaginacao = (pagina, totalPaginas, onChange, totalItens, rotulo) => {
        if (totalItens <= TAMANHO_PAGINA) return null
        const ini = (pagina - 1) * TAMANHO_PAGINA + 1
        const fim = Math.min(pagina * TAMANHO_PAGINA, totalItens)
        return (
            <div className='config_import_cred_paginacao'>
                <span>
                    {rotulo}: {ini}–{fim} de {totalItens}
                </span>
                <div className='config_import_cred_paginacao_btns'>
                    <button
                        type='button'
                        className='credenciamento_main_action_btn secondary'
                        disabled={pagina <= 1}
                        onClick={() => onChange(1)}
                    >
                        «
                    </button>
                    <button
                        type='button'
                        className='credenciamento_main_action_btn secondary'
                        disabled={pagina <= 1}
                        onClick={() => onChange(pagina - 1)}
                    >
                        Anterior
                    </button>
                    <span className='config_import_cred_pagina_num'>
                        Página {pagina} / {totalPaginas}
                    </span>
                    <button
                        type='button'
                        className='credenciamento_main_action_btn secondary'
                        disabled={pagina >= totalPaginas}
                        onClick={() => onChange(pagina + 1)}
                    >
                        Próxima
                    </button>
                    <button
                        type='button'
                        className='credenciamento_main_action_btn secondary'
                        disabled={pagina >= totalPaginas}
                        onClick={() => onChange(totalPaginas)}
                    >
                        »
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className='credenciamento_main config_import_cred'>
            <h1>Importar Credenciados</h1>
            <hr />

            <p className='config_import_cred_lead'>
                Compare uma planilha com o perfil dos veterinários: o sistema cruza nome e código do
                procedimento e mostra o que já está no perfil, o que falta e o que precisa revisar.
            </p>

            {erro ? (
                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role='alert' />
            ) : null}
            {feedback ? (
                <CredenciamentoMainAlert
                    message={feedback}
                    onClose={() => setFeedback('')}
                    role='status'
                />
            ) : null}

            <div
                className={`config_import_cred_drop${arrastandoArquivo ? ' is-drag' : ''}${loading || processando ? ' is-busy' : ''}`}
                onDragEnter={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!loading && !processando) setArrastandoArquivo(true)
                }}
                onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                }}
                onDragLeave={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (e.currentTarget === e.target) setArrastandoArquivo(false)
                }}
                onDrop={onDropArquivo}
            >
                <div className='config_import_cred_drop_icon' aria-hidden>
                    <svg width='36' height='36' viewBox='0 0 24 24' fill='none'>
                        <path
                            d='M12 3v10m0 0l3.5-3.5M12 13L8.5 9.5M4 17.5V19a2 2 0 002 2h12a2 2 0 002-2v-1.5'
                            stroke='currentColor'
                            strokeWidth='1.75'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        />
                    </svg>
                </div>
                <div className='config_import_cred_drop_copy'>
                    <strong>
                        {processando
                            ? 'Processando planilha…'
                            : loading
                              ? 'Carregando cadastros…'
                              : 'Arraste o Excel aqui'}
                    </strong>
                    <span>
                        Colunas: <em>Nome do Credenciado</em>, <em>Procedimento</em> e{' '}
                        <em>Procedimento Código</em>
                    </span>
                    {nomeArquivo ? (
                        <span className='config_import_cred_nome_arq'>{nomeArquivo}</span>
                    ) : null}
                </div>
                <label className='credenciamento_main_action_btn config_import_cred_file_label'>
                    {processando ? 'Aguarde…' : 'Selecionar arquivo'}
                    <input
                        ref={inputArquivoRef}
                        type='file'
                        accept='.xlsx,.xls'
                        hidden
                        disabled={loading || processando}
                        onChange={onArquivo}
                    />
                </label>
            </div>

            {linhas.length > 0 ? (
                <>
                    <div className='config_import_cred_resumo'>
                        <span className='config_import_cred_kpi'>Total: {resumo.total}</span>
                        <span className='config_import_cred_kpi ok'>No perfil: {resumo.noPerfil}</span>
                        <span className='config_import_cred_kpi warn'>Fora: {resumo.fora}</span>
                        <span className='config_import_cred_kpi'>Revisar: {resumo.revisar}</span>
                        <span className='config_import_cred_kpi err'>Sem match: {resumo.sem}</span>
                        {orfaos.length > 0 ? (
                            <button
                                type='button'
                                className='config_import_cred_kpi config_import_cred_kpi_orfao'
                                onClick={() =>
                                    orfaosRef.current?.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'start',
                                    })
                                }
                            >
                                Orfãos no perfil: {orfaos.length} — revisar
                            </button>
                        ) : null}
                    </div>

                    <div className='config_import_cred_opcoes'>
                        <label className='config_import_cred_opcao'>
                            <input
                                type='checkbox'
                                checked={somenteForaDoPerfil}
                                onChange={(e) => setSomenteForaDoPerfil(e.target.checked)}
                            />
                            <span>
                                Somente diferentes de <strong>No perfil</strong>
                                {somenteForaDoPerfil
                                    ? ` (${linhasExibidas.length} exibida${linhasExibidas.length === 1 ? '' : 's'})`
                                    : ''}
                            </span>
                        </label>
                        {!somenteLeitura && candidatosVincularLote.length > 0 ? (
                            <button
                                type='button'
                                className='credenciamento_main_action_btn'
                                disabled={vinculandoLote || Boolean(acaoId)}
                                onClick={() => void vincularLoteForaPerfil()}
                                title='Vincula ao perfil todos os procedimentos prontos que estão fora do perfil (respeita o filtro ativo)'
                            >
                                {vinculandoLote
                                    ? 'Vinculando…'
                                    : `Vincular ${candidatosVincularLote.length} fora do perfil`}
                            </button>
                        ) : null}
                    </div>

                    {renderPaginacao(
                        paginaLinhas,
                        totalPaginasLinhas,
                        setPaginaLinhas,
                        linhasExibidas.length,
                        'Linhas',
                    )}

                    <div className='config_import_cred_table_wrap'>
                        <table className='config_import_cred_table'>
                            <thead>
                                <tr>
                                    <th>Linha</th>
                                    <th>Credenciado (planilha)</th>
                                    <th>Match credenciado</th>
                                    <th>Procedimento</th>
                                    <th>Código</th>
                                    <th>Status</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhasPagina.map((l) => (
                                    <tr
                                        key={l.idLocal}
                                        className={`st-${l.status}${l.noPerfil ? ' is-no-perfil' : ''}`}
                                    >
                                        <td>{l.linhaExcel}</td>
                                        <td>{l.nomeCredenciado}</td>
                                        <td>
                                            {l.prestadorId ? (
                                                <span>{l.prestadorNome}</span>
                                            ) : (
                                                <div className='config_import_cred_match'>
                                                    <PrestadorVinculoBusca
                                                        prestadores={prestadores}
                                                        prestadorId=''
                                                        onChange={(p) => {
                                                            if (p) void fixarPrestador(l.idLocal, p)
                                                        }}
                                                        rotuloFn={(p) => p?.nome || ''}
                                                        placeholder='Buscar credenciado…'
                                                        usePortal
                                                    />
                                                    {(l.sugestoesPrestador || []).length > 0 ? (
                                                        <div className='config_import_cred_sugestoes'>
                                                            {(l.sugestoesPrestador || [])
                                                                .slice(0, 5)
                                                                .map((s) => (
                                                                    <button
                                                                        key={s.id}
                                                                        type='button'
                                                                        className='config_import_cred_sug_btn'
                                                                        onClick={() =>
                                                                            void fixarPrestador(
                                                                                l.idLocal,
                                                                                s,
                                                                            )
                                                                        }
                                                                    >
                                                                        {s.nome}
                                                                    </button>
                                                                ))}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {l.procedimentoCodigoResolvido ? (
                                                <span>
                                                    {l.procedimentoNomeResolvido ||
                                                        l.procedimentoNome}
                                                </span>
                                            ) : (
                                                <div className='config_import_cred_match'>
                                                    {(l.sugestoesProcedimento || []).length > 0 ? (
                                                        (l.sugestoesProcedimento || [])
                                                            .slice(0, 5)
                                                            .map((s) => (
                                                                <button
                                                                    key={s.codigo || s.id}
                                                                    type='button'
                                                                    className='config_import_cred_sug_btn'
                                                                    onClick={() =>
                                                                        void fixarProcedimento(
                                                                            l.idLocal,
                                                                            s,
                                                                        )
                                                                    }
                                                                >
                                                                    {s.codigo} — {s.nome}
                                                                </button>
                                                            ))
                                                    ) : (
                                                        <span className='muted'>
                                                            {l.procedimentoNome || '—'}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {l.procedimentoCodigoResolvido ||
                                                l.procedimentoCodigo ||
                                                '—'}
                                        </td>
                                        <td>
                                            <span
                                                className={`config_import_cred_badge st-${
                                                    l.noPerfil ? 'ja_vinculado' : l.status
                                                }`}
                                            >
                                                {l.noPerfil
                                                    ? ROTULO_STATUS.ja_vinculado
                                                    : ROTULO_STATUS[l.status] || l.status}
                                            </span>
                                        </td>
                                        <td className='config_import_cred_acoes'>
                                            {!somenteLeitura &&
                                            l.prestadorId &&
                                            l.procedimentoCodigoResolvido &&
                                            !l.noPerfil ? (
                                                <button
                                                    type='button'
                                                    className='credenciamento_main_action_btn'
                                                    disabled={acaoId === l.idLocal}
                                                    onClick={() => void vincular(l)}
                                                >
                                                    Vincular
                                                </button>
                                            ) : null}
                                            {!somenteLeitura &&
                                            l.prestadorId &&
                                            l.procedimentoCodigoResolvido &&
                                            l.noPerfil ? (
                                                <button
                                                    type='button'
                                                    className='credenciamento_main_action_btn secondary'
                                                    disabled={acaoId === l.idLocal}
                                                    onClick={() =>
                                                        void removerDoPerfil(
                                                            l.prestadorId,
                                                            l.procedimentoCodigoResolvido,
                                                            l.idLocal,
                                                        )
                                                    }
                                                >
                                                    Remover do perfil
                                                </button>
                                            ) : null}
                                            <button
                                                type='button'
                                                className='credenciamento_main_action_btn secondary'
                                                onClick={() => excluirRegistro(l.idLocal)}
                                                title='Remove só desta lista de revisão. Não altera o perfil nem o cadastro.'
                                            >
                                                Remover da lista
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {renderPaginacao(
                        paginaLinhas,
                        totalPaginasLinhas,
                        setPaginaLinhas,
                        linhasExibidas.length,
                        'Linhas',
                    )}

                    {orfaos.length > 0 ? (
                        <section
                            ref={orfaosRef}
                            className='config_import_cred_orfaos'
                            aria-live='polite'
                        >
                            <h2>Procedimentos no perfil ausentes da planilha</h2>
                            <p>
                                Estes códigos estão no perfil do credenciado, mas não vieram no Excel.
                                Escolha <strong>Remover do perfil</strong> ou <strong>Manter</strong> para
                                cada um.
                            </p>
                            {renderPaginacao(
                                paginaOrfaos,
                                totalPaginasOrfaos,
                                setPaginaOrfaos,
                                orfaos.length,
                                'Orfãos',
                            )}
                            <div className='config_import_cred_table_wrap'>
                                <table className='config_import_cred_table'>
                                    <thead>
                                        <tr>
                                            <th>Credenciado</th>
                                            <th>Código</th>
                                            <th>Procedimento</th>
                                            <th>Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orfaosPagina.map((o) => (
                                            <tr key={o.idLocal}>
                                                <td>{o.prestadorNome}</td>
                                                <td>{o.procedimentoCodigo}</td>
                                                <td>{o.procedimentoNome}</td>
                                                <td className='config_import_cred_acoes'>
                                                    {!somenteLeitura ? (
                                                        <>
                                                            <button
                                                                type='button'
                                                                className='credenciamento_main_action_btn secondary'
                                                                disabled={acaoId === o.idLocal}
                                                                onClick={() =>
                                                                    void removerDoPerfil(
                                                                        o.prestadorId,
                                                                        o.procedimentoCodigo,
                                                                        o.idLocal,
                                                                    )
                                                                }
                                                            >
                                                                Remover do perfil
                                                            </button>
                                                            <button
                                                                type='button'
                                                                className='credenciamento_main_action_btn'
                                                                disabled={acaoId === o.idLocal}
                                                                onClick={() =>
                                                                    manterOrfao(
                                                                        o.prestadorId,
                                                                        o.procedimentoCodigo,
                                                                    )
                                                                }
                                                            >
                                                                Manter
                                                            </button>
                                                        </>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {renderPaginacao(
                                paginaOrfaos,
                                totalPaginasOrfaos,
                                setPaginaOrfaos,
                                orfaos.length,
                                'Orfãos',
                            )}
                        </section>
                    ) : null}
                </>
            ) : null}
        </div>
    )
}

export default ConfigImportarCredenciados
