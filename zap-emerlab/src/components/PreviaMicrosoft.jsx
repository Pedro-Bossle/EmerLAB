import { useEffect, useRef, useState } from 'react'
import Icone from './Icone.jsx'
import CaixaEmail from './PreviaEmail.jsx'
import Agenda from './PreviaAgenda.jsx'
import MolduraMicrosoft from './MolduraMicrosoft.jsx'
import { CONVERSAS_TEAMS, EMAILS_OUTLOOK, EVENTOS_AGENDA, gerarEmailsExemplo } from '../previaMicrosoftDados.js'
import { PRESENCA, dataLocal, gravar, horaAgora, ler } from '../util.js'
import { Arquivo, Avatar } from './MsComum.jsx'
import { useContaMs, useEmailsMs, useTeamsMs } from '../clienteMs.js'

// Teams e Outlook dentro do Emerzap. Com MS_ATIVO no servidor (ver server/microsoft.js) usa a conta Microsoft real de cada
// atendente (Graph); sem ele segue a prévia: "Entrar com a Microsoft" simulado, dados de exemplo (previaMicrosoftDados.js)
// e envio que só aparece na tela. A prop `real` (vinda de clienteMs.js) é o que separa os dois modos.

const CHAVE_CONECTADO = 'zap.previaMs.conectado'

// ordem fixa da lista do Teams: canais (grupos) em cima, chats privados embaixo
const SECOES_TEAMS = [
    ['Canais', (c) => c.tipo === 'canal'],
    ['Reuniões', (c) => c.tipo === 'reuniao' || c.tipo === 'grupo'],
    ['Chats', (c) => c.tipo === 'chat'],
]

// @menção em destaque, como no Teams
function TextoComMencao({ texto }) {
    return String(texto)
        .split(/(@\p{L}+)/u)
        .map((parte, i) => (parte.startsWith('@') ? <mark key={i} className="ms-mencao">{parte}</mark> : parte))
}

function Teams({ selecionado, aoSelecionar, moldura, real }) {
    const [extras, setExtras] = useState({}) // mensagens "enviadas" na prévia, por conversa
    const [texto, setTexto] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [erroEnvio, setErroEnvio] = useState('')
    const [lidas, setLidas] = useState(new Set())
    const fim = useRef(null)
    const base = real ? real.conversas : CONVERSAS_TEAMS
    const conversas = base.map((c) => ({ ...c, mensagens: real ? c.mensagens : [...c.mensagens, ...(extras[c.id] || [])], naoLidas: lidas.has(c.id) ? 0 : c.naoLidas }))
    const atual = conversas.find((c) => c.id === selecionado) || null

    useEffect(() => {
        fim.current?.scrollIntoView({ block: 'end' })
    }, [selecionado, extras])

    const abrir = (id) => {
        setLidas((s) => new Set(s).add(id))
        setErroEnvio('')
        real?.marcarVisto(id)
        aoSelecionar(id)
    }
    const enviar = async (e) => {
        e.preventDefault()
        const t = texto.trim()
        if (!t || !atual || enviando) return
        if (real) {
            setEnviando(true)
            setErroEnvio('')
            try {
                await real.enviar(atual.id, t)
                setTexto('')
            } catch (err) {
                setErroEnvio(err.message || 'Não foi possível enviar.')
            } finally {
                setEnviando(false)
            }
            return
        }
        setExtras((x) => ({ ...x, [atual.id]: [...(x[atual.id] || []), { autor: 'você', texto: t, hora: horaAgora(), dia: 'Hoje', minha: true }] }))
        setTexto('')
    }

    // canais da equipe fixados em cima; reuniões no meio; chats privados sempre embaixo
    const item = (c) => {
        const ultima = c.mensagens.at(-1) || { hora: '', autor: '', texto: c.erro ? 'Sem acesso a este canal' : 'Sem mensagens' }
        return (
            <button key={c.id} role="listitem" className={`item ${selecionado === c.id ? 'selecionado' : ''} ${c.naoLidas ? 'nao-lida' : ''}`} onClick={() => abrir(c.id)}>
                <Avatar nome={c.nome} tipo={c.tipo} presenca={c.presenca} />
                <div className="item-corpo">
                    <div className="item-linha">
                        <span className="item-nome-wrap">
                            <span className="item-nome">{c.nome}</span>
                            {c.privado ? <Icone nome="cadeado" tamanho={12} /> : null}
                        </span>
                        <span className={`item-hora ${c.naoLidas ? 'destaque' : ''}`}>{ultima.hora}</span>
                    </div>
                    <div className="item-linha">
                        <span className="item-previa">
                            <span className="item-previa-texto">
                                {ultima.minha ? 'Você: ' : c.tipo !== 'chat' ? `${ultima.autor.split(' ')[0]}: ` : ''}
                                {ultima.arquivo ? `📎 ${ultima.arquivo.nome}` : ultima.texto}
                            </span>
                        </span>
                        {c.mensagens.some((m) => m.mencao) && c.naoLidas ? <span className="ms-arroba">@</span> : null}
                        {c.naoLidas ? <span className="badge">{c.naoLidas}</span> : null}
                    </div>
                </div>
            </button>
        )
    }
    const lista = (
        <div className="lista" role="list">
            {SECOES_TEAMS.map(([rotulo, naSecao]) => {
                const daSecao = conversas.filter(naSecao)
                if (!daSecao.length) return null
                return (
                    <div key={rotulo} role="group" aria-label={rotulo}>
                        <p className="ms-secao">{rotulo}</p>
                        {daSecao.map(item)}
                    </div>
                )
            })}
        </div>
    )
    const conteudo = atual ? (
        <section className="chat">
            <header className="barra barra-chat">
                <button className="icone-botao so-mobile" onClick={() => aoSelecionar(null)} aria-label="Voltar para a lista">
                    <Icone nome="voltar" />
                </button>
                <Avatar nome={atual.nome} tipo={atual.tipo} presenca={atual.presenca} tamanho={40} />
                <div className="barra-titulo">
                    <strong className="ms-titulo">{atual.nome}</strong>
                    <small>
                        {atual.presenca
                            ? PRESENCA[atual.presenca].rotulo
                            : atual.tipo === 'canal'
                              ? 'Canal da equipe'
                              : atual.tipo === 'reuniao'
                                ? 'Chat da reunião'
                                : 'Conversa em grupo'}
                    </small>
                </div>
                {!real ? (
                    <div className="barra-acoes">
                        <button className="icone-botao" aria-label="Chamada de vídeo" data-dica="Chamada de vídeo (na integração, abre o Teams)" data-dica-lado="esquerda">
                            <Icone nome="video" />
                        </button>
                    </div>
                ) : null}
            </header>
            <div className="mensagens">
                <div className="mensagens-interno">
                    {atual.mensagens.map((m, n) => {
                        const anterior = atual.mensagens[n - 1]
                        const novoDia = !anterior || anterior.dia !== m.dia
                        const cauda = novoDia || !anterior || anterior.autor !== m.autor
                        return (
                            <div key={n}>
                                {novoDia ? (
                                    <div className="msg-dia">
                                        <span>{m.dia}</span>
                                    </div>
                                ) : null}
                                {m.reuniao ? (
                                    <div className="ms-reuniao">
                                        <Icone nome="calendario" tamanho={20} />
                                        <div>
                                            <strong>{m.reuniao.titulo}</strong>
                                            <small>{m.reuniao.quando}</small>
                                        </div>
                                        <button className="botao botao-pequeno" title="Na integração, entra na reunião pelo Teams">
                                            Entrar
                                        </button>
                                    </div>
                                ) : (
                                    <div className={`msg-linha ${cauda ? 'com-cauda' : ''} ${m.minha ? 'minha' : 'dele'}`}>
                                        <div className={`msg ${m.mencao ? 'ms-msg-mencao' : ''}`}>
                                            {!m.minha && atual.tipo !== 'chat' && cauda ? <strong className="ms-autor">{m.autor}</strong> : null}
                                            <span className="msg-texto">
                                                <TextoComMencao texto={m.texto} />
                                            </span>
                                            {m.arquivo ? <Arquivo arquivo={m.arquivo} /> : null}
                                            <span className="ms-rodape-msg">
                                                {m.reacoes ? (
                                                    <span className="ms-reacoes">
                                                        {m.reacoes.map(([emoji, n]) => (
                                                            <span key={emoji}>
                                                                {emoji} {n}
                                                            </span>
                                                        ))}
                                                    </span>
                                                ) : null}
                                                <span className="ms-hora">{m.hora}</span>
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                    <div ref={fim} />
                </div>
            </div>
            <form className="composer ms-composer" onSubmit={enviar}>
                <div className="ms-campo">
                    <input className="entrada" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`Mensagem para ${atual.nome}`} aria-label="Mensagem" />
                    <button className="icone-botao" type="submit" aria-label="Enviar" disabled={!texto.trim() || enviando}>
                        <Icone nome="enviar" />
                    </button>
                </div>
                {real ? erroEnvio ? <small role="alert">{erroEnvio}</small> : null : <small>Prévia: a mensagem só aparece aqui, não é enviada ao Teams.</small>}
            </form>
        </section>
    ) : null
    const listaOuEstado =
        real && real.carregando ? (
            <div className="estado-vazio">
                <p>Carregando os canais…</p>
            </div>
        ) : real && real.erro && !conversas.length ? (
            <div className="estado-vazio">
                <p>{real.erro}</p>
            </div>
        ) : (
            lista
        )
    return <MolduraMicrosoft {...moldura} lista={listaOuEstado} conteudo={conteudo} />
}

// Outlook: alterna entre E-mail e Agenda. E-mails e eventos ficam aqui para não se perderem na troca.
function Outlook({ selecionado, aoSelecionar, usuario, moldura, real }) {
    const [modo, setModo] = useState('email')
    const abrirReal = real?.abrir
    useEffect(() => {
        if (selecionado && abrirReal) abrirReal(selecionado)
    }, [selecionado, abrirReal])
    // todos os e-mails (todas as pastas) com a data de chegada calculada a partir de "minutos atrás"
    const [agora] = useState(() => new Date().getTime())
    const [emailsPrevia, setEmailsPrevia] = useState(() =>
        [...EMAILS_OUTLOOK, ...gerarEmailsExemplo()].map(({ minutos, ...e }) => ({ ...e, recebido: agora - minutos * 60000 })),
    )
    const emails = real ? real.emails || [] : emailsPrevia
    const setEmails = real ? real.setEmails : setEmailsPrevia
    const [eventos, setEventos] = useState(() =>
        EVENTOS_AGENDA.map(({ dia, ...e }) => {
            const d = new Date()
            d.setDate(d.getDate() + dia)
            return { ...e, data: dataLocal(d) }
        }),
    )
    const trocar = (m) => {
        setModo(m)
        aoSelecionar(null)
    }
    const topo = (
        <div className="ms-ferramentas">
            <div className="ms-segmento" role="tablist" aria-label="Outlook">
                <button role="tab" aria-selected={modo === 'email'} className={modo === 'email' ? 'ativo' : ''} onClick={() => trocar('email')}>
                    <Icone nome="email" tamanho={15} /> E-mail
                </button>
                {!real ? (
                    <button role="tab" aria-selected={modo === 'agenda'} className={modo === 'agenda' ? 'ativo' : ''} onClick={() => trocar('agenda')}>
                        <Icone nome="calendario" tamanho={15} /> Agenda
                    </button>
                ) : null}
            </div>
            <button className="botao botao-pequeno ms-novo" onClick={() => aoSelecionar(modo === 'email' ? 'novo' : 'novo-evento')}>
                <Icone nome="mais" tamanho={16} /> {modo === 'email' ? 'Novo e-mail' : 'Novo evento'}
            </button>
        </div>
    )
    const faixa =
        real && (real.erro || real.carregando) ? (
            <p className="ms-faixa" role={real.erro ? 'alert' : 'status'}>
                <Icone nome="info" tamanho={14} /> {real.erro || 'Carregando e-mails…'}
                {real.erro ? (
                    <button type="button" className="ms-link" onClick={real.limparErro}>
                        Fechar
                    </button>
                ) : null}
            </p>
        ) : null
    const comum = {
        selecionado,
        aoSelecionar,
        usuario,
        moldura,
        topo: (
            <>
                {topo}
                {faixa}
            </>
        ),
    }
    return modo === 'email' ? (
        <CaixaEmail {...comum} emails={emails} setEmails={setEmails} agora={agora} />
    ) : (
        <Agenda {...comum} eventos={eventos} setEventos={setEventos} />
    )
}

export default function PreviaMicrosoft({ app, usuario, aoSelecionar }) {
    const [conectado, setConectado] = useState(() => Boolean(ler(CHAVE_CONECTADO, false)))
    const [selecionado, setSelecionado] = useState(null)
    const conta = useContaMs()
    const ligadoReal = conta.st.ativo && conta.st.conectado
    const teamsMs = useTeamsMs(ligadoReal && app === 'teams', conta.st.canal)
    const emailsMs = useEmailsMs(ligadoReal && app === 'outlook', conta.st.canal)
    const modoReal = conta.st.ativo

    const selecionar = (id) => {
        setSelecionado(id)
        aoSelecionar?.(Boolean(id))
    }
    const conectar = (sim) => {
        setConectado(sim)
        gravar(CHAVE_CONECTADO, sim)
        selecionar(null)
    }

    if (conta.st.carregando) {
        return (
            <main className="principal">
                <div className="estado-vazio">
                    <p>Carregando…</p>
                </div>
            </main>
        )
    }
    const infoReal = modoReal ? { email: conta.st.email, aviso: conta.aviso, reconectar: conta.st.reconectar } : null
    const moldura = modoReal
        ? { app, usuario, conectado: conta.st.conectado, conectar: (sim) => (sim ? conta.conectar(app) : conta.desconectar()), real: infoReal }
        : { app, usuario, conectado, conectar }
    return app === 'teams' ? (
        <Teams selecionado={selecionado} aoSelecionar={selecionar} moldura={moldura} real={modoReal ? teamsMs : null} />
    ) : (
        <Outlook selecionado={selecionado} aoSelecionar={selecionar} usuario={usuario} moldura={moldura} real={modoReal ? emailsMs : null} />
    )
}
