import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase.js'
import { mapearPlanos } from '../../../lib/planosHierarquia.js'
import {
    buscarCidadeIdsFiltroPlanoCredenciados,
    carregarVinculosMunicipios,
    listarOpcoesMunicipioImpressaoPlanos,
    ufsDisponiveisFiltroCredenciamento,
} from '../../../lib/cidadesSupertabelaVinculos.js'
import { listarPlanosImpressaoOrdenados } from '../../../lib/impressaoPlanos/mapearPlanoPdfAsset.js'
import { carregarLinhasImpressaoPlanos } from '../../../lib/impressaoPlanos/carregarLinhasImpressaoPlanos.js'
import {
    downloadImpressaoPlanosPdf,
    gerarImpressaoPlanosPdf,
} from '../../../lib/impressaoPlanos/gerarImpressaoPlanosPdf.js'
import { MIN_REALIZADORES_PRE_MARCAR } from '../../../lib/impressaoPlanos/mapaRealizadoresRegiao.js'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import '../../Supertabela/Supertabela_planos/Supertabelaplanos.css'
import './ImpressaoPlanos.css'
import CelulaRealizadores, { obterClasseProcedimento } from './CelulaRealizadores.jsx'
import { procedimentoIsentoLimiteGrupo } from '../../../lib/categoriaLimitesGrupo.js'

export default function ImpressaoPlanos() {
    const [planos, setPlanos] = useState([])
    const [cidades, setCidades] = useState([])
    const [cidadeIdsPermitidos, setCidadeIdsPermitidos] = useState(null)
    const [vinculosMunicipios, setVinculosMunicipios] = useState([])
    const [municipiosIbge, setMunicipiosIbge] = useState([])
    const [loadingMunicipios, setLoadingMunicipios] = useState(false)

    const [uf, setUf] = useState('')
    const [municipioNome, setMunicipioNome] = useState('')
    const [planoId, setPlanoId] = useState('')
    const [incluirCidadesParalelas, setIncluirCidadesParalelas] = useState(true)

    const [carregando, setCarregando] = useState(false)
    const [gerandoPdf, setGerandoPdf] = useState(false)
    const [erro, setErro] = useState('')
    const [buscaProc, setBuscaProc] = useState('')

    const [meta, setMeta] = useState(null)
    const [categorias, setCategorias] = useState([])
    const [ordenColuna, setOrdenColuna] = useState('codigo')
    const [ordenDir, setOrdenDir] = useState('asc')

    useEffect(() => {
        const run = async () => {
            const [{ data: planosData }, { data: cidadesData }, vinculos] = await Promise.all([
                supabase.from('planos').select('id, nome').order('id'),
                supabase.from('cidades').select('id, nome, uf').order('nome', { ascending: true }),
                carregarVinculosMunicipios(supabase).catch(() => []),
            ])
            setPlanos(planosData || [])
            setCidades(cidadesData || [])
            setVinculosMunicipios(vinculos || [])
        }
        void run()
    }, [])

    useEffect(() => {
        let cancelado = false
        const run = async () => {
            try {
                const ids = await buscarCidadeIdsFiltroPlanoCredenciados(
                    supabase,
                    planoId || null,
                    buscarTodosPaginado,
                )
                if (!cancelado) setCidadeIdsPermitidos(ids)
            } catch {
                if (!cancelado) setCidadeIdsPermitidos(new Set())
            }
        }
        void run()
        return () => {
            cancelado = true
        }
    }, [planoId])

    const mapaPlanos = useMemo(() => mapearPlanos(planos), [planos])
    const planosImpressao = useMemo(
        () => listarPlanosImpressaoOrdenados(planos, mapaPlanos),
        [planos, mapaPlanos],
    )

    const ufsPermitidas = useMemo(() => {
        const set = ufsDisponiveisFiltroCredenciamento(cidades, cidadeIdsPermitidos)
        return UFS_BRASIL.filter((sigla) => set.has(sigla))
    }, [cidades, cidadeIdsPermitidos])

    const opcoesMunicipio = useMemo(
        () =>
            listarOpcoesMunicipioImpressaoPlanos(
                cidades,
                vinculosMunicipios,
                municipiosIbge,
                uf,
                cidadeIdsPermitidos,
            ),
        [cidades, vinculosMunicipios, municipiosIbge, uf, cidadeIdsPermitidos],
    )

    const municipioSelecionado = useMemo(
        () => opcoesMunicipio.find((o) => o.municipioNome === municipioNome) || null,
        [opcoesMunicipio, municipioNome],
    )

    const cidadeTabelaId = municipioSelecionado?.cidadeTabelaId ?? null

    useEffect(() => {
        if (!uf) {
            setMunicipiosIbge([])
            setMunicipioNome('')
            return
        }
        setLoadingMunicipios(true)
        buscarMunicipiosPorUf(uf)
            .then((lista) => setMunicipiosIbge(lista || []))
            .catch(() => setMunicipiosIbge([]))
            .finally(() => setLoadingMunicipios(false))
    }, [uf])

    useEffect(() => {
        if (!municipioNome) return
        const ok = opcoesMunicipio.some((o) => o.municipioNome === municipioNome)
        if (!ok) setMunicipioNome('')
    }, [municipioNome, opcoesMunicipio])

    const limparLista = useCallback(() => {
        setCategorias([])
        setMeta(null)
        setErro('')
    }, [])

    const carregarLista = useCallback(async () => {
        setErro('')
        setCarregando(true)
        setCategorias([])
        setMeta(null)
        try {
            const res = await carregarLinhasImpressaoPlanos({
                cidadeId: cidadeTabelaId,
                municipioNome,
                planoId,
                incluirCidadesParalelas,
                planosLista: planos,
            })
            setMeta({
                pdfUrl: res.pdfUrl,
                planoNome: res.planoNome,
                cidadeNome: res.cidadeNome,
            })
            setCategorias(res.categorias)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setCarregando(false)
        }
    }, [cidadeTabelaId, municipioNome, planoId, incluirCidadesParalelas, planos])

    const toggleLinha = (categoriaId, linhaKey) => {
        setCategorias((prev) =>
            prev.map((cat) => {
                if (Number(cat.id) !== Number(categoriaId)) return cat
                return {
                    ...cat,
                    linhas: (cat.linhas || []).map((l) =>
                        l.linhaKey === linhaKey ? { ...l, checked: !l.checked } : l,
                    ),
                }
            }),
        )
    }

    const toggleTodasCategoria = (categoriaId, marcar) => {
        setCategorias((prev) =>
            prev.map((cat) => {
                if (Number(cat.id) !== Number(categoriaId)) return cat
                return {
                    ...cat,
                    linhas: (cat.linhas || []).map((l) => ({ ...l, checked: marcar })),
                }
            }),
        )
    }

    const marcarComPrestadoresCategoria = (categoriaId) => {
        setCategorias((prev) =>
            prev.map((cat) => {
                if (Number(cat.id) !== Number(categoriaId)) return cat
                return {
                    ...cat,
                    linhas: (cat.linhas || []).map((l) => ({
                        ...l,
                        checked: Number(l.realizadores || 0) > 0,
                    })),
                }
            }),
        )
    }

    const categoriasFiltradas = useMemo(() => {
        if (!normalizarTextoBusca(buscaProc)) return categorias
        return categorias
            .map((cat) => ({
                ...cat,
                linhas: (cat.linhas || []).filter((l) => {
                    const blob = normalizarTextoBusca(
                        [
                            l.codigo,
                            l.nome,
                            l.diferenca,
                            l.limiteExibicao,
                            l.carenciaExibicao,
                            l.realizadores,
                            ...(l.realizadoresNomes || []),
                        ].join(' '),
                    )
                    return filtrarPorTermoBusca(blob, buscaProc)
                }),
            }))
            .filter((cat) => (cat.linhas || []).length > 0)
    }, [categorias, buscaProc])

    const ordenarLinhas = useCallback(
        (linhas) => {
            const fator = ordenDir === 'asc' ? 1 : -1
            const list = [...(linhas || [])]
            list.sort((a, b) => {
                if (ordenColuna === 'checked') {
                    const ca = a.checked !== false ? 1 : 0
                    const cb = b.checked !== false ? 1 : 0
                    return (ca - cb) * fator
                }
                if (ordenColuna === 'realizadores') {
                    return (Number(a.realizadores || 0) - Number(b.realizadores || 0)) * fator
                }
                if (ordenColuna === 'diferenca') {
                    return (Number(a.diferencaNum || 0) - Number(b.diferencaNum || 0)) * fator
                }
                if (ordenColuna === 'limite') {
                    return (
                        fator *
                        String(a.limiteExibicao || '').localeCompare(
                            String(b.limiteExibicao || ''),
                            'pt-BR',
                            { sensitivity: 'base' },
                        )
                    )
                }
                if (ordenColuna === 'carencia') {
                    return (
                        fator *
                        String(a.carenciaExibicao || '').localeCompare(
                            String(b.carenciaExibicao || ''),
                            'pt-BR',
                            { sensitivity: 'base' },
                        )
                    )
                }
                if (ordenColuna === 'nome') {
                    return (
                        fator *
                        String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
                            sensitivity: 'base',
                        })
                    )
                }
                return (
                    fator *
                    String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', {
                        sensitivity: 'base',
                    })
                )
            })
            return list
        },
        [ordenColuna, ordenDir],
    )

    const categoriasExibicao = useMemo(
        () =>
            categoriasFiltradas.map((cat) => ({
                ...cat,
                linhas: ordenarLinhas(cat.linhas),
            })),
        [categoriasFiltradas, ordenarLinhas],
    )

    const alternarOrdenacao = (coluna) => {
        if (ordenColuna === coluna) {
            setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setOrdenColuna(coluna)
            setOrdenDir(coluna === 'nome' || coluna === 'codigo' ? 'asc' : 'desc')
        }
    }

    const indicadorOrdem = (coluna) => {
        if (ordenColuna !== coluna) return ''
        return ordenDir === 'asc' ? ' ▲' : ' ▼'
    }

    const rotuloDiferenca = meta?.planoNome ? `Diferença ${meta.planoNome}` : 'Diferença'
    const rotuloDiferencaCurto = 'Dif.'

    const gerarPdf = async () => {
        if (!meta?.pdfUrl) return
        setGerandoPdf(true)
        setErro('')
        try {
            const blob = await gerarImpressaoPlanosPdf({
                pdfUrl: meta.pdfUrl,
                categorias,
            })
            downloadImpressaoPlanosPdf(blob, meta.planoNome, meta.cidadeNome)
        } catch (e) {
            setErro(e?.message || 'Falha ao gerar PDF.')
        } finally {
            setGerandoPdf(false)
        }
    }

    const totalMarcados = useMemo(
        () =>
            categorias.reduce(
                (acc, c) => acc + (c.linhas || []).filter((l) => l.checked !== false).length,
                0,
            ),
        [categorias],
    )

    return (
        <div className="credenciamento_main planos_impressao">
            <h1>Planos — Impressão</h1>
            <hr />

            <section className="planos_impressao_filtros planos_impressao_filtros_center">
                <div className="planos_impressao_row planos_impressao_row_center">
                    <label className="pcad_field">
                        <span>UF</span>
                        <select
                            className="credenciamento_main_input"
                            value={uf}
                            onChange={(e) => {
                                setUf(e.target.value)
                                setMunicipioNome('')
                                limparLista()
                            }}
                        >
                            <option value="">—</option>
                            {ufsPermitidas.map((sigla) => (
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
                            value={municipioNome}
                            disabled={!uf || loadingMunicipios}
                            onChange={(e) => {
                                setMunicipioNome(e.target.value)
                                limparLista()
                            }}
                        >
                            <option value="">
                                {!uf ? 'Selecione a UF' : loadingMunicipios ? 'A carregar…' : '—'}
                            </option>
                            {opcoesMunicipio.map((o) => (
                                <option key={o.municipioNome} value={o.municipioNome}>
                                    {o.municipioNome}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="pcad_field">
                        <span>Plano</span>
                        <select
                            className="credenciamento_main_input"
                            value={planoId}
                            disabled={!municipioNome}
                            onChange={(e) => {
                                setPlanoId(e.target.value)
                                limparLista()
                            }}
                        >
                            <option value="">{!municipioNome ? 'Selecione a cidade' : '—'}</option>
                            {planosImpressao.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.nome}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="planos_impressao_switch_cidades">
                        <span className="planos_impressao_switch_label">Cidades paralelas</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={incluirCidadesParalelas}
                            className={`credenciamento_switch ${incluirCidadesParalelas ? 'is-on' : 'is-off'}`}
                            disabled={!municipioNome}
                            onClick={() => setIncluirCidadesParalelas((v) => !v)}
                            title="Inclui prestadores com esta cidade em «Cidades que atendem» na contagem de realizadores"
                        >
                            <span className="credenciamento_switch_track">
                                <span className="credenciamento_switch_knob" />
                            </span>
                            <span className="credenciamento_switch_label">
                                {incluirCidadesParalelas ? 'Sim' : 'Não'}
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        className="planos_impressao_btn_carregar"
                        disabled={!municipioNome || !planoId || !cidadeTabelaId || carregando}
                        onClick={() => void carregarLista()}
                    >
                        {carregando ? 'Carregando…' : 'Carregar procedimentos'}
                    </button>
                </div>
            </section>

            <p className="planos_impressao_hint">
                Pré-marcação automática com {MIN_REALIZADORES_PRE_MARCAR}+ realizadores na região (cidade
                {incluirCidadesParalelas ? ' + paralelas' : ''}).
            </p>

            {erro ? <p className="planos_impressao_erro">{erro}</p> : null}

            {categorias.length > 0 ? (
                <>
                    <div className="planos_impressao_toolbar">
                        <CampoBuscaComLimpar
                            value={buscaProc}
                            onChange={(e) => setBuscaProc(e.target.value)}
                            placeholder="Buscar por código ou nome…"
                            className="credenciamento_main_input"
                        />
                        <button
                            type="button"
                            className="planos_impressao_btn_pdf"
                            disabled={gerandoPdf || totalMarcados === 0}
                            onClick={() => void gerarPdf()}
                        >
                            {gerandoPdf ? 'Gerando PDF…' : `Imprimir PDF (${totalMarcados})`}
                        </button>
                    </div>

                    <div className="supertabelaplanos planos_impressao_conteudo">
                        <div className="supertabelaplanos_table_stage">
                            {categoriasExibicao.map((cat) => (
                                <section key={cat.id} className="categoria_secao">
                                    <div className="planos_impressao_secao_head">
                                        <h2 className="categoria_titulo">{cat.nome}</h2>
                                        <div className="planos_impressao_secao_acoes">
                                            <button
                                                type="button"
                                                className="planos_impressao_btn_secao planos_impressao_btn_secao_prestadores"
                                                onClick={() => marcarComPrestadoresCategoria(cat.id)}
                                                title="Marca apenas procedimentos com pelo menos um realizador na região"
                                            >
                                                Com prestadores
                                            </button>
                                            <button
                                                type="button"
                                                className="planos_impressao_btn_secao planos_impressao_btn_secao_marcar"
                                                onClick={() => toggleTodasCategoria(cat.id, true)}
                                            >
                                                Marcar todos
                                            </button>
                                            <button
                                                type="button"
                                                className="planos_impressao_btn_secao planos_impressao_btn_secao_desmarcar"
                                                onClick={() => toggleTodasCategoria(cat.id, false)}
                                            >
                                                Desmarcar todos
                                            </button>
                                        </div>
                                    </div>
                                    <div className="planos_impressao_table_wrap">
                                    <table className="table_main planos_impressao_table_main">
                                        <colgroup>
                                            <col className="planos_impressao_col_check" />
                                            <col className="planos_impressao_col_codigo" />
                                            <col className="planos_impressao_col_nome" />
                                            <col className="planos_impressao_col_realiz" />
                                            <col className="planos_impressao_col_dif" />
                                            <col className="planos_impressao_col_limite" />
                                            <col className="planos_impressao_col_carencia" />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th
                                                    className="table_header planos_impressao_th_check"
                                                    onClick={() => alternarOrdenacao('checked')}
                                                    title="Ordenar por marcados"
                                                >
                                                    <span className="planos_impressao_th_check_label">
                                                        ✓{indicadorOrdem('checked')}
                                                    </span>
                                                </th>
                                                <th
                                                    className="table_header planos_impressao_th_compact"
                                                    onClick={() => alternarOrdenacao('codigo')}
                                                >
                                                    Cód.{indicadorOrdem('codigo')}
                                                </th>
                                                <th
                                                    className="table_header"
                                                    onClick={() => alternarOrdenacao('nome')}
                                                >
                                                    Nome{indicadorOrdem('nome')}
                                                </th>
                                                <th
                                                    className="table_header planos_impressao_th_compact planos_impressao_th_realiz"
                                                    onClick={() => alternarOrdenacao('realizadores')}
                                                    title="Realizadores"
                                                >
                                                    Real.{indicadorOrdem('realizadores')}
                                                </th>
                                                <th
                                                    className="table_header planos_impressao_th_compact"
                                                    onClick={() => alternarOrdenacao('diferenca')}
                                                    title={rotuloDiferenca}
                                                >
                                                    <span className="planos_impressao_th_stack">
                                                        {rotuloDiferencaCurto}
                                                        {indicadorOrdem('diferenca')}
                                                    </span>
                                                </th>
                                                <th
                                                    className="table_header planos_impressao_th_compact"
                                                    onClick={() => alternarOrdenacao('limite')}
                                                >
                                                    Lim.{indicadorOrdem('limite')}
                                                </th>
                                                <th
                                                    className="table_header planos_impressao_th_compact"
                                                    onClick={() => alternarOrdenacao('carencia')}
                                                >
                                                    Car.{indicadorOrdem('carencia')}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                const linhasSecao = cat.linhas || []
                                                const limiteGrupo = cat.limiteGrupoValor
                                                const usaLimiteGrupoSecao = Boolean(limiteGrupo)
                                                const linhasNoGrupo = usaLimiteGrupoSecao
                                                    ? linhasSecao.filter(
                                                          (item) => !procedimentoIsentoLimiteGrupo(item),
                                                      )
                                                    : []
                                                const rowspanGrupo = linhasNoGrupo.length
                                                const podeMesclarLimiteGrupo =
                                                    ordenColuna === 'codigo' && usaLimiteGrupoSecao && rowspanGrupo > 0
                                                const textoGrupo = cat.textoLimiteGrupo || ''

                                                return linhasSecao.map((linha) => {
                                                    const isentoLimiteGrupo = procedimentoIsentoLimiteGrupo(linha)
                                                    const indiceNoGrupo = linhasNoGrupo.findIndex(
                                                        (item) => item.linhaKey === linha.linhaKey,
                                                    )

                                                    let celulaLimite = null
                                                    if (isentoLimiteGrupo || !usaLimiteGrupoSecao) {
                                                        celulaLimite = (
                                                            <td
                                                                className="table_text_left planos_impressao_td_compact planos_impressao_td_limite"
                                                                title={
                                                                    linha.limiteIndividualExibicao ||
                                                                    linha.limiteExibicao
                                                                }
                                                            >
                                                                {linha.limiteIndividualExibicao ||
                                                                    linha.limiteExibicao}
                                                            </td>
                                                        )
                                                    } else if (
                                                        podeMesclarLimiteGrupo &&
                                                        indiceNoGrupo === 0
                                                    ) {
                                                        celulaLimite = (
                                                            <td
                                                                rowSpan={rowspanGrupo}
                                                                className="supertabelaplanos_limite_grupo_cell planos_impressao_td_limite_grupo"
                                                                title={textoGrupo}
                                                            >
                                                                {textoGrupo}
                                                            </td>
                                                        )
                                                    } else if (
                                                        podeMesclarLimiteGrupo &&
                                                        indiceNoGrupo > 0
                                                    ) {
                                                        celulaLimite = null
                                                    } else {
                                                        celulaLimite = (
                                                            <td
                                                                className="table_text_left planos_impressao_td_compact planos_impressao_td_limite"
                                                                title={linha.limiteExibicao || textoGrupo}
                                                            >
                                                                {linha.limiteExibicao || textoGrupo}
                                                            </td>
                                                        )
                                                    }

                                                    return (
                                                        <tr key={linha.linhaKey}>
                                                            <td className="planos_impressao_td_check">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={linha.checked !== false}
                                                                    onChange={() =>
                                                                        toggleLinha(cat.id, linha.linhaKey)
                                                                    }
                                                                    aria-label={`Selecionar ${linha.codigo} ${linha.nome}`}
                                                                />
                                                            </td>
                                                            <td
                                                                className="table_text_left planos_impressao_td_compact planos_impressao_td_codigo"
                                                                title={linha.codigo}
                                                            >
                                                                {linha.codigo}
                                                            </td>
                                                            <td
                                                                className={`table_text_left planos_impressao_td_nome ${obterClasseProcedimento(linha.nome)}`}
                                                            >
                                                                {linha.nome}
                                                            </td>
                                                            <CelulaRealizadores
                                                                contagem={linha.realizadores}
                                                                nomes={linha.realizadoresNomes}
                                                            />
                                                            <td
                                                                className="planos_impressao_td_compact planos_impressao_td_dif"
                                                                title={linha.diferenca}
                                                            >
                                                                {linha.diferenca}
                                                            </td>
                                                            {celulaLimite}
                                                            <td
                                                                className="planos_impressao_td_compact planos_impressao_td_carencia"
                                                                title={linha.carenciaExibicao}
                                                            >
                                                                {linha.carenciaExibicao}
                                                            </td>
                                                        </tr>
                                                    )
                                                })
                                            })()}
                                        </tbody>
                                    </table>
                                    </div>
                                </section>
                            ))}
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    )
}
