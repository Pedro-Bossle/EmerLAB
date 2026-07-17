import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    ACCESS_PROFILE_CHANGE_EVENT,
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    normalizarProfileAcesso,
    setStoredAccessProfile,
    usuarioSomenteLeituraGlobal,
} from '../../lib/accessControl.js'
import { bloquearSeSomenteLeitura } from '../../lib/readOnlyGuard.js'
import { getReadOnlyFlag, setReadOnlyFlag, supabase } from '../../lib/supabase.js'
import {
    agruparPendenciasPorPrestador,
    atualizarPagamentoRegistro,
    formatarDataAtualizadoEm,
    listarPagamentosPendentesNota,
} from '../../lib/pagamentosRegistros.js'
import { rotuloMesAnoCurto, rotuloTipoRepasse } from '../../lib/pagamentosPrestador.js'
import { formatarValorMonetarioBr } from '../../lib/pagamentosValor.js'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import './PagamentosResumo.css'

function rotuloQtdMeses(n) {
    const q = Number(n) || 0
    if (q === 1) return '1 Mês'
    return `${q} Meses`
}

function patchPagoDeRegistro(registro) {
    return {
        mes: registro.mes,
        ano: registro.ano,
        prestadorId: registro.prestadorId,
        prestadorNome: registro.prestadorNome,
        tipoRepasse: registro.tipoRepasse,
        chavePix: registro.chavePix,
        valor: registro.valor,
        resposta: true,
        pago: true,
        obs: registro.obs || '',
    }
}

export default function PagamentosResumo() {
    const [perfilAcesso, setPerfilAcesso] = useState(() => getStoredAccessProfile())
    const [somenteLeitura, setSomenteLeitura] = useState(() => getReadOnlyFlag())
    const podeEditar =
        hasPermission(perfilAcesso, PERMISSION_KEYS.PAGAMENTOS_EDIT) && !somenteLeitura

    useEffect(() => {
        const syncPerfil = async () => {
            const { data: userData } = await supabase.auth.getUser()
            const userId = userData?.user?.id
            if (!userId) return
            const { data: profileData } = await supabase
                .from('profiles')
                .select('id, name, email, permissions')
                .eq('id', userId)
                .maybeSingle()
            if (!profileData) return
            const normalizado = normalizarProfileAcesso(profileData)
            setStoredAccessProfile(normalizado)
            setReadOnlyFlag(usuarioSomenteLeituraGlobal(normalizado))
            setPerfilAcesso(normalizado)
            setSomenteLeitura(getReadOnlyFlag())
        }
        const onPerfil = () => {
            setPerfilAcesso(getStoredAccessProfile())
            setSomenteLeitura(getReadOnlyFlag())
        }
        void syncPerfil()
        window.addEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)
        return () => window.removeEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)
    }, [])

    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [grupos, setGrupos] = useState([])
    const [busca, setBusca] = useState('')
    const [expandidos, setExpandidos] = useState(() => new Set())
    const [marcandoIds, setMarcandoIds] = useState(() => new Set())

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const rows = await listarPagamentosPendentesNota()
            const agrupados = agruparPendenciasPorPrestador(rows)
            setGrupos(agrupados)
            setExpandidos(new Set(agrupados.map((g) => g.chave)))
        } catch (e) {
            setErro(e?.message || 'Falha ao carregar pendências.')
            setGrupos([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const filtrados = useMemo(() => {
        const termo = normalizarTextoBusca(busca)
        if (!termo) return grupos
        return grupos.filter((g) => {
            const blob = normalizarTextoBusca(
                [g.prestadorNome, g.tipoRepasse, g.chavePix].filter(Boolean).join(' '),
            )
            return blob.includes(termo)
        })
    }, [grupos, busca])

    const totalGeral = useMemo(
        () => filtrados.reduce((s, g) => s + (Number(g.total) || 0), 0),
        [filtrados],
    )

    const qtdCompetencias = useMemo(
        () => filtrados.reduce((s, g) => s + g.qtdMeses, 0),
        [filtrados],
    )

    const alternarGrupo = (chave) => {
        setExpandidos((prev) => {
            const next = new Set(prev)
            if (next.has(chave)) next.delete(chave)
            else next.add(chave)
            return next
        })
    }

    const expandirTodos = () => setExpandidos(new Set(filtrados.map((g) => g.chave)))
    const recolherTodos = () => setExpandidos(new Set())

    const removerMesesPagos = useCallback((idsPagos) => {
        const setIds = new Set(idsPagos.map(String))
        setGrupos((prev) =>
            prev
                .map((g) => {
                    const meses = g.meses.filter((m) => !setIds.has(String(m.id)))
                    if (!meses.length) return null
                    const total = meses.reduce((s, m) => s + (Number(m.valor) || 0), 0)
                    return { ...g, meses, qtdMeses: meses.length, total }
                })
                .filter(Boolean),
        )
    }, [])

    const marcarMesesComoPagos = useCallback(
        async (meses) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
            const lista = (meses || []).filter((m) => m?.id && m?.registro)
            if (!lista.length) return

            const ids = lista.map((m) => String(m.id))
            setMarcandoIds((prev) => {
                const next = new Set(prev)
                ids.forEach((id) => next.add(id))
                return next
            })
            setErro('')
            try {
                await Promise.all(
                    lista.map((m) => atualizarPagamentoRegistro(m.id, patchPagoDeRegistro(m.registro))),
                )
                removerMesesPagos(ids)
            } catch (e) {
                setErro(e?.message || 'Falha ao marcar como pago.')
            } finally {
                setMarcandoIds((prev) => {
                    const next = new Set(prev)
                    ids.forEach((id) => next.delete(id))
                    return next
                })
            }
        },
        [podeEditar, removerMesesPagos],
    )

    const aoMarcarMes = (mesItem, event) => {
        event.stopPropagation()
        if (!podeEditar || marcandoIds.has(String(mesItem.id))) return
        void marcarMesesComoPagos([mesItem])
    }

    const aoMarcarCard = (grupo, event) => {
        event.stopPropagation()
        if (!podeEditar) return
        const pendentes = grupo.meses.filter((m) => !marcandoIds.has(String(m.id)))
        if (!pendentes.length) return
        void marcarMesesComoPagos(pendentes)
    }

    const [copiadoChave, setCopiadoChave] = useState('')

    const copiarPix = useCallback(async (chavePix, chaveGrupo, event) => {
        event?.stopPropagation?.()
        event?.preventDefault?.()
        const texto = String(chavePix || '').trim()
        if (!texto || texto === '—') return
        try {
            await navigator.clipboard.writeText(texto)
            setCopiadoChave(chaveGrupo)
            window.setTimeout(() => {
                setCopiadoChave((atual) => (atual === chaveGrupo ? '' : atual))
            }, 1600)
        } catch (e) {
            setErro(e?.message || 'Não foi possível copiar o PIX.')
        }
    }, [])

    return (
        <div className="pag_res">
            <h1 className="pag_res_page_title">Resumo — a pagar</h1>
            <hr className="pag_res_hr" />

            <header className="pag_res_header_sticky">
                <h2 className="pag_res_filtros_titulo">Filtros</h2>
                <div className="pag_res_filtros_flutuantes">
                    <div className="pag_res_filtros_inner">
                        <label className="pag_res_filtro pag_res_filtro--grow">
                            <span>Prestador</span>
                            <input
                                type="search"
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder="Filtrar por nome, tipo ou PIX…"
                            />
                        </label>
                        <div className="pag_res_filtros_acoes">
                            <button
                                type="button"
                                className="pag_res_btn pag_res_btn--sec"
                                onClick={expandirTodos}
                            >
                                Expandir
                            </button>
                            <button
                                type="button"
                                className="pag_res_btn pag_res_btn--sec"
                                onClick={recolherTodos}
                            >
                                Recolher
                            </button>
                            <button
                                type="button"
                                className="pag_res_btn"
                                onClick={() => void carregar()}
                                disabled={loading}
                            >
                                Atualizar
                            </button>
                            <Link className="pag_res_btn pag_res_btn--sec" to="/pagamentos/registro">
                                Ir ao Registro
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            <p className="pag_res_sub">
                Prestadores com nota/resposta enviada e ainda não pagos.
                {podeEditar
                    ? ' Marque o card inteiro ou cada mês para registrar o pagamento.'
                    : ''}
            </p>

            {erro ? <p className="pag_res_erro">{erro}</p> : null}

            <div className="pag_res_stats">
                <span>
                    {filtrados.length} prestador{filtrados.length === 1 ? '' : 'es'}
                </span>
                <span>
                    {qtdCompetencias} competência{qtdCompetencias === 1 ? '' : 's'}
                </span>
                <span className="pag_res_stats_total">
                    {formatarValorMonetarioBr(totalGeral) || 'R$ 0,00'}
                </span>
            </div>

            {loading ? (
                <p className="pag_res_loading">Carregando…</p>
            ) : filtrados.length === 0 ? (
                <p className="pag_res_empty">Nenhuma pendência com resposta e sem pagamento.</p>
            ) : (
                <div className="pag_res_lista_wrap">
                    <div
                        className={`pag_res_col_head${podeEditar ? ' pag_res_col_head--edit' : ''}`}
                        aria-hidden
                    >
                        <span className="pag_res_col_chev" />
                        {podeEditar ? <span className="pag_res_col_chk">Pago</span> : null}
                        <span className="pag_res_col_nome">Prestador</span>
                        <span className="pag_res_col_badge">Meses</span>
                        <span className="pag_res_col_tipo">Tipo</span>
                        <span className="pag_res_col_pix">PIX</span>
                        <span className="pag_res_col_total">Total</span>
                    </div>
                    <ul className="pag_res_lista">
                        {filtrados.map((g) => {
                            const aberto = expandidos.has(g.chave)
                            const salvandoCard = g.meses.some((m) => marcandoIds.has(String(m.id)))
                            return (
                                <li
                                    key={g.chave}
                                    className={`pag_res_card${salvandoCard ? ' is-saving' : ''}`}
                                >
                                    <div
                                        className={`pag_res_card_head${podeEditar ? ' pag_res_card_head--edit' : ''}`}
                                    >
                                        <button
                                            type="button"
                                            className="pag_res_chev_btn"
                                            onClick={() => alternarGrupo(g.chave)}
                                            aria-expanded={aberto}
                                            aria-label={aberto ? 'Recolher' : 'Expandir'}
                                        >
                                            <span className="pag_res_chev" aria-hidden>
                                                {aberto ? '▾' : '▸'}
                                            </span>
                                        </button>
                                        {podeEditar ? (
                                            <label
                                                className={`pag_res_chk_label${salvandoCard ? ' is-disabled' : ''}`}
                                                title="Marcar todos os meses como pagos"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={false}
                                                    disabled={salvandoCard}
                                                    onChange={(e) => aoMarcarCard(g, e)}
                                                />
                                                <span className="pag_res_sr_only">Pagar card</span>
                                            </label>
                                        ) : null}
                                        <div
                                            className="pag_res_card_main"
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={aberto}
                                            onClick={() => alternarGrupo(g.chave)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    alternarGrupo(g.chave)
                                                }
                                            }}
                                        >
                                            <span className="pag_res_nome" title={g.prestadorNome}>
                                                {g.prestadorNome}
                                            </span>
                                            <span className="pag_res_meses_badge">
                                                {rotuloQtdMeses(g.qtdMeses)}
                                            </span>
                                            <span className="pag_res_tipo">
                                                {rotuloTipoRepasse(g.tipoRepasse)}
                                            </span>
                                            <span
                                                className="pag_res_pix_cell"
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => e.stopPropagation()}
                                            >
                                                <span className="pag_res_pix" title={g.chavePix || ''}>
                                                    {g.chavePix || '—'}
                                                </span>
                                                {g.chavePix ? (
                                                    <button
                                                        type="button"
                                                        className="pag_res_pix_copy"
                                                        title={
                                                            copiadoChave === g.chave
                                                                ? 'Copiado'
                                                                : 'Copiar PIX'
                                                        }
                                                        aria-label={`Copiar PIX de ${g.prestadorNome}`}
                                                        disabled={copiadoChave === g.chave}
                                                        onClick={(e) => void copiarPix(g.chavePix, g.chave, e)}
                                                    >
                                                        {copiadoChave === g.chave ? (
                                                            <span className="pag_res_pix_copy_ok" aria-hidden>
                                                                ✓
                                                            </span>
                                                        ) : (
                                                            <svg
                                                                width="18"
                                                                height="18"
                                                                viewBox="0 0 24 24"
                                                                aria-hidden="true"
                                                                focusable="false"
                                                            >
                                                                <path
                                                                    fill="currentColor"
                                                                    d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                                                                />
                                                            </svg>
                                                        )}
                                                    </button>
                                                ) : null}
                                            </span>
                                            <span className="pag_res_total">
                                                {formatarValorMonetarioBr(g.total) || 'R$ 0,00'}
                                            </span>
                                        </div>
                                    </div>
                                    {aberto ? (
                                        <ul
                                            className={`pag_res_meses${podeEditar ? ' pag_res_meses--edit' : ''}`}
                                        >
                                            {g.meses.map((m) => {
                                                const salvando = marcandoIds.has(String(m.id))
                                                return (
                                                    <li
                                                        key={m.id}
                                                        className={`pag_res_mes_linha${salvando ? ' is-saving' : ''}`}
                                                    >
                                                        <span className="pag_res_mes_spacer" aria-hidden />
                                                        {podeEditar ? (
                                                            <label
                                                                className={`pag_res_chk_label${salvando ? ' is-disabled' : ''}`}
                                                                title={`Marcar ${rotuloMesAnoCurto(m.mes, m.ano)} como pago`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={false}
                                                                    disabled={salvando}
                                                                    onChange={(e) => aoMarcarMes(m, e)}
                                                                />
                                                                <span className="pag_res_sr_only">Pagar mês</span>
                                                            </label>
                                                        ) : null}
                                                        <span className="pag_res_mes_rotulo">
                                                            {rotuloMesAnoCurto(m.mes, m.ano)}
                                                        </span>
                                                        <span
                                                            className="pag_res_mes_enviado"
                                                            title={m.atualizadoEm || ''}
                                                        >
                                                            Resposta em {formatarDataAtualizadoEm(m.atualizadoEm)}
                                                        </span>
                                                        <span className="pag_res_mes_filler" aria-hidden />
                                                        <span className="pag_res_mes_valor">
                                                            {m.valor != null
                                                                ? formatarValorMonetarioBr(m.valor)
                                                                : '—'}
                                                        </span>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    ) : null}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}
        </div>
    )
}
