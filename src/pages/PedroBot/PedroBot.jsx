import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStoredAccessProfile } from '../../lib/accessControl'
import { usePedroBot } from '../../hooks/usePedroBot.js'
import './PedroBot.css'

const TOPICOS = [
    {
        id: 'cred',
        titulo: 'Credenciamento',
        desc: 'Funil do Kanban até o cadastro e o contrato.',
        prompt: 'Como funciona o processo de credenciamento, da prospecção até o prestador ficar Credenciado?',
    },
    {
        id: 'tabelas',
        titulo: 'Tabelas de valores',
        desc: 'SuperTabela, planos, negociações e honorários.',
        prompt: 'Para que serve a SuperTabela e como se relaciona com honorários e planos?',
    },
    {
        id: 'contratos',
        titulo: 'Contratos',
        desc: 'Gerar PDF e assinar no Clicksign.',
        prompt: 'Qual a ordem correcta para gerar contrato e enviar para assinatura no Clicksign?',
    },
    {
        id: 'pagamentos',
        titulo: 'Pagamentos',
        desc: 'Registo mensal e resumo de pendências.',
        prompt: 'Como usar Pagamentos — Registro e Resumo depois do prestador credenciado?',
    },
    {
        id: 'home',
        titulo: 'Início e Home',
        desc: 'Favoritos, tarefas, Outlook e alertas.',
        prompt: 'O que aparece na página Início (/home) e como usar favoritos, tarefas e alertas?',
    },
    {
        id: 'prospeccao',
        titulo: 'Prospecção e IA',
        desc: 'Prospectar cidade e o chip de uso Gemini.',
        prompt: 'Como prospectar uma cidade e o que significa o chip Gemini RPM / hoje?',
    },
]

function primeiroNome(profile) {
    const n = String(profile?.name || '').trim()
    if (!n) return ''
    return n.split(/\s+/)[0]
}

const PedroBot = () => {
    const profile = useStoredAccessProfile()
    const {
        mensagens,
        enviando,
        erro,
        setErro,
        meta,
        carregarMeta,
        enviar,
        novaConversa,
        listarConhecimento,
        salvarConhecimento,
        apagarConhecimento,
    } = usePedroBot()

    const [vista, setVista] = useState('inicio')
    const [rascunho, setRascunho] = useState('')
    const [blocos, setBlocos] = useState([])
    const [avisoTabela, setAvisoTabela] = useState('')
    const [editando, setEditando] = useState(null)
    const [form, setForm] = useState({ titulo: '', categoria: 'geral', corpo: '', activo: true })
    const [gravando, setGravando] = useState(false)
    const fimChatRef = useRef(null)

    const nome = primeiroNome(profile)
    const podeEditar = Boolean(meta?.podeEditar)

    useEffect(() => {
        void carregarMeta()
    }, [carregarMeta])

    useEffect(() => {
        fimChatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [mensagens, enviando, vista])

    const abrirChat = useCallback(
        (promptInicial) => {
            setVista('chat')
            setErro('')
            if (promptInicial) void enviar(promptInicial)
        },
        [enviar, setErro],
    )

    const submeterComposer = (e) => {
        e.preventDefault()
        const t = rascunho.trim()
        if (!t || enviando) return
        setRascunho('')
        void enviar(t)
    }

    const carregarBlocos = useCallback(async () => {
        try {
            const json = await listarConhecimento()
            setBlocos(json.blocos || [])
            setAvisoTabela(json.aviso || '')
        } catch (e) {
            setAvisoTabela(e?.message || 'Não foi possível listar a base.')
        }
    }, [listarConhecimento])

    const abrirConhecimento = () => {
        setVista('conhecimento')
        void carregarBlocos()
    }

    const gravarBloco = async (e) => {
        e.preventDefault()
        setGravando(true)
        setErro('')
        try {
            await salvarConhecimento({
                id: editando || undefined,
                ...form,
            })
            setEditando(null)
            setForm({ titulo: '', categoria: 'geral', corpo: '', activo: true })
            await carregarBlocos()
        } catch (err) {
            setErro(err?.message || 'Falha ao gravar.')
        } finally {
            setGravando(false)
        }
    }

    const removerBloco = async (id) => {
        if (!window.confirm('Apagar este bloco da base de conhecimento?')) return
        setErro('')
        try {
            await apagarConhecimento(id)
            await carregarBlocos()
        } catch (err) {
            setErro(err?.message || 'Falha ao apagar.')
        }
    }

    const kicker = useMemo(() => (nome ? `Olá, ${nome}` : 'Olá'), [nome])

    return (
        <div className="pedro_bot_page">
            {vista === 'inicio' ? (
                <div className="pedro_bot_inicio">
                    <header className="pedro_bot_topo">
                        <p className="pedro_bot_kicker">{kicker}</p>
                        <h1>Pedro Bot</h1>
                    </header>

                    <section className="pedro_bot_hero" aria-label="Apresentação">
                        <div className="pedro_bot_mascote" aria-hidden="true">
                            <span className="pedro_bot_mascote_olho" />
                            <span className="pedro_bot_mascote_olho" />
                        </div>
                        <div className="pedro_bot_hero_txt">
                            <h2>Sou o Pedro Bot</h2>
                            <p>Dúvidas de como usar o EmerLAB e qual a ordem correcta dos processos — pensado para quem está a chegar.</p>
                            <button type="button" className="pedro_bot_cta" onClick={() => abrirChat()}>
                                Começar conversa
                            </button>
                        </div>
                    </section>

                    <section className="pedro_bot_explorar" aria-label="Explorar tópicos">
                        <div className="pedro_bot_explorar_head">
                            <h3>Explorar</h3>
                            <button type="button" className="pedro_bot_link" onClick={abrirConhecimento}>
                                Base de conhecimento
                            </button>
                        </div>
                        <ul className="pedro_bot_grid">
                            {TOPICOS.map((t) => (
                                <li key={t.id}>
                                    <button type="button" className="pedro_bot_card" onClick={() => abrirChat(t.prompt)}>
                                        <strong>{t.titulo}</strong>
                                        <span>{t.desc}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                    {meta?.configurado === false ? (
                        <p className="pedro_bot_aviso">{meta.erro || 'A IA ainda não está configurada no servidor.'}</p>
                    ) : null}
                </div>
            ) : null}

            {vista === 'chat' ? (
                <div className="pedro_bot_chat">
                    <header className="pedro_bot_chat_bar">
                        <button type="button" className="pedro_bot_voltar" onClick={() => setVista('inicio')}>
                            Voltar
                        </button>
                        <h1>Pedro Bot</h1>
                        <button type="button" className="pedro_bot_link" onClick={novaConversa}>
                            Nova
                        </button>
                    </header>
                    <div className="pedro_bot_msgs" role="log" aria-live="polite">
                        {mensagens.length === 0 && !enviando ? (
                            <p className="pedro_bot_vazio">Pergunte como usar uma tela ou qual o próximo passo do funil.</p>
                        ) : null}
                        {mensagens.map((m, i) => (
                            <div
                                key={`${m.role}-${i}`}
                                className={`pedro_bot_bolha ${m.role === 'user' ? 'is-user' : 'is-bot'}`}
                            >
                                {m.content}
                            </div>
                        ))}
                        {enviando ? <div className="pedro_bot_bolha is-bot is-typing">A escrever…</div> : null}
                        <div ref={fimChatRef} />
                    </div>
                    {erro ? <p className="pedro_bot_aviso">{erro}</p> : null}
                    <form className="pedro_bot_composer" onSubmit={submeterComposer}>
                        <label className="sr-only" htmlFor="pedro-bot-input">
                            Mensagem
                        </label>
                        <textarea
                            id="pedro-bot-input"
                            rows={1}
                            value={rascunho}
                            onChange={(e) => setRascunho(e.target.value)}
                            placeholder="Escreva a sua dúvida…"
                            disabled={enviando}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    submeterComposer(e)
                                }
                            }}
                        />
                        <button type="submit" disabled={enviando || !rascunho.trim()}>
                            Enviar
                        </button>
                    </form>
                </div>
            ) : null}

            {vista === 'conhecimento' ? (
                <div className="pedro_bot_kb">
                    <header className="pedro_bot_chat_bar">
                        <button type="button" className="pedro_bot_voltar" onClick={() => setVista('inicio')}>
                            Voltar
                        </button>
                        <h1>Base de conhecimento</h1>
                        <span />
                    </header>
                    <p className="pedro_bot_kb_hint">
                        Notas extra que o Pedro Bot lê em cada pergunta. Editor aberto a quem usa esta página; mais tarde
                        fica só para administração.
                    </p>
                    {avisoTabela ? <p className="pedro_bot_aviso">{avisoTabela}</p> : null}
                    {erro ? <p className="pedro_bot_aviso">{erro}</p> : null}

                    {podeEditar ? (
                        <form className="pedro_bot_kb_form" onSubmit={gravarBloco}>
                            <label>
                                Título
                                <input
                                    value={form.titulo}
                                    onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                                    required
                                />
                            </label>
                            <label>
                                Categoria
                                <input
                                    value={form.categoria}
                                    onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                                />
                            </label>
                            <label className="pedro_bot_kb_corpo">
                                Corpo
                                <textarea
                                    rows={6}
                                    value={form.corpo}
                                    onChange={(e) => setForm((f) => ({ ...f, corpo: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="pedro_bot_kb_check">
                                <input
                                    type="checkbox"
                                    checked={form.activo}
                                    onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                                />
                                Activo (entra no prompt)
                            </label>
                            <div className="pedro_bot_kb_acoes">
                                <button type="submit" disabled={gravando}>
                                    {editando ? 'Actualizar bloco' : 'Adicionar bloco'}
                                </button>
                                {editando ? (
                                    <button
                                        type="button"
                                        className="pedro_bot_link"
                                        onClick={() => {
                                            setEditando(null)
                                            setForm({ titulo: '', categoria: 'geral', corpo: '', activo: true })
                                        }}
                                    >
                                        Cancelar edição
                                    </button>
                                ) : null}
                            </div>
                        </form>
                    ) : (
                        <p className="pedro_bot_muted">Sem permissão para editar a base.</p>
                    )}

                    <ul className="pedro_bot_kb_lista">
                        {blocos.map((b) => (
                            <li key={b.id} className={!b.activo ? 'is-off' : ''}>
                                <div>
                                    <strong>{b.titulo}</strong>
                                    <span className="pedro_bot_muted"> {b.categoria}</span>
                                    <p>{b.corpo}</p>
                                </div>
                                {podeEditar ? (
                                    <div className="pedro_bot_kb_item_acoes">
                                        <button
                                            type="button"
                                            className="pedro_bot_link"
                                            onClick={() => {
                                                setEditando(b.id)
                                                setForm({
                                                    titulo: b.titulo || '',
                                                    categoria: b.categoria || 'geral',
                                                    corpo: b.corpo || '',
                                                    activo: b.activo !== false,
                                                })
                                            }}
                                        >
                                            Editar
                                        </button>
                                        <button type="button" className="pedro_bot_link" onClick={() => void removerBloco(b.id)}>
                                            Apagar
                                        </button>
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}

export default PedroBot
