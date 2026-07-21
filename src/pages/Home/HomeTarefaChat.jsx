import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
    enviarMensagemTarefa,
    listarMensagensTarefa,
    marcarMensagensTarefaComoLidas,
} from '../../lib/homeTarefas'

function formatarHoraMensagem(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function mapRowRealtime(row, autorNome) {
    if (!row?.id) return null
    return {
        id: row.id,
        tarefaId: row.tarefa_id,
        autorId: row.autor_id,
        corpo: String(row.corpo || '').trim(),
        criadoEm: row.criado_em,
        lidaEm: row.lida_em || null,
        autorNome: autorNome || 'Usuário',
    }
}

/**
 * Bate-papo entre criador e pessoa designada da tarefa.
 * Carrega 1x ao abrir; novas mensagens entram via Realtime (sem polling / sem reload).
 */
export default function HomeTarefaChat({
    tarefaId,
    userId,
    ativo = true,
    onMensagensLidas,
    onErro,
}) {
    const [mensagens, setMensagens] = useState([])
    const [texto, setTexto] = useState('')
    const [carregando, setCarregando] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const fimRef = useRef(null)
    const nomesCacheRef = useRef(new Map())
    const onMensagensLidasRef = useRef(onMensagensLidas)
    const onErroRef = useRef(onErro)
    const userIdRef = useRef(userId)

    useEffect(() => {
        onMensagensLidasRef.current = onMensagensLidas
    }, [onMensagensLidas])

    useEffect(() => {
        onErroRef.current = onErro
    }, [onErro])

    useEffect(() => {
        userIdRef.current = userId
    }, [userId])

    useEffect(() => {
        if (!ativo || !tarefaId) {
            setMensagens([])
            setCarregando(false)
            return undefined
        }

        let cancelado = false
        setCarregando(true)

        const carregar = async () => {
            try {
                const lista = await listarMensagensTarefa(tarefaId)
                if (cancelado) return
                for (const m of lista) {
                    if (m.autorId) nomesCacheRef.current.set(m.autorId, m.autorNome)
                }
                setMensagens(lista)
                await marcarMensagensTarefaComoLidas(tarefaId)
                if (!cancelado) onMensagensLidasRef.current?.(tarefaId)
            } catch (e) {
                if (!cancelado) onErroRef.current?.(e?.message || String(e))
            } finally {
                if (!cancelado) setCarregando(false)
            }
        }

        void carregar()

        const resolverNomeAutor = async (autorId) => {
            const id = String(autorId || '')
            if (!id) return 'Usuário'
            if (id === userIdRef.current) return 'Você'
            if (nomesCacheRef.current.has(id)) return nomesCacheRef.current.get(id)
            const { data } = await supabase.from('profiles').select('name').eq('id', id).maybeSingle()
            const nome = data?.name || 'Usuário'
            nomesCacheRef.current.set(id, nome)
            return nome
        }

        const channel = supabase
            .channel(`home-tarefa-chat:${tarefaId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'home_tarefas_mensagens',
                    filter: `tarefa_id=eq.${tarefaId}`,
                },
                (payload) => {
                    void (async () => {
                        const row = payload?.new
                        if (!row?.id || cancelado) return
                        const autorNome = await resolverNomeAutor(row.autor_id)
                        const mapped = mapRowRealtime(row, autorNome)
                        if (!mapped || cancelado) return
                        setMensagens((prev) => {
                            if (prev.some((m) => String(m.id) === String(mapped.id))) return prev
                            return [...prev, mapped]
                        })
                        if (row.autor_id && row.autor_id !== userIdRef.current) {
                            try {
                                await marcarMensagensTarefaComoLidas(tarefaId)
                                if (!cancelado) onMensagensLidasRef.current?.(tarefaId)
                            } catch {
                                /* ignore */
                            }
                        }
                    })()
                },
            )
            .subscribe()

        return () => {
            cancelado = true
            void supabase.removeChannel(channel)
        }
    }, [ativo, tarefaId])

    useEffect(() => {
        if (carregando) return
        fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [mensagens.length, carregando])

    const onEnviar = async (e) => {
        e.preventDefault()
        const corpo = texto.trim()
        if (!corpo || enviando) return
        setEnviando(true)
        try {
            const nova = await enviarMensagemTarefa(tarefaId, corpo)
            setTexto('')
            setMensagens((prev) => {
                if (prev.some((m) => String(m.id) === String(nova.id))) return prev
                return [...prev, nova]
            })
        } catch (err) {
            onErroRef.current?.(err?.message || String(err))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div
            className="home_dash_tarefa_chat"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <div className="home_dash_tarefa_chat_head">
                <strong>Bate-papo</strong>
                {carregando ? <span className="home_dash_tarefa_chat_status">Carregando…</span> : null}
            </div>
            <div className="home_dash_tarefa_chat_lista">
                {mensagens.length === 0 && !carregando ? (
                    <p className="home_dash_tarefa_chat_vazio">
                        Nenhuma mensagem ainda. Escreva para a pessoa designada.
                    </p>
                ) : (
                    mensagens.map((m) => {
                        const minha = m.autorId === userId
                        return (
                            <div
                                key={m.id}
                                className={`home_dash_tarefa_chat_msg${minha ? ' is-mine' : ''}`}
                            >
                                <div className="home_dash_tarefa_chat_msg_meta">
                                    <span>{minha ? 'Você' : m.autorNome}</span>
                                    <time dateTime={m.criadoEm || undefined}>
                                        {formatarHoraMensagem(m.criadoEm)}
                                    </time>
                                </div>
                                <p>{m.corpo}</p>
                            </div>
                        )
                    })
                )}
                <div ref={fimRef} />
            </div>
            <form className="home_dash_tarefa_chat_form" onSubmit={(e) => void onEnviar(e)}>
                <input
                    className="home_dash_input"
                    placeholder="Escrever resposta…"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    disabled={enviando || carregando}
                    maxLength={2000}
                />
                <button
                    type="submit"
                    className="home_dash_btn"
                    disabled={enviando || carregando || !texto.trim()}
                >
                    {enviando ? '…' : 'Enviar'}
                </button>
            </form>
        </div>
    )
}
