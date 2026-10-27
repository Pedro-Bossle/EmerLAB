import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usarAtualizacao } from '../atualizacao.js'
import { api, registrarAoConexao } from '../api.js'
import { iniciais, corAvatar, nomeExibicao, CANAIS, ler, gravar, tempoDesde, calcularEspera, janelaDaConversa, normalizarWaId } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'
import ListaConversas from './ListaConversas.jsx'
import Chat from './Chat.jsx'
import Configuracoes from './Configuracoes.jsx'
import Admin from './Admin.jsx'
import NovaConversa from './NovaConversa.jsx'
import Menu from './Menu.jsx'
import FilaEspera from './FilaEspera.jsx'
import Marca from './Marca.jsx'
import Redimensionar from './Redimensionar.jsx'
import Modal from './Modal.jsx'
import MenuContexto from './MenuContexto.jsx'
import Transferir from './Transferir.jsx'
import SeletorDepartamento from './SeletorDepartamento.jsx'
import { useRolagemHorizontal } from '../rolagemHorizontal.js'
import { transferir, itensDeAtendimento } from '../acoesConversa.js'
import { ATALHOS, MOD, comMod, teclaDe, haSobreposicao } from '../atalhos.js'

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
    'nao-lidas': 'Nenhuma conversa com mensagem não lida.',
    minhas: 'Nenhuma conversa aberta atribuída a você. Use "Assumir" numa conversa da fila, ou veja as resolvidas no filtro Resolvidas.',
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
    // sobrevive à troca de conversa (o Chat remonta por waId); fecha só ao voltar à lista
    const [perfilAberto, setPerfilAberto] = useState(false)
    const [busca, setBusca] = useState('')
    // ao entrar, a lista abre sempre nas conversas atribuídas a quem logou
    const [filtro, setFiltro] = useState('minhas')
    const [filtroDepto, setFiltroDepto] = useState('')
    const [respostas, setRespostas] = useState([])
    const [equipe, setEquipe] = useState([])
    const [tagsCatalogo, setTagsCatalogo] = useState([])
    const [modal, setModal] = useState(null)
    const [toast, setToast] = useState(null)
    const [online, setOnline] = useState(() => navigator.onLine)
    // aviso: WATI aberta = operador online para o robô / round-robin
    const [avisoWatiAberta, setAvisoWatiAberta] = useState(() => !ler('zap.avisoWatiAbertaOk', false))
    const naoLidasAntes = useRef(null)
    const campoBusca = useRef(null)
    const raiz = useRef(null)
    // largura da lista arrastada pelo atendente (null = padrão do layout)
    const [larguraLista, setLarguraLista] = useState(() => ler('zap.larguraLista', null))
    const mudarLarguraLista = (px) => {
        setLarguraLista(px)
        gravar('zap.larguraLista', px)
    }
    const teclado = useRef(null)

    // atendente de verdade = sempre; admin/fixo só quando prefs.visao === 'atendente'
    const visaoAtendente =
        usuario.papel !== 'admin' || Boolean((usuario.fixo || usuario.admin) && prefs.visao === 'atendente')

    // setores do usuário; admin sem vínculo usa todos (para ver a fila de cada departamento)
    const meusDeptoIds = useMemo(() => {
        const vinculados = usuario.departamentos || []
        if (vinculados.length) return new Set(vinculados)
        if (usuario.papel === 'admin' || usuario.fixo) return new Set(departamentos.map((d) => d.id))
        return new Set()
    }, [usuario.departamentos, usuario.papel, usuario.fixo, departamentos])

    // inbox / notificações / Na fila: minhas OU do meu departamento (com ou sem atendente)
    const noEscopoNotificacao = useCallback(
        (c) => {
            if (!visaoAtendente) return true
            if (c.atendenteEmail === usuario.email) return true
            // conversa do departamento → membro do setor vê (fila para Assumir ou chat do colega)
            if (c.departamentoId && meusDeptoIds.has(c.departamentoId)) return true
            if (c.atendenteEmail && meusDeptoIds.size) {
                const colega = equipe.find((u) => u.email === c.atendenteEmail)
                if (colega?.departamentos?.some((id) => meusDeptoIds.has(id))) return true
            }
            return false
        },
        [visaoAtendente, usuario.email, meusDeptoIds, equipe],
    )

    // Na fila do setor: sem atendente, aberta, e departamento do qual faço parte
    const naFilaDoSetor = useCallback(
        (c) => {
            if (c.atendenteEmail || c.status === 'resolvida') return false
            if (!visaoAtendente) return true
            return Boolean(c.departamentoId && meusDeptoIds.has(c.departamentoId))
        },
        [visaoAtendente, meusDeptoIds],
    )

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
                // não deixa o poll apagar a prévia que o chat acabou de espelhar (meta no banco ainda atrasada)
                setConversas((antes) => {
                    if (!antes.length) return lista
                    const local = new Map(antes.map((c) => [normalizarWaId(c.waId), c]))
                    return lista.map((c) => {
                        const velha = local.get(normalizarWaId(c.waId))
                        if (!velha?.ultimaEm || !c.ultimaEm) return c
                        if (new Date(velha.ultimaEm).getTime() <= new Date(c.ultimaEm).getTime() + 2000) return c
                        return {
                            ...c,
                            ultimaMsg: velha.ultimaMsg,
                            ultimaMinha: velha.ultimaMinha,
                            ultimaEm: velha.ultimaEm,
                        }
                    })
                })
                setErroLista('')
                const relevantes = lista.filter(noEscopoNotificacao)
                const total = relevantes.reduce((s, c) => s + c.naoLidas, 0)
                if (naoLidasAntes.current != null && total > naoLidasAntes.current) {
                    if (prefs.som) tocarBip()
                    if (prefs.notificacoes && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                        const c = relevantes.find((x) => x.naoLidas > 0)
                        new Notification(c ? nomeExibicao(c) : 'Nova mensagem', { body: c?.ultimaMsg || '', icon: '/favicon.svg' })
                    }
                }
                naoLidasAntes.current = total
                document.title = total ? `(${total}) Emerzap` : 'Emerzap'
            } catch (e) {
                setErroLista(e.message)
            } finally {
                setCarregando(false)
            }
        },
        [busca, canal, prefs.som, prefs.notificacoes, noEscopoNotificacao],
    )

    // ao trocar visão admin ↔ atendente, recalcula o título sem disparar bip/notificação
    useEffect(() => {
        naoLidasAntes.current = null
        const total = conversas.filter(noEscopoNotificacao).reduce((s, c) => s + c.naoLidas, 0)
        naoLidasAntes.current = total
        document.title = total ? `(${total}) Emerzap` : 'Emerzap'
    }, [visaoAtendente]) // eslint-disable-line react-hooks/exhaustive-deps

    const carregarApoio = useCallback(async () => {
        const [r, eq, me, tg] = await Promise.allSettled([api('respostas'), api('equipe'), api('auth/me'), api('tags')])
        if (r.status === 'fulfilled') setRespostas(r.value.respostas)
        if (eq.status === 'fulfilled') setEquipe(eq.value.equipe)
        if (me.status === 'fulfilled') setDepartamentos(me.value.departamentos)
        if (tg.status === 'fulfilled') setTagsCatalogo(tg.value.tags || [])
    }, [])

    useEffect(() => {
        carregarApoio()
    }, [carregarApoio])

    // busca com pequeno atraso; depois, atualização periódica (mais espaçada com a aba oculta, ver atualizacao.js)
    useEffect(() => {
        const t = setTimeout(() => carregarConversas(busca), busca ? 400 : 0)
        return () => clearTimeout(t)
    }, [busca, carregarConversas])
    usarAtualizacao(() => carregarConversas(busca), { visivel: INTERVALO_LISTA })

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

    // setores do filtro = departamentos do atendente atribuído (não o departamento_id da conversa)
    const deptosPorAtendente = useMemo(() => {
        const map = new Map()
        for (const u of equipe) map.set(String(u.email || '').toLowerCase(), new Set(u.departamentos || []))
        map.set(String(usuario.email || '').toLowerCase(), new Set(usuario.departamentos || []))
        return map
    }, [equipe, usuario])

    const setoresDoAtendente = useCallback(
        (email) => {
            if (!email) return null
            return deptosPorAtendente.get(String(email).toLowerCase()) || new Set()
        },
        [deptosPorAtendente],
    )


    const buscando = Boolean(busca.trim())

    const passaFiltro = useCallback(
        (c) => {
            // visão atendente sem busca: só eu + meu setor. Com busca: toda a base (API WATI).
            if (visaoAtendente && !buscando && !noEscopoNotificacao(c)) return false
            if (buscando) {
                if (filtro === 'nao-lidas') return c.naoLidas > 0
                if (filtro === 'resolvidas') return c.status === 'resolvida'
                return true
            }
            if (filtro === 'nao-lidas') return c.naoLidas > 0
            if (filtro === 'minhas') return c.atendenteEmail === usuario.email && c.status !== 'resolvida'
            if (filtro === 'fila') return naFilaDoSetor(c)
            if (filtro === 'resolvidas') return c.status === 'resolvida'
            return true
        },
        [filtro, usuario.email, visaoAtendente, buscando, noEscopoNotificacao, naFilaDoSetor],
    )

    const conversasVisao = useMemo(() => conversas.filter(noEscopoNotificacao), [conversas, noEscopoNotificacao])

    // setores em que a conversa conta; vazio = "sem setor".
    // Fila (sem atendente + departamento): conta no setor mesmo com janela 24h fechada — precisa Assumir.
    // Com atendente: janela fechada ou resolvida → sai do setor ("sem setor").
    const setoresDaConversa = useCallback(
        (c) => {
            if (c.status === 'resolvida') return null
            if (!c.atendenteEmail && c.departamentoId) return new Set([c.departamentoId])
            if (janelaDaConversa(c)?.fechada) return null
            const setores = setoresDoAtendente(c.atendenteEmail)
            if (setores?.size) return setores
            return null
        },
        [setoresDoAtendente],
    )

    const passaFiltroDepto = useCallback(
        (c) => {
            if (!filtroDepto) return true
            const setores = setoresDaConversa(c)
            if (filtroDepto === 'sem') return !setores
            // setor específico: atendente da conversa pertence a esse departamento
            return Boolean(setores?.has(filtroDepto))
        },
        [filtroDepto, setoresDaConversa],
    )

    const filtradas = useMemo(() => conversas.filter((c) => passaFiltroDepto(c) && passaFiltro(c)), [conversas, passaFiltroDepto, passaFiltro])

    // contagem por setor do atendente (uma conversa pode entrar em vários setores se o atendente tiver mais de um)
    const contagemDepto = useMemo(() => {
        const n = { '': 0, sem: 0 }
        for (const d of departamentos) n[d.id] ??= 0
        for (const c of conversas) {
            if (!passaFiltro(c)) continue
            n[''] += 1
            const setores = setoresDaConversa(c)
            if (!setores) {
                n.sem += 1
                continue
            }
            for (const id of setores) if (n[id] !== undefined) n[id] += 1
        }
        return n
    }, [conversas, passaFiltro, departamentos, setoresDaConversa])

    const faixaFiltros = useRef(null)
    useRolagemHorizontal(faixaFiltros)

    // catálogo da API (WATI + histórico) + tags da lista aberta — sem duplicar (case-insensitive)
    const tagsConhecidas = useMemo(() => {
        const ordem = []
        const visto = new Set()
        const add = (t) => {
            const nome = String(t || '').trim()
            if (!nome) return
            const chave = nome.toLowerCase()
            if (visto.has(chave)) return
            visto.add(chave)
            ordem.push(nome)
        }
        for (const t of tagsCatalogo) add(t)
        const conta = new Map()
        for (const c of conversas) for (const t of c.tags || []) conta.set(t, (conta.get(t) || 0) + 1)
        ;[...conta.entries()]
            .sort((a, b) => b[1] - a[1])
            .forEach(([t]) => add(t))
        return ordem
    }, [tagsCatalogo, conversas])

    const conversaAtual = useMemo(() => {
        if (!selecionada) return null
        return conversas.find((c) => c.waId === selecionada.waId) || selecionada
    }, [conversas, selecionada])

    useEffect(() => {
        if (!selecionada) setPerfilAberto(false)
    }, [selecionada])

    const abrir = (c) => {
        setSelecionada(c)
        if (c.naoLidas) {
            setConversas((lista) => lista.map((x) => (x.waId === c.waId ? { ...x, naoLidas: 0 } : x)))
            api(`conversas/${encodeURIComponent(c.waId)}/lida`, { method: 'POST' }).catch(() => {})
        }
    }

    // mensagem nova na conversa que está aberta (e visível) já conta como lida
    const naoLidasAberta = conversaAtual?.naoLidas || 0
    useEffect(() => {
        if (!naoLidasAberta || document.hidden || !conversaAtual) return
        const { waId } = conversaAtual
        setConversas((lista) => lista.map((x) => (x.waId === waId ? { ...x, naoLidas: 0 } : x)))
        api(`conversas/${encodeURIComponent(waId)}/lida`, { method: 'POST' }).catch(() => {})
    }, [naoLidasAberta]) // eslint-disable-line react-hooks/exhaustive-deps

    const atualizarConversa = (waId, campos) => {
        const id = normalizarWaId(waId)
        setConversas((lista) => lista.map((x) => (normalizarWaId(x.waId) === id ? { ...x, ...campos } : x)))
        setSelecionada((s) => (s && normalizarWaId(s.waId) === id ? { ...s, ...campos } : s))
    }

    // menu de botão direito nos cards da lista
    const [menuConversa, setMenuConversa] = useState(null) // { c, x, y }
    const [transferindo, setTransferindo] = useState(null)
    const fecharMenuConversa = useCallback(() => setMenuConversa(null), [])

    const acaoNaConversa = (c) => async (rota, body, sucesso, campos) => {
        try {
            const r = await api(`conversas/${encodeURIComponent(c.waId)}/${rota}`, { method: 'POST', body })
            atualizarConversa(c.waId, campos)
            avisar(r.avisoWati ? `${sucesso} Aviso da WATI: ${r.avisoWati}` : sucesso, r.avisoWati ? 'aviso' : 'info')
            carregarConversas(busca)
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const marcarLida = (c) => {
        setConversas((lista) => lista.map((x) => (x.waId === c.waId ? { ...x, naoLidas: 0 } : x)))
        api(`conversas/${encodeURIComponent(c.waId)}/lida`, { method: 'POST' }).catch((e) => avisar(e.message, 'erro'))
    }

    const marcarNaoLida = (c) => {
        // a conversa aberta seria marcada como lida de novo na hora: fecha, como no WhatsApp Web
        if (conversaAtual?.waId === c.waId) setSelecionada(null)
        setConversas((lista) => lista.map((x) => (x.waId === c.waId ? { ...x, naoLidas: Math.max(1, x.naoLidas) } : x)))
        api(`conversas/${encodeURIComponent(c.waId)}/nao-lida`, { method: 'POST' }).catch((e) => avisar(e.message, 'erro'))
    }

    const itensMenuConversa = (c) => [
        { rotulo: 'Abrir conversa', acao: () => abrir(c) },
        c.naoLidas > 0 ? { rotulo: 'Marcar como lida', acao: () => marcarLida(c) } : { rotulo: 'Marcar como não lida', acao: () => marcarNaoLida(c) },
        ...itensDeAtendimento(c, usuario.email, { acao: acaoNaConversa(c), aoTransferir: () => setTransferindo(c) }),
    ]

    const escuro = prefs.modo === 'escuro' || (prefs.modo === 'sistema' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    const infoCanal = CANAIS[canal]

    const itensMenu = [
        canal === 'whatsapp' && { rotulo: 'Nova conversa', acao: () => setModal('nova') },
        { rotulo: 'Configurações', acao: () => setModal('config') },
        { rotulo: 'Atalhos de teclado', acao: () => setModal('atalhos') },
        usuario.papel === 'admin' && { rotulo: 'Administração', acao: () => setModal('admin') },
        { rotulo: escuro ? 'Usar modo claro' : 'Usar modo escuro', acao: () => setPrefs({ modo: escuro ? 'claro' : 'escuro' }) },
        { rotulo: 'Sair', acao: aoSair, perigo: true },
    ]

    // atalhos globais no padrão do WhatsApp Web (ver src/atalhos.js)
    teclado.current = (e) => {
        if (e.defaultPrevented) return
        const k = teclaDe(e)
        if (e.ctrlKey && !e.altKey && !e.shiftKey && k === '/') {
            e.preventDefault()
            return setModal((m) => (m === 'atalhos' ? null : 'atalhos'))
        }
        if (comMod(e)) {
            let acao = null
            if (k === 'n' && !e.shiftKey && canal === 'whatsapp') acao = () => setModal('nova')
            else if ((k === '/' || e.code === 'Slash' || e.code === 'IntlRo') && !e.shiftKey)
                acao = () => {
                    campoBusca.current?.focus()
                    campoBusca.current?.select()
                }
            else if (k === ',') acao = () => setModal('config')
            else if (e.shiftKey && k === 'u' && conversaAtual) acao = () => marcarNaoLida(conversaAtual)
            else if ((e.shiftKey && (k === ']' || k === '}')) || k === 'ArrowDown') acao = () => vizinha(1)
            else if ((e.shiftKey && (k === '[' || k === '{')) || k === 'ArrowUp') acao = () => vizinha(-1)
            if (acao) {
                e.preventDefault()
                acao()
            }
            return
        }
        if (e.key !== 'Escape' || modal || haSobreposicao()) return
        if (e.target === campoBusca.current) {
            if (busca) setBusca('')
            campoBusca.current.blur()
            return
        }
        // Esc fecha a conversa atual; o rascunho fica guardado no Composer
        if (conversaAtual) {
            e.preventDefault()
            setSelecionada(null)
        }
    }
    useEffect(() => {
        const ouvir = (e) => teclado.current(e)
        window.addEventListener('keydown', ouvir)
        return () => window.removeEventListener('keydown', ouvir)
    }, [])

    // próxima/anterior na lista filtrada, como Ctrl+Alt+Shift+] / [ no WhatsApp Web
    const vizinha = (passo) => {
        if (!filtradas.length) return
        const i = filtradas.findIndex((c) => c.waId === conversaAtual?.waId)
        const alvo = i < 0 ? (passo > 0 ? 0 : filtradas.length - 1) : (i + passo + filtradas.length) % filtradas.length
        abrir(filtradas[alvo])
    }

    const esperando = calcularEspera(conversasVisao)
    const listaVazia = busca ? `Nada encontrado para "${busca}".` : VAZIO[filtro]

    return (
        <div ref={raiz} className={`app ${conversaAtual ? 'com-chat' : ''}`} style={larguraLista ? { '--largura-lateral': `${larguraLista}px` } : undefined}>
            <nav className="trilho" aria-label="Canais">
                <span className="trilho-marca" aria-label="zap.emerlab" role="img" data-dica="zap.emerlab" data-dica-lado="direita">
                    <Marca tamanho={30} />
                </span>
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
                    {usuario.fixo ? (
                        <button
                            className={`trilho-botao ${visaoAtendente ? 'ativo' : ''}`}
                            aria-label={visaoAtendente ? 'Visão atendente (clique para ver tudo)' : 'Visão administrador (clique para só os seus)'}
                            data-dica={
                                visaoAtendente
                                    ? 'Visão: Atendente — inbox seu/setor; busca na base toda'
                                    : 'Visão: Administrador — tudo'
                            }
                            data-dica-lado="direita"
                            aria-pressed={visaoAtendente}
                            onClick={() => {
                                const prox = visaoAtendente ? 'admin' : 'atendente'
                                setPrefs({ visao: prox })
                                if (prox === 'atendente') {
                                    setFiltro('tudo')
                                    setSelecionada((s) => {
                                        if (!s) return null
                                        if (s.atendenteEmail === usuario.email) return s
                                        if (s.departamentoId && (usuario.departamentos || []).includes(s.departamentoId)) return s
                                        return null
                                    })
                                }
                            }}
                        >
                            <Icone nome={visaoAtendente ? 'usuario' : 'equipe'} />
                        </button>
                    ) : null}
                    <button className="trilho-botao" aria-label="Configurações" data-dica="Configurações" data-dica-lado="direita" onClick={() => setModal('config')}>
                        <Icone nome="engrenagem" />
                    </button>
                    <button className="trilho-avatar" aria-label={`${usuario.nome}: conta`} data-dica={usuario.nome} data-dica-lado="direita" onClick={() => setModal('config')}>
                        <span className="avatar" style={{ '--av': corAvatar(usuario.email) }}>
                            {iniciais(usuario.nome)}
                        </span>
                    </button>
                </div>
            </nav>

            <aside className="lateral">
                <Redimensionar alvo={raiz} largura={larguraLista} aoMudar={mudarLarguraLista} />
                <header className="barra barra-lateral">
                    <div className="barra-titulo">
                        <h1 className="titulo-canal">
                            <IconeCanal canal={canal} tamanho={18} cor={infoCanal.cor} /> {infoCanal.rotulo}
                        </h1>
                        <small>
                            Conta WATI {config.tenantId} ·{' '}
                            {visaoAtendente
                                ? 'Atendente · busca na base toda'
                                : usuario.papel === 'admin'
                                  ? 'Administrador'
                                  : meusDeptos.map((d) => d.nome).join(', ') || 'Atendente'}
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

                {avisoWatiAberta ? (
                    <div className="faixa-aviso-wati" role="status">
                        <Icone nome="info" tamanho={18} />
                        <span>
                            Mantenha a <strong>WATI aberta</strong> (outra aba ou app) enquanto atende. Só assim você aparece como online lá e o robô auxiliar
                            distribui as conversas corretamente.
                        </span>
                        <button
                            type="button"
                            className="faixa-aviso-fechar"
                            aria-label="Entendi, ocultar aviso"
                            onClick={() => {
                                gravar('zap.avisoWatiAbertaOk', true)
                                setAvisoWatiAberta(false)
                            }}
                        >
                            Entendi
                        </button>
                    </div>
                ) : null}

                <div className="busca">
                    <div className="busca-caixa">
                        <Icone nome="busca" tamanho={18} />
                        <input
                            ref={campoBusca}
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder={
                                visaoAtendente
                                    ? canal === 'whatsapp'
                                        ? 'Buscar em todos os contatos WATI (nome, telefone…)'
                                        : 'Buscar em todos os contatos'
                                    : canal === 'whatsapp'
                                      ? 'Nome, telefone, cidade, UF, tipo ou etiqueta'
                                      : 'Pesquisar nome ou etiqueta'
                            }
                            aria-label="Pesquisar conversas"
                        />
                        {busca ? (
                            <button className="icone-botao mini" onClick={() => setBusca('')} aria-label="Limpar busca">
                                <Icone nome="fechar" tamanho={16} />
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="filtros" role="tablist" aria-label="Filtros" ref={faixaFiltros}>
                    {FILTROS.map(([k, r]) => {
                        let qtd = 0
                        if (k === 'nao-lidas') qtd = conversasVisao.filter((c) => c.naoLidas > 0).length
                        else if (k === 'fila') qtd = conversas.filter(naFilaDoSetor).length
                        return (
                            <button key={k} role="tab" aria-selected={filtro === k} className={`chip ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>
                                {r}
                                {qtd ? <span className="chip-qtd">{qtd}</span> : null}
                            </button>
                        )
                    })}
                    {meusDeptos.length > 0 ? (
                        <SeletorDepartamento departamentos={meusDeptos} valor={filtroDepto} aoMudar={setFiltroDepto} contagem={contagemDepto} />
                    ) : null}
                </div>

                {esperando.length ? (
                    <button className="resumo-fila" onClick={() => abrir(esperando[0])}>
                        <span>
                            <strong>{esperando.length} esperando resposta</strong> · a mais antiga {tempoDesde(esperando[0].ultimaEm)}
                        </span>
                        <span className="resumo-fila-acao">Abrir</span>
                    </button>
                ) : null}

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
                    aoMenu={(c, { x, y }) => setMenuConversa({ c, x, y })}
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
                        tagsConhecidas={tagsConhecidas}
                        perfilAberto={perfilAberto}
                        aoPerfil={setPerfilAberto}
                        aoVoltar={() => {
                            setPerfilAberto(false)
                            setSelecionada(null)
                        }}
                        aoAtualizar={atualizarConversa}
                        aoRecarregarLista={() => {
                            carregarConversas(busca)
                            api('tags')
                                .then((r) => setTagsCatalogo(r.tags || []))
                                .catch(() => {})
                        }}
                        avisar={avisar}
                    />
                ) : (
                    <FilaEspera conversas={conversasVisao} canal={canal} usuarioEmail={usuario.email} aoAbrir={abrir} />
                )}
            </main>

            {menuConversa ? (
                <MenuContexto
                    x={menuConversa.x}
                    y={menuConversa.y}
                    titulo={nomeExibicao(menuConversa.c)}
                    itens={itensMenuConversa(menuConversa.c)}
                    aoFechar={fecharMenuConversa}
                />
            ) : null}
            {transferindo ? (
                <Transferir
                    conversa={transferindo}
                    usuario={usuario}
                    departamentos={departamentos}
                    equipe={equipe}
                    aoFechar={() => setTransferindo(null)}
                    aoTransferir={(escolha) => {
                        const c = transferindo
                        setTransferindo(null)
                        return transferir(c, escolha, acaoNaConversa(c))
                    }}
                />
            ) : null}

            {modal === 'atalhos' ? (
                <Modal titulo="Atalhos de teclado" aoFechar={() => setModal(null)}>
                    {ATALHOS.map(([grupo, lista]) => (
                        <section key={grupo} className="atalhos-grupo">
                            <h3>{grupo}</h3>
                            <ul className="atalhos-lista">
                                {lista.map(([teclas, rotulo]) => (
                                    <li key={rotulo}>
                                        <span>{rotulo}</span>
                                        <span className="atalhos-teclas">
                                            {teclas.flatMap((t) => (t === 'mod' ? MOD : [t])).map((t, i) => (
                                                <kbd key={i}>{t}</kbd>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </Modal>
            ) : null}
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
                        const id = normalizarWaId(waId)
                        const existente = conversas.find((c) => normalizarWaId(c.waId) === id)
                        abrir(existente || { waId: id, nome: null, naoLidas: 0, status: 'aberta', departamentoId: null, atendenteEmail: null })
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
