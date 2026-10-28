import { useEffect, useRef, useState } from 'react'
import Icone from './Icone.jsx'
import CaixaEmail from './PreviaEmail.jsx'
import Agenda from './PreviaAgenda.jsx'
import MolduraMicrosoft from './MolduraMicrosoft.jsx'
import { CONVERSAS_TEAMS, EMAILS_OUTLOOK, EVENTOS_AGENDA, gerarEmailsExemplo } from '../previaMicrosoftDados.js'
import { PRESENCA, dataLocal, gravar, horaAgora, ler } from '../util.js'
import { Arquivo, Avatar } from './MsComum.jsx'

// Prévia de Teams e Outlook dentro do Emerzap. Ainda não há o registro do app no Azure (Microsoft Graph): o
// "Entrar com a Microsoft" é simulado, os dados são de exemplo (previaMicrosoftDados.js) e o envio só aparece na
// tela. Serve para ver como fica depois da integração; na versão real o login é a conta Microsoft da Emerdog.

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

function Teams({ selecionado, aoSelecionar, moldura }) {
    const [extras, setExtras] = useState({}) // mensagens "enviadas" na prévia, por conversa
    const [texto, setTexto] = useState('')
    const [lidas, setLidas] = useState(new Set())
    const fim = useRef(null)
    const conversas = CONVERSAS_TEAMS.map((c) => ({ ...c, mensagens: [...c.mensagens, ...(extras[c.id] || [])], naoLidas: lidas.has(c.id) ? 0 : c.naoLidas }))
    const atual = conversas.find((c) => c.id === selecionado) || null

    useEffect(() => {
        fim.current?.scrollIntoView({ block: 'end' })
    }, [selecionado, extras])

    const abrir = (id) => {
        setLidas((s) => new Set(s).add(id))
        aoSelecionar(id)
    }
    const enviar = (e) => {
        e.preventDefault()
        const t = texto.trim()
        if (!t || !atual) return
        setExtras((x) => ({ ...x, [atual.id]: [...(x[atual.id] || []), { autor: 'você', texto: t, hora: horaAgora(), dia: 'Hoje', minha: true }] }))
        setTexto('')
    }

    // canais da equipe fixados em cima; reuniões no meio; chats privados sempre embaixo
    const item = (c) => {
        const ultima = c.mensagens.at(-1)
        return (
            <button key={c.id} role="listitem" className={`item ${selecionado === c.id ? 'selecionado' : ''} ${c.naoLidas ? 'nao-lida' : ''}`} onClick={() => abrir(c.id)}>
                <Avatar nome={c.nome} tipo={c.tipo} presenca={c.presenca} />
                <div className="item-corpo">
                    <div className="item-linha">
                        <span className="item-nome-wrap">
                            <span className="item-nome">{c.nome}</span>
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
                <div className="barra-acoes">
                    <button className="icone-botao" aria-label="Chamada de vídeo" data-dica="Chamada de vídeo (na integração, abre o Teams)" data-dica-lado="esquerda">
                        <Icone nome="video" />
                    </button>
                </div>
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
                    <button className="icone-botao" type="submit" aria-label="Enviar" disabled={!texto.trim()}>
                        <Icone nome="enviar" />
                    </button>
                </div>
                <small>Prévia: a mensagem só aparece aqui, não é enviada ao Teams.</small>
            </form>
        </section>
    ) : null
    return <MolduraMicrosoft {...moldura} lista={lista} conteudo={conteudo} />
}

// Outlook: alterna entre E-mail e Agenda. E-mails e eventos ficam aqui para não se perderem na troca.
function Outlook({ selecionado, aoSelecionar, usuario, moldura }) {
    const [modo, setModo] = useState('email')
    // todos os e-mails (todas as pastas) com a data de chegada calculada a partir de "minutos atrás"
    const [agora] = useState(() => new Date().getTime())
    const [emails, setEmails] = useState(() =>
        [...EMAILS_OUTLOOK, ...gerarEmailsExemplo()].map(({ minutos, ...e }) => ({ ...e, recebido: agora - minutos * 60000 })),
    )
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
                <button role="tab" aria-selected={modo === 'agenda'} className={modo === 'agenda' ? 'ativo' : ''} onClick={() => trocar('agenda')}>
                    <Icone nome="calendario" tamanho={15} /> Agenda
                </button>
            </div>
            <button className="botao botao-pequeno ms-novo" onClick={() => aoSelecionar(modo === 'email' ? 'novo' : 'novo-evento')}>
                <Icone nome="mais" tamanho={16} /> {modo === 'email' ? 'Novo e-mail' : 'Novo evento'}
            </button>
        </div>
    )
    const comum = { selecionado, aoSelecionar, usuario, moldura, topo }
    return modo === 'email' ? (
        <CaixaEmail {...comum} emails={emails} setEmails={setEmails} agora={agora} />
    ) : (
        <Agenda {...comum} eventos={eventos} setEventos={setEventos} />
    )
}

export default function PreviaMicrosoft({ app, usuario, aoSelecionar }) {
    const [conectado, setConectado] = useState(() => Boolean(ler(CHAVE_CONECTADO, false)))
    const [selecionado, setSelecionado] = useState(null)

    const selecionar = (id) => {
        setSelecionado(id)
        aoSelecionar?.(Boolean(id))
    }
    const conectar = (sim) => {
        setConectado(sim)
        gravar(CHAVE_CONECTADO, sim)
        selecionar(null)
    }

    const moldura = { app, usuario, conectado, conectar }
    return app === 'teams' ? (
        <Teams selecionado={selecionado} aoSelecionar={selecionar} moldura={moldura} />
    ) : (
        <Outlook selecionado={selecionado} aoSelecionar={selecionar} usuario={usuario} moldura={moldura} />
    )
}
