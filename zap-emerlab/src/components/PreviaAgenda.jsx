import { useState } from 'react'
import Icone from './Icone.jsx'
import MolduraMicrosoft from './MolduraMicrosoft.jsx'
import { dataLocal, novoIdPrevia } from '../util.js'

// Agenda do Outlook na prévia: semana em faixa, compromissos do dia, detalhes e "Novo evento".
// Na integração: GET /me/calendarView (semana), POST /me/events (novo, com isOnlineMeeting para reunião do Teams)
// e POST /me/events/{id}/accept | tentativelyAccept | decline (resposta ao convite).

const RESPOSTAS = [
    ['aceito', 'Aceitar'],
    ['talvez', 'Talvez'],
    ['recusado', 'Recusar'],
]

function diaDe(texto) {
    const [a, m, d] = texto.split('-').map(Number)
    return new Date(a, m - 1, d)
}

// segunda a domingo da semana de `d`
function semanaDe(d) {
    const seg = new Date(d)
    seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
        const x = new Date(seg)
        x.setDate(seg.getDate() + i)
        return x
    })
}

// "Outubro de 2026" (só a primeira letra maiúscula)
const mesDe = (d) => {
    const t = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return t.charAt(0).toUpperCase() + t.slice(1)
}
const nomeDia = (d) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

function NovoEvento({ dia, usuario, aoSalvar, aoCancelar }) {
    const [f, setF] = useState({ titulo: '', data: dia, inicio: '09:00', fim: '09:30', participantes: '', teams: true, descricao: '' })
    const mudar = (campo) => (e) => setF({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    const valido = f.titulo.trim() && f.data && f.inicio && f.fim && f.fim > f.inicio
    const salvar = (e) => {
        e.preventDefault()
        if (!valido) return
        aoSalvar({
            id: novoIdPrevia('ev'),
            titulo: f.titulo.trim(),
            data: f.data,
            inicio: f.inicio,
            fim: f.fim,
            teams: f.teams,
            local: f.teams ? 'Reunião do Microsoft Teams' : '',
            organizador: usuario.nome || 'Você',
            participantes: [usuario.nome || 'Você', ...f.participantes.split(/[,;]/).map((s) => s.trim()).filter(Boolean)],
            descricao: f.descricao.trim(),
        })
    }
    return (
        <form className="ms-evento-form" onSubmit={salvar}>
            <h2>Novo evento</h2>
            <label className="campo">
                <span>Título</span>
                <input className="entrada" value={f.titulo} onChange={mudar('titulo')} placeholder="Ex.: Alinhamento com a equipe" autoFocus />
            </label>
            <div className="ms-evento-horario">
                <label className="campo">
                    <span>Data</span>
                    <input className="entrada" type="date" value={f.data} onChange={mudar('data')} />
                </label>
                <label className="campo">
                    <span>Início</span>
                    <input className="entrada" type="time" value={f.inicio} onChange={mudar('inicio')} />
                </label>
                <label className="campo">
                    <span>Fim</span>
                    <input className="entrada" type="time" value={f.fim} onChange={mudar('fim')} />
                </label>
            </div>
            <label className="campo">
                <span>Participantes</span>
                <input className="entrada" value={f.participantes} onChange={mudar('participantes')} placeholder="Nomes ou e-mails, separados por vírgula" />
            </label>
            <label className="check">
                <input type="checkbox" checked={f.teams} onChange={mudar('teams')} /> Reunião do Teams (gera o link para entrar)
            </label>
            <label className="campo">
                <span>Descrição</span>
                <textarea className="entrada" rows={3} value={f.descricao} onChange={mudar('descricao')} />
            </label>
            {f.fim <= f.inicio ? <small className="ms-erro">O fim precisa ser depois do início.</small> : null}
            <div className="ms-acoes">
                <button className="botao botao-pequeno" type="submit" disabled={!valido}>
                    Salvar e enviar convites
                </button>
                <button className="botao botao-secundario botao-pequeno" type="button" onClick={aoCancelar}>
                    Cancelar
                </button>
                <small>Prévia: nada vai para a sua agenda de verdade.</small>
            </div>
        </form>
    )
}

// Calendário do mês (área da direita quando nenhum evento está aberto). Cada semana é uma linha: o botão à
// esquerda expande a semana para mostrar todos os compromissos com horário; clicar num dia abre esse dia na
// lista lateral. Recolhida, a linha mostra até MAX_RESUMO compromissos por dia.
const MAX_RESUMO = 2
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// semana do ano (ISO 8601: começa na segunda, a semana 1 tem a primeira quinta-feira do ano)
function semanaDoAno(d) {
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7))
    const inicio = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
    return Math.ceil(((x - inicio) / 86400000 + 1) / 7)
}

// semanas (seg–dom) que cobrem o mês de `ref`
function semanasDoMes(ref) {
    const primeiro = new Date(ref.getFullYear(), ref.getMonth(), 1)
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    const semanas = []
    for (let seg = semanaDe(primeiro)[0]; seg <= ultimo; seg = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 7)) {
        semanas.push(semanaDe(seg))
    }
    return semanas
}

function CalendarioMes({ mes, aoMudarMes, semanaAberta, aoAlternarSemana, eventos, dia, hoje, aoEscolherDia, aoAbrir }) {
    const ref = diaDe(mes)
    const doDia = (v) => eventos.filter((e) => e.data === v).sort((a, b) => a.inicio.localeCompare(b.inicio))
    return (
        <section className="ms-mes" aria-label="Calendário do mês">
            <header className="ms-mes-topo">
                <button className="icone-botao" aria-label="Mês anterior" onClick={() => aoMudarMes(-1)}>
                    <Icone nome="voltar" tamanho={18} />
                </button>
                <strong>{mesDe(ref)}</strong>
                <button className="icone-botao ms-avancar" aria-label="Próximo mês" onClick={() => aoMudarMes(1)}>
                    <Icone nome="voltar" tamanho={18} />
                </button>
                <button className="ms-link" onClick={() => aoMudarMes(0)}>
                    Hoje
                </button>
            </header>
            <div className="ms-mes-cab" aria-hidden="true">
                <span />
                {DIAS_SEMANA.map((d) => (
                    <span key={d}>{d}</span>
                ))}
            </div>
            <div className="ms-mes-corpo">
                {semanasDoMes(ref).map((semana) => {
                    const chave = dataLocal(semana[0])
                    const aberta = chave === semanaAberta
                    return (
                        <div key={chave} className={`ms-mes-semana ${aberta ? 'aberta' : ''}`}>
                            <button
                                className="ms-mes-num"
                                aria-expanded={aberta}
                                aria-label={`${aberta ? 'Recolher' : 'Expandir'} a semana de ${semana[0].toLocaleDateString('pt-BR')}`}
                                data-dica={aberta ? 'Recolher a semana' : 'Ver os compromissos da semana'}
                                data-dica-lado="direita"
                                onClick={() => aoAlternarSemana(aberta ? null : chave)}
                            >
                                <small>S{semanaDoAno(semana[0])}</small>
                                <Icone nome="baixo" tamanho={14} className="ms-mes-seta" />
                            </button>
                            {semana.map((d) => {
                                const v = dataLocal(d)
                                const evs = doDia(v)
                                const mostrar = aberta ? evs : evs.slice(0, MAX_RESUMO)
                                return (
                                    <div
                                        key={v}
                                        role="button"
                                        tabIndex={0}
                                        className={`ms-mes-dia ${v === dia ? 'ativo' : ''} ${v === hoje ? 'hoje' : ''} ${d.getMonth() !== ref.getMonth() ? 'fora' : ''}`}
                                        aria-label={`${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}, ${evs.length} compromisso(s)`}
                                        onClick={() => aoEscolherDia(v)}
                                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), aoEscolherDia(v))}
                                    >
                                        <span className="ms-mes-data">{d.getDate()}</span>
                                        {mostrar.map((e) => (
                                            <button
                                                key={e.id}
                                                className="ms-mes-evento"
                                                title={`${e.inicio}–${e.fim} · ${e.titulo}`}
                                                onClick={(ev) => {
                                                    ev.stopPropagation()
                                                    aoAbrir(e)
                                                }}
                                            >
                                                {aberta ? <small>{e.inicio}–{e.fim}</small> : null}
                                                <span>{e.titulo}</span>
                                            </button>
                                        ))}
                                        {!aberta && evs.length > MAX_RESUMO ? <span className="ms-mes-mais">+{evs.length - MAX_RESUMO}</span> : null}
                                        {aberta && !evs.length ? <span className="ms-mes-livre">Livre</span> : null}
                                    </div>
                                )
                            })}
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

export default function Agenda({ selecionado, aoSelecionar, usuario, moldura, topo, eventos, setEventos }) {
    const [dia, setDia] = useState(() => dataLocal(new Date()))
    const [mes, setMes] = useState(() => dataLocal(new Date()))
    const [semanaAberta, setSemanaAberta] = useState(() => dataLocal(semanaDe(new Date())[0]))
    const semana = semanaDe(diaDe(dia))
    const hoje = dataLocal(new Date())
    const doDia = eventos.filter((e) => e.data === dia).sort((a, b) => a.inicio.localeCompare(b.inicio))
    const atual = eventos.find((e) => e.id === selecionado) || null
    const souOrganizador = atual && atual.organizador === (usuario.nome || 'Você')

    // dia escolhido pela lista lateral: o calendário do mês vai junto
    const irPara = (v) => {
        setDia(v)
        setMes(v)
    }
    const pularSemana = (n) => {
        const d = diaDe(dia)
        d.setDate(d.getDate() + 7 * n)
        irPara(dataLocal(d))
        aoSelecionar(null)
    }
    const responder = (id, resposta) => setEventos((l) => l.map((e) => (e.id === id ? { ...e, resposta } : e)))

    const lista = (
        <>
            {topo}
            <div className="ms-semana">
                <div className="ms-semana-topo">
                    <button className="icone-botao" aria-label="Semana anterior" onClick={() => pularSemana(-1)}>
                        <Icone nome="voltar" tamanho={18} />
                    </button>
                    <strong>{mesDe(semana[0])}</strong>
                    <button className="icone-botao ms-avancar" aria-label="Próxima semana" onClick={() => pularSemana(1)}>
                        <Icone nome="voltar" tamanho={18} />
                    </button>
                    {dia !== hoje ? (
                        <button className="ms-link" onClick={() => irPara(hoje)}>
                            Hoje
                        </button>
                    ) : null}
                </div>
                <div className="ms-semana-dias" role="tablist" aria-label="Dias da semana">
                    {semana.map((d) => {
                        const v = dataLocal(d)
                        const tem = eventos.some((e) => e.data === v)
                        return (
                            <button
                                key={v}
                                role="tab"
                                aria-selected={v === dia}
                                className={`ms-dia ${v === dia ? 'ativo' : ''} ${v === hoje ? 'hoje' : ''}`}
                                onClick={() => {
                                    irPara(v)
                                    aoSelecionar(null)
                                }}
                            >
                                <small>{d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</small>
                                <strong>{d.getDate()}</strong>
                                <span className={`ms-dia-ponto ${tem ? 'tem' : ''}`} />
                            </button>
                        )
                    })}
                </div>
            </div>
            <p className="ms-secao">{nomeDia(diaDe(dia))}</p>
            <div className="lista" role="list">
                {doDia.map((e) => (
                    <button key={e.id} role="listitem" className={`item ms-evento ${selecionado === e.id ? 'selecionado' : ''}`} onClick={() => aoSelecionar(e.id)}>
                        <span className="ms-evento-hora">
                            <strong>{e.inicio}</strong>
                            <small>{e.fim}</small>
                        </span>
                        <div className="item-corpo">
                            <div className="item-linha">
                                <span className="item-nome">{e.titulo}</span>
                            </div>
                            <div className="item-linha">
                                <span className="item-previa">
                                    {e.teams ? <Icone nome="video" tamanho={14} /> : null}
                                    <span className="item-previa-texto">{e.local || 'Sem local'}</span>
                                </span>
                                {e.resposta === 'talvez' ? <span className="ms-qtd">talvez</span> : null}
                                {!e.resposta && e.organizador !== (usuario.nome || 'Você') ? <span className="ms-qtd">sem resposta</span> : null}
                            </div>
                        </div>
                    </button>
                ))}
                {!doDia.length ? <p className="lista-vazia">Nenhum compromisso neste dia.</p> : null}
            </div>
        </>
    )

    let conteudo = (
        <CalendarioMes
            mes={mes}
            aoMudarMes={(n) => {
                if (n === 0) {
                    setMes(hoje)
                    setDia(hoje)
                    setSemanaAberta(dataLocal(semanaDe(new Date())[0]))
                    return
                }
                const d = diaDe(mes)
                setMes(dataLocal(new Date(d.getFullYear(), d.getMonth() + n, 1)))
            }}
            semanaAberta={semanaAberta}
            aoAlternarSemana={setSemanaAberta}
            eventos={eventos}
            dia={dia}
            hoje={hoje}
            aoEscolherDia={setDia}
            aoAbrir={(e) => {
                setDia(e.data)
                aoSelecionar(e.id)
            }}
        />
    )
    if (selecionado === 'novo-evento') {
        conteudo = (
            <NovoEvento
                dia={dia}
                usuario={usuario}
                aoCancelar={() => aoSelecionar(null)}
                aoSalvar={(ev) => {
                    setEventos((l) => [...l, ev])
                    irPara(ev.data)
                    aoSelecionar(ev.id)
                }}
            />
        )
    } else if (atual) {
        conteudo = (
            <section className="chat">
                <header className="barra barra-chat">
                    <button className="icone-botao" onClick={() => aoSelecionar(null)} aria-label="Voltar ao calendário" data-dica="Voltar ao calendário" data-dica-lado="direita">
                        <Icone nome="voltar" />
                    </button>
                    <div className="barra-titulo">
                        <strong className="ms-titulo">{atual.titulo}</strong>
                        <small>{nomeDia(diaDe(atual.data))}</small>
                    </div>
                </header>
                <article className="ms-email ms-evento-detalhe">
                    <p>
                        <Icone nome="relogio" tamanho={16} /> {atual.inicio} – {atual.fim}
                    </p>
                    {atual.local ? (
                        <p>
                            <Icone nome={atual.teams ? 'video' : 'local'} tamanho={16} /> {atual.local}
                        </p>
                    ) : null}
                    {atual.teams ? (
                        <button className="botao ms-entrar-reuniao" title="Na integração, abre a reunião no Teams">
                            <Icone nome="video" tamanho={16} /> Entrar na reunião
                        </button>
                    ) : null}
                    <p>
                        <Icone nome="usuario" tamanho={16} /> Organizado por <strong>{souOrganizador ? 'você' : atual.organizador}</strong>
                    </p>
                    <div className="ms-participantes">
                        {atual.participantes.map((p) => (
                            <span key={p} className="tag tag-neutra">
                                {p}
                            </span>
                        ))}
                    </div>
                    {atual.descricao ? <p className="ms-evento-descricao">{atual.descricao}</p> : null}
                    {souOrganizador ? (
                        <div className="ms-acoes">
                            <button
                                className="botao botao-secundario botao-pequeno"
                                onClick={() => {
                                    setEventos((l) => l.filter((e) => e.id !== atual.id))
                                    aoSelecionar(null)
                                }}
                            >
                                Cancelar evento
                            </button>
                            <small>Na integração, os participantes recebem o cancelamento.</small>
                        </div>
                    ) : (
                        <div className="ms-convite-acoes">
                            {RESPOSTAS.map(([v, r]) => (
                                <button key={v} className={`chip ${atual.resposta === v ? 'ativo' : ''}`} onClick={() => responder(atual.id, v)}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    )}
                </article>
            </section>
        )
    }

    return <MolduraMicrosoft {...moldura} lista={lista} conteudo={conteudo} />
}
