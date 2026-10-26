import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, registrarAoConexao } from '../api.js'
import { iniciais, corAvatar, nomeExibicao, CANAIS, ler, gravar } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'
import ListaConversas from './ListaConversas.jsx'
import Chat from './Chat.jsx'
import Configuracoes from './Configuracoes.jsx'
import Admin from './Admin.jsx'
import NovaConversa from './NovaConversa.jsx'
import Menu from './Menu.jsx'

const INTERVALO_LISTA = 10000

const FILTROS = [
    ['todas', 'Tudo'],
    ['nao-lidas', 'Não lidas'],
    ['minhas', 'Minhas'],
    ['fila', 'Na fila'],
    ['resolvidas', 'Resolvidas'],
]

// Texto da lista vazia conforme o filtro, para o atendente entender o porquê
const VAZIO = {
    todas: 'Nenhuma conversa neste canal ainda.',
    'nao-lidas': 'Tudo lido por aqui. 🎉',
    minhas: 'Nenhuma conversa atribuída a você. Use "Assumir" numa conversa da fila.',
    fila: 'A fila está vazia: todas as conversas têm atendente.',
    resolvidas: 'Nenhuma conversa resolvida ainda.',
}

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
    const canais = useMemo(() => {
        const tipos = new Set((sessao.canais || []).map((c) => c.tipo))
        return ['whatsapp', 'instagram', 'messenger'].map((tipo) => ({ tipo, conectado: tipo === 'whatsapp' || tipos.has(tipo) }))
    }, [sessao.canais])
    const [canal, setCanal] = useState(() => {
        const salvo = ler('zap.canal', 'whatsapp')
        return CANAIS[salvo] ? salvo : 'whatsapp'
    })
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
    const [online, setOnline] = useState(() => navigator.onLine)
    const naoLidasAntes = useRef(null)

    const avisar = useCallback((texto, tipo = 'info') => {
        setToast({ texto, tipo, id: Date.now() })
    }, [])

    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), toast.tipo === 'erro' ? 7000 : 4500)
        return () => clearTimeout(t)
    }, [toast])

    useEffect(() => {
        registrarAoConexao(setOnline)
        const on = () => setOnline(true)
        const off = () => setOnline(false)
        window.addEventListener('online', on)
        window.addEventListener('offline', off)
        return () => {
            window.removeEventListener('online', on)
            window.removeEventListener('offline', off)
        }
    }, [])

    const carregarConversas = useCallback(
        async (q = busca) => {
            try {
                const params = new URLSearchParams({ canal })
                if (q) params.set('q', q)
                const { conversas: lista } = await api(`conversas?${params}`)
                setConversas(lista)
                setErroLista('')
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
        [busca, canal, prefs.som, prefs.notificacoes],
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

    const trocarCanal = (novo) => {
        if (novo === canal) return
        setCanal(novo)
        gravar('zap.canal', novo)
        setSelecionada(null)
        setConversas([])
        setCarregando(true)
        naoLidasAntes.current = null
    }

    const deptoPorId = useMemo(() => Object.fromEntries(departamentos.map((d) => [d.id, d])), [departamentos])

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
            api(`conversas/${encodeURIComponent(c.waId)}/lida`, { method: 'POST' }).catch(() => {})
        }
    }

    const atualizarConversa = (waId, campos) => {
        setConversas((lista) => lista.map((x) => (x.waId === waId ? { ...x, ...campos } : x)))
        setSelecionada((s) => (s?.waId === waId ? { ...s, ...campos } : s))
    }

    const escuro = prefs.modo === 'escuro' || (prefs.modo === 'sistema' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    const infoCanal = CANAIS[canal]

    const itensMenu = [
        canal === 'whatsapp' && { rotulo: 'Nova conversa', acao: () => setModal('nova') },
        { rotulo: 'Configurações', acao: () => setModal('config') },
        usuario.papel === 'admin' && { rotulo: 'Administração', acao: () => setModal('admin') },
        { rotulo: escuro ? 'Usar modo claro' : 'Usar modo escuro', acao: () => setPrefs({ modo: escuro ? 'claro' : 'escuro' }) },
        { rotulo: 'Sair', acao: aoSair, perigo: true },
    ]

    const listaVazia = busca ? `Nada encontrado para "${busca}".` : VAZIO[filtro]

    return (
        <div className={`app ${conversaAtual ? 'com-chat' : ''}`}>
            <nav className="trilho" aria-label="Canais">
                <div className="trilho-canais">
                    {canais.map(({ tipo, conectado }) => (
                        <button
                            key={tipo}
                            className={`trilho-botao ${canal === tipo ? 'ativo' : ''}`}
                            style={{ '--canal': CANAIS[tipo].cor }}
                            aria-pressed={canal === tipo}
                            aria-label={CANAIS[tipo].rotulo}
                            data-dica={conectado ? CANAIS[tipo].rotulo : `${CANAIS[tipo].rotulo}: não conectado na WATI`}
                            data-dica-lado="direita"
                            disabled={!conectado}
                            onClick={() => trocarCanal(tipo)}
                        >
                            <IconeCanal canal={tipo} tamanho={24} />
                            <span className="trilho-rotulo">{CANAIS[tipo].rotulo}</span>
                        </button>
                    ))}
                </div>
                <div className="trilho-rodape">
                    <button className="trilho-botao" aria-label={escuro ? 'Modo claro' : 'Modo escuro'} data-dica={escuro ? 'Modo claro' : 'Modo escuro'} data-dica-lado="direita" onClick={() => setPrefs({ modo: escuro ? 'claro' : 'escuro' })}>
                        <Icone nome={escuro ? 'sol' : 'lua'} />
                    </button>
                    {usuario.papel === 'admin' ? (
                        <button className="trilho-botao" aria-label="Administração" data-dica="Administração" data-dica-lado="direita" onClick={() => setModal('admin')}>
                            <Icone nome="escudo" />
                        </button>
                    ) : null}
                    <button className="trilho-botao" aria-label="Configurações" data-dica="Configurações" data-dica-lado="direita" onClick={() => setModal('config')}>
                        <Icone nome="engrenagem" />
                    </button>
                    <button className="trilho-avatar" aria-label={`${usuario.nome}: conta`} data-dica={usuario.nome} data-dica-lado="direita" onClick={() => setModal('config')}>
                        <span className="avatar" style={{ background: corAvatar(usuario.email) }}>
                            {iniciais(usuario.nome)}
                        </span>
                    </button>
                </div>
            </nav>

            <aside className="lateral">
                <header className="barra barra-lateral">
                    <div className="barra-titulo">
                        <strong className="titulo-canal">
                            <IconeCanal canal={canal} tamanho={18} cor={infoCanal.cor} /> {infoCanal.rotulo}
                        </strong>
                        <small>
                            {usuario.nome} · {usuario.papel === 'admin' ? 'Administrador' : meusDeptos.map((d) => d.nome).join(', ') || 'Atendente'}
                        </small>
                    </div>
                    <div className="barra-acoes">
                        {canal === 'whatsapp' ? (
                            <button className="icone-botao" aria-label="Nova conversa" data-dica="Nova conversa" onClick={() => setModal('nova')}>
                                <Icone nome="novo" />
                            </button>
                        ) : null}
                        <Menu itens={itensMenu} titulo="Mais opções">
                            <Icone nome="menu" />
                        </Menu>
                    </div>
                </header>

                {!online ? (
                    <div className="faixa-offline" role="status">
                        <Icone nome="offline" tamanho={18} /> Sem conexão. As listas voltam a atualizar sozinhas quando a internet voltar.
                    </div>
                ) : null}

                <div className="busca">
                    <div className="busca-caixa">
                        <Icone nome="busca" tamanho={18} />
                        <input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder={canal === 'whatsapp' ? 'Pesquisar nome ou número' : 'Pesquisar nome'}
                            aria-label="Pesquisar conversas"
                        />
                        {busca ? (
                            <button className="icone-botao mini" onClick={() => setBusca('')} aria-label="Limpar busca">
                                <Icone nome="fechar" tamanho={16} />
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="filtros" role="tablist" aria-label="Filtros">
                    {FILTROS.map(([k, r]) => {
                        const qtd = k === 'nao-lidas' ? conversas.filter((c) => c.naoLidas > 0).length : 0
                        return (
                            <button key={k} role="tab" aria-selected={filtro === k} className={`chip ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>
                                {r}
                                {qtd ? <span className="chip-qtd">{qtd}</span> : null}
                            </button>
                        )
                    })}
                    {meusDeptos.length > 0 ? (
                        <label className="chip chip-select">
                            <Icone nome="filtro" tamanho={14} />
                            <select value={filtroDepto} onChange={(e) => setFiltroDepto(e.target.value)} aria-label="Filtrar por departamento">
                                <option value="">Departamentos</option>
                                {meusDeptos.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {d.nome}
                                    </option>
                                ))}
                                <option value="sem">Sem departamento</option>
                            </select>
                        </label>
                    ) : null}
                </div>

                <ListaConversas
                    conversas={filtradas}
                    carregando={carregando}
                    erro={erroLista}
                    textoVazio={listaVazia}
                    selecionada={conversaAtual?.waId}
                    deptoPorId={deptoPorId}
                    usuarioEmail={usuario.email}
                    equipe={equipe}
                    aoAbrir={abrir}
                    aoTentar={() => carregarConversas(busca)}
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
                        <span className="vazio-logo" style={{ '--canal': infoCanal.cor }}>
                            <IconeCanal canal={canal} tamanho={56} />
                        </span>
                        <h2>zap.emerlab · {infoCanal.rotulo}</h2>
                        <p>Selecione uma conversa à esquerda para começar o atendimento.</p>
                        <ul className="vazio-dicas">
                            <li>
                                <kbd>/</kbd> no campo de mensagem abre as respostas rápidas
                            </li>
                            <li>
                                <strong>Assumir</strong> tira a conversa da fila e coloca no seu nome
                            </li>
                            <li>Troque de canal pelos ícones {window.innerWidth > 760 ? 'à esquerda' : 'abaixo'}</li>
                        </ul>
                    </div>
                )}
            </main>

            {modal === 'config' ? <Configuracoes usuario={usuario} prefs={prefs} setPrefs={setPrefs} aoFechar={() => setModal(null)} avisar={avisar} /> : null}
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
                <div key={toast.id} className={`toast toast-${toast.tipo}`} role={toast.tipo === 'erro' ? 'alert' : 'status'}>
                    <Icone nome={toast.tipo === 'erro' ? 'erro' : toast.tipo === 'aviso' ? 'info' : 'check'} tamanho={18} />
                    <span>{toast.texto}</span>
                    <button className="toast-fechar" aria-label="Fechar aviso" onClick={() => setToast(null)}>
                        <Icone nome="fechar" tamanho={16} />
                    </button>
                </div>
            ) : null}
        </div>
    )
}
