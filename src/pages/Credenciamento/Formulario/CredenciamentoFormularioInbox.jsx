import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSfscExclusaoConfirm } from '../../../hooks/useSfscExclusaoConfirm.jsx'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PERMISSION_KEYS, hasStoredPermission, hasStoredExclusaoPermanenteCredenciamento } from '../../../lib/accessControl'
import { getReadOnlyFlag, buscarTodosPaginado, supabase } from '../../../lib/supabase'
import { sugerirPrestadoresPorNome } from '../../../lib/pagamentosPrestador.js'
import PrestadorVinculoBusca from '../../Supertabela/Supertabela_negociacoes/PrestadorVinculoBusca.jsx'
import {
    atualizarStatusEntradaFormulario,
    contarEntradasFormularioPendentes,
    aplicarEntradaFormularioEmPrestadorExistente,
    buscarPrestadorIdPorDocumento,
    converterEntradaFormularioEmPrestador,
    formatarDataEntrada,
    listarEntradasFormulario,
    obterEntradaFormulario,
    rotuloTipoPerfil,
    excluirEntradaFormularioPermanentemente,
} from '../../../lib/formularioCredenciamento'
import {
    TIPOS_CHAVE_PIX,
    TIPOS_REPASSE,
    formatarChavePixEntrada,
    formatarCpfCnpjEntrada,
    formatarCrmvEntrada,
    formatarTelefoneEntrada,
    inferirTipoPixDaChave,
    filtrarPorTermoBusca,
    normalizarTextoBusca,
} from '../../../lib/prestadorCadastroHelpers'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'

const FILTROS = [
    { id: 'abertas', label: 'Pendentes e em análise', status: ['pendente', 'em_analise'] },
    { id: 'pendente', label: 'Só pendentes', status: ['pendente'] },
    { id: 'em_analise', label: 'Em análise', status: ['em_analise'] },
    { id: 'convertido', label: 'Cadastrados', status: ['convertido'] },
    { id: 'descartado', label: 'Descartados', status: ['descartado'] },
    { id: 'todos', label: 'Todas', status: null },
]

function rotuloTipoPix(valor) {
    const v = String(valor || '').toLowerCase()
    return TIPOS_CHAVE_PIX.find((t) => t.value === v)?.label || v || '—'
}

function rotuloTipoRepasse(valor) {
    const v = String(valor || '').toLowerCase()
    return TIPOS_REPASSE.find((t) => t.value === v)?.label || v || '—'
}

function exibirChavePix(payload) {
    const p = payload || {}
    const tipo = String(p.tipo_pix || '').toLowerCase() || inferirTipoPixDaChave(p.chave_pix)
    const bruto = p.chave_pix
    if (!bruto) return '—'
    if (tipo) return formatarChavePixEntrada(bruto, tipo)
    return String(bruto)
}

function rotuloStatus(st) {
    const s = String(st || '')
    if (s === 'pendente') return 'Pendente'
    if (s === 'em_analise') return 'Em análise'
    if (s === 'convertido') return 'Cadastrado'
    if (s === 'descartado') return 'Descartado'
    return s || '—'
}

export default function CredenciamentoFormularioInbox() {
    const { askExclusao, exclusaoToast } = useSfscExclusaoConfirm()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const somenteLeitura =
        getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
    const podeExclusaoPermanente = hasStoredExclusaoPermanenteCredenciamento()

    const filtroId = searchParams.get('filtro') || 'abertas'
    const entradaIdParam = searchParams.get('id')

    const filtroAtivo = useMemo(
        () => FILTROS.find((f) => f.id === filtroId) || FILTROS[0],
        [filtroId],
    )

    const [lista, setLista] = useState([])
    const [selecionada, setSelecionada] = useState(null)
    const [procedimentosPorCategoria, setProcedimentosPorCategoria] = useState([])
    const [nomesEspecialidades, setNomesEspecialidades] = useState([])
    const [mapaEspecialidades, setMapaEspecialidades] = useState(() => new Map())
    const [loading, setLoading] = useState(true)
    const [acaoLoading, setAcaoLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [okMsg, setOkMsg] = useState('')
    const [abertasCount, setAbertasCount] = useState(0)
    const [prestadorExistenteId, setPrestadorExistenteId] = useState(null)
    const [prestadores, setPrestadores] = useState([])
    const [prestadorVinculoManualId, setPrestadorVinculoManualId] = useState('')
    const [buscaLista, setBuscaLista] = useState('')

    const rotuloPrestador = useCallback((item) => item?.nome || '', [])

    const carregarPrestadores = useCallback(async () => {
        try {
            const { data, error } = await buscarTodosPaginado(() =>
                supabase
                    .from('prestadores')
                    .select('id, nome, cpf_cnpj')
                    .eq('ativo', true)
                    .order('nome', { ascending: true }),
            )
            if (error) throw error
            setPrestadores(data || [])
        } catch {
            setPrestadores([])
        }
    }, [])

    const carregarLista = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const rows = await listarEntradasFormulario({
                status: filtroAtivo.status,
                limite: 200,
            })
            setLista(rows)
            try {
                const n = await contarEntradasFormularioPendentes()
                setAbertasCount(n)
            } catch {
                /* opcional */
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [filtroAtivo.status])

    const carregarDetalhe = useCallback(async (id) => {
        if (!id) {
            setSelecionada(null)
            setPrestadorVinculoManualId('')
            return
        }
        setErro('')
        setPrestadorVinculoManualId('')
        try {
            const row = await obterEntradaFormulario(id)
            setSelecionada(row)
            try {
                const pid = await buscarPrestadorIdPorDocumento(row?.cpf_cnpj)
                setPrestadorExistenteId(pid)
                if (!pid) {
                    const sugerido = Number(row?.payload?.prestador_id_sugerido)
                    if (sugerido > 0) setPrestadorVinculoManualId(String(sugerido))
                }
            } catch {
                setPrestadorExistenteId(null)
            }
            const pl = row?.payload || {}
            const codigos = [...new Set((pl.procedimentos || []).map((c) => String(c).trim().toUpperCase()))].filter(
                Boolean,
            )
            if (codigos.length) {
                const { data: procs } = await supabase
                    .from('procedimentos')
                    .select('codigo, nome, categoria_id')
                    .in('codigo', codigos)
                const catIds = [
                    ...new Set((procs || []).map((x) => Number(x.categoria_id)).filter((id) => id > 0)),
                ]
                let mapaCat = new Map()
                if (catIds.length) {
                    const { data: cats } = await supabase.from('categorias').select('id, nome').in('id', catIds)
                    mapaCat = new Map((cats || []).map((c) => [Number(c.id), String(c.nome || '').trim()]))
                }
                const porCat = new Map()
                const codigosEncontrados = new Set()
                ;(procs || []).forEach((pr) => {
                    const cod = String(pr.codigo || '').toUpperCase()
                    codigosEncontrados.add(cod)
                    const cid = Number(pr.categoria_id) || 0
                    const nomeCat = mapaCat.get(cid) || (cid ? `Categoria #${cid}` : 'Outros')
                    if (!porCat.has(nomeCat)) porCat.set(nomeCat, [])
                    porCat.get(nomeCat).push({
                        codigo: cod,
                        nome: String(pr.nome || '').trim(),
                    })
                })
                const faltando = codigos.filter((c) => !codigosEncontrados.has(c))
                if (faltando.length) {
                    if (!porCat.has('Outros')) porCat.set('Outros', [])
                    faltando.forEach((cod) => {
                        porCat.get('Outros').push({ codigo: cod, nome: '' })
                    })
                }
                const grupos = [...porCat.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base' }))
                    .map(([categoriaNome, itens]) => ({
                        categoriaNome,
                        itens: itens.sort((a, b) =>
                            String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { sensitivity: 'base' }),
                        ),
                    }))
                setProcedimentosPorCategoria(grupos)
            } else {
                setProcedimentosPorCategoria([])
            }

            const espIds = [...new Set((pl.especialidades_ids || []).map(Number).filter(Boolean))]
            const espIdsVets = new Set()
            ;(pl.vetsPendentes || []).forEach((v) => {
                ;(v.especialidades_ids || []).forEach((id) => espIdsVets.add(Number(id)))
                if (v.especialidade_id) espIdsVets.add(Number(v.especialidade_id))
            })
            const todosEspIds = [...new Set([...espIds, ...espIdsVets])]
            if (todosEspIds.length) {
                const { data: esps } = await supabase.from('especialidades').select('id, nome').in('id', todosEspIds)
                const mapa = new Map(
                    (esps || []).map((e) => [Number(e.id), String(e.nome || '').trim()]).filter(([, n]) => n),
                )
                setMapaEspecialidades(mapa)
                setNomesEspecialidades(
                    espIds.map((id) => mapa.get(id)).filter(Boolean),
                )
            } else {
                setMapaEspecialidades(new Map())
                setNomesEspecialidades([])
            }
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }, [])

    useEffect(() => {
        void carregarLista()
        void carregarPrestadores()
    }, [carregarLista, carregarPrestadores])

    useEffect(() => {
        const id = entradaIdParam?.trim() || null
        if (id) void carregarDetalhe(id)
        else setSelecionada(null)
    }, [entradaIdParam, carregarDetalhe])

    const selecionar = (id) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('id', String(id))
            return next
        })
    }

    const mudarFiltro = (id) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('filtro', id)
            next.delete('id')
            return next
        })
        setSelecionada(null)
        setBuscaLista('')
    }

    const termoBuscaLista = useMemo(() => normalizarTextoBusca(buscaLista), [buscaLista])

    const listaFiltrada = useMemo(() => {
        if (!termoBuscaLista) return lista
        return lista.filter((e) => {
            const pl = e.payload || {}
            const end = pl.endereco || {}
            const blob = normalizarTextoBusca(
                [
                    pl.nome,
                    e.cpf_cnpj,
                    formatarCpfCnpjEntrada(e.cpf_cnpj),
                    pl.email,
                    pl.telefone,
                    pl.celular,
                    pl.crmv,
                    end.cidade,
                    end.uf,
                    end.logradouro,
                    rotuloTipoPerfil(e.tipo_perfil),
                    rotuloStatus(e.status),
                ]
                    .filter(Boolean)
                    .join(' '),
            )
            return filtrarPorTermoBusca(blob, termoBuscaLista, false)
        })
    }, [lista, termoBuscaLista])

    const recarregarTudo = async () => {
        await carregarLista()
        if (selecionada?.id) await carregarDetalhe(selecionada.id)
    }

    const marcarEmAnalise = async () => {
        if (!selecionada?.id || somenteLeitura) return
        setAcaoLoading(true)
        setOkMsg('')
        try {
            await atualizarStatusEntradaFormulario(selecionada.id, 'em_analise')
            setOkMsg('Marcado como em análise.')
            await recarregarTudo()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAcaoLoading(false)
        }
    }

    const descartar = () => {
        if (!selecionada?.id || somenteLeitura) return
        askExclusao(
            'Descartar esta entrada? Não será criado cadastro a partir dela.',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                try {
                    await atualizarStatusEntradaFormulario(selecionada.id, 'descartado')
                    setOkMsg('Entrada descartada.')
                    await recarregarTudo()
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Descartar entrada',
        )
    }

    const excluirEntradaPermanente = () => {
        const idEntrada = selecionada?.id ?? entradaIdParam
        if (!idEntrada || !podeExclusaoPermanente) return
        askExclusao(
            'Apagar PERMANENTEMENTE esta entrada do banco de dados? Não há como desfazer.',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                setErro('')
                try {
                    const idNorm = String(idEntrada).trim()
                    await excluirEntradaFormularioPermanentemente(idEntrada)
                    setLista((prev) => prev.filter((e) => String(e.id).trim() !== idNorm))
                    setOkMsg('Entrada removida permanentemente.')
                    setSearchParams((prev) => {
                        const next = new URLSearchParams(prev)
                        next.delete('id')
                        return next
                    })
                    setSelecionada(null)
                    await carregarLista()
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Excluir permanentemente',
            { variante: 'danger', rotuloConfirmar: 'Apagar do banco' },
        )
    }

    const aplicarCadastroExistente = () => {
        const prestadorAlvoId = prestadorExistenteId || Number(prestadorVinculoManualId) || null
        if (!selecionada?.id || somenteLeitura || !prestadorAlvoId) return
        askExclusao(
            'Os dados desta entrada serão mesclados no cadastro existente (contato, endereço, especialidades e procedimentos do envio). Continuar?',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                setErro('')
                try {
                    const prestadorId = await aplicarEntradaFormularioEmPrestadorExistente(
                        selecionada.id,
                        prestadorAlvoId,
                    )
                    setOkMsg('Dados aplicados ao cadastro existente. Abrindo ficha…')
                    navigate(`/credenciamento/cadastro/${prestadorId}`)
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Aplicar ao cadastro existente',
            { variante: 'primary', rotuloConfirmar: 'Aplicar ao cadastro' },
        )
    }

    const criarCadastro = () => {
        if (!selecionada?.id || somenteLeitura || prestadorExistenteId || prestadorVinculoManualId) return
        askExclusao(
            'Será criado um prestador com os dados enviados no formulário. Você poderá completar a ficha em seguida.',
            async () => {
                setAcaoLoading(true)
                setOkMsg('')
                setErro('')
                try {
                    const prestadorId = await converterEntradaFormularioEmPrestador(selecionada.id)
                    setOkMsg('Cadastro criado. Abrindo ficha do prestador…')
                    navigate(`/credenciamento/cadastro/${prestadorId}`)
                } catch (e) {
                    setErro(e?.message || String(e))
                } finally {
                    setAcaoLoading(false)
                }
            },
            'Criar cadastro definitivo',
            { variante: 'primary', rotuloConfirmar: 'Criar cadastro' },
        )
    }

    const p = selecionada?.payload || {}
    const end = p.endereco || {}
    const tipoPerfil = String(selecionada?.tipo_perfil || '').toLowerCase()
    const mostrarCrmv = tipoPerfil === 'volante' || tipoPerfil === 'clinica'
    const prestadorAlvoId = prestadorExistenteId || Number(prestadorVinculoManualId) || null
    const sugestoesPrestadorNome = useMemo(
        () => sugerirPrestadoresPorNome(prestadores, p.nome, { limite: 8 }),
        [prestadores, p.nome],
    )
    const podeConverter =
        selecionada &&
        !selecionada.prestador_id &&
        selecionada.status !== 'convertido' &&
        selecionada.status !== 'descartado'

    return (
        <div className="credenciamento_main fcred_inbox">
            {exclusaoToast}
            <h1>Credenciamento — Inbox do formulário</h1>
            <p className="pcad_muted fcred_inbox_lead">
                Revise pré-cadastros enviados pelos parceiros e converta em ficha de prestador.
                {abertasCount > 0 && (
                    <>
                        {' '}
                        <strong>{abertasCount}</strong> em aberto (pendente ou em análise).
                    </>
                )}
            </p>
            <p className="fcred_inbox_top_links">
                <Link to="/credenciamento/formulario" className="credenciamento_main_action_btn secondary">
                    Configuração do formulário
                </Link>
            </p>
            <hr />

            <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            <CredenciamentoMainAlert message={okMsg} onClose={() => setOkMsg('')} role="status" />

            <header className="credenciamento_main_header">
                <h2 className="credenciamento_cadastro_filters_title">Filtrar entradas</h2>
                <div className="credenciamento_main_filters fcred_inbox_filters">
                    <div className="fcred_inbox_filtros" role="tablist" aria-label="Filtrar entradas">
                        {FILTROS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                role="tab"
                                aria-selected={filtroAtivo.id === f.id}
                                className={`credenciamento_main_action_btn ${
                                    filtroAtivo.id === f.id ? '' : 'secondary'
                                }`}
                                onClick={() => mudarFiltro(f.id)}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="fcred_layout fcred_inbox_layout">
                <aside className="fcred_paginas fcred_inbox_lista" aria-label="Lista de entradas">
                    <div className="fcred_paginas_head">
                        <h2>Entradas</h2>
                        <span className="pcad_muted">
                            {loading
                                ? '…'
                                : termoBuscaLista
                                  ? `${listaFiltrada.length} / ${lista.length}`
                                  : lista.length}
                        </span>
                    </div>
                    <div className="fcred_inbox_busca">
                        <CampoBuscaComLimpar
                            className="credenciamento_main_input fcred_inbox_busca_input"
                            placeholder="Nome, CPF/CNPJ, e-mail, cidade…"
                            value={buscaLista}
                            disabled={loading}
                            aria-label="Buscar entradas"
                            onChange={(e) => setBuscaLista(e.target.value)}
                        />
                    </div>
                    {loading && <p className="pcad_muted fcred_inbox_pad">Carregando…</p>}
                    {!loading && lista.length === 0 && (
                        <p className="pcad_muted fcred_inbox_pad">Nenhuma entrada neste filtro.</p>
                    )}
                    {!loading && lista.length > 0 && listaFiltrada.length === 0 && (
                        <p className="pcad_muted fcred_inbox_pad">Nenhuma entrada corresponde à busca.</p>
                    )}
                    <ul className="fcred_inbox_ul">
                        {listaFiltrada.map((e) => {
                            const pl = e.payload || {}
                            const ativo = String(selecionada?.id) === String(e.id)
                            return (
                                <li key={e.id}>
                                    <button
                                        type="button"
                                        className={`fcred_inbox_item ${ativo ? 'is-active' : ''}`}
                                        onClick={() => selecionar(e.id)}
                                    >
                                        <span className="fcred_inbox_item_nome">{pl.nome || 'Sem nome'}</span>
                                        <span className={`fcred_inbox_badge status-${e.status}`}>
                                            {rotuloStatus(e.status)}
                                        </span>
                                        <span className="fcred_inbox_item_meta">
                                            {rotuloTipoPerfil(e.tipo_perfil)} ·{' '}
                                            {formatarCpfCnpjEntrada(e.cpf_cnpj)}
                                        </span>
                                        <span className="fcred_inbox_item_data">
                                            {formatarDataEntrada(e.criado_em)}
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </aside>

                <section className="fcred_inbox_detalhe" aria-label="Detalhe da entrada">
                    {!selecionada && (
                        <p className="pcad_muted fcred_inbox_placeholder">
                            Selecione uma entrada na lista para revisar.
                        </p>
                    )}
                    {selecionada && (
                        <>
                            <div className="fcred_inbox_detalhe_head">
                                <h2 className="fcred_inbox_detalhe_tit">{p.nome || 'Sem nome'}</h2>
                                <span className={`fcred_inbox_badge status-${selecionada.status}`}>
                                    {rotuloStatus(selecionada.status)}
                                </span>
                            </div>
                            <p className="pcad_muted fcred_inbox_detalhe_sub">
                                {rotuloTipoPerfil(selecionada.tipo_perfil)} ·{' '}
                                {formatarCpfCnpjEntrada(selecionada.cpf_cnpj)}
                                {prestadorExistenteId && podeConverter && (
                                    <>
                                        {' '}
                                        · <strong>Já credenciado</strong> (cadastro #{prestadorExistenteId})
                                    </>
                                )}
                                {!prestadorExistenteId && prestadorVinculoManualId && podeConverter && (
                                    <>
                                        {' '}
                                        · <strong>Perfil selecionado</strong> (cadastro #{prestadorVinculoManualId})
                                    </>
                                )}
                            </p>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <h3 className="fcred_inbox_sec_tit">Identificação</h3>
                                <p>
                                    <strong>Enviado em:</strong> {formatarDataEntrada(selecionada.criado_em)}
                                </p>
                                {mostrarCrmv && (
                                    <p>
                                        <strong>CRMV:</strong>{' '}
                                        {p.crmv ? formatarCrmvEntrada(p.crmv) : '—'}
                                    </p>
                                )}
                                {nomesEspecialidades.length > 0 && (
                                    <p>
                                        <strong>Especialidade(s):</strong> {nomesEspecialidades.join(' · ')}
                                    </p>
                                )}
                            </div>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <h3 className="fcred_inbox_sec_tit">Contato</h3>
                                <p>
                                    <strong>E-mail:</strong> {p.email || '—'}
                                </p>
                                <p>
                                    <strong>Telefone:</strong>{' '}
                                    {p.telefone ? formatarTelefoneEntrada(p.telefone) : '—'}
                                </p>
                                <p>
                                    <strong>WhatsApp / celular:</strong>{' '}
                                    {p.celular ? formatarTelefoneEntrada(p.celular) : '—'}
                                </p>
                            </div>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <h3 className="fcred_inbox_sec_tit">Financeiro</h3>
                                <p>
                                    <strong>Tipo de PIX:</strong> {rotuloTipoPix(p.tipo_pix)}
                                </p>
                                <p>
                                    <strong>Chave PIX:</strong> {exibirChavePix(p)}
                                </p>
                                <p>
                                    <strong>Nota / RPA:</strong> {rotuloTipoRepasse(p.tipo_repasse)}
                                </p>
                            </div>

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <h3 className="fcred_inbox_sec_tit">Endereço</h3>
                                <p>
                                    <strong>CEP:</strong> {p.cep || '—'}
                                </p>
                                <p>
                                    <strong>Logradouro:</strong> {end.logradouro || '—'}
                                </p>
                                <p>
                                    <strong>Número:</strong> {end.numero || '—'}
                                </p>
                                <p>
                                    <strong>Complemento:</strong> {end.complemento || '—'}
                                </p>
                                <p>
                                    <strong>Bairro:</strong> {end.bairro || '—'}
                                </p>
                                <p>
                                    <strong>Cidade / UF:</strong>{' '}
                                    {[end.cidade, end.uf].filter(Boolean).join(' / ') || '—'}
                                </p>
                                <p>
                                    <strong>País:</strong> {end.pais || '—'}
                                </p>
                            </div>

                            {tipoPerfil === 'volante' && (p.cidadesAtende || []).length > 0 && (
                                <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                    <h3 className="fcred_inbox_sec_tit">Cidades que atende</h3>
                                    <ul className="fcred_inbox_proc_list">
                                        {(p.cidadesAtende || []).map((c, idx) => (
                                            <li key={`${c.cidadeId || idx}-${c.nome}`}>
                                                {[c.nome, c.uf].filter(Boolean).join(' — ') || '—'}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {tipoPerfil === 'clinica' && (p.vetsPendentes || []).length > 0 && (
                                <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                    <h3 className="fcred_inbox_sec_tit">Veterinários vinculados</h3>
                                    <ul className="fcred_inbox_proc_list">
                                        {(p.vetsPendentes || []).map((v, idx) => {
                                            const ids = v.especialidades_ids?.length
                                                ? v.especialidades_ids
                                                : v.especialidade_id
                                                  ? [v.especialidade_id]
                                                  : []
                                            const rotEsp = ids
                                                .map((id) => mapaEspecialidades.get(Number(id)))
                                                .filter(Boolean)
                                                .join(', ')
                                            return (
                                                <li key={`${v.nome}-${idx}`}>
                                                    <strong>{v.nome || '—'}</strong>
                                                    {v.crmv ? ` · ${formatarCrmvEntrada(v.crmv)}` : ''}
                                                    {rotEsp ? ` · ${rotEsp}` : ''}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </div>
                            )}

                            <div className="credenciamento_main_detail_box fcred_inbox_detail_box">
                                <h3 className="fcred_inbox_sec_tit">Procedimentos selecionados</h3>
                                {(p.procedimentos || []).length === 0 && (
                                    <p className="pcad_muted">Nenhum procedimento no envio.</p>
                                )}
                                {procedimentosPorCategoria.map((grupo) => (
                                    <div key={grupo.categoriaNome} className="fcred_inbox_proc_grupo">
                                        <h4 className="fcred_inbox_proc_cat">{grupo.categoriaNome}</h4>
                                        <ul className="fcred_inbox_proc_list">
                                            {grupo.itens.map((item) => (
                                                <li key={item.codigo}>
                                                    <code>{item.codigo}</code>
                                                    {item.nome ? ` — ${item.nome}` : ''}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>

                            {podeConverter && !prestadorExistenteId && (
                                <div className="credenciamento_main_detail_box fcred_inbox_vinculo_box">
                                    <h3 className="fcred_inbox_sec_tit">Vincular a cadastro existente</h3>
                                    <p className="pcad_muted fcred_inbox_vinculo_hint">
                                        O CPF/CNPJ do envio não corresponde a um cadastro. Escolha um perfil pelo nome
                                        (sugestões automáticas ou busca).
                                    </p>
                                    {sugestoesPrestadorNome.length > 0 ? (
                                        <label className="fcred_inbox_vinculo_sug">
                                            <span>Sugestões para «{p.nome || 'sem nome'}»</span>
                                            <select
                                                className="credenciamento_main_select"
                                                value={prestadorVinculoManualId}
                                                disabled={somenteLeitura || acaoLoading}
                                                onChange={(e) => setPrestadorVinculoManualId(e.target.value)}
                                            >
                                                <option value="">Possíveis matches…</option>
                                                {sugestoesPrestadorNome.map((s) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.nome}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ) : (
                                        <p className="pcad_muted">Nenhuma sugestão automática para este nome.</p>
                                    )}
                                    <div className="fcred_inbox_vinculo_busca">
                                        <PrestadorVinculoBusca
                                            prestadores={prestadores}
                                            prestadorId={prestadorVinculoManualId}
                                            onChange={setPrestadorVinculoManualId}
                                            disabled={somenteLeitura || acaoLoading}
                                            rotuloFn={rotuloPrestador}
                                            placeholder="Buscar clínica ou prestador por nome…"
                                            usePortal
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="fcred_inbox_acoes">
                                {selecionada.prestador_id && (
                                    <Link
                                        to={`/credenciamento/cadastro/${selecionada.prestador_id}`}
                                        className="credenciamento_main_action_btn"
                                    >
                                        Abrir ficha do prestador
                                    </Link>
                                )}
                                {podeConverter && (
                                    <>
                                        {prestadorAlvoId ? (
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn"
                                                disabled={acaoLoading || somenteLeitura}
                                                onClick={() => void aplicarCadastroExistente()}
                                            >
                                                {acaoLoading ? 'A processar…' : 'Aplicar ao cadastro existente'}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn"
                                                disabled={acaoLoading || somenteLeitura}
                                                onClick={() => void criarCadastro()}
                                            >
                                                {acaoLoading ? 'A processar…' : 'Criar cadastro definitivo'}
                                            </button>
                                        )}
                                        {selecionada.status === 'pendente' && (
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn secondary"
                                                disabled={acaoLoading || somenteLeitura}
                                                onClick={() => void marcarEmAnalise()}
                                            >
                                                Marcar em análise
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn secondary fcred_inbox_btn_descartar"
                                            disabled={acaoLoading || somenteLeitura}
                                            onClick={() => void descartar()}
                                        >
                                            Descartar
                                        </button>
                                    </>
                                )}
                            </div>
                            {podeExclusaoPermanente && (
                                <div className="fcred_inbox_dev_excluir">
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn fcred_inbox_btn_apagar_bd"
                                        disabled={acaoLoading}
                                        onClick={() => void excluirEntradaPermanente()}
                                    >
                                        Apagar entrada do banco
                                    </button>
                                    <p className="pcad_muted fcred_inbox_dev_excluir_hint">
                                        Remove o registro de forma irreversível (diferente de «Descartar»).
                                    </p>
                                </div>
                            )}
                            {somenteLeitura && (
                                <p className="pcad_muted fcred_inbox_readonly">
                                    Modo somente leitura: não é possível converter ou alterar status.
                                </p>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    )
}
