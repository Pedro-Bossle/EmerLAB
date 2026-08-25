import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades.js'
import {
    buscarCidadeIdsFiltroPlanoCredenciados,
    buildNomesMunicipioPermitidosPorUf,
    carregarVinculosMunicipios,
    filtrarMunicipiosIbgePorCredenciamento,
    ufsDisponiveisFiltroCredenciamento,
} from '../../../lib/cidadesSupertabelaVinculos.js'
import { prestadorEhCredenciado } from '../../../lib/prestadorCadastroHelpers.js'
import {
    agruparCredenciadosPorEspecialidadeCidade,
    formatarEspecialidadeCidadeParaClipboard,
} from '../../../lib/credenciamento/especialidadesPorCidade.js'
import { anexarLocalidadeVinculoAoCtx } from '../../../lib/prestadorLocalidadeVinculo.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase.js'
import '../Credenciamento_main/Credenciamento_main.css'
import '../QuemRealiza/CredenciamentoQuemRealiza.css'
import './CredenciamentoEspecialidadesCidade.css'
import { PageHeader } from '../../../components/ui'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'

function usarContagemColunasEspecialidade() {
    const [cols, setCols] = useState(() => {
        if (typeof window === 'undefined') return 3
        if (window.matchMedia('(max-width: 620px)').matches) return 1
        if (window.matchMedia('(max-width: 960px)').matches) return 2
        return 3
    })
    useEffect(() => {
        const mq1 = window.matchMedia('(max-width: 620px)')
        const mq2 = window.matchMedia('(max-width: 960px)')
        const sync = () => {
            if (mq1.matches) setCols(1)
            else if (mq2.matches) setCols(2)
            else setCols(3)
        }
        sync()
        mq1.addEventListener('change', sync)
        mq2.addEventListener('change', sync)
        return () => {
            mq1.removeEventListener('change', sync)
            mq2.removeEventListener('change', sync)
        }
    }, [])
    return cols
}

export default function CredenciamentoEspecialidadesCidade() {
    const [uf, setUf] = useState('')
    const [cidadeNome, setCidadeNome] = useState('')
    const [buscarCidadesParalelas, setBuscarCidadesParalelas] = useState(false)
    const [municipios, setMunicipios] = useState([])
    const [loadingMun, setLoadingMun] = useState(false)
    const [cidadesTabela, setCidadesTabela] = useState([])
    const [vinculosMunicipios, setVinculosMunicipios] = useState([])
    const [idsFiltroCidadeCred, setIdsFiltroCidadeCred] = useState(null)

    const [prestadores, setPrestadores] = useState([])
    const [todosPrestadoresAtivos, setTodosPrestadoresAtivos] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [prestadorEspecialidades, setPrestadorEspecialidades] = useState([])
    const [mapaCidadesCred, setMapaCidadesCred] = useState(new Map())
    const [especialidades, setEspecialidades] = useState([])
    const [loading, setLoading] = useState(true)
    const [expandidas, setExpandidas] = useState({})
    const [copiadoEspId, setCopiadoEspId] = useState(null)
    const [ordenacao, setOrdenacao] = useState('desc')
    const colunasCount = usarContagemColunasEspecialidade()

    useEffect(() => {
        const run = async () => {
            setLoading(true)
            try {
                const [resPrest, resPc, resCc, { data: esps }, resPe, { data: sit }, resPeEst] =
                    await Promise.all([
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
                            supabase
                                .from('cidades_credenciamento')
                                .select('id, nome')
                                .order('id', { ascending: true }),
                        ),
                        supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                        buscarTodosPaginado(() =>
                            supabase
                                .from('prestador_especialidades')
                                .select('prestador_id, especialidade_id, principal')
                                .order('prestador_id', { ascending: true }),
                        ),
                        supabase.from('situacoes').select('id, descricao'),
                        buscarTodosPaginado(() =>
                            supabase
                                .from('prestador_estabelecimentos')
                                .select('veterinario_id, estabelecimento_id, principal')
                                .order('veterinario_id', { ascending: true }),
                        ),
                    ])
                const prest = resPrest.data || []
                const pc = resPc.data || []
                const cc = resCc.data || []
                const pe = resPe.data || []
                const peEst = resPeEst.data || []
                const listaSituacoes = sit || []
                setTodosPrestadoresAtivos(prest)
                setPrestadores(prest.filter((p) => prestadorEhCredenciado(p, listaSituacoes)))
                setPrestadorCidades(pc)
                setPrestadorEstabelecimentos(peEst)
                setMapaCidadesCred(new Map(cc.map((c) => [Number(c.id), c.nome])))
                setEspecialidades(esps || [])
                setPrestadorEspecialidades(pe)
            } finally {
                setLoading(false)
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

    const ctxCidade = useMemo(
        () =>
            anexarLocalidadeVinculoAoCtx(
                {
                    mapaCidadesCred,
                    prestadorCidades,
                    incluirCidadesParalelas: buscarCidadesParalelas,
                },
                todosPrestadoresAtivos,
                prestadorEstabelecimentos,
            ),
        [mapaCidadesCred, prestadorCidades, buscarCidadesParalelas, todosPrestadoresAtivos, prestadorEstabelecimentos],
    )

    const grupos = useMemo(() => {
        if (!cidadeNome || !uf) return []
        const base = agruparCredenciadosPorEspecialidadeCidade({
            prestadores,
            prestadorEspecialidades,
            especialidades,
            cidadeAlvo: { nome: cidadeNome, uf },
            ctx: ctxCidade,
            incluirCidadesParalelas: buscarCidadesParalelas,
        })
        const lista = [...base]
        const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
        const porTotal = (a, b) => a.total - b.total
        if (ordenacao === 'az') lista.sort(porNome)
        else if (ordenacao === 'za') lista.sort((a, b) => porNome(b, a))
        else if (ordenacao === 'cres') lista.sort((a, b) => porTotal(a, b) || porNome(a, b))
        else lista.sort((a, b) => porTotal(b, a) || porNome(a, b))
        return lista
    }, [
        cidadeNome,
        uf,
        buscarCidadesParalelas,
        prestadores,
        prestadorEspecialidades,
        especialidades,
        ctxCidade,
        ordenacao,
    ])

    const gruposPorColuna = useMemo(() => {
        const n = Math.max(1, colunasCount)
        const cols = Array.from({ length: n }, () => [])
        grupos.forEach((g, i) => {
            cols[i % n].push(g)
        })
        return cols
    }, [grupos, colunasCount])

    const prestadorPorId = useMemo(
        () => new Map(todosPrestadoresAtivos.map((p) => [Number(p.id), p])),
        [todosPrestadoresAtivos],
    )

    const maxTotal = useMemo(() => Math.max(1, ...grupos.map((g) => g.total)), [grupos])

    const totalCredenciadosUnicos = useMemo(() => {
        const ids = new Set()
        for (const g of grupos) {
            for (const it of g.itens) ids.add(Number(it.id))
        }
        return ids.size
    }, [grupos])

    const toggleExpandir = (espId) => {
        setExpandidas((prev) => ({ ...prev, [espId]: !prev[espId] }))
    }

    const copiarEspecialidade = async (g, event) => {
        event?.stopPropagation?.()
        event?.preventDefault?.()
        const texto = formatarEspecialidadeCidadeParaClipboard({
            uf,
            cidadeNome,
            especialidadeNome: g.nome,
            itens: g.itens,
            prestadorPorId,
            estabelecimentoPorVeterinario: ctxCidade.estabelecimentoPorVeterinario,
        })
        try {
            await navigator.clipboard.writeText(texto)
            setCopiadoEspId(g.especialidadeId)
            window.setTimeout(() => setCopiadoEspId((atual) => (atual === g.especialidadeId ? null : atual)), 2000)
        } catch {
            /* ignore */
        }
    }

    const renderCard = (g) => {
        const expandido = !!expandidas[g.especialidadeId]
        const pct = Math.round((g.total / maxTotal) * 100)
        return (
            <article key={g.especialidadeId} className="cred_esp_cidade_card">
                <div className="cred_esp_cidade_card_head">
                    <button
                        type="button"
                        className="cred_esp_cidade_card_head_toggle"
                        aria-expanded={expandido}
                        onClick={() => toggleExpandir(g.especialidadeId)}
                    >
                        <span
                            className={`cred_esp_cidade_chevron ${expandido ? 'is-open' : ''}`}
                            aria-hidden
                        />
                        <span className="cred_esp_cidade_card_tit">{g.nome}</span>
                    </button>
                    <button
                        type="button"
                        className="cred_esp_cidade_copiar"
                        title={
                            copiadoEspId === g.especialidadeId
                                ? 'Copiado'
                                : 'Copiar lista (UF-cidade-especialidade e nomes com telefone)'
                        }
                        aria-label={`Copiar credenciados de ${g.nome}`}
                        onClick={(e) => void copiarEspecialidade(g, e)}
                    >
                        {copiadoEspId === g.especialidadeId ? (
                            <span className="cred_esp_cidade_copiar_ok" aria-hidden>
                                ✓
                            </span>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path
                                    fill="currentColor"
                                    d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                                />
                            </svg>
                        )}
                    </button>
                    <span className="cred_esp_cidade_card_qtd">{g.total}</span>
                </div>
                <div className="cred_esp_cidade_bar_track" aria-hidden>
                    <div className="cred_esp_cidade_bar_fill" style={{ width: `${pct}%` }} />
                </div>
                {expandido ? (
                    <ul className="cred_esp_cidade_nomes">
                        {g.itens.map((it) => (
                            <li key={`${g.especialidadeId}-${it.id}`}>
                                <Link
                                    to={`/credenciamento/cadastro/${it.id}`}
                                    className="cred_esp_cidade_nome_link"
                                >
                                    {it.nome}
                                </Link>
                                {it.viaParalela ? (
                                    <span className="cred_esp_cidade_tag_paralela">cidade paralela</span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </article>
        )
    }

    return (
        <div className="el-page credenciamento_main cred_esp_cidade_page">
            <PageHeader kicker="Credenciamento" title="Especialidades por cidade" />

            <section className="cred_esp_cidade_filtros_flutuantes quem_realiza_filtros quem_realiza_filtros_center">
                <div className="quem_realiza_row quem_realiza_row_center">
                    <label className="pcad_field">
                        <span>UF</span>
                        <select
                            className="credenciamento_main_input"
                            value={uf}
                            onChange={(e) => {
                                setUf(e.target.value)
                                setCidadeNome('')
                                setExpandidas({})
                            }}
                        >
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
                        <SelectMunicipioBusca
                            value={cidadeNome}
                            options={municipios}
                            disabled={!uf || loadingMun}
                            loading={loadingMun}
                            placeholder={!uf ? 'Selecione a UF' : 'Buscar cidade…'}
                            onChange={(nome) => {
                                setCidadeNome(nome)
                                setExpandidas({})
                            }}
                        />
                    </label>
                    <label className="pcad_field">
                        <span>Ordenar por</span>
                        <select
                            className="credenciamento_main_input"
                            value={ordenacao}
                            onChange={(e) => setOrdenacao(e.target.value)}
                            disabled={!cidadeNome}
                        >
                            <option value="az">A–Z</option>
                            <option value="za">Z–A</option>
                            <option value="cres">Crescente</option>
                            <option value="desc">Decrescente</option>
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

            <div className="cred_esp_cidade_corpo">
            {loading ? (
                <p className="pcad_muted">A carregar credenciados…</p>
            ) : !cidadeNome ? (
                <p className="pcad_muted">Selecione UF e cidade para ver o gráfico.</p>
            ) : grupos.length === 0 ? (
                <p className="pcad_muted">
                    Nenhum credenciado encontrado em {cidadeNome}/{uf}
                    {buscarCidadesParalelas ? ' (com cidades paralelas).' : '.'}
                </p>
            ) : (
                <>
                    <p className="cred_esp_cidade_resumo pcad_muted">
                        <strong>{totalCredenciadosUnicos}</strong> credenciado(s) único(s) ·{' '}
                        <strong>{grupos.length}</strong> especialidade(s) com pelo menos um vínculo
                    </p>
                    <div className="cred_esp_cidade_grid" data-cols={colunasCount}>
                        {gruposPorColuna.map((coluna, idx) => (
                            <div key={`col-${idx}`} className="cred_esp_cidade_coluna">
                                {coluna.map((g) => renderCard(g))}
                            </div>
                        ))}
                    </div>
                </>
            )}
            </div>
        </div>
    )
}
