import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import { normalizarTextoBusca, resolverCidadePrincipalNome } from '../../../lib/prestadorCadastroHelpers.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import '../Credenciamento_main/Credenciamento_main.css'
import {
    avaliarViaCidadeParalela,
    prestadorAtendeCidadeAlvo,
} from '../../../lib/buscarQuemRealizaPrestadores.js'
import './CredenciamentoQuemRealiza.css'

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
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [mapaCidadesCred, setMapaCidadesCred] = useState(new Map())
    const [especialidades, setEspecialidades] = useState([])
    const [resultados, setResultados] = useState([])
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [pesquisou, setPesquisou] = useState(false)

    useEffect(() => {
        const run = async () => {
            const [
                { data: cats },
                { data: prest },
                { data: pc },
                { data: cc },
                { data: esps },
                procPaginado,
            ] = await Promise.all([
                supabase
                    .from('categorias')
                    .select('id, nome')
                    .gte('id', CATEGORIA_MIN)
                    .lte('id', CATEGORIA_MAX)
                    .order('id'),
                supabase
                    .from('prestadores')
                    .select(
                        'id, nome, telefone, celular, especialidade_id, endereco_uf, endereco_cidade, cidade_id, tipo, ativo'
                    )
                    .eq('ativo', true),
                supabase.from('prestador_cidades').select('prestador_id, cidade_id'),
                supabase.from('cidades_credenciamento').select('id, nome'),
                supabase.from('especialidades').select('id, nome'),
                buscarTodosPaginado(() =>
                    supabase
                        .from('procedimentos')
                        .select('id, codigo, nome, categoria_id')
                        .order('codigo', { ascending: true })
                ),
            ])
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
            setPrestadores(prest || [])
            setPrestadorCidades(pc || [])
            setMapaCidadesCred(new Map((cc || []).map((c) => [Number(c.id), c.nome])))
            setEspecialidades(esps || [])
        }
        void run()
    }, [])

    useEffect(() => {
        if (!uf) {
            setMunicipios([])
            setCidadeNome('')
            return
        }
        setLoadingMun(true)
        buscarMunicipiosPorUf(uf)
            .then((lista) => setMunicipios(lista))
            .catch(() => setMunicipios([]))
            .finally(() => setLoadingMun(false))
    }, [uf])

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
        (p, q) => {
            if (!q) return true
            const cod = normalizarTextoBusca(p.codigo)
            const nom = normalizarTextoBusca(p.nome)
            const cat = normalizarTextoBusca(mapaCategoriaNome.get(Number(p.categoria_id)) || '')
            return cod.includes(q) || nom.includes(q) || cat.includes(q)
        },
        [mapaCategoriaNome]
    )

    const sugestoesProcedimento = useMemo(() => {
        const q = normalizarTextoBusca(buscaProc)
        if (!q || q.length < 2) return []
        return procedimentosCatalogo.filter((p) => procedimentoCombinaTermo(p, q)).slice(0, 18)
    }, [buscaProc, procedimentosCatalogo, procedimentoCombinaTermo])

    const procedimentosFiltrados = useMemo(() => {
        const q = normalizarTextoBusca(buscaProc)
        const base = q ? procedimentosCatalogo.filter((p) => procedimentoCombinaTermo(p, q)) : procedimentosCat
        return base.slice(0, q ? 300 : undefined)
    }, [procedimentosCat, buscaProc, procedimentosCatalogo, procedimentoCombinaTermo])

    const buscaEmTodasCategorias = Boolean(normalizarTextoBusca(buscaProc))

    const resolverCodigosParaPesquisa = useCallback(() => {
        const out = new Set([...codigosSelecionados])
        const q = normalizarTextoBusca(buscaProc)
        if (q) {
            procedimentosCatalogo.forEach((p) => {
                if (!procedimentoCombinaTermo(p, q)) return
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

    const nomeCidadePrincipalPrestador = useCallback(
        (p) => {
            const rels = prestadorCidades.filter((r) => Number(r.prestador_id) === Number(p.id))
            return resolverCidadePrincipalNome(p, {
                mapaCidadeNomePorId: mapaCidadesCred,
                relacoesCidades: rels,
            })
        },
        [mapaCidadesCred, prestadorCidades]
    )

    const ctxFiltroCidade = useMemo(
        () => ({
            mapaCidadesCred,
            prestadorCidades,
            incluirCidadesParalelas: buscarCidadesParalelas,
        }),
        [mapaCidadesCred, prestadorCidades, buscarCidadesParalelas],
    )

    const alvoCidadeFiltro = useMemo(
        () => (uf && cidadeNome ? { nome: cidadeNome, uf } : null),
        [uf, cidadeNome],
    )

    const prestadorAtendeCidade = useCallback(
        (p) => {
            if (!alvoCidadeFiltro) return false
            return prestadorAtendeCidadeAlvo(p, alvoCidadeFiltro, ctxFiltroCidade)
        },
        [alvoCidadeFiltro, ctxFiltroCidade],
    )

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

    const temFiltroProcedimentos = codigosSelecionados.size > 0 || Boolean(String(buscaProc || '').trim())

    const limparFiltrosProcedimentos = () => {
        setCodigosSelecionados(new Set())
        setBuscaProc('')
        setSugestoesAbertas(false)
        setResultados([])
        setPesquisou(false)
        setErro('')
    }

    const nomeServico = (codigo) => mapaNomePorCodigo.get(normCodigo(codigo)) || codigo

    const executarPesquisa = async () => {
        setErro('')
        setPesquisou(false)
        if (!uf || !cidadeNome) {
            setErro('Selecione UF e cidade.')
            return
        }
        const codigos = resolverCodigosParaPesquisa()
        if (!codigos.length) {
            setErro('Marque procedimentos na lista ou digite na busca (ex.: consulta simples) e clique em Pesquisar.')
            return
        }
        setLoading(true)
        try {
            const candidatos = prestadores.filter(prestadorAtendeCidade)
            const ids = candidatos.map((p) => Number(p.id)).filter(Boolean)
            if (!ids.length) {
                setResultados([])
                setPesquisou(true)
                return
            }
            const vinculos = []
            const chunk = 40
            for (let i = 0; i < ids.length; i += chunk) {
                const lote = ids.slice(i, i + chunk)
                const { data, error } = await supabase
                    .from('prestador_procedimentos')
                    .select('prestador_id, procedimento_cod')
                    .in('prestador_id', lote)
                if (error) throw new Error(error.message)
                vinculos.push(...(data || []))
            }
            const porPrestador = new Map()
            vinculos.forEach((v) => {
                const pid = Number(v.prestador_id)
                const cod = normCodigo(v.procedimento_cod)
                if (!pid || !cod) return
                if (!porPrestador.has(pid)) porPrestador.set(pid, new Set())
                porPrestador.get(pid).add(cod)
            })
            const lista = candidatos
                .filter((p) => {
                    const set = porPrestador.get(Number(p.id))
                    if (!set) return false
                    return codigos.some((c) => set.has(c))
                })
                .map((p) => {
                    const set = porPrestador.get(Number(p.id)) || new Set()
                    const realizaNomes = codigos
                        .filter((c) => set.has(c))
                        .map((c) => nomeServico(c))
                        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
                    const tel = [p.celular, p.telefone].map((t) => String(t || '').trim()).find(Boolean) || '—'
                    const viaCidadeParalela =
                        buscarCidadesParalelas &&
                        alvoCidadeFiltro &&
                        avaliarViaCidadeParalela(p, [alvoCidadeFiltro], ctxFiltroCidade)
                    return {
                        id: p.id,
                        nome: p.nome,
                        especialidade: mapaEspNome.get(Number(p.especialidade_id)) || '—',
                        telefone: tel,
                        procedimentos: realizaNomes,
                        viaCidadeParalela,
                        cidadePrincipal: nomeCidadePrincipalPrestador(p),
                    }
                })
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
            setResultados(lista)
            setPesquisou(true)
        } catch (e) {
            setErro(e?.message || String(e))
            setResultados([])
        } finally {
            setLoading(false)
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
                            {UFS_BRASIL.map((sigla) => (
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
                            <input
                                type="search"
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
                            Exibindo procedimentos de <strong>todas as categorias</strong> que correspondem à busca.
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
                                <label key={p.id} className={`quem_realiza_proc_item ${marcado ? 'is-on' : ''}`}>
                                    <input type="checkbox" checked={marcado} onChange={() => toggleCodigo(cod)} />
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
                </section>

                <section className="quem_realiza_resultados quem_realiza_col">
                    <h2>Resultados</h2>
                    {loading && <p className="pcad_muted">A pesquisar…</p>}
                    {!loading && pesquisou && resultados.length === 0 && (
                        <p className="pcad_muted">
                            Nenhum prestador (veterinário ou clínica) encontrado que realize algum dos procedimentos selecionados nesta cidade
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
                                    <ul className="quem_realiza_card_procs">
                                        {r.procedimentos.map((nome) => (
                                            <li key={`${r.id}-${nome}`}>{nome}</li>
                                        ))}
                                    </ul>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
