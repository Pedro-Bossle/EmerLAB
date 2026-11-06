import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PERMISSION_KEYS, useStoredPermission } from '../../lib/accessControl'
import { supabase } from '../../lib/supabase'
import { publicarContagens } from '../../lib/notifContagens'
import { FORMULARIO_ENTRADAS_CHANGE_EVENT } from '../../lib/formularioCredenciamento'
import { EVENTO_MUDANCA_NOTIF_PAGAMENTOS } from '../../lib/repasse/notificacoesPagamentos'
import {
    TIPOS_NOTIFICACAO,
    agruparNotificacoes,
    carregarNotificacoesCentral,
    dispensarNotificacao,
    limparGrupoNotificacoes,
    limparTudoNotificacoes,
    rotuloAcessivelSino,
    rotuloTempoRelativo,
} from '../../lib/notificacoesCentral'
import './CentralNotificacoes.css'

/** Fallback se o Realtime do Supabase estiver indisponível. */
const INTERVALO_FALLBACK_MS = 120_000
const DURACAO_TOAST_MS = 7000
const VISIVEIS_POR_GRUPO = 3
const TITULO_ABA_BASE = 'EmerLAB'

/** Ícones (traço, 24x24). Desenhados em JSX: nada de HTML injetado. */
const ICONES = {
    sino: (
        <>
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>
    ),
    sinoOff: (
        <>
            <path d="M8.7 3A6 6 0 0 1 18 8c0 2.3.4 4.1.9 5.4M6.3 6.3C6.1 6.8 6 7.4 6 8c0 7-3 9-3 9h14" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" />
        </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    checkcircle: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </>
    ),
    xcircle: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="m9 9 6 6M15 9l-6 6" />
        </>
    ),
    clock: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </>
    ),
    userplus: (
        <>
            <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
            <circle cx="8.5" cy="7.5" r="3.5" />
            <path d="M19 8v6M16 11h6" />
        </>
    ),
    filetext: (
        <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h6" />
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
        </>
    ),
    chevron: <path d="m6 9 6 6 6-6" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
}

function Icone({ nome, tamanho = 18, traco = 2, className }) {
    return (
        <svg
            className={className}
            width={tamanho}
            height={tamanho}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={traco}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {ICONES[nome] || ICONES.info}
        </svg>
    )
}

function CartaoAviso({ item, comoToast, nomeGrupo, onAbrir, onDispensar }) {
    const tipo = TIPOS_NOTIFICACAO[item.tipo] || TIPOS_NOTIFICACAO.generico
    return (
        <>
            <button type="button" className="nc_imain" onClick={() => onAbrir(item)}>
                <span className={`nc_ico nc_tom_${tipo.tom}`}>
                    <Icone nome={tipo.icone} tamanho={16} traco={2.4} />
                </span>
                <span className="nc_itext">
                    {comoToast ? <span className="nc_tapp">{nomeGrupo}</span> : null}
                    <span className="nc_itexto">{item.texto}</span>
                    <span className="nc_itime">{rotuloTempoRelativo(item.at)}</span>
                </span>
            </button>
            <button
                type="button"
                className="nc_ix"
                aria-label={comoToast ? 'Dispensar aviso' : 'Remover notificação'}
                onClick={() => onDispensar(item)}
            >
                <Icone nome="x" tamanho={15} traco={2.4} />
            </button>
        </>
    )
}

/**
 * Central de Notificações (estilo Central de Ações do Windows 10): sino fixo + painel lateral com os avisos
 * agrupados por origem, «X» para remover e aviso no canto quando chega algo novo.
 *
 * Props
 * - compact: celular/tablet. O sino fixo some; quem abre é a barra inferior (via `open`/`onOpenChange`).
 * - open / onOpenChange: abertura controlada pelo Layout2.
 * - onBadgeChange: total de avisos (para a barra inferior).
 */
export default function CentralNotificacoes({ compact = false, open: openControlled, onOpenChange, onBadgeChange }) {
    const navigate = useNavigate()
    const podeContratos = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_CONTRATOS)
    const podeFormulario = useStoredPermission(PERMISSION_KEYS.NOTIFICACOES_FORMULARIO)
    // Pagamentos: quem vê a área recebe o que os prestadores responderam ao e-mail de repasse
    const podePagamentos = useStoredPermission(PERMISSION_KEYS.PAGAMENTOS_VIEW)
    const temPermissao = podeContratos || podeFormulario || podePagamentos
    const pode = useMemo(
        () => ({ contratos: podeContratos, formulario: podeFormulario, pagamentos: podePagamentos }),
        [podeContratos, podeFormulario, podePagamentos],
    )

    const controlado = typeof openControlled === 'boolean'
    const [abertoInterno, setAbertoInterno] = useState(false)
    const aberto = controlado ? openControlled : abertoInterno
    const setAberto = useCallback(
        (v) => {
            if (!controlado) setAbertoInterno(v)
            onOpenChange?.(v)
        },
        [controlado, onOpenChange],
    )

    const [itens, setItens] = useState([])
    const [carregou, setCarregou] = useState(false)
    const [recolhidos, setRecolhidos] = useState({})
    const [expandidos, setExpandidos] = useState({})
    const [realcado, setRealcado] = useState(null)
    const [toasts, setToasts] = useState([])
    const [limpando, setLimpando] = useState(false)

    const sinoRef = useRef(null)
    const fecharRef = useRef(null)
    const abertoRef = useRef(aberto)
    const vistosRef = useRef(new Set())
    const primeiraCargaRef = useRef(true)
    const timersToastRef = useRef(new Map())
    const debounceRef = useRef(null)
    const ativoRef = useRef(true)

    useEffect(() => {
        abertoRef.current = aberto
    }, [aberto])

    useEffect(() => {
        ativoRef.current = true
        const timers = timersToastRef.current
        return () => {
            ativoRef.current = false
            timers.forEach((t) => clearTimeout(t))
            timers.clear()
            if (debounceRef.current) clearTimeout(debounceRef.current)
        }
    }, [])

    const dispensarToast = useCallback((id) => {
        const t = timersToastRef.current.get(id)
        if (t) clearTimeout(t)
        timersToastRef.current.delete(id)
        setToasts((atual) => atual.filter((x) => x.id !== id))
    }, [])

    const mostrarToast = useCallback(
        (item) => {
            setToasts((atual) => [...atual.filter((x) => x.id !== item.id), { id: item.id, item }].slice(-3))
            const anterior = timersToastRef.current.get(item.id)
            if (anterior) clearTimeout(anterior)
            timersToastRef.current.set(
                item.id,
                setTimeout(() => dispensarToast(item.id), DURACAO_TOAST_MS),
            )
        },
        [dispensarToast],
    )

    const recarregar = useCallback(async () => {
        if (!temPermissao) return
        let lista = []
        try {
            lista = await carregarNotificacoesCentral(pode)
        } catch {
            return
        }
        if (!ativoRef.current) return
        setItens(lista)
        setCarregou(true)

        // Avisos novos: a primeira carga só «semeia» (sem toast); depois, o que chegar vira aviso no canto.
        const novos = lista.filter((i) => !vistosRef.current.has(i.id))
        lista.forEach((i) => vistosRef.current.add(i.id))
        if (primeiraCargaRef.current) {
            primeiraCargaRef.current = false
            return
        }
        if (!novos.length) return
        if (abertoRef.current) {
            setRealcado(novos[0].id)
        } else {
            novos.slice(0, 3).forEach(mostrarToast)
        }
    }, [temPermissao, pode, mostrarToast])

    const recarregarSemPressa = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => void recarregar(), 400)
    }, [recarregar])

    // carga inicial, ao abrir, plano B por intervalo e ao voltar para a aba
    useEffect(() => {
        if (!temPermissao) return undefined
        void recarregar()
        const t = setInterval(() => void recarregar(), INTERVALO_FALLBACK_MS)
        const onVis = () => {
            if (document.visibilityState === 'visible') void recarregar()
        }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            clearInterval(t)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [temPermissao, recarregar])

    useEffect(() => {
        if (aberto && temPermissao) void recarregar()
    }, [aberto, temPermissao, recarregar])

    // tempo real: Contratos (webhook), Formulário (entradas) e Pagamentos (respostas dos prestadores)
    useEffect(() => {
        if (!temPermissao) return undefined
        const canais = []
        const assinar = (nome, tabela, evento = '*') => {
            canais.push(
                supabase
                    .channel(nome)
                    .on('postgres_changes', { event: evento, schema: 'public', table: tabela }, recarregarSemPressa)
                    .subscribe(),
            )
        }
        if (podeContratos) assinar('central-notif-contratos', 'clicksign_notificacoes_webhook')
        if (podeFormulario) assinar('central-notif-formulario', 'formulario_cred_entradas')
        if (podePagamentos) assinar('central-notif-pagamentos', 'repasse_eventos', 'INSERT')

        window.addEventListener(FORMULARIO_ENTRADAS_CHANGE_EVENT, recarregarSemPressa)
        window.addEventListener(EVENTO_MUDANCA_NOTIF_PAGAMENTOS, recarregarSemPressa)
        window.addEventListener('emerdog-clicksign-notif-change', recarregarSemPressa)
        return () => {
            canais.forEach((c) => void supabase.removeChannel(c))
            window.removeEventListener(FORMULARIO_ENTRADAS_CHANGE_EVENT, recarregarSemPressa)
            window.removeEventListener(EVENTO_MUDANCA_NOTIF_PAGAMENTOS, recarregarSemPressa)
            window.removeEventListener('emerdog-clicksign-notif-change', recarregarSemPressa)
        }
    }, [temPermissao, podeContratos, podeFormulario, podePagamentos, recarregarSemPressa])

    // contagens: sidebar (bolinhas), barra inferior e título da aba
    const contagem = useMemo(() => {
        const c = { contratos: 0, formulario: 0, pagamentos: 0 }
        itens.forEach((i) => {
            c[i.fonte] += 1
        })
        return c
    }, [itens])
    const total = itens.length

    useEffect(() => {
        publicarContagens({ form: contagem.formulario, contratos: contagem.contratos, pagamentos: contagem.pagamentos })
    }, [contagem])

    useEffect(() => {
        onBadgeChange?.(total)
    }, [total, onBadgeChange])

    useEffect(() => {
        if (!temPermissao) return undefined
        const n = total > 0 ? (total > 99 ? '99+' : String(total)) : ''
        document.title = n ? `(${n}) ${TITULO_ABA_BASE}` : TITULO_ABA_BASE
        return () => {
            document.title = TITULO_ABA_BASE
        }
    }, [temPermissao, total])

    // o sino fixo ocupa o canto: reserva espaço no cabeçalho das páginas (ver CSS)
    useEffect(() => {
        if (!temPermissao || compact) return undefined
        document.body.classList.add('nc-sino-fixo')
        return () => document.body.classList.remove('nc-sino-fixo')
    }, [temPermissao, compact])

    // Esc fecha; ao abrir leva o foco para «Fechar», ao fechar devolve ao sino
    useEffect(() => {
        if (!aberto) return undefined
        fecharRef.current?.focus({ preventScroll: true })
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setAberto(false)
                sinoRef.current?.focus({ preventScroll: true })
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [aberto, setAberto])

    useEffect(() => {
        if (!aberto) setRealcado(null)
    }, [aberto])

    // «há 5 min» envelhece sem precisar de nova carga
    const [, forcarRender] = useState(0)
    useEffect(() => {
        if (!aberto && toasts.length === 0) return undefined
        const t = setInterval(() => forcarRender((n) => n + 1), 30_000)
        return () => clearInterval(t)
    }, [aberto, toasts.length])

    const remover = useCallback(
        (item) => {
            setItens((atual) => atual.filter((i) => i.id !== item.id))
            dispensarToast(item.id)
            void dispensarNotificacao(item).catch(() => {})
        },
        [dispensarToast],
    )

    const abrirItem = useCallback(
        (item) => {
            remover(item)
            setAberto(false)
            navigate(item.href)
        },
        [navigate, remover, setAberto],
    )

    const limparGrupo = useCallback(async (fonte) => {
        setItens((atual) => atual.filter((i) => i.fonte !== fonte))
        await limparGrupoNotificacoes(fonte).catch(() => {})
    }, [])

    const limparTudo = useCallback(async () => {
        setLimpando(true)
        setItens([])
        try {
            await limparTudoNotificacoes(pode)
        } finally {
            setLimpando(false)
        }
    }, [pode])

    if (!temPermissao) return null

    const grupos = agruparNotificacoes(itens)
    const nomeGrupo = (id) => grupos.find((g) => g.id === id)?.nome || ''
    const badge = total > 99 ? '99+' : String(total)

    return (
        <div className="nc_root">
            {!compact ? (
                <button
                    ref={sinoRef}
                    type="button"
                    className={`nc_bell${aberto ? ' is-open' : ''}`}
                    aria-label={rotuloAcessivelSino(total)}
                    aria-expanded={aberto}
                    aria-controls="nc-painel"
                    title="Notificações"
                    onClick={() => setAberto(!aberto)}
                >
                    <Icone nome="sino" tamanho={18} />
                    {total > 0 ? (
                        <span className="nc_badge" aria-hidden="true">
                            {badge}
                        </span>
                    ) : null}
                </button>
            ) : null}

            <div className={`nc_scrim${aberto ? ' is-on' : ''}`} onClick={() => setAberto(false)} aria-hidden="true" />

            <aside
                id="nc-painel"
                className={`nc_panel${aberto ? ' is-open' : ''}`}
                role="dialog"
                aria-label="Notificações"
                aria-hidden={!aberto}
            >
                <div className="nc_grip" aria-hidden="true" />
                <header className="nc_head">
                    <h2 className="nc_title">Notificações</h2>
                    <button type="button" className="nc_link" disabled={!total || limpando} onClick={() => void limparTudo()}>
                        Limpar tudo
                    </button>
                    <button
                        ref={fecharRef}
                        type="button"
                        className="nc_iconbtn"
                        aria-label="Fechar notificações"
                        onClick={() => setAberto(false)}
                    >
                        <Icone nome="x" tamanho={18} traco={2.2} />
                    </button>
                </header>

                <div className="nc_body">
                    {grupos.length === 0 ? (
                        <div className="nc_vazio">
                            <span className="nc_vazio_ico">
                                <Icone nome="sinoOff" tamanho={26} traco={1.9} />
                            </span>
                            <strong>{carregou ? 'Tudo em dia' : 'Carregando…'}</strong>
                            {carregou ? <span>Quando alguém assinar, recusar ou enviar algo, o aviso aparece aqui.</span> : null}
                        </div>
                    ) : (
                        grupos.map((g) => {
                            const fechado = Boolean(recolhidos[g.id])
                            const aberto3 = Boolean(expandidos[g.id])
                            const visiveis = aberto3 ? g.itens : g.itens.slice(0, VISIVEIS_POR_GRUPO)
                            const extra = g.itens.length - VISIVEIS_POR_GRUPO
                            return (
                                <section key={g.id} className={`nc_group${fechado ? ' is-fechado' : ''}`}>
                                    <div className="nc_ghead">
                                        <button
                                            type="button"
                                            className="nc_gname"
                                            aria-expanded={!fechado}
                                            onClick={() => setRecolhidos((r) => ({ ...r, [g.id]: !r[g.id] }))}
                                        >
                                            <Icone nome="chevron" tamanho={16} traco={2.4} className="nc_chev" />
                                            {g.nome}
                                            <span className="nc_count">{g.itens.length}</span>
                                        </button>
                                        <button type="button" className="nc_link nc_link_sm" onClick={() => void limparGrupo(g.id)}>
                                            Limpar
                                        </button>
                                    </div>
                                    {!fechado ? (
                                        <>
                                            <ul className="nc_items">
                                                {visiveis.map((it) => (
                                                    <li key={it.id} className={`nc_item${it.id === realcado ? ' is-novo' : ''}`}>
                                                        <CartaoAviso item={it} onAbrir={abrirItem} onDispensar={remover} />
                                                    </li>
                                                ))}
                                            </ul>
                                            {extra > 0 ? (
                                                <div className="nc_more">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandidos((e) => ({ ...e, [g.id]: !e[g.id] }))}
                                                    >
                                                        {aberto3 ? 'Mostrar menos' : `Mostrar mais (${extra})`}
                                                    </button>
                                                </div>
                                            ) : null}
                                        </>
                                    ) : null}
                                </section>
                            )
                        })
                    )}
                </div>
            </aside>

            <div className="nc_toasts" role="status" aria-live="polite">
                {toasts.map(({ id, item }) => (
                    <div key={id} className="nc_toast">
                        <CartaoAviso
                            item={item}
                            comoToast
                            nomeGrupo={nomeGrupo(item.fonte) || (item.fonte === 'contratos' ? 'Contratos' : item.fonte === 'formulario' ? 'Formulário' : 'Pagamentos')}
                            onAbrir={abrirItem}
                            onDispensar={(it) => dispensarToast(it.id)}
                        />
                    </div>
                ))}
            </div>
        </div>
    )
}
