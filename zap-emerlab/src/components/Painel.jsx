import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usarAtualizacao } from '../atualizacao.js'
import { api, registrarAoConexao } from '../api.js'
import { iniciais, corAvatar, nomeExibicao, CANAIS, APPS_MS, ler, gravar, tempoDesde, calcularEspera, janelaDaConversa, normalizarWaId, mesmoEmail } from '../util.js'
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
import Seletor from './Seletor.jsx'
import PreviaMicrosoft from './PreviaMicrosoft.jsx'
import IconeMicrosoft from './IconeMicrosoft.jsx'
import { transferir, itensDeAtendimento } from '../acoesConversa.js'
import { ATALHOS, MOD, comMod, teclaDe, haSobreposicao } from '../atalhos.js'

const INTERVALO_LISTA = 10000

// Prévia de Teams e Outlook (sem integração com o Azure ainda): só para estes e-mails, para avaliar o desenho
const PREVIA_MICROSOFT = ['pedro@emerdog.com.br']

// Filtros como na Team Inbox da WATI (support.wati.io, "How to search or filter conversations"):
//   Todos = tudo; Ativos = novas/abertas/pendentes com a janela de 24h aberta (expirada não é ativa);
//   Atribuídos a mim; Não atribuídos = sem atendente; Não lidas = com mensagem não lida; Últimas 24h = movimento
//   no último dia; Sem resposta ("Unreplied" da WATI) = cliente esperando resposta de pessoa (bot não conta, template enviado por
//   atendente conta); Menções = citado com @ nas notas.
// Combinam com setor, atendente, status, tag e período (como os filtros avançados da WATI).
// Duas linhas fixas de quatro: a faixa não cresce nem rola quando aparece um contador.
// Terceiro item = rótulo curto, usado quando a lista fica estreita (celular, coluna redimensionada).
const FILTROS = [
    ['todos', 'Todos'],
    ['ativos', 'Ativos'],
    ['atribuidos', 'Atribuídos a mim', 'Meus'],
    ['nao-atribuidos', 'Não atribuídos', 'Na fila'],
    ['nao-lidas', 'Não lidas'],
    ['ultimas-24h', 'Últimas 24h', '24h'],
    ['nao-respondidas', 'Sem resposta'],
    ['mencoes', 'Menções'],
]
const LINHAS_FILTROS = [FILTROS.slice(0, 4), FILTROS.slice(4)]

const PERIODOS = [
    ['', 'Qualquer data'],
    ['hoje', 'Hoje'],
    ['7d', 'Últimos 7 dias'],
    ['30d', 'Últimos 30 dias'],
]

const DIA_MS = 24 * 3600 * 1000

function dentroDoPeriodo(iso, periodo, agora = Date.now()) {
    if (!periodo) return true
    const t = iso ? new Date(iso).getTime() : 0
    if (!t) return false
    if (periodo === 'hoje') return t >= new Date(agora).setHours(0, 0, 0, 0)
    return agora - t <= ({ '1d': 1, '7d': 7 }[periodo] || 30) * DIA_MS
}

// Texto da lista vazia conforme o filtro, para o atendente entender o porquê
const VAZIO = {
    todos: 'Nenhuma conversa neste canal ainda.',
    ativos: 'Nenhuma conversa aberta ou pendente com a janela de 24h ativa.',
    atribuidos: 'Nenhuma conversa aberta atribuída a você. Use "Assumir" numa conversa de Não atribuídos.',
    'nao-atribuidos': 'Todas as conversas abertas têm atendente.',
    'nao-lidas': 'Nenhuma conversa com mensagem não lida.',
    'ultimas-24h': 'Nenhuma conversa com movimento nas últimas 24 horas.',
    'nao-respondidas': 'Nenhum cliente esperando resposta de um atendente.',
    mencoes: 'Ninguém citou você nas notas de uma conversa. Para citar, escreva @nome nas notas do contato.',
}

const STATUS_FILTRO = [
    ['', 'Qualquer status'],
    ['nova', 'Nova'],
    ['aberta', 'Aberta'],
    ['pendente', 'Pendente'],
    ['resolvida', 'Resolvida'],
    ['expirada', 'Expirada'],
    ['bloqueada', 'Bloqueada'],
]

// status como a WATI mostra: aberta/pendente com a janela de 24h fechada = expirada;
// nova = aberta, sem atendente e com o cliente esperando a primeira resposta de uma pessoa
function statusExibido(c) {
    if (c.status === 'resolvida') return c.bloqueada ? 'bloqueada' : 'resolvida'
    if (janelaDaConversa(c)?.fechada) return 'expirada'
    if (c.status === 'pendente') return 'pendente'
    return !c.atendenteEmail && c.aguardandoHumano ? 'nova' : 'aberta'
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
    const [filtro, setFiltro] = useState('atribuidos')
    const [filtroDepto, setFiltroDepto] = useState('')
    const [filtroStatus, setFiltroStatus] = useState('')
    const [filtroTag, setFiltroTag] = useState('')
    const [filtroPeriodo, setFiltroPeriodo] = useState('')
    const [maisAntigas, setMaisAntigas] = useState(false)
    const [filtroAtendente, setFiltroAtendente] = useState('') // '' todos · 'sem' sem atendente · e-mail
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

    // setores do usuário. Na visão de atendente valem só os vinculados, como para qualquer atendente (o admin
    // do .env não tem vínculo: vê as suas e a fila sem setor). Na visão de administrador, todos.
    const meusDeptoIds = useMemo(() => {
        const vinculados = usuario.departamentos || []
        if (!visaoAtendente && (usuario.papel === 'admin' || usuario.fixo)) return new Set(departamentos.map((d) => d.id))
        return new Set(vinculados)
    }, [visaoAtendente, usuario.departamentos, usuario.papel, usuario.fixo, departamentos])

    // Fila (sem atendente) que é minha, como na WATI: do meu setor (equipe) ou sem setor nenhum
    // (a "Default Team" da WATI, visível a todos quando ZAP_ATENDENTE_VE_SEM_DEPARTAMENTO=true)
    const filaVisivel = useCallback(
        (c) => (c.departamentoId ? meusDeptoIds.has(c.departamentoId) : config.atendenteVeSemDepto !== false),
        [meusDeptoIds, config.atendenteVeSemDepto],
    )

    // visão atendente: só as minhas + fila do meu setor (sem atendente).
    // chats já atribuídos a colegas NÃO entram — senão parece que a conversa da Ju “está nas minhas”.
    const noEscopoNotificacao = useCallback(
        (c) => {
            if (!visaoAtendente) return true
            if (mesmoEmail(c.atendenteEmail, usuario.email)) return true
            return !c.atendenteEmail && filaVisivel(c)
        },
        [visaoAtendente, usuario.email, filaVisivel],
    )

    // Na fila: sem atendente, não resolvida, com alguma mensagem, do meu setor ou sem setor
    const naFilaDoSetor = useCallback(
        (c) => {
            if (c.atendenteEmail || c.status === 'resolvida' || c.semHistorico) return false
            if (!visaoAtendente) return true
            return filaVisivel(c)
        },
        [visaoAtendente, filaVisivel],
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
    // com tempo real: o aviso recarrega na hora e o polling espaça para 30 s (nunca menos: a lista também
    // reconcilia com a WATI, e mudanças feitas dentro da própria WATI não geram aviso)
    usarAtualizacao(() => carregarConversas(busca), {
        visivel: INTERVALO_LISTA,
        tempoReal: config.realtime?.lista ? { nome: config.realtime.lista, visivelRt: 30000 } : null,
    })

    // Teams/Outlook (prévia): ocupa a lista e a área do chat no lugar do canal
    const [appMs, setAppMs] = useState(null)
    const [msComItem, setMsComItem] = useState(false)
    const vePreviaMs = PREVIA_MICROSOFT.includes(String(usuario.email || '').toLowerCase())
    const abrirAppMs = (app) => {
        setAppMs(app)
        setMsComItem(false)
        setSelecionada(null)
    }

    const trocarCanal = (novo) => {
        setAppMs(null)
        if (novo === canal) return
        setCanal(novo)
        gravar('zap.canal', novo)
        setSelecionada(null)
        setConversas([])
        setCarregando(true)
        naoLidasAntes.current = null
    }

    const deptoPorId = useMemo(() => Object.fromEntries(departamentos.map((d) => [d.id, d])), [departamentos])

    // setores do filtro "Setor": todos na visão de administrador; os do usuário na de atendente
    const meusDeptos = useMemo(
        () => (usuario.papel === 'admin' && !visaoAtendente ? departamentos : departamentos.filter((d) => (usuario.departamentos || []).includes(d.id))),
        [departamentos, usuario, visaoAtendente],
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

    // filtro de cima, com a regra da WATI (ver FILTROS)
    const passaFiltroWati = useCallback(
        (c, st = statusExibido(c)) => {
            // bloqueada é uma resolvida (encerrada) com o contato bloqueado
            const encerrada = st === 'resolvida' || st === 'bloqueada'
            if (filtro === 'todos') return true
            if (filtro === 'ativos') return st === 'nova' || st === 'aberta' || st === 'pendente'
            if (filtro === 'atribuidos') return mesmoEmail(c.atendenteEmail, usuario.email) && !encerrada
            if (filtro === 'nao-atribuidos') return naFilaDoSetor(c)
            if (filtro === 'nao-lidas') return c.naoLidas > 0
            if (filtro === 'ultimas-24h') return dentroDoPeriodo(c.ultimaEm, '1d')
            if (filtro === 'nao-respondidas') return Boolean(c.aguardandoHumano) && !encerrada
            if (filtro === 'mencoes') return (c.mencionados || []).some((e) => mesmoEmail(e, usuario.email))
            return true
        },
        [filtro, usuario.email, naFilaDoSetor],
    )

    // pessoas para o filtro de atendente: a equipe do painel e quem está logado (o admin do .env não está na equipe)
    const atendentesFiltro = useMemo(() => {
        const lista = (equipe || []).map((u) => ({ nome: u.nome || u.email, email: u.email }))
        if (usuario.email && !lista.some((u) => mesmoEmail(u.email, usuario.email))) lista.push({ nome: usuario.nome || usuario.email, email: usuario.email })
        return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    }, [equipe, usuario.email, usuario.nome])

    const passaFiltro = useCallback(
        (c) => {
            // contato sem nenhuma mensagem só aparece na busca (ou se estiver aberto), como na WATI
            if (c.semHistorico && !buscando && c.waId !== selecionada?.waId) return false
            // visão atendente sem busca: só eu + meu setor. Com busca: toda a base (API WATI).
            if (visaoAtendente && !buscando && !noEscopoNotificacao(c)) return false
            // status e atendente escolhidos valem também na busca
            const st = statusExibido(c)
            if (filtroStatus && st !== filtroStatus) return false
            if (filtroAtendente === 'sem' ? c.atendenteEmail : filtroAtendente && !mesmoEmail(c.atendenteEmail, filtroAtendente)) return false
            if (filtroTag && !(c.tags || []).some((t) => t.toLowerCase() === filtroTag.toLowerCase())) return false
            if (!dentroDoPeriodo(c.ultimaEm, filtroPeriodo)) return false
            if (buscando) return filtro === 'todos' || passaFiltroWati(c, st)
            return passaFiltroWati(c, st)
        },
        [visaoAtendente, buscando, selecionada?.waId, noEscopoNotificacao, filtroStatus, filtroAtendente, filtroTag, filtroPeriodo, filtro, passaFiltroWati],
    )

    // tags das conversas carregadas, para o filtro de tag (só aparece se houver alguma)
    const tagsDaLista = useMemo(() => {
        const vistas = new Map()
        for (const c of conversas) for (const t of c.tags || []) if (!vistas.has(t.toLowerCase())) vistas.set(t.toLowerCase(), t)
        return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    }, [conversas])

    // base dos contadores, da fila de espera e dos avisos: só conversas de verdade (com alguma mensagem)
    const conversasVisao = useMemo(() => conversas.filter((c) => !c.semHistorico && noEscopoNotificacao(c)), [conversas, noEscopoNotificacao])

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

    // o servidor manda das mais recentes para as mais antigas; "Mais antigas" só inverte
    const filtradas = useMemo(() => {
        const lista = conversas.filter((c) => passaFiltroDepto(c) && passaFiltro(c))
        return maisAntigas ? lista.reverse() : lista
    }, [conversas, passaFiltroDepto, passaFiltro, maisAntigas])

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

    // filtros avançados ativos, para o contador do botão e as etiquetas removíveis
    const [painelFiltros, setPainelFiltros] = useState(false)
    const botaoFiltros = useRef(null)
    const filtrosAtivos = [
        filtroDepto && {
            chave: 'depto',
            rotulo: filtroDepto === 'sem' ? 'Sem setor' : deptoPorId[filtroDepto]?.nome || 'Setor',
            limpar: () => setFiltroDepto(''),
        },
        filtroAtendente && {
            chave: 'atendente',
            rotulo: filtroAtendente === 'sem' ? 'Sem atendente' : atendentesFiltro.find((p) => mesmoEmail(p.email, filtroAtendente))?.nome || filtroAtendente,
            limpar: () => setFiltroAtendente(''),
        },
        filtroStatus && { chave: 'status', rotulo: STATUS_FILTRO.find(([v]) => v === filtroStatus)?.[1], limpar: () => setFiltroStatus('') },
        filtroPeriodo && { chave: 'periodo', rotulo: PERIODOS.find(([v]) => v === filtroPeriodo)?.[1], limpar: () => setFiltroPeriodo('') },
        filtroTag && { chave: 'tag', rotulo: `#${filtroTag}`, limpar: () => setFiltroTag('') },
    ].filter(Boolean)
    const limparFiltros = () => {
        setFiltroDepto('')
        setFiltroAtendente('')
        setFiltroStatus('')
        setFiltroPeriodo('')
        setFiltroTag('')
    }

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
        ...itensDeAtendimento(c, usuario.email, { acao: acaoNaConversa(c), aoTransferir: () => setTransferindo(c), admin: usuario.papel === 'admin' }),
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
        // painel de filtros aberto: Esc fecha ele primeiro (o menu de setor, se aberto, já barrou acima) e
        // devolve o foco ao botão "Filtros"
        if (painelFiltros) {
            e.preventDefault()
            setPainelFiltros(false)
            botaoFiltros.current?.focus()
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
        <div ref={raiz} className={`app ${(appMs ? msComItem : conversaAtual) ? 'com-chat' : ''}`} style={larguraLista ? { '--largura-lateral': `${larguraLista}px` } : undefined}>
            <nav className="trilho" aria-label="Canais">
                <span className="trilho-marca" aria-label="zap.emerlab" role="img" data-dica="zap.emerlab" data-dica-lado="direita">
                    <Marca tamanho={30} />
                </span>
                <div className="trilho-canais">
                    {canais.map(({ tipo, conectado }) => (
                        <button
                            key={tipo}
                            className={`trilho-botao ${canal === tipo && !appMs ? 'ativo' : ''}`}
                            style={{ '--canal': CANAIS[tipo].cor }}
                            aria-pressed={canal === tipo && !appMs}
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
                    {vePreviaMs ? (
                        <>
                            <span className="trilho-divisor" role="separator" />
                            {Object.entries(APPS_MS).map(([app, info]) => (
                                <button
                                    key={app}
                                    className={`trilho-botao trilho-ms ${appMs === app ? 'ativo' : ''}`}
                                    style={{ '--canal': info.cor }}
                                    aria-pressed={appMs === app}
                                    aria-label={`${info.nome} (prévia)`}
                                    data-dica={`${info.nome} (prévia)`}
                                    data-dica-lado="direita"
                                    onClick={() => abrirAppMs(app)}
                                >
                                    <IconeMicrosoft app={app} tamanho={24} />
                                    <span className="trilho-rotulo">{info.rotulo}</span>
                                </button>
                            ))}
                        </>
                    ) : null}
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
                                    ? 'Visão: Atendente — só as suas e a fila do setor; busca na base toda'
                                    : 'Visão: Administrador — tudo'
                            }
                            data-dica-lado="direita"
                            aria-pressed={visaoAtendente}
                            onClick={() => {
                                const prox = visaoAtendente ? 'admin' : 'atendente'
                                setPrefs({ visao: prox })
                                if (prox === 'atendente') {
                                    setFiltro('atribuidos')
                                    setSelecionada((s) => {
                                        if (!s) return null
                                        if (mesmoEmail(s.atendenteEmail, usuario.email)) return s
                                        // fila do setor (ou sem setor) ainda pode ficar aberta para Assumir
                                        const daFila = s.departamentoId ? (usuario.departamentos || []).includes(s.departamentoId) : config.atendenteVeSemDepto !== false
                                        if (!s.atendenteEmail && daFila) return s
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

            {appMs ? <PreviaMicrosoft key={appMs} app={appMs} usuario={usuario} aoSelecionar={setMsComItem} /> : null}
            {!appMs ? (
            <>
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
                                ? `Atendente · ${meusDeptos.map((d) => d.nome).join(', ') || 'sem setor'}`
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

                <div className="filtros">
                    {/* visões rápidas (como a Team Inbox da WATI): todas à vista, em duas linhas fixas */}
                    <div className="visoes" role="tablist" aria-label="Visões">
                        {LINHAS_FILTROS.map((linha, i) => (
                            <div key={i} className="visoes-linha">
                                {linha.map(([k, r, curto]) => {
                                    // contagem só onde ajuda a agir (como os marcadores da WATI)
                                    let qtd = 0
                                    if (k === 'nao-atribuidos') qtd = conversas.filter((c) => naFilaDoSetor(c) && noEscopoNotificacao(c)).length
                                    else if (k === 'nao-lidas') qtd = conversasVisao.filter((c) => c.naoLidas > 0).length
                                    else if (k === 'nao-respondidas') qtd = conversasVisao.filter((c) => c.aguardandoHumano && c.status !== 'resolvida').length
                                    else if (k === 'mencoes') qtd = conversasVisao.filter((c) => (c.mencionados || []).some((e) => mesmoEmail(e, usuario.email))).length
                                    return (
                                        <button key={k} role="tab" aria-selected={filtro === k} className={`chip ${filtro === k ? 'ativo' : ''}`} title={r} onClick={() => setFiltro(k)}>
                                            <span className="chip-rotulo">
                                                {curto ? (
                                                    <>
                                                        <span className="rotulo-longo">{r}</span>
                                                        <span className="rotulo-curto">{curto}</span>
                                                    </>
                                                ) : (
                                                    r
                                                )}
                                            </span>
                                            {qtd ? <span className="chip-qtd">{qtd}</span> : null}
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </div>

                    {/* filtros avançados num painel que abre embaixo; fechado, os ativos viram etiquetas removíveis */}
                    <div className="filtros-barra">
                        <button
                            ref={botaoFiltros}
                            type="button"
                            className={`filtro-botao ${painelFiltros ? 'aberto' : ''} ${filtrosAtivos.length ? 'tem' : ''}`}
                            aria-expanded={painelFiltros}
                            aria-controls="painel-filtros"
                            onClick={() => setPainelFiltros((v) => !v)}
                        >
                            <Icone nome="filtro" tamanho={15} />
                            Filtros
                            {filtrosAtivos.length ? <span className="chip-qtd">{filtrosAtivos.length}</span> : null}
                            <Icone nome="baixo" tamanho={14} className={`seletor-depto-seta ${painelFiltros ? 'aberto' : ''}`} />
                        </button>
                        {!painelFiltros ? (
                            <div className="filtros-ativos">
                                {filtrosAtivos.map((f) => (
                                    <button key={f.chave} type="button" className="filtro-ativo" title={`Remover: ${f.rotulo}`} aria-label={`Remover filtro ${f.rotulo}`} onClick={f.limpar}>
                                        <span>{f.rotulo}</span>
                                        <Icone nome="fechar" tamanho={12} />
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <button
                            type="button"
                            className="ordem-botao"
                            aria-pressed={maisAntigas}
                            data-dica={maisAntigas ? 'Mostrando as mais antigas primeiro' : 'Mostrando as mais recentes primeiro'}
                            data-dica-lado="esquerda"
                            onClick={() => setMaisAntigas((v) => !v)}
                        >
                            <Icone nome="ordenar" tamanho={15} />
                            {maisAntigas ? 'Antigas' : 'Recentes'}
                        </button>
                    </div>

                    {painelFiltros ? (
                        <div id="painel-filtros" className="painel-filtros">
                            {meusDeptos.length > 0 ? (
                                <div className="filtro-campo">
                                    <span>Setor</span>
                                    <SeletorDepartamento departamentos={meusDeptos} valor={filtroDepto} aoMudar={setFiltroDepto} contagem={contagemDepto} campo />
                                </div>
                            ) : null}
                            {!visaoAtendente ? (
                                <label className="filtro-campo">
                                    <span>Atendente</span>
                                    <Seletor
                                        className="filtro-select"
                                        ativo={Boolean(filtroAtendente)}
                                        valor={filtroAtendente}
                                        aoMudar={setFiltroAtendente}
                                        opcoes={[{ valor: '', rotulo: 'Todos' }, { valor: 'sem', rotulo: 'Sem atendente' }, ...atendentesFiltro.map((p) => ({ valor: p.email, rotulo: p.nome }))]}
                                    />
                                </label>
                            ) : null}
                            <label className="filtro-campo">
                                <span>Status</span>
                                <Seletor
                                    className="filtro-select"
                                    ativo={Boolean(filtroStatus)}
                                    valor={filtroStatus}
                                    aoMudar={setFiltroStatus}
                                    opcoes={STATUS_FILTRO.map(([valor, rotulo]) => ({ valor, rotulo }))}
                                />
                            </label>
                            <label className="filtro-campo">
                                <span>Período</span>
                                <Seletor
                                    className="filtro-select"
                                    ativo={Boolean(filtroPeriodo)}
                                    valor={filtroPeriodo}
                                    aoMudar={setFiltroPeriodo}
                                    opcoes={PERIODOS.map(([valor, rotulo]) => ({ valor, rotulo }))}
                                />
                            </label>
                            {tagsDaLista.length || filtroTag ? (
                                <label className="filtro-campo">
                                    <span>Tag</span>
                                    <Seletor
                                        className="filtro-select"
                                        ativo={Boolean(filtroTag)}
                                        valor={filtroTag}
                                        aoMudar={setFiltroTag}
                                        opcoes={[
                                            { valor: '', rotulo: 'Todas' },
                                            ...(tagsDaLista.includes(filtroTag) || !filtroTag ? tagsDaLista : [filtroTag, ...tagsDaLista]).map((t) => ({ valor: t, rotulo: t })),
                                        ]}
                                    />
                                </label>
                            ) : null}
                            <div className="painel-filtros-rodape">
                                <button type="button" className="link-limpar" disabled={!filtrosAtivos.length} onClick={limparFiltros}>
                                    Limpar filtros
                                </button>
                                <button type="button" className="link-limpar" onClick={() => setPainelFiltros(false)}>
                                    Pronto
                                </button>
                            </div>
                        </div>
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
            </>
            ) : null}

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
