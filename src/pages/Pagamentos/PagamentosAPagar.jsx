import { useMemo, useState } from 'react'
import { agruparPendenciasPorPrestador, formatarDataAtualizadoEm } from '../../lib/pagamentosRegistros.js'
import { rotuloMesAnoCurto, rotuloTipoRepasse } from '../../lib/pagamentosPrestador.js'
import { ehTipoRpa, formatarValorMonetarioBr, valorLiquidoRpa } from '../../lib/pagamentosValor.js'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import './PagamentosResumo.css'

/** Valor que o prestador recebe: RPA com o desconto de 11%. */
const aReceber = (tipoRepasse, bruto) => (ehTipoRpa(tipoRepasse) ? valorLiquidoRpa(bruto) ?? Number(bruto || 0) : Number(bruto || 0))

const rotuloQtdMeses = (n) => (Number(n) === 1 ? '1 Mês' : `${Number(n) || 0} Meses`)

/**
 * «Aprovados a pagar» (antes a tela Resumo): prestadores com resposta marcada e ainda não pagos,
 * em todas as competências. O pagamento acontece no painel do prestador.
 * `registros` = linhas de pagamentos_registros já mapeadas (resposta && !pago).
 */
export default function PagamentosAPagar({ registros, busca, carregando, podeEditar, onAbrirPainel }) {
    const [copiado, setCopiado] = useState('')
    const [erro, setErro] = useState('')
    const [recolhidos, setRecolhidos] = useState(() => new Set())

    const grupos = useMemo(() => {
        const todos = agruparPendenciasPorPrestador(registros)
        const termo = normalizarTextoBusca(busca)
        const filtrados = termo
            ? todos.filter((g) => normalizarTextoBusca([g.prestadorNome, g.tipoRepasse, g.chavePix].filter(Boolean).join(' ')).includes(termo))
            : todos
        return filtrados.map((g) => ({
            ...g,
            totalLiquido: g.meses.reduce((t, m) => t + aReceber(g.tipoRepasse, m.valor), 0),
        }))
    }, [registros, busca])

    const totalGeral = grupos.reduce((t, g) => t + g.totalLiquido, 0)
    const qtdMeses = grupos.reduce((t, g) => t + g.qtdMeses, 0)

    const alternar = (chave) =>
        setRecolhidos((prev) => {
            const n = new Set(prev)
            if (n.has(chave)) n.delete(chave)
            else n.add(chave)
            return n
        })

    const copiar = async (g, e) => {
        e.stopPropagation()
        try {
            await navigator.clipboard.writeText(String(g.chavePix))
            setCopiado(g.chave)
            window.setTimeout(() => setCopiado((c) => (c === g.chave ? '' : c)), 1600)
        } catch {
            setErro('Não foi possível copiar a chave PIX.')
        }
    }

    if (carregando) return <p className="pag_reg_loading">A carregar…</p>

    return (
        <section className="pag_res pag_res--embutido" aria-label="Aprovados a pagar">
            <div className="pag_res_kpis">
                <div className="pag_res_kpi">
                    <span className="pag_res_kpi_rot">Prestadores</span>
                    <strong className="pag_res_kpi_val">{grupos.length}</strong>
                </div>
                <div className="pag_res_kpi">
                    <span className="pag_res_kpi_rot">Competências</span>
                    <strong className="pag_res_kpi_val">{qtdMeses}</strong>
                </div>
                <div className="pag_res_kpi pag_res_kpi--total">
                    <span className="pag_res_kpi_rot">Total a pagar</span>
                    <strong className="pag_res_kpi_val">{formatarValorMonetarioBr(totalGeral) || 'R$ 0,00'}</strong>
                </div>
                <span className="pag_res_stats_acoes">
                    <button type="button" className="pag_res_link" onClick={() => setRecolhidos(new Set())}>Expandir</button>
                    <button type="button" className="pag_res_link" onClick={() => setRecolhidos(new Set(grupos.map((g) => g.chave)))}>Recolher</button>
                </span>
            </div>
            {erro ? <p className="pag_res_erro">{erro}</p> : null}

            {grupos.length === 0 ? (
                <p className="pag_res_empty">Nenhuma pendência com resposta e sem pagamento.</p>
            ) : (
                <div className="pag_res_lista_wrap overflow-x-auto">
                    <div className="pag_res_col_head" aria-hidden>
                        <span className="pag_res_col_chev" />
                        <span className="pag_res_col_nome">Prestador</span>
                        <span className="pag_res_col_badge">Meses</span>
                        <span className="pag_res_col_tipo">Tipo</span>
                        <span className="pag_res_col_pix">PIX</span>
                        <span className="pag_res_col_total">Total</span>
                        <span />
                    </div>
                    <ul className="pag_res_lista">
                        {grupos.map((g) => {
                            const aberto = !recolhidos.has(g.chave)
                            const rpa = ehTipoRpa(g.tipoRepasse)
                            return (
                                <li key={g.chave} className="pag_res_card">
                                    <div className="pag_res_card_head">
                                        <button type="button" className="pag_res_chev_btn" onClick={() => alternar(g.chave)} aria-expanded={aberto} aria-label={aberto ? 'Recolher' : 'Expandir'}>
                                            <span className="pag_res_chev" aria-hidden>{aberto ? '▾' : '▸'}</span>
                                        </button>
                                        <div
                                            className="pag_res_card_main"
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={aberto}
                                            onClick={() => alternar(g.chave)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    alternar(g.chave)
                                                }
                                            }}
                                        >
                                            <span className="pag_res_nome" title={g.prestadorNome}>{g.prestadorNome}</span>
                                            <span className="pag_res_meses_badge">{rotuloQtdMeses(g.qtdMeses)}</span>
                                            <span className="pag_res_tipo">{rotuloTipoRepasse(g.tipoRepasse)}</span>
                                            <span className="pag_res_pix_cell" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                                <span className="pag_res_pix" title={g.chavePix || ''}>{g.chavePix || '—'}</span>
                                                {g.chavePix ? (
                                                    <button
                                                        type="button"
                                                        className="pag_res_pix_copy"
                                                        title={copiado === g.chave ? 'Copiado' : 'Copiar PIX'}
                                                        aria-label={`Copiar PIX de ${g.prestadorNome}`}
                                                        disabled={copiado === g.chave}
                                                        onClick={(e) => void copiar(g, e)}
                                                    >
                                                        {copiado === g.chave ? (
                                                            <span className="pag_res_pix_copy_ok" aria-hidden>✓</span>
                                                        ) : (
                                                            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                                                <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                ) : null}
                                            </span>
                                            <span className="pag_res_total">
                                                {formatarValorMonetarioBr(g.totalLiquido) || 'R$ 0,00'}
                                                {rpa ? <small className="pag_res_total_orig">original {formatarValorMonetarioBr(g.total)}</small> : null}
                                            </span>
                                        </div>
                                        {g.prestadorId ? (
                                            <button type="button" className="pag_reg_btn pag_reg_btn--pri pag_reg_btn--mini pag_res_acao" onClick={() => onAbrirPainel({ id: g.prestadorId, nome: g.prestadorNome })}>
                                                {podeEditar ? 'Pagar' : 'Ver meses'}
                                            </button>
                                        ) : (
                                            <span className="pag_res_sem" title="Vincule o registro a um prestador cadastrado para pagar por aqui">Sem cadastro</span>
                                        )}
                                    </div>
                                    {aberto ? (
                                        <ul className="pag_res_meses">
                                            {g.meses.map((m) => (
                                                <li key={m.id} className="pag_res_mes_linha">
                                                    <span className="pag_res_mes_rotulo">{rotuloMesAnoCurto(m.mes, m.ano)}</span>
                                                    <span className="pag_res_mes_enviado" title={m.atualizadoEm || ''}>Resposta em {formatarDataAtualizadoEm(m.atualizadoEm)}</span>
                                                    <span className="pag_res_mes_filler" aria-hidden />
                                                    <span className="pag_res_mes_valor">
                                                        {m.valor != null ? formatarValorMonetarioBr(aReceber(g.tipoRepasse, m.valor)) : '—'}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}
        </section>
    )
}
