import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { iniciais, corAvatar, nomeExibicao } from '../util.js'
import Icone from './Icone.jsx'
import ListaConversas from './ListaConversas.jsx'
import Chat from './Chat.jsx'
import Configuracoes from './Configuracoes.jsx'
import Admin from './Admin.jsx'
import NovaConversa from './NovaConversa.jsx'
import Menu from './Menu.jsx'

const INTERVALO_LISTA = 10000

function tocarBip() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.connect(g)
        g.connect(ctx.destination)
        osc.frequency.value = 880
        g.gain.setValueAtTime(0.08, ctx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
        osc.start()
        osc.stop(ctx.currentTime + 0.25)
    } catch {
        /* sem áudio */
    }
}

export default function Painel({ sessao, prefs, setPrefs, aoSair, recarregarSessao }) {
    const { usuario, config } = sessao
    const [departamentos, setDepartamentos] = useState(sessao.departamentos)
    const [conversas, setConversas] = useState([])
    const [carregando, setCarregando] = useState(true)
    const [erroLista, setErroLista] = useState('')
    const [selecionada, setSelecionada] = useState(null)
    const [busca, setBusca] = useState('')
    const [filtro, setFiltro] = useState('todas')
    const [filtroDepto, setFiltroDepto] = useState('')
    const [respostas, setRespostas] = useState([])
    const [equipe, setEquipe] = useState([])
    const [modal, setModal] = useState(null)
    const [toast, setToast] = useState(null)
    const naoLidasAntes = useRef(null)

    const avisar = useCallback((texto, tipo = 'info') => {
        setToast({ texto, tipo, id: Date.now() })
    }, [])

    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 4500)
        return () => clearTimeout(t)
    }, [toast])

    const carregarConversas = useCallback(
        async (q = busca) => {
            try {
                const { conversas: lista } = await api(`conversas${q ? `?q=${encodeURIComponent(q)}` : ''}`)
                setConversas(lista)
                setErroLista('')
                // notificação de novas mensagens
                const total = lista.reduce((s, c) => s + c.naoLidas, 0)
                if (naoLidasAntes.current != null && total > naoLidasAntes.current) {
                    if (prefs.som) tocarBip()
                    if (prefs.notificacoes && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                        const c = lista.find((x) => x.naoLidas > 0)
                        new Notification(c ? nomeExibicao(c) : 'Nova mensagem', { body: c?.ultimaMsg || '', icon: '/favicon.svg' })
                    }
                }
                naoLidasAntes.current = total
                document.title = total ? `(${total}) zap.emerlab` : 'zap.emerlab'
            } catch (e) {
                setErroLista(e.message)
            } finally {
                setCarregando(false)
            }
        },
        [busca, prefs.som, prefs.notificacoes],
    )

    const carregarApoio = useCallback(async () => {
        const [r, eq, me] = await Promise.allSettled([api('respostas'), api('equipe'), api('auth/me')])
        if (r.status === 'fulfilled') setRespostas(r.value.respostas)
        if (eq.status === 'fulfilled') setEquipe(eq.value.equipe)
        if (me.status === 'fulfilled') setDepartamentos(me.value.departamentos)
    }, [])

    useEffect(() => {
        carregarApoio()
    }, [carregarApoio])

    // busca com pequeno atraso; polling só com a aba visível
    useEffect(() => {
        const t = setTimeout(() => carregarConversas(busca), busca ? 400 : 0)
        const id = setInterval(() => {
            if (!document.hidden) carregarConversas(busca)
        }, INTERVALO_LISTA)
        return () => {
            clearTimeout(t)
            clearInterval(id)
        }
    }, [busca, carregarConversas])

    const deptoPorId = useMemo(() => Object.fromEntries(departamentos.map((d) => [d.id, d])), [departamentos])

    // departamentos que o usuário enxerga (admin: todos)
    const meusDeptos = useMemo(
        () => (usuario.papel === 'admin' ? departamentos : departamentos.filter((d) => usuario.departamentos.includes(d.id))),
        [departamentos, usuario],
    )

    const filtradas = useMemo(() => {
        return conversas.filter((c) => {
            if (filtroDepto === 'sem' && c.departamentoId) return false
            if (filtroDepto && filtroDepto !== 'sem' && c.departamentoId !== filtroDepto) return false
            if (filtro === 'nao-lidas') return c.naoLidas > 0
            if (filtro === 'minhas') return c.atendenteEmail === usuario.email
            if (filtro === 'fila') return !c.atendenteEmail && c.status !== 'resolvida'
            if (filtro === 'resolvidas') return c.status === 'resolvida'
            return true
        })
    }, [conversas, filtro, filtroDepto, usuario.email])

    const conversaAtual = useMemo(() => {
        if (!selecionada) return null
        return conversas.find((c) => c.waId === selecionada.waId) || selecionada
    }, [conversas, selecionada])

    const abrir = (c) => {
        setSelecionada(c)
        if (c.naoLidas) {
            setConversas((lista) => lista.map((x) => (x.waId === c.waId ? { ...x, naoLidas: 0 } : x)))
            api(`conversas/${c.waId}/lida`, { method: 'POST' }).catch(() => {})
        }
    }

    const atualizarConversa = (waId, campos) => {
        setConversas((lista) => lista.map((x) => (x.waId === waId ? { ...x, ...campos } : x)))
        setSelecionada((s) => (s?.waId === waId ? { ...s, ...campos } : s))
    }

    const escuro = prefs.modo === 'escuro' || (prefs.modo === 'sistema' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

    const itensMenu = [
        { rotulo: 'Nova conversa', acao: () => setModal('nova') },
        { rotulo: 'Configurações', acao: () => setModal('config') },
        ...(usuario.papel === 'admin' ? [{ rotulo: 'Administração', acao: () => setModal('admin') }] : []),
        { rotulo: 'Sair', acao: aoSair },
    ]

    return (
        <div className={`app ${conversaAtual ? 'com-chat' : ''}`}>
            <aside className="lateral">
                <header className="barra barra-lateral">
                    <button className="avatar-botao" onClick={() => setModal('config')} title={`${usuario.nome} — configurações`}>
                        <span className="avatar" style={{ background: corAvatar(usuario.email) }}>
                            {iniciais(usuario.nome)}
                        </span>
                    </button>
                    <div className="barra-titulo">
                        <strong>{usuario.nome}</strong>
                        <small>{usuario.papel === 'admin' ? 'Administrador' : meusDeptos.map((d) => d.nome).join(', ') || 'Atendente'}</small>
                    </div>
                    <div className="barra-acoes">
                        <button className="icone-botao" title={escuro ? 'Modo claro' : 'Modo escuro'} onClick={() => setPrefs({ modo: escuro ? 'claro' : 'escuro' })}>
                            <Icone nome={escuro ? 'sol' : 'lua'} tamanho={20} />
                        </button>
                        <button className="icone-botao" title="Nova conversa" onClick={() => setModal('nova')}>
                            <Icone nome="novo" />
                        </button>
                        <Menu itens={itensMenu}>
                            <Icone nome="menu" />
                        </Menu>
                    </div>
                </header>

                <div className="busca">
                    <div className="busca-caixa">
                        <Icone nome="busca" tamanho={18} />
                        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome ou número" aria-label="Pesquisar conversas" />
                        {busca ? (
                            <button className="icone-botao mini" onClick={() => setBusca('')} aria-label="Limpar busca">
                                <Icone nome="fechar" tamanho={16} />
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="filtros" role="tablist">
                    {[
                        ['todas', 'Tudo'],
                        ['nao-lidas', 'Não lidas'],
                        ['minhas', 'Minhas'],
                        ['fila', 'Na fila'],
                        ['resolvidas', 'Resolvidas'],
                    ].map(([k, r]) => (
                        <button key={k} role="tab" aria-selected={filtro === k} className={`chip ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>
                            {r}
                        </button>
                    ))}
                    {meusDeptos.length > 0 ? (
                        <select className="chip chip-select" value={filtroDepto} onChange={(e) => setFiltroDepto(e.target.value)} aria-label="Filtrar por departamento">
                            <option value="">Todos departamentos</option>
                            {meusDeptos.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.nome}
                                </option>
                            ))}
                            <option value="sem">Sem departamento</option>
                        </select>
                    ) : null}
                </div>

                <ListaConversas
                    conversas={filtradas}
                    carregando={carregando}
                    erro={erroLista}
                    selecionada={conversaAtual?.waId}
                    deptoPorId={deptoPorId}
                    usuarioEmail={usuario.email}
                    equipe={equipe}
                    aoAbrir={abrir}
                />
            </aside>

            <main className="principal">
                {conversaAtual ? (
                    <Chat
                        key={conversaAtual.waId}
                        conversa={conversaAtual}
                        usuario={usuario}
                        config={config}
                        prefs={prefs}
                        departamentos={departamentos}
                        deptoPorId={deptoPorId}
                        respostas={respostas}
                        equipe={equipe}
                        aoVoltar={() => setSelecionada(null)}
                        aoAtualizar={atualizarConversa}
                        aoRecarregarLista={() => carregarConversas(busca)}
                        avisar={avisar}
                    />
                ) : (
                    <div className="vazio">
                        <img src="/favicon.svg" alt="" width="96" height="96" />
                        <h2>zap.emerlab</h2>
                        <p>Selecione uma conversa para começar o atendimento.</p>
                        <small>Mensagens enviadas pela API oficial do WhatsApp (WATI).</small>
                    </div>
                )}
            </main>

            {modal === 'config' ? (
                <Configuracoes usuario={usuario} prefs={prefs} setPrefs={setPrefs} aoFechar={() => setModal(null)} avisar={avisar} />
            ) : null}
            {modal === 'admin' ? (
                <Admin
                    departamentos={departamentos}
                    aoFechar={() => {
                        setModal(null)
                        carregarApoio()
                        recarregarSessao()
                    }}
                    aoMudar={carregarApoio}
                    avisar={avisar}
                />
            ) : null}
            {modal === 'nova' ? (
                <NovaConversa
                    aoFechar={() => setModal(null)}
                    aoAbrir={(waId) => {
                        setModal(null)
                        const existente = conversas.find((c) => c.waId === waId)
                        abrir(existente || { waId, nome: null, naoLidas: 0, status: 'aberta', departamentoId: null, atendenteEmail: null })
                    }}
                />
            ) : null}

            {toast ? (
                <div key={toast.id} className={`toast toast-${toast.tipo}`} role="status">
                    {toast.texto}
                </div>
            ) : null}
        </div>
    )
}
