import React, { useEffect, useRef, useState } from 'react'
import { carregarResumoCredenciamento } from '../../lib/homeCredenciamentoResumo.js'

const SERIES = [
    { id: 'credenciados', nome: 'Credenciados', cor: 'var(--home-ok)' },
    { id: 'cancelados', nome: 'Cancelados', cor: 'var(--home-danger)' },
    { id: 'emProcesso', nome: 'Em processo (total no dia)', cor: 'var(--home-accent)', eixo: 'dir' },
]

const PERIODOS = [7, 14, 30]

/** Teto do eixo vertical: 4, 8, 12… para os rótulos ficarem redondos. */
export function tetoDoEixo(valores) {
    const max = Math.max(0, ...valores)
    return Math.max(4, Math.ceil(max / 4) * 4)
}

const L = 28
const R = 30
const T = 18
const B = 22

/** Posição horizontal (0..1) do ponto `i` do gráfico. */
export const posicaoRelativa = (i, n, largura) => (L + ((largura - L - R) * i) / Math.max(1, n - 1)) / largura

/** Índice do ponto mais próximo de uma posição horizontal (0..1 da largura do desenho). */
export function indiceMaisProximo(fracao, n, largura) {
    const util = largura - L - R
    const px = fracao * largura - L
    return Math.min(n - 1, Math.max(0, Math.round((px / util) * (n - 1))))
}

export function GraficoLinhas({ resumo, largura = 480, altura = 250, ativas = null, indice = null, onIndice = null }) {
    const visiveis = SERIES.filter((s) => !ativas || ativas.has(s.id))
    const doEixo = (eixo) => visiveis.filter((s) => (s.eixo || 'esq') === eixo).flatMap((s) => resumo.series[s.id])
    // dois eixos: por dia (credenciados e cancelados, à esquerda) e total em processo (à direita)
    const tetoEsq = tetoDoEixo(doEixo('esq'))
    const tetoDir = tetoDoEixo(doEixo('dir'))
    const n = resumo.dias.length
    const x = (i) => L + ((largura - L - R) * i) / Math.max(1, n - 1)
    const yCom = (v, teto) => T + (altura - T - B) - ((altura - T - B) * v) / teto
    const yDe = (s, v) => yCom(v, (s.eixo || 'esq') === 'dir' ? tetoDir : tetoEsq)
    const quartos = [0, 1, 2, 3, 4]
    const passo = Math.max(1, Math.round((n - 1) / 3))
    const marcas = [...new Set([0, passo, passo * 2, n - 1])].filter((i) => i < n)
    const temDir = visiveis.some((s) => s.eixo === 'dir')
    const temEsq = visiveis.some((s) => (s.eixo || 'esq') === 'esq')

    const aoMover = (e) => {
        if (!onIndice) return
        const r = e.currentTarget.getBoundingClientRect()
        if (!r.width) return
        onIndice(indiceMaisProximo((e.clientX - r.left) / r.width, n, largura))
    }
    const aoTeclar = (e) => {
        if (!onIndice) return
        if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onIndice(Math.max(0, (indice ?? n) - 1))
        } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            onIndice(Math.min(n - 1, (indice ?? -1) + 1))
        } else if (e.key === 'Escape') {
            onIndice(null)
        }
    }

    return (
        <svg
            className="home_dash_cred_svg"
            viewBox={`0 0 ${largura} ${altura}`}
            role="img"
            aria-label={`Credenciados, cancelados e total em processo por dia nos últimos ${n} dias`}
            tabIndex={onIndice ? 0 : undefined}
            onPointerMove={aoMover}
            onPointerDown={aoMover}
            onPointerLeave={() => onIndice?.(null)}
            onKeyDown={aoTeclar}
            onBlur={() => onIndice?.(null)}
        >
            {quartos.map((q) => {
                const yy = yCom(q, 4)
                return (
                    <g key={q}>
                        <line x1={L} x2={largura - R} y1={yy} y2={yy} stroke="var(--home-line)" strokeWidth="1" />
                        {temEsq ? (
                            <text x={L - 6} y={yy + 3.5} textAnchor="end" fontSize="10" fill="var(--home-muted)">
                                {(tetoEsq * q) / 4}
                            </text>
                        ) : null}
                        {temDir ? (
                            <text x={largura - R + 6} y={yy + 3.5} textAnchor="start" fontSize="10" fill="var(--home-accent)">
                                {(tetoDir * q) / 4}
                            </text>
                        ) : null}
                    </g>
                )
            })}
            {temEsq ? (
                <text x={2} y={9} textAnchor="start" fontSize="9" fontWeight="700" fill="var(--home-muted)">
                    por dia
                </text>
            ) : null}
            {temDir ? (
                <text x={largura - 2} y={9} textAnchor="end" fontSize="9" fontWeight="700" fill="var(--home-accent)">
                    em processo (total)
                </text>
            ) : null}
            {marcas.map((i) => (
                <text key={i} x={x(i)} y={altura - 6} textAnchor="middle" fontSize="10" fill="var(--home-muted)">
                    {resumo.dias[i].rotulo}
                </text>
            ))}
            {indice != null ? (
                <line x1={x(indice)} x2={x(indice)} y1={T} y2={altura - B} stroke="var(--home-muted)" strokeWidth="1" strokeDasharray="3 3" />
            ) : null}
            {visiveis.map((s) => {
                const serie = resumo.series[s.id]
                const pts = serie.map((v, i) => `${x(i).toFixed(1)},${yDe(s, v).toFixed(1)}`).join(' ')
                const foco = indice != null ? indice : n - 1
                return (
                    <g key={s.id}>
                        <polyline points={pts} fill="none" stroke={s.cor} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                        <circle cx={x(foco)} cy={yDe(s, serie[foco])} r={indice != null ? 5 : 4} fill={s.cor} stroke="var(--home-card)" strokeWidth="2" />
                    </g>
                )
            })}
        </svg>
    )
}

/** Andamento do credenciamento nos últimos dias. Só é montado para quem tem Credenciamento ou Gerenciamento. */
export default function HomeCredenciamentoGrafico({ dias: diasInicial = 14 }) {
    const [dias, setDias] = useState(diasInicial)
    const [resumo, setResumo] = useState(null)
    const [erro, setErro] = useState(false)
    const [ativas, setAtivas] = useState(() => new Set(SERIES.map((s) => s.id)))
    const [indice, setIndice] = useState(null)

    useEffect(() => {
        let ativo = true
        carregarResumoCredenciamento({ dias })
            .then((r) => {
                if (!ativo) return
                setResumo(r)
                setErro(false)
            })
            .catch(() => ativo && setErro(true))
        return () => {
            ativo = false
        }
    }, [dias])

    // o desenho usa as medidas reais do quadro: ocupa o espaço que sobra e nunca é cortado
    const plotRef = useRef(null)
    const [dim, setDim] = useState({ w: 520, h: 230 })
    const temResumo = resumo !== null
    useEffect(() => {
        const el = plotRef.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver(([e]) => {
            const { width, height } = e.contentRect
            if (width > 0 && height > 0) setDim({ w: Math.round(width), h: Math.max(120, Math.round(height)) })
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [temResumo])

    if (erro && !resumo) return null

    const alternar = (id) =>
        setAtivas((atual) => {
            const novo = new Set(atual)
            if (novo.has(id)) {
                if (novo.size > 1) novo.delete(id) // sempre fica ao menos uma linha
            } else novo.add(id)
            return novo
        })

    const n = resumo?.dias.length || 0
    const dia = resumo && indice != null && indice < n ? resumo.dias[indice] : null

    return (
        <section className="home_dash_card home_dash_card--cred" aria-label="Credenciamento nos últimos dias">
            <div className="home_dash_card_head">
                <h2>Credenciamento</h2>
                <div className="home_dash_cred_periodos" role="group" aria-label="Período">
                    {PERIODOS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            className={p === dias ? 'is-active' : ''}
                            aria-pressed={p === dias}
                            onClick={() => {
                                setDias(p)
                                setIndice(null)
                            }}
                        >
                            {p} dias
                        </button>
                    ))}
                </div>
            </div>
            {!resumo ? (
                <p className="home_dash_muted">Carregando…</p>
            ) : (
                <>
                    <div className="home_dash_cred_stats">
                        <div className="home_dash_cred_stat">
                            <span><i style={{ background: 'var(--home-ok)' }} />Credenciados</span>
                            <strong>{resumo.totais.credenciados}</strong>
                        </div>
                        <div className="home_dash_cred_stat">
                            <span><i style={{ background: 'var(--home-danger)' }} />Cancelados</span>
                            <strong>{resumo.totais.cancelados}</strong>
                        </div>
                        <div className="home_dash_cred_stat is-wide">
                            <span><i style={{ background: 'var(--home-accent)' }} />Em processo agora</span>
                            <strong>{resumo.emProcesso.total}</strong>
                            <div className="home_dash_cred_etapas">
                                {resumo.emProcesso.etapas.map((e) => (
                                    <b key={e.id}>
                                        {e.label} <em>{e.quantidade}</em>
                                    </b>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="home_dash_cred_plot" ref={plotRef}>
                        <GraficoLinhas resumo={resumo} largura={dim.w} altura={dim.h} ativas={ativas} indice={indice} onIndice={setIndice} />
                        {dia ? (
                            <div
                                className="home_dash_cred_tip"
                                style={{
                                    left: `${posicaoRelativa(indice, n, dim.w) * 100}%`,
                                    transform: `translateX(-${posicaoRelativa(indice, n, dim.w) * 100}%)`,
                                }}
                                role="status"
                            >
                                <strong>{dia.rotulo}</strong>
                                {SERIES.filter((s) => ativas.has(s.id)).map((s) => (
                                    <span key={s.id}>
                                        <i style={{ background: s.cor }} />
                                        {s.nome}
                                        <b>{resumo.series[s.id][indice]}</b>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="home_dash_cred_leg">
                        {SERIES.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                className={ativas.has(s.id) ? '' : 'is-off'}
                                aria-pressed={ativas.has(s.id)}
                                onClick={() => alternar(s.id)}
                                title={ativas.has(s.id) ? `Ocultar ${s.nome}` : `Mostrar ${s.nome}`}
                            >
                                <i style={{ background: s.cor }} />
                                {s.nome}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </section>
    )
}
