import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import {
    buscarCidadeIdsFiltroPlanoCredenciados,
    buildNomesMunicipioPermitidosPorUf,
    carregarVinculosMunicipios,
    filtrarMunicipiosIbgePorCredenciamento,
    ufsDisponiveisFiltroCredenciamento } from '../../../lib/cidadesSupertabelaVinculos.js'
import { normalizarTextoBusca, filtrarPorTermoBusca, prestadorEhCredenciado } from '../../../lib/prestadorCadastroHelpers.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import { useAutoDismiss } from '../../../lib/toastUi.js'
import '../Credenciamento_main/Credenciamento_main.css'
import {
    formatarResultadosQuemRealizaParaClipboard,
    mapaCodigoProcedimentoIdDeCatalogo,
    pesquisarQuemOfereceDescontos,
    pesquisarQuemRealizaNaRede } from '../../../lib/buscarQuemRealizaPrestadores.js'
import {
    carregarCatalogoBeneficios,
    gruposDoCatalogo,
    nomeGrupoBeneficioVisivel } from '../../../lib/credenciamento/prestadorBeneficios.js'
import './CredenciamentoQuemRealiza.css'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'

const CATEGORIA_MIN = 3
const CATEGORIA_MAX = 25

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

const normCodigo = (c) => String(c || '').trim().toUpperCase()

/** Aba inicial: categoria «Atendimento», senão a primeira da lista. */
function idCategoriaPadrao(lista) {
    const cats = lista || []
    const atendimento = cats.find((c) => {
        const n = normalizarTextoBusca(c.nome)
        return n === 'atendimento' || n.startsWith('atendimento ')
    })
    if (atendimento) return Number(atendimento.id)
    const contem = cats.find((c) => normalizarTextoBusca(c.nome).includes('atendimento'))
    if (contem) return Number(contem.id)
    return cats[0] ? Number(cats[0].id) : null
}

export default function CredenciamentoQuemRealiza() {
    const [uf, setUf] = useState('')
    const [cidadeNome, setCidadeNome] = useState('')
    const [buscarCidadesParalelas, setBuscarCidadesParalelas] = useState(false)
    const [municipios, setMunicipios] = useState([])
    const [loadingMun, setLoadingMun] = useState(false)
    const [cidadesTabela, setCidadesTabela] = useState([])
    const [vinculosMunicipios, setVinculosMunicipios] = useState([])
    const [idsFiltroCidadeCred, setIdsFiltroCidadeCred] = useState(null)

    const [categorias, setCategorias] = useState([])
    const [abaCategoria, setAbaCategoria] = useState(null)
    const [procedimentosCat, setProcedimentosCat] = useState([])
    const [buscaProc, setBuscaProc] = useState('')
    const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
    const buscaProcRef = useRef(null)
    const [codigosSelecionados, setCodigosSelecionados] = useState(() => new Set())
    const [mapaNomePorCodigo, setMapaNomePorCodigo] = useState(() => new Map())
    const [procedimentosCatalogo, setProcedimentosCatalogo] = useState([])

    const [prestadores, setPrestadores] = useState([])
    const [todosPrestadoresAtivos, setTodosPrestadoresAtivos] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [mapaCidadesCred, setMapaCidadesCred] = useState(new Map())
    const [especialidades, setEspecialidades] = useState([])
    const [resultados, setResultados] = useState([])
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')

    useAutoDismiss(Boolean(erro), () => setErro(''))
    const [pesquisou, setPesquisou] = useState(false)
    const [copiandoResultados, setCopiandoResultados] = useState(false)
    /** @type {['servicos'|'descontos', Function]} */
    const [modoBusca, setModoBusca] = useState('servicos')
    const [catalogoBeneficios, setCatalogoBeneficios] = useState([])
    const [abaGrupoDesconto, setAbaGrupoDesconto] = useState('')
    const [beneficioIdsSelecionados, setBeneficioIdsSelecionados] = useState(() => new Set())
    const [buscaBeneficio, setBuscaBeneficio] = useState('')
    const modoDescontos = modoBusca === 'descontos'

    useEffect(() => {
        const run = async () => {
            const [
                { data: cats },
                resPrest,
                resPc,
                resCc,
                { data: esps },
                { data: situacoesData },
                resPeEst,
                procPaginado,
            ] = await Promise.all([
                supabase
                    .from('categorias')
                    .select('id, nome')
                    .gte('id', CATEGORIA_MIN)
                    .lte('id', CATEGORIA_MAX)
                    .order('id'),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, telefone, celular, especialidade_id, endereco_uf, endereco_cidade, cidade_id, tipo, ativo, situacao_id',
                        )
                        .eq('ativo', true)
                        .order('id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_cidades')
                        .select('prestador_id, cidade_id')
                        .order('prestador_id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase.from('cidades_credenciamento').select('id, nome').order('id', { ascending: true }),
                ),
                supabase.from('especialidades').select('id, nome'),
                supabase.from('situacoes').select('id, descricao'),
                buscarTodosPaginado(() =>
                    supabase
                        .from('prestador_estabelecimentos')
                        .select('veterinario_id, estabelecimento_id, principal')
                        .order('veterinario_id', { ascending: true }),
                ),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('id, codigo, nome, categoria_id')
                        .order('codigo', { ascending: true }),
                ),
            ])
            const prest = resPrest.data || []
            const pc = resPc.data || []
            const cc = resCc.data || []
            const peEst = resPeEst.data || []
            const catalogo = procPaginado?.data || []
            setProcedimentosCatalogo(catalogo)
            const mapaProc = new Map()
            catalogo.forEach((row) => {
                const cod = normCodigo(row.codigo)
                if (cod) mapaProc.set(cod, String(row.nome || cod).trim())
            })
            setMapaNomePorCodigo(mapaProc)
            const listaCats = cats || []
            setCategorias(listaCats)
            const idPadrao = idCategoriaPadrao(listaCats)
            if (idPadrao != null) setAbaCategoria(idPadrao)
            const listaSituacoes = situacoesData || []
            const prestCred = prest.filter((p) => prestadorEhCredenciado(p, listaSituacoes))
            setTodosPrestadoresAtivos(prest)
            setPrestadores(prestCred)
            setPrestadorCidades(pc)
            setPrestadorEstabelecimentos(peEst)
            setMapaCidadesCred(new Map(cc.map((c) => [Number(c.id), c.nome])))
            setEspecialidades(esps || [])
            try {
                const catBenef = await carregarCatalogoBeneficios()
                setCatalogoBeneficios(catBenef)
                const gs = gruposDoCatalogo(catBenef)
                if (gs[0]) setAbaGrupoDesconto(gs[0].codigo)
            } catch {
                setCatalogoBeneficios([])
            }
        }
        void run()
    }, [])

    useEffect(() => {
        let cancelado = false
        const run = async () => {
            try {
                const [ids, cidResp, vinculos] = await Promise.all([
                    buscarCidadeIdsFiltroPlanoCredenciados(supabase, null, buscarTodosPaginado),
                    supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                    carregarVinculosMunicipios(supabase).catch(() => []),
                ])
                if (cancelado) return
                setIdsFiltroCidadeCred(ids)
                setCidadesTabela(cidResp.data || [])
                setVinculosMunicipios(vinculos || [])
            } catch {
                if (!cancelado) {
                    setIdsFiltroCidadeCred(new Set())
                    setCidadesTabela([])
                    setVinculosMunicipios([])
                }
            }
        }
        void run()
        return () => {
            cancelado = true
        }
    }, [])

    const nomesMunicipioPermitidosPorUf = useMemo(
        () => buildNomesMunicipioPermitidosPorUf(cidadesTabela, vinculosMunicipios, idsFiltroCidadeCred),
        [cidadesTabela, vinculosMunicipios, idsFiltroCidadeCred],
    )

    const ufsPermitidasCredenciamento = useMemo(() => {
        const set = ufsDisponiveisFiltroCredenciamento(cidadesTabela, idsFiltroCidadeCred)
        return UFS_BRASIL.filter((sigla) => set.has(sigla))
    }, [cidadesTabela, idsFiltroCidadeCred])

    useEffect(() => {
        if (!uf) {
            setMunicipios([])
            setCidadeNome('')
            return
        }
        setLoadingMun(true)
        buscarMunicipiosPorUf(uf)
            .then((lista) =>
                setMunicipios(
                    filtrarMunicipiosIbgePorCredenciamento(lista, uf, nomesMunicipioPermitidosPorUf),
                ),
            )
            .catch(() => setMunicipios([]))
            .finally(() => setLoadingMun(false))
    }, [uf, nomesMunicipioPermitidosPorUf])

    useEffect(() => {
        if (!cidadeNome) return
        const ok = municipios.some((m) => m.nome === cidadeNome)
        if (!ok) setCidadeNome('')
    }, [cidadeNome, municipios])

    useEffect(() => {
        if (!abaCategoria) {
            setProcedimentosCat([])
            return
        }
        const run = async () => {
            const { data } = await supabase
                .from('procedimentos')
                .select('id, codigo, nome, categoria_id')
                .eq('categoria_id', abaCategoria)
                .order('codigo')
            setProcedimentosCat(data || [])
        }
        void run()
    }, [abaCategoria])

    const mapaCategoriaNome = useMemo(
        () => new Map((categorias || []).map((c) => [Number(c.id), c.nome])),
        [categorias]
    )

    const procedimentoCombinaTermo = useCallback(
        (p, termoBruto) => {
            const cat = normalizarTextoBusca(mapaCategoriaNome.get(Number(p.categoria_id)) || '')
            const blob = normalizarTextoBusca([p.codigo, p.nome, cat].filter(Boolean).join(' '))
            return filtrarPorTermoBusca(blob, termoBruto)
        },
        [mapaCategoriaNome],
    )

    const sugestoesProcedimento = useMemo(() => {
        const bruto = String(buscaProc || '').trim()
        const q = normalizarTextoBusca(buscaProc)
        const sintaxeAvancada = /^[!(\s]|not\s/i.test(bruto)
        if (!bruto) return []
        if (!sintaxeAvancada && (!q || q.length < 2)) return []
        return procedimentosCatalogo.filter((p) => procedimentoCombinaTermo(p, buscaProc)).slice(0, 18)
    }, [buscaProc, procedimentosCatalogo, procedimentoCombinaTermo])

    const procedimentosFiltrados = useMemo(() => {
        const bruto = String(buscaProc || '').trim()
        const q = normalizarTextoBusca(buscaProc)
        const base = bruto || q ? procedimentosCatalogo.filter((p) => procedimentoCombinaTermo(p, buscaProc)) : procedimentosCat
        return base.slice(0, bruto || q ? 300 : undefined)
    }, [procedimentosCat, buscaProc, procedimentosCatalogo, procedimentoCombinaTermo])

    const buscaEmTodasCategorias = Boolean(normalizarTextoBusca(buscaProc))

    const resolverCodigosParaPesquisa = useCallback(() => {
        const out = new Set([...codigosSelecionados])
        const bruto = String(buscaProc || '').trim()
        if (bruto || normalizarTextoBusca(buscaProc)) {
            procedimentosCatalogo.forEach((p) => {
                if (!procedimentoCombinaTermo(p, buscaProc)) return
                const cod = normCodigo(p.codigo)
                if (cod) out.add(cod)
            })
        }
        return [...out]
    }, [codigosSelecionados, buscaProc, procedimentosCatalogo, procedimentoCombinaTermo])

    const escolherSugestaoProcedimento = (p) => {
        const cod = normCodigo(p.codigo)
        if (!cod) return
        setCodigosSelecionados((prev) => new Set([...prev, cod]))
        setSugestoesAbertas(false)
    }

    useEffect(() => {
        const q = normalizarTextoBusca(buscaProc)
        if (q.length >= 2 && sugestoesProcedimento.length > 0) setSugestoesAbertas(true)
        if (!q) setSugestoesAbertas(false)
    }, [buscaProc, sugestoesProcedimento.length])

    const mapaEspNome = useMemo(() => new Map(especialidades.map((e) => [Number(e.id), e.nome])), [especialidades])

    const toggleCodigo = (codigo) => {
        const c = normCodigo(codigo)
        if (!c) return
        setCodigosSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(c)) next.delete(c)
            else next.add(c)
            return next
        })
    }

    const gruposBeneficioQr = useMemo(() => gruposDoCatalogo(catalogoBeneficios), [catalogoBeneficios])

    const benefCombinaTermo = useCallback((b, termoRaw) => {
        const termo = String(termoRaw || '')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
        if (!termo) return true
        const blob = [b.codigo, b.nome, b.grupo_codigo, b.grupo_nome]
            .map((x) =>
                String(x || '')
                    .normalize('NFD')
                    .replace(/\p{M}/gu, '')
                    .toLowerCase(),
            )
            .join(' ')
        return termo.split(/\s+/).filter(Boolean).every((t) => blob.includes(t))
    }, [])

    const beneficiosAba = useMemo(() => {
        const q = String(buscaBeneficio || '').trim()
        if (q) return catalogoBeneficios.filter((b) => benefCombinaTermo(b, buscaBeneficio))
        if (!abaGrupoDesconto) return catalogoBeneficios
        return catalogoBeneficios.filter((b) => b.grupo_codigo === abaGrupoDesconto)
    }, [catalogoBeneficios, abaGrupoDesconto, buscaBeneficio, benefCombinaTermo])

    const resolverBeneficioIdsParaPesquisa = useCallback(() => {
        const out = new Set([...beneficioIdsSelecionados])
        const bruto = String(buscaBeneficio || '').trim()
        if (bruto) {
            catalogoBeneficios.forEach((b) => {
                if (!benefCombinaTermo(b, buscaBeneficio)) return
                out.add(Number(b.id))
            })
        }
        return [...out].filter((id) => Number.isFinite(id) && id > 0)
    }, [beneficioIdsSelecionados, buscaBeneficio, catalogoBeneficios, benefCombinaTermo])

    const toggleBeneficioId = (id) => {
        const n = Number(id)
        if (!Number.isFinite(n)) return
        setBeneficioIdsSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(n)) next.delete(n)
            else next.add(n)
            return next
        })
    }

    const limparFiltrosDescontos = () => {
        setBeneficioIdsSelecionados(new Set())
        setBuscaBeneficio('')
        setResultados([])
        setPesquisou(false)
        setErro('')
    }

    const trocarModoBusca = (modo) => {
        setModoBusca(modo)
        setResultados([])
        setPesquisou(false)
        setErro('')
    }

    const temFiltroProcedimentos = codigosSelecionados.size > 0 || Boolean(String(buscaProc || '').trim())
    const temFiltroDescontos =
        beneficioIdsSelecionados.size > 0 || Boolean(String(buscaBeneficio || '').trim())

    const limparFiltrosProcedimentos = () => {
        setCodigosSelecionados(new Set())
        setBuscaProc('')
        setSugestoesAbertas(false)
        setResultados([])
        setPesquisou(false)
        setErro('')
    }

    const nomeServico = (codigo) => mapaNomePorCodigo.get(normCodigo(codigo)) || codigo

    const mapaCodigoPorProcedimentoId = useMemo(
        () => mapaCodigoProcedimentoIdDeCatalogo(procedimentosCatalogo),
        [procedimentosCatalogo],
    )

    const executarPesquisa = async () => {
        setErro('')
        setPesquisou(false)
        if (!uf || !cidadeNome) {
            setErro('Selecione UF e cidade.')
            return
        }
        setLoading(true)
        try {
            const cidadesAlvoPesquisa = [{ nome: cidadeNome, uf }]
            let lista
            if (modoDescontos) {
                const beneficioIds = resolverBeneficioIdsParaPesquisa()
                if (!beneficioIds.length) {
                    setErro('Marque tipos de desconto na lista ou digite na busca e clique em Pesquisar.')
                    setLoading(false)
                    return
                }
                lista = await pesquisarQuemOfereceDescontos(supabase, {
                    beneficioIds,
                    cidadesAlvo: cidadesAlvoPesquisa,
                    incluirCidadesParalelas: buscarCidadesParalelas,
                    prestadores,
                    prestadorCidades,
                    prestadorEstabelecimentos,
                    mapaCidadesCred,
                    especialidades,
                    catalogoBeneficios,
                    prestadoresParaVinculoLocalidade: todosPrestadoresAtivos })
            } else {
                const codigos = resolverCodigosParaPesquisa()
                if (!codigos.length) {
                    setErro(
                        'Marque procedimentos na lista ou digite na busca (ex.: consulta simples) e clique em Pesquisar.',
                    )
                    setLoading(false)
                    return
                }
                lista = await pesquisarQuemRealizaNaRede(supabase, {
                    codigosProcedimento: codigos,
                    cidadesAlvo: cidadesAlvoPesquisa,
                    incluirCidadesParalelas: buscarCidadesParalelas,
                    prestadores,
                    prestadorCidades,
                    prestadorEstabelecimentos,
                    mapaCidadesCred,
                    especialidades,
                    mapaNomePorCodigo,
                    mapaCodigoPorProcedimentoId,
                    prestadoresParaVinculoLocalidade: todosPrestadoresAtivos })
            }
            setResultados(lista)
            setPesquisou(true)
        } catch (e) {
            setErro(e?.message || String(e))
            setResultados([])
            setPesquisou(true)
        } finally {
            setLoading(false)
        }
    }

    const copiarResultados = async () => {
        if (!resultados.length || copiandoResultados) return
        setCopiandoResultados(true)
        try {
            const texto = formatarResultadosQuemRealizaParaClipboard(resultados, { modo: modoBusca })
            await navigator.clipboard.writeText(texto)
        } catch (e) {
            setErro(e?.message || 'Não foi possível copiar os resultados.')
        } finally {
            setCopiandoResultados(false)
        }
    }

    return (
        <div className="credenciamento_main quem_realiza">
            <h1>Credenciamento — Quem Realiza</h1>
            <hr />

            <section className="quem_realiza_filtros quem_realiza_filtros_center">
                <div className="quem_realiza_row quem_realiza_row_center">
                    <label className="pcad_field">
                        <span>UF</span>
                        <select className="credenciamento_main_input" value={uf} onChange={(e) => setUf(e.target.value)}>
                            <option value="">—</option>
                            {ufsPermitidasCredenciamento.map((sigla) => (
                                <option key={sigla} value={sigla}>
                                    {sigla}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="pcad_field">
                        <span>Cidade</span>
                        <select
                            className="credenciamento_main_input"
                            value={cidadeNome}
                            disabled={!uf || loadingMun}
                            onChange={(e) => setCidadeNome(e.target.value)}
                        >
                            <option value="">{loadingMun ? 'A carregar…' : '—'}</option>
                            {municipios.map((m) => (
                                <option key={m.id} value={m.nome}>
                                    {m.nome}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="quem_realiza_switch_cidades">
                        <span className="quem_realiza_switch_cidades_label">Buscar em cidades paralelas</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={buscarCidadesParalelas}
                            className={`credenciamento_switch ${buscarCidadesParalelas ? 'is-on' : 'is-off'}`}
                            disabled={!uf || !cidadeNome}
                            onClick={() => setBuscarCidadesParalelas((v) => !v)}
                            title="Inclui veterinários que têm esta cidade em «Cidades que atendem» no cadastro (além da sede/endereço)"
                        >
                            <span className="credenciamento_switch_track">
                                <span className="credenciamento_switch_knob" />
                            </span>
                            <span className="credenciamento_switch_label">
                                {buscarCidadesParalelas ? 'Sim' : 'Não'}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            <div className="quem_realiza_split">
                <section className="quem_realiza_proc quem_realiza_col">
                    <div className="quem_realiza_modo" role="tablist" aria-label="Tipo de pesquisa">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={!modoDescontos}
                            className={`quem_realiza_modo_btn ${!modoDescontos ? 'is-on' : ''}`}
                            onClick={() => trocarModoBusca('servicos')}
                        >
                            Serviços
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={modoDescontos}
                            className={`quem_realiza_modo_btn ${modoDescontos ? 'is-on' : ''}`}
                            onClick={() => trocarModoBusca('descontos')}
                        >
                            Descontos
                        </button>
                    </div>

                    {modoDescontos ? (
                        <>
                            <h2>Descontos</h2>
                            <p className="quem_realiza_cat_label">Grupos</p>
                            {gruposBeneficioQr.length === 0 ? (
                                <p className="pcad_muted">A carregar grupos…</p>
                            ) : (
                                <div className="quem_realiza_tabs" role="tablist" aria-label="Grupos de desconto">
                                    {gruposBeneficioQr.map((g) => (
                                        <button
                                            key={g.codigo}
                                            type="button"
                                            role="tab"
                                            aria-selected={abaGrupoDesconto === g.codigo}
                                            className={`quem_realiza_tab ${abaGrupoDesconto === g.codigo ? 'is-on' : ''}`}
                                            onClick={() => {
                                                setAbaGrupoDesconto(g.codigo)
                                                setBuscaBeneficio('')
                                            }}
                                        >
                                            {g.nome || g.codigo}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="quem_realiza_busca">
                                <div className="quem_realiza_busca_input_wrap">
                                    <CampoBuscaComLimpar
                                        className="credenciamento_main_input"
                                        placeholder="Buscar em todos os grupos (código ou tipo)"
                                        value={buscaBeneficio}
                                        onChange={(e) => setBuscaBeneficio(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                void executarPesquisa()
                                            }
                                        }}
                                        autoComplete="off"
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn quem_realiza_lupa"
                                    title="Pesquisar parceiros"
                                    disabled={loading}
                                    onClick={() => void executarPesquisa()}
                                >
                                    🔍 Pesquisar
                                </button>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary quem_realiza_limpar_proc"
                                    title="Desmarcar descontos e limpar a busca"
                                    disabled={!temFiltroDescontos}
                                    onClick={limparFiltrosDescontos}
                                >
                                    Limpar filtros
                                </button>
                            </div>
                            {erro && <p className="pcad_erro quem_realiza_erro_col">{erro}</p>}
                            {Boolean(String(buscaBeneficio || '').trim()) && (
                                <p className="pcad_muted quem_realiza_busca_hint">
                                    Exibindo tipos de <strong>todos os grupos</strong> que correspondem à busca.
                                </p>
                            )}
                            <div className="quem_realiza_proc_list">
                                {beneficiosAba.length === 0 && (
                                    <p className="pcad_muted quem_realiza_lista_vazia">
                                        {buscaBeneficio.trim()
                                            ? 'Nenhum tipo de desconto encontrado para este termo.'
                                            : 'Nenhum tipo neste grupo.'}
                                    </p>
                                )}
                                {beneficiosAba.map((b) => {
                                    const id = Number(b.id)
                                    const marcado = beneficioIdsSelecionados.has(id)
                                    return (
                                        <label
                                            key={b.id}
                                            className={`quem_realiza_proc_item ${marcado ? 'is-on' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={marcado}
                                                onChange={() => toggleBeneficioId(id)}
                                            />
                                            <span className="quem_realiza_proc_item_texto">
                                                <span>
                                                    <strong>{b.codigo}</strong> — {b.nome}
                                                </span>
                                                {Boolean(String(buscaBeneficio || '').trim()) && b.grupo_nome && (
                                                    <small className="quem_realiza_proc_cat">
                                                        {nomeGrupoBeneficioVisivel(b.grupo_nome)}
                                                    </small>
                                                )}
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        </>
                    ) : (
                        <>
                            <h2>Procedimentos</h2>
                            <p className="quem_realiza_cat_label">Categorias</p>
                            {categorias.length === 0 ? (
                                <p className="pcad_muted">A carregar categorias…</p>
                            ) : (
                                <div className="quem_realiza_tabs" role="tablist" aria-label="Categorias de procedimento">
                                    {categorias.map((cat) => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={Number(abaCategoria) === Number(cat.id)}
                                            className={`quem_realiza_tab ${Number(abaCategoria) === Number(cat.id) ? 'is-on' : ''}`}
                                            onClick={() => {
                                                setAbaCategoria(Number(cat.id))
                                                setBuscaProc('')
                                            }}
                                        >
                                            {cat.nome}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="quem_realiza_busca">
                                <div className="quem_realiza_busca_input_wrap" ref={buscaProcRef}>
                                    <CampoBuscaComLimpar
                                        className="credenciamento_main_input"
                                        placeholder="Buscar em todas as categorias (código, nome ou categoria)"
                                        value={buscaProc}
                                        onChange={(e) => setBuscaProc(e.target.value)}
                                        onFocus={() => {
                                            if (sugestoesProcedimento.length > 0) setSugestoesAbertas(true)
                                        }}
                                        onBlur={() => {
                                            setTimeout(() => setSugestoesAbertas(false), 180)
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                setSugestoesAbertas(false)
                                                void executarPesquisa()
                                            }
                                            if (e.key === 'Escape') setSugestoesAbertas(false)
                                        }}
                                        autoComplete="off"
                                    />
                                    {sugestoesAbertas && sugestoesProcedimento.length > 0 && (
                                        <ul className="quem_realiza_sugestoes" role="listbox">
                                            {sugestoesProcedimento.map((p) => {
                                                const cod = normCodigo(p.codigo)
                                                const catNome = mapaCategoriaNome.get(Number(p.categoria_id)) || '—'
                                                const jaSel = codigosSelecionados.has(cod)
                                                return (
                                                    <li key={p.id}>
                                                        <button
                                                            type="button"
                                                            onMouseDown={(ev) => ev.preventDefault()}
                                                            onClick={() => escolherSugestaoProcedimento(p)}
                                                        >
                                                            <span className="quem_realiza_sug_linha">
                                                                <strong>{p.codigo}</strong> — {p.nome}
                                                            </span>
                                                            <span className="quem_realiza_sug_cat">
                                                                {catNome}
                                                                {jaSel ? ' · selecionado' : ''}
                                                            </span>
                                                        </button>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn quem_realiza_lupa"
                                    title="Pesquisar prestadores"
                                    disabled={loading}
                                    onClick={() => void executarPesquisa()}
                                >
                                    🔍 Pesquisar
                                </button>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary quem_realiza_limpar_proc"
                                    title="Desmarcar procedimentos e limpar o campo de busca"
                                    disabled={!temFiltroProcedimentos}
                                    onClick={limparFiltrosProcedimentos}
                                >
                                    Limpar filtros
                                </button>
                            </div>
                            {erro && <p className="pcad_erro quem_realiza_erro_col">{erro}</p>}
                            {buscaEmTodasCategorias && (
                                <p className="pcad_muted quem_realiza_busca_hint">
                                    Exibindo procedimentos de <strong>todas as categorias</strong> que correspondem à
                                    busca.
                                </p>
                            )}
                            <div className="quem_realiza_proc_list">
                                {procedimentosFiltrados.length === 0 && (
                                    <p className="pcad_muted quem_realiza_lista_vazia">
                                        {buscaProc.trim()
                                            ? 'Nenhum procedimento encontrado em nenhuma categoria para este termo.'
                                            : 'Nenhum procedimento nesta categoria.'}
                                    </p>
                                )}
                                {procedimentosFiltrados.map((p) => {
                                    const cod = normCodigo(p.codigo)
                                    const marcado = codigosSelecionados.has(cod)
                                    const catNome = mapaCategoriaNome.get(Number(p.categoria_id))
                                    return (
                                        <label
                                            key={p.id}
                                            className={`quem_realiza_proc_item ${marcado ? 'is-on' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={marcado}
                                                onChange={() => toggleCodigo(cod)}
                                            />
                                            <span className="quem_realiza_proc_item_texto">
                                                <span>
                                                    <strong>{p.codigo}</strong> — {p.nome}
                                                </span>
                                                {buscaEmTodasCategorias && catNome && (
                                                    <small className="quem_realiza_proc_cat">{catNome}</small>
                                                )}
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </section>

                <section className="quem_realiza_resultados quem_realiza_col">
                    <div className="quem_realiza_resultados_head">
                        <h2>Resultados</h2>
                        {resultados.length > 0 && (
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary quem_realiza_copiar_resultados"
                                disabled={copiandoResultados}
                                onClick={() => void copiarResultados()}
                                title={
                                    modoDescontos
                                        ? 'Copiar: parceiro - especialidade - telefone, depois grupo — tipo — %'
                                        : 'Copiar: prestador - especialidade - telefone, depois procedimentos (um bloco por linha)'
                                }
                            >
                                {copiandoResultados ? 'Copiando…' : 'Copiar resultados'}
                            </button>
                        )}
                    </div>
                    {loading && <p className="pcad_muted">A pesquisar…</p>}
                    {!loading && pesquisou && resultados.length === 0 && (
                        <p className="pcad_muted">
                            {modoDescontos ? (
                                <>
                                    Nenhum parceiro <strong>credenciado</strong> encontrado que ofereça algum dos
                                    descontos selecionados nesta cidade
                                </>
                            ) : (
                                <>
                                    Nenhum prestador <strong>credenciado</strong> encontrado que realize algum dos
                                    procedimentos selecionados nesta cidade
                                </>
                            )}
                            {buscarCidadesParalelas
                                ? ' (endereço ou «Cidades que atendem»).'
                                : ' (somente cidade do endereço do cadastro). Ative «Buscar em cidades paralelas» para incluir quem atende na cidade sem endereço aqui.'}
                        </p>
                    )}
                    {!loading && resultados.length > 0 && (
                        <div className="quem_realiza_cards">
                            {resultados.map((r) => (
                                <article key={r.id} className="quem_realiza_card">
                                    {r.viaCidadeParalela && (
                                        <span
                                            className="quem_realiza_card_badge"
                                            title={`Atende em ${cidadeNome} (cidade paralela). Cidade principal: ${r.cidadePrincipal}`}
                                        >
                                            {r.cidadePrincipal}
                                        </span>
                                    )}
                                    <div className="quem_realiza_card_meta">
                                        <div className="quem_realiza_card_meta_item">
                                            <span className="quem_realiza_card_label">Nome</span>
                                            <span className="quem_realiza_card_value">{r.nome}</span>
                                        </div>
                                        <div className="quem_realiza_card_meta_item">
                                            <span className="quem_realiza_card_label">Especialidade</span>
                                            <span className="quem_realiza_card_value">{r.especialidade}</span>
                                        </div>
                                        <div className="quem_realiza_card_meta_item">
                                            <span className="quem_realiza_card_label">Telefone</span>
                                            <span className="quem_realiza_card_value">{r.telefone}</span>
                                        </div>
                                    </div>
                                    {modoDescontos ? (
                                        <ul className="quem_realiza_card_procs">
                                            {(r.beneficios || []).map((b) => (
                                                <li key={`${r.id}-${b.codigo}-${b.tipoNome}`}>
                                                    <span className="quem_realiza_proc_base">
                                                        {[b.grupoNome, b.tipoNome, b.faixa].filter(Boolean).join(' — ')}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <ul className="quem_realiza_card_procs">
                                            {r.procedimentos.map((proc) => (
                                                <li key={`${r.id}-${proc.nomeBase}-${proc.nomeAlt || ''}`}>
                                                    <span className="quem_realiza_proc_base">{proc.nomeBase}</span>
                                                    {proc.nomeAlt ? (
                                                        <>
                                                            {' — '}
                                                            <span className="quem_realiza_proc_alt">{proc.nomeAlt}</span>
                                                        </>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
