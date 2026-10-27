import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { usarAtualizacao } from '../atualizacao.js'
import { nomeExibicao, formatarTelefone, rotuloDia, chaveDia, janela24h, canalDoId, CANAIS } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'
import Menu from './Menu.jsx'
import { Avatar, ContatoMetaPills } from './ListaConversas.jsx'
import Mensagem from './Mensagem.jsx'
import Composer from './Composer.jsx'
import Perfil from './Perfil.jsx'
import Transferir from './Transferir.jsx'
import EnviarTemplate from './EnviarTemplate.jsx'
import { comMod, teclaDe, emCampo, haSobreposicao } from '../atalhos.js'
import { transferir, itensDeAtendimento } from '../acoesConversa.js'
import { codigosServicos, temMarcaCredenciados, cidadeDaRegra, chaveCidade } from '../regras.js'

const INTERVALO_CHAT = 5000
const BUSCA_COMPLETA_MS = 30000

// a partir de 4h restantes o contador fica em destaque
const RISCO_JANELA_MS = 4 * 3600 * 1000

// Mesmo critério da WATI: minutos inteiros para baixo (ceil deixava o Emerzap 1 min à frente).
function tempoRestante(ms) {
    if (ms <= 0) return '0 min restantes'
    const totalMin = Math.floor(ms / 60000)
    const h = Math.floor(totalMin / 60)
    const min = totalMin % 60
    if (h) return `${h}h ${String(min).padStart(2, '0')}min restantes`
    return `${Math.max(1, min)} min restantes`
}

function previewDe(m) {
    if (!m) return null
    return {
        wamid: m.wamid || null,
        texto: m.texto || '',
        tipo: m.tipo || 'text',
        minha: !!m.minha,
        operador: m.operador || null,
        nomeArquivo: m.nomeArquivo || null,
    }
}

/** Anexa respostaA a partir do wamid citado na própria lista (e de um mapa local de envios). */
function comCitacoes(lista, locais = null) {
    const porWamid = new Map()
    for (const m of lista) {
        if (m.wamid) porWamid.set(m.wamid, m)
    }
    return lista.map((m) => {
        if (m.respostaA?.texto || m.respostaA?.tipo) return m
        const ctx = m.replyContextId
        if (!ctx) return m
        const alvo = porWamid.get(ctx)
        if (alvo) return { ...m, respostaA: previewDe(alvo) }
        const local = locais?.get(ctx)
        if (local) return { ...m, respostaA: local }
        return m
    })
}

export default function Chat({ conversa, usuario, config, prefs, departamentos, deptoPorId, respostas, equipe, tagsConhecidas, perfilAberto = false, aoPerfil, aoVoltar, aoAtualizar, aoRecarregarLista, avisar }) {
    const { waId } = conversa
    const caminho = `conversas/${encodeURIComponent(waId)}`
    const canal = canalDoId(waId)
    const temTemplates = canal === 'whatsapp'
    const [mensagens, setMensagens] = useState([])
    const [pendentes, setPendentes] = useState([])
    const [carregando, setCarregando] = useState(true)
    const [erro, setErro] = useState('')
    const [pagina, setPagina] = useState(1)
    const [temMais, setTemMais] = useState(false)
    const [respondendo, setRespondendo] = useState(null)
    // preview local das respostas enviadas (a WATI às vezes não devolve replyContextId no histórico)
    const citacoesLocais = useRef(new Map())
    const pendentesRef = useRef([])
    const [modal, setModal] = useState(null)
    const [noFim, setNoFim] = useState(true)
    // data flutuante no topo enquanto o usuário rola (some 5 s depois de parar), como no WhatsApp
    const [diaFlutuante, setDiaFlutuante] = useState({ texto: '', visivel: false })
    const rolouManual = useRef(false)
    const timerDia = useRef(null)
    useEffect(() => () => clearTimeout(timerDia.current), [])
    const [arrastando, setArrastando] = useState(false)
    const setPerfilAberto = aoPerfil || (() => {})
    // atributos do contato na WATI (UF, cidade, tipo…) para ordenar as respostas rápidas pelas regras
    const [atributosContato, setAtributosContato] = useState({})
    useEffect(() => {
        let vivo = true
        api(`${caminho}/contexto`)
            .then((r) => vivo && setAtributosContato(r.atributos || {}))
            .catch(() => {})
        return () => {
            vivo = false
        }
        // o que a ficha salva entra direto pelo aoSalvo: reler a WATI aqui sobrescrevia com dado ainda não atualizado
    }, [caminho])
    // regra services {…}: quem da rede realiza os códigos usados nas respostas, na cidade do contato
    // (null = ainda não se sabe; {services.content} não é preenchido até a busca voltar)
    const codigosRespostas = useMemo(() => [...new Set((respostas || []).flatMap((r) => codigosServicos(r.regras)))].sort().join(','), [respostas])
    const [servicosCidade, setServicosCidade] = useState(null)
    const ufContato = atributosContato.uf || ''
    const cidadeContato = atributosContato.cidade || ''
    useEffect(() => {
        setServicosCidade(null)
        if (!codigosRespostas || !cidadeContato) return
        let vivo = true
        const q = new URLSearchParams({ uf: ufContato, cidade: cidadeContato, codigos: codigosRespostas })
        api(`servicos?${q}`)
            .then((r) => vivo && setServicosCidade({ prestadores: r.prestadores || [] }))
            .catch(() => vivo && setServicosCidade({ erro: true }))
        return () => {
            vivo = false
        }
    }, [codigosRespostas, ufContato, cidadeContato])
    // marcas {credenciados.*}: cidades que as respostas pedem (a da regra locais com uma cidade, ou a do contato).
    // Mesma rota /servicos (credenciados=1), uma chamada por cidade; o resultado fica por chave de cidade.
    const cidadesCredenciados = useMemo(() => {
        const porChave = new Map()
        for (const r of respostas || []) {
            if (!temMarcaCredenciados(r.texto)) continue
            const alvo = cidadeDaRegra(r.regras) || (cidadeContato ? { uf: ufContato, cidade: cidadeContato } : null)
            if (alvo) porChave.set(chaveCidade(alvo), alvo)
        }
        return porChave
    }, [respostas, ufContato, cidadeContato])
    const chavesCredenciados = [...cidadesCredenciados.keys()].sort().join(';')
    const [credenciadosPorCidade, setCredenciadosPorCidade] = useState({})
    useEffect(() => {
        let vivo = true
        setCredenciadosPorCidade({})
        for (const [chave, alvo] of cidadesCredenciados) {
            const q = new URLSearchParams({ uf: alvo.uf || '', cidade: alvo.cidade, credenciados: '1' })
            api(`servicos?${q}`)
                .then((r) => vivo && setCredenciadosPorCidade((m) => ({ ...m, [chave]: { estado: 'pronto', listas: r.credenciados } })))
                .catch(() => vivo && setCredenciadosPorCidade((m) => ({ ...m, [chave]: { estado: 'erro' } })))
        }
        return () => {
            vivo = false
        }
        // as cidades mudam só quando muda a chave (evita refazer a busca a cada render)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chavesCredenciados])
    const fecharPerfil = useCallback(() => setPerfilAberto(false), [setPerfilAberto])
    const area = useRef(null)
    const alturaAntes = useRef(null)
    const composer = useRef(null)
    const teclado = useRef(null)

    // null = ainda não houve primeira carga (evita tratar o histórico inicial como "mensagem nova")
    const idsVistos = useRef(null)
    const aoAtualizarRef = useRef(aoAtualizar)
    const aoRecarregarListaRef = useRef(aoRecarregarLista)
    aoAtualizarRef.current = aoAtualizar
    aoRecarregarListaRef.current = aoRecarregarLista

    // versão da conversa no banco (última mensagem/atualização): igual à última vista = nada novo, não chama a WATI.
    // A cada 30 s busca mesmo assim, para o caso de o webhook perder um evento.
    const versaoVista = useRef(null)
    const buscouEm = useRef(0)
    const carregar = useCallback(async () => {
        try {
            if (versaoVista.current != null && Date.now() - buscouEm.current < BUSCA_COMPLETA_MS) {
                const { versao } = await api(`${caminho}/versao`)
                if (versao && versao === versaoVista.current) return
                versaoVista.current = versao
            } else {
                versaoVista.current = (await api(`${caminho}/versao`).catch(() => ({ versao: '' }))).versao || ''
            }
            buscouEm.current = Date.now()
            const r = await api(`${caminho}/mensagens?pagina=1`)
            const msgs = r.mensagens || []
            setMensagens((atual) => {
                // mantém páginas antigas já carregadas e substitui as recentes
                const ids = new Set(msgs.map((m) => m.id))
                const antigas = atual.filter((m) => !ids.has(m.id) && msgs.length && m.em < msgs[0].em)
                // se a WATI não trouxe replyContextId, herda do estado local (pendente ou mensagem já enriquecida)
                const locais = [...atual, ...pendentesRef.current]
                const enriquecidas = msgs.map((m) => {
                    if (m.respostaA?.texto || m.respostaA?.tipo) return m
                    const irma = locais.find(
                        (x) =>
                            x.minha &&
                            m.minha &&
                            x.texto === m.texto &&
                            (x.respostaA || x.replyContextId) &&
                            Math.abs(new Date(x.em) - new Date(m.em)) < 120000,
                    )
                    if (!irma) return m
                    return {
                        ...m,
                        replyContextId: m.replyContextId || irma.replyContextId || null,
                        respostaA: m.respostaA || irma.respostaA || null,
                    }
                })
                return [...antigas, ...enriquecidas]
            })
            // pendente que já apareceu no histórico da WATI some da fila local
            setPendentes((p) => p.filter((x) => x.status === 'erro' || !msgs.some((m) => m.minha && m.texto === x.texto)))
            setTemMais((v) => (pagina === 1 ? r.temMais : v))
            setErro('')

            const chatMsgs = msgs.filter((m) => !m.evento || m.evento === 'message' || m.evento === 'broadcastMessage')
            const ultima = [...chatMsgs].sort((a, b) => String(a.em || '').localeCompare(String(b.em || ''))).at(-1)
            const previaDe = (m) => {
                if (!m) return null
                const texto = String(m.texto || '').trim()
                if (texto) return texto.slice(0, 500)
                if (m.tipo && m.tipo !== 'text') return `📎 ${m.tipo}`
                return ''
            }

            if (ultima && aoAtualizarRef.current) {
                aoAtualizarRef.current(waId, {
                    ultimaMsg: previaDe(ultima),
                    ultimaMinha: Boolean(ultima.minha),
                    ultimaEm: ultima.em,
                })
            }
            if (idsVistos.current == null) {
                idsVistos.current = new Set(msgs.map((m) => m.id).filter(Boolean))
            } else {
                const novas = msgs.filter((m) => m.id && !idsVistos.current.has(m.id))
                for (const m of msgs) if (m.id) idsVistos.current.add(m.id)
                // cliente escreveu: recarrega a lista para bip / badge / meta do banco
                if (novas.some((m) => !m.minha) && aoRecarregarListaRef.current) aoRecarregarListaRef.current()
            }
        } catch (e) {
            setErro(e.message)
        } finally {
            setCarregando(false)
        }
    }, [caminho, pagina, waId])

    useEffect(() => {
        idsVistos.current = null
        versaoVista.current = null
        citacoesLocais.current = new Map()
        carregar()
    }, [carregar])
    usarAtualizacao(carregar, { visivel: INTERVALO_CHAT })

    const carregarAntigas = async () => {
        const prox = pagina + 1
        alturaAntes.current = area.current?.scrollHeight ?? null
        try {
            const r = await api(`${caminho}/mensagens?pagina=${prox}`)
            setMensagens((atual) => {
                const ids = new Set(atual.map((m) => m.id))
                const novas = r.mensagens.filter((m) => !ids.has(m.id))
                return comCitacoes([...novas, ...atual], citacoesLocais.current)
            })
            setTemMais(r.temMais)
            setPagina(prox)
        } catch (e) {
            alturaAntes.current = null
            avisar(`Não foi possível carregar mensagens anteriores. ${e.message}`, 'erro')
        }
    }

    pendentesRef.current = pendentes
    const todas = useMemo(
        () => comCitacoes([...mensagens, ...pendentes], citacoesLocais.current),
        [mensagens, pendentes],
    )

    // rolagem: mantém no fim quando chegam mensagens; preserva posição ao carregar antigas
    useLayoutEffect(() => {
        const el = area.current
        if (!el) return
        if (alturaAntes.current != null) {
            el.scrollTop = el.scrollHeight - alturaAntes.current
            alturaAntes.current = null
        } else if (noFim) {
            el.scrollTop = el.scrollHeight
        }
    }, [todas.length]) // eslint-disable-line react-hooks/exhaustive-deps

    const aoRolar = () => {
        const el = area.current
        setNoFim(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
        // rolagem automática (abrir a conversa, mensagem nova) não mostra a data
        if (!rolouManual.current) return
        const divisorias = [...el.querySelectorAll('.msg-dia')]
        if (!divisorias.length) return
        // o dia em exibição é o da última divisória que já passou do topo
        const atual = divisorias.filter((d) => d.offsetTop <= el.scrollTop + 8).at(-1) || divisorias[0]
        setDiaFlutuante({ texto: atual.textContent, visivel: true })
        clearTimeout(timerDia.current)
        timerDia.current = setTimeout(() => setDiaFlutuante((d) => ({ ...d, visivel: false })), 5000)
    }
    const marcarRolagemManual = () => {
        rolouManual.current = true
    }

    const irParaFim = () => {
        area.current.scrollTo({ top: area.current.scrollHeight, behavior: 'smooth' })
    }

    // janela de atendimento da Meta: 24h desde a última mensagem do cliente para responder sem template.
    // Sem mensagem do cliente (número novo / abertura nossa) = janela fechada → só template.
    const [agora, setAgora] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setAgora(Date.now()), 15000)
        return () => clearInterval(id)
    }, [])
    const ultimaDoCliente = [...mensagens].reverse().find((m) => !m.minha && m.evento === 'message' && m.em)
    const isoCliente = ultimaDoCliente?.em || conversa.ultimaClienteEm || null
    const janela = isoCliente ? janela24h(isoCliente, agora) : null
    const aberta = Boolean(janela && !janela.fechada)
    const inicioNosso = !isoCliente

    const enviarTexto = async (texto, existente) => {
        if (conversa.status === 'resolvida') return
        // abertura nossa / janela fechada: não dispara texto livre (WATI/API ban)
        if (!aberta) {
            abrirTemplate()
            return
        }
        const ctx = existente ? existente.replyContextId : respondendo?.wamid
        const citacao = existente?.respostaA || (respondendo ? previewDe(respondendo) : null)
        if (ctx && citacao) citacoesLocais.current.set(ctx, citacao)
        const temp = existente
            ? { ...existente, status: 'pendente', erro: null, replyContextId: ctx || existente.replyContextId, respostaA: citacao || existente.respostaA }
            : {
                  id: `tmp-${Date.now()}`,
                  tipo: 'text',
                  texto,
                  em: new Date().toISOString(),
                  minha: true,
                  status: 'pendente',
                  evento: 'message',
                  operador: usuario.nome,
                  replyContextId: ctx || null,
                  respostaA: citacao,
              }
        setPendentes((p) => (existente ? p.map((x) => (x.id === temp.id ? temp : x)) : [...p, temp]))
        setNoFim(true)
        if (!existente) setRespondendo(null)
        try {
            await api(`${caminho}/texto`, { method: 'POST', body: { texto, replyContextId: ctx } })
            aoAtualizar(waId, { ultimaMsg: texto, ultimaMinha: true, ultimaEm: temp.em, atendenteEmail: conversa.atendenteEmail || usuario.email })
            setTimeout(carregar, 800)
        } catch (e) {
            // a mensagem fica no chat, marcada, com explicação e ações (tentar/descartar/template)
            setPendentes((p) => p.map((x) => (x.id === temp.id ? { ...x, status: 'erro', replyContextId: ctx, erro: { mensagem: e.message, codigo: e.codigo } } : x)))
        }
    }

    const tentarDeNovo = (m) => enviarTexto(m.texto, m)
    const descartar = (m) => setPendentes((p) => p.filter((x) => x.id !== m.id))

    // erros de arquivo voltam para o modal do Composer, que mantém o arquivo para nova tentativa
    const enviarArquivo = async (dados) => {
        if (conversa.status === 'resolvida') throw new Error('Conversa resolvida: reabra para enviar arquivos.')
        if (!aberta) {
            abrirTemplate()
            throw new Error('Janela fechada: envie um template antes de anexar arquivos.')
        }
        await api(`${caminho}/arquivo`, { method: 'POST', body: dados })
        avisar('Arquivo enviado.')
        setNoFim(true)
        setTimeout(carregar, 1200)
    }

    const acao = async (rota, body, sucesso, campos) => {
        try {
            const r = await api(`${caminho}/${rota}`, { method: 'POST', body })
            aoAtualizar(waId, campos)
            avisar(r.avisoWati ? `${sucesso} Aviso da WATI: ${r.avisoWati}` : sucesso, r.avisoWati ? 'aviso' : 'info')
            aoRecarregarLista()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const assumir = () => acao('atribuir', {}, 'Conversa atribuída a você.', { atendenteEmail: usuario.email })
    const mudarStatus = (status, txt) => {
        if (status === 'resolvida') setRespondendo(null)
        return acao('status', { status }, txt, { status })
    }

    useEffect(() => {
        if (conversa.status === 'resolvida') setRespondendo(null)
    }, [conversa.status])

    const depto = conversa.departamentoId ? deptoPorId[conversa.departamentoId] : null
    const atendente = conversa.atendenteEmail
        ? equipe.find((u) => String(u.email || '').toLowerCase() === String(conversa.atendenteEmail || '').toLowerCase())?.nome || conversa.atendenteEmail
        : null
    const minha = String(conversa.atendenteEmail || '').toLowerCase() === String(usuario.email || '').toLowerCase()
    const abrirTemplate = () =>
        temTemplates ? setModal('template') : avisar('Instagram e Messenger não têm templates: só dá para responder depois que o cliente escrever.', 'aviso')

    const itensMenu = [
        { rotulo: 'Dados do contato', acao: () => setPerfilAberto(true) },
        temTemplates && { rotulo: 'Enviar template…', acao: () => setModal('template') },
        ...itensDeAtendimento(conversa, usuario.email, { acao, aoTransferir: () => setModal('transferir') }),
    ]

    // atalhos da conversa (o ref mantém as ações atuais sem recriar o listener a cada render)
    teclado.current = (e) => {
        const c = composer.current
        if (comMod(e)) {
            const k = teclaDe(e)
            const acao = !e.shiftKey && k === 'e' ? () => c?.alternar('emoji')
                : !e.shiftKey && k === 'r' ? () => c?.alternar('respostas')
                : e.shiftKey && k === 'a' && !minha ? assumir
                : e.shiftKey && k === 'r' && conversa.status !== 'resolvida' ? () => mudarStatus('resolvida', 'Conversa resolvida.')
                : null
            if (acao) {
                e.preventDefault()
                acao()
            }
            return
        }
        // como no WhatsApp Web: começar a digitar em qualquer lugar escreve no campo de mensagem
        if (c && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !emCampo(e.target) && !haSobreposicao()) c.focar()
    }
    useEffect(() => {
        const ouvir = (e) => teclado.current(e)
        window.addEventListener('keydown', ouvir)
        return () => window.removeEventListener('keydown', ouvir)
    }, [])

    // arrastar arquivo para a conversa abre a prévia de envio
    const temArquivo = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
    const aoArrastar = (e) => {
        if (!temArquivo(e) || !composer.current) return
        e.preventDefault()
        setArrastando(true)
    }
    const aoSair = (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false)
    }
    const aoSoltar = (e) => {
        if (!temArquivo(e)) return
        e.preventDefault()
        setArrastando(false)
        const f = e.dataTransfer.files?.[0]
        if (f && composer.current) composer.current.anexar(f)
    }

    let diaAnterior = null
    let anterior = null

    return (
        <div className={`chat-area ${perfilAberto ? 'com-perfil' : ''}`}>
            <section className="chat" aria-label={`Conversa com ${nomeExibicao(conversa)}`} onDragOver={aoArrastar} onDragLeave={aoSair} onDrop={aoSoltar}>
                {arrastando ? (
                    <div className="soltar-arquivo" aria-hidden="true">
                        <Icone nome="clipe" tamanho={32} />
                        <span>Solte para enviar o arquivo</span>
                    </div>
                ) : null}
                <header className="barra barra-chat">
                    <button className="icone-botao so-mobile" onClick={aoVoltar} aria-label="Voltar para a lista">
                        <Icone nome="voltar" />
                    </button>
                    <button className="abrir-perfil" onClick={() => setPerfilAberto(true)} aria-label={`Dados do contato ${nomeExibicao(conversa)}`}>
                        <span className="avatar-com-canal">
                            <Avatar conversa={conversa} tamanho={40} />
                            <span className="selo-canal" style={{ background: CANAIS[canal].cor }} aria-label={CANAIS[canal].rotulo} role="img">
                                <IconeCanal canal={canal} tamanho={10} cor="#fff" />
                            </span>
                        </span>
                    </button>
                    <div className="barra-titulo">
                        <div className="titulo-linha">
                            <button className="abrir-perfil titulo-perfil" onClick={() => setPerfilAberto(true)} title="Dados do contato">
                                {nomeExibicao(conversa)}
                            </button>
                            <ContatoMetaPills
                                tipo={atributosContato.tipo || conversa.atributos?.tipo}
                                cidade={atributosContato.cidade || conversa.atributos?.cidade}
                                anuncio={conversa.anuncio}
                            />
                        </div>
                        <small>
                            {conversa.nome && formatarTelefone(waId) ? <span className="sub-fone">{formatarTelefone(waId)}</span> : null}
                            {depto ? (
                                <span className="tag tag-mini" style={{ '--tag': depto.cor }}>
                                    {depto.nome}
                                </span>
                            ) : null}
                            {atendente ? (
                                <span className="sub-atendente">
                                    <Icone nome="usuario" tamanho={12} traco={2.5} /> {minha ? 'Você' : atendente}
                                </span>
                            ) : (
                                <span className="status-pill fila" title="Nenhum atendente atribuído">
                                    Na fila
                                </span>
                            )}
                            {conversa.status !== 'aberta' ? (
                                <span className={`status-pill ${conversa.status}`}>{conversa.status}</span>
                            ) : null}
                            {aberta ? (
                                <span
                                    className={`status-pill janela ${janela.restanteMs <= RISCO_JANELA_MS ? 'risco' : ''}`}
                                    title="Tempo para responder sem template: a Meta só libera mensagem livre até 24h depois da última mensagem do cliente"
                                >
                                    <Icone nome="relogio" tamanho={12} traco={2.5} /> {tempoRestante(janela.restanteMs)}
                                </span>
                            ) : null}
                        </small>
                    </div>
                    <div className="barra-acoes">
                        {!minha ? (
                            <button className="botao botao-pequeno botao-assumir" onClick={assumir} aria-label="Assumir conversa" data-dica="Atribuir esta conversa a você" data-dica-lado="esquerda">
                                <Icone nome="pessoaMais" tamanho={18} />
                                <span>Assumir</span>
                            </button>
                        ) : null}
                        <button className="icone-botao some-estreito" aria-label="Transferir" data-dica="Transferir" data-dica-lado="esquerda" onClick={() => setModal('transferir')}>
                            <Icone nome="transferir" />
                        </button>
                        {conversa.status !== 'resolvida' ? (
                            <button className="icone-botao some-estreito" aria-label="Marcar como resolvida" data-dica="Marcar como resolvida" data-dica-lado="esquerda" onClick={() => mudarStatus('resolvida', 'Conversa resolvida.')}>
                                <Icone nome="concluir" />
                            </button>
                        ) : null}
                        <Menu itens={itensMenu} titulo="Mais ações">
                            <Icone nome="menu" />
                        </Menu>
                    </div>
                </header>

                <div
                    className="mensagens"
                    ref={area}
                    onScroll={aoRolar}
                    onWheel={marcarRolagemManual}
                    onTouchStart={marcarRolagemManual}
                    onPointerDown={marcarRolagemManual}
                    onKeyDown={marcarRolagemManual}
                >
                    <div className={`msg-dia-flutuante ${diaFlutuante.visivel ? 'visivel' : ''}`} aria-hidden="true">
                        <span>{diaFlutuante.texto}</span>
                    </div>
                    <div className="mensagens-interno">
                        {temMais ? (
                            <button className="carregar-mais" onClick={carregarAntigas}>
                                Carregar mensagens anteriores
                            </button>
                        ) : null}
                        {carregando ? <div className="spinner spinner-centro" aria-label="Carregando mensagens" /> : null}
                        {erro ? (
                            <div className="estado-erro estado-erro-chat" role="alert">
                                <Icone nome="erro" tamanho={24} />
                                <p>Não foi possível carregar as mensagens. {erro}</p>
                                <button className="botao botao-pequeno botao-secundario" onClick={carregar}>
                                    <Icone nome="tentar" tamanho={16} /> Tentar de novo
                                </button>
                            </div>
                        ) : null}
                        {!carregando && !erro && todas.length === 0 ? (
                            <div className="msg-sistema">
                                <span>{temTemplates ? 'Nenhuma mensagem ainda. Para iniciar o contato, envie um template.' : 'Nenhuma mensagem ainda. Aguarde o cliente escrever.'}</span>
                            </div>
                        ) : null}
                        {todas.map((m) => {
                            const dia = m.em ? chaveDia(m.em) : diaAnterior
                            const novoDia = dia !== diaAnterior
                            const primeira = novoDia || !anterior || anterior.minha !== m.minha || anterior.evento !== 'message'
                            diaAnterior = dia
                            anterior = m
                            return (
                                <Fragment key={m.id}>
                                    {novoDia && m.em ? (
                                        <div className="msg-dia">
                                            <span>{rotuloDia(m.em)}</span>
                                        </div>
                                    ) : null}
                                    <Mensagem
                                        m={m}
                                        waId={waId}
                                        primeiraDoGrupo={primeira}
                                        aoResponder={aberta && conversa.status !== 'resolvida' ? setRespondendo : null}
                                        aoTentar={tentarDeNovo}
                                        aoDescartar={descartar}
                                        aoTemplate={abrirTemplate}
                                    />
                                </Fragment>
                            )
                        })}
                    </div>
                </div>

                {!noFim ? (
                    <button className="ir-fim" onClick={irParaFim} aria-label="Ir para a última mensagem">
                        <Icone nome="baixo" />
                    </button>
                ) : null}

                {conversa.status === 'resolvida' ? (
                    <footer className="chat-resolvido" role="status">
                        <div className="chat-resolvido-texto">
                            <strong>Este bate-papo foi resolvido</strong>
                            <p>Você pode reabrir o chat para acompanhar o cliente.</p>
                        </div>
                        <button
                            type="button"
                            className="botao botao-primario"
                            onClick={() => mudarStatus('aberta', 'Conversa reaberta.')}
                        >
                            Reabrir bate-papo
                        </button>
                    </footer>
                ) : (
                    <>
                        {!aberta ? (
                            <div className="janela-fechada" role="status">
                                <span>
                                    <Icone nome="cadeado" tamanho={18} />
                                    {temTemplates
                                        ? inicioNosso
                                            ? 'Abertura nossa: o WhatsApp exige um template aprovado para iniciar contato com este número. Mensagem livre só depois que o cliente responder.'
                                            : 'Janela de 24h fechada: o cliente não escreve há mais de 24 horas. Só templates aprovados podem ser enviados.'
                                        : inicioNosso
                                          ? `Aguarde o cliente escrever no ${CANAIS[canal].rotulo} para liberar a resposta.`
                                          : `Janela de 24h fechada: o ${CANAIS[canal].rotulo} só permite responder até 24 horas depois da última mensagem do cliente.`}
                                </span>
                                {temTemplates ? (
                                    <button className="botao botao-pequeno" onClick={() => setModal('template')}>
                                        Enviar template
                                    </button>
                                ) : null}
                            </div>
                        ) : null}

                        <Composer
                            // trava sempre que não há janela aberta (inclui carregando / número novo) — nunca liberar texto livre na abertura nossa
                            desabilitado={!aberta}
                            inicioNosso={inicioNosso}
                            temTemplates={temTemplates}
                            prefs={prefs}
                            respostas={respostas}
                            respondendo={respondendo}
                            aoCancelarResposta={() => setRespondendo(null)}
                            aoEnviarTexto={enviarTexto}
                            aoEnviarArquivo={enviarArquivo}
                            controle={composer}
                            chave={waId}
                            aoAbrirTemplate={abrirTemplate}
                            contexto={{
                                nome: conversa.nome || '',
                                atendente: usuario.nome,
                                telefone: formatarTelefone(waId),
                                tipo: atributosContato.tipo || '',
                                uf: atributosContato.uf || '',
                                cidade: atributosContato.cidade || '',
                            }}
                            credenciados={{ porCidade: credenciadosPorCidade, contato: cidadeContato ? { uf: ufContato, cidade: cidadeContato } : null }}
                            quemRealiza={
                                !cidadeContato
                                    ? { estado: 'sem-cidade' }
                                    : !servicosCidade
                                      ? { estado: 'carregando' }
                                      : servicosCidade.erro
                                        ? { estado: 'erro' }
                                        : { estado: 'pronto', prestadores: servicosCidade.prestadores }
                            }
                            contextoRegras={{
                                uf: atributosContato.uf || '',
                                cidade: atributosContato.cidade || '',
                                departamento: depto?.nome || '',
                                atributos: atributosContato,
                            }}
                        />
                    </>
                )}

                {modal === 'transferir' ? (
                    <Transferir
                        conversa={conversa}
                        usuario={usuario}
                        departamentos={departamentos}
                        equipe={equipe}
                        aoFechar={() => setModal(null)}
                        aoTransferir={(escolha) => {
                            setModal(null)
                            return transferir(conversa, escolha, acao)
                        }}
                    />
                ) : null}

                {modal === 'template' ? (
                    <EnviarTemplate
                        conversa={conversa}
                        config={config}
                        aoFechar={() => setModal(null)}
                        aoEnviado={() => {
                            setModal(null)
                            avisar('Template enviado.')
                            setTimeout(carregar, 1500)
                        }}
                        avisar={avisar}
                    />
                ) : null}
            </section>
            {/* ficha do contato ao lado do chat (empurra a conversa), como no WhatsApp Web */}
            {perfilAberto ? (
                <Perfil
                    conversa={conversa}
                    sugestoesTags={tagsConhecidas}
                    aoFechar={fecharPerfil}
                    aoSalvo={(campos, atributos) => {
                        if (atributos) setAtributosContato((a) => ({ ...a, ...atributos }))
                        aoAtualizar(waId, atributos ? { ...campos, atributos: { ...(conversa.atributos || {}), ...atributos } } : campos)
                        aoRecarregarLista()
                    }}
                    avisar={avisar}
                />
            ) : null}
        </div>
    )
}
