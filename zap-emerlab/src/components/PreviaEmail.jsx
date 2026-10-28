import { useState } from 'react'
import Icone from './Icone.jsx'
import Menu from './Menu.jsx'
import Seletor from './Seletor.jsx'
import EditorEmail from './EditorEmail.jsx'
import MolduraMicrosoft from './MolduraMicrosoft.jsx'
import { Arquivo, Avatar } from './MsComum.jsx'
import { limparHtml } from '../htmlSeguro.js'
import { novoIdPrevia } from '../util.js'

// Caixa de e-mail do Outlook na prévia, com o que o Microsoft Graph permite fazer sem sair da tela:
//   listar 20 por vez ........ GET /me/mailFolders/{pasta}/messages?$top=20 (+ @odata.nextLink no "Carregar mais")
//   buscar ................... $search="…" (remetente, assunto e corpo; em todas as pastas: GET /me/messages)
//   filtrar / ordenar ........ $filter=isRead eq false | flag/flagStatus eq 'flagged' | hasAttachments eq true |
//                              importance eq 'high'; $orderby=receivedDateTime desc|asc
//   lido / sinalizar ......... PATCH /me/messages/{id} { isRead } | { flag: { flagStatus } }
//   arquivar / excluir / mover POST /me/messages/{id}/move { destinationId: archive | deleteditems | … }
//   excluir de vez ........... DELETE /me/messages/{id}
//   vários de uma vez ........ POST /$batch (até 20 requisições por lote)
//   rascunho ................. POST /me/messages, PATCH para editar e POST /me/messages/{id}/send
//   enviar / responder ....... POST /me/sendMail | /reply | /replyAll | /forward
// Aqui tudo é simulado: as mudanças ficam só na tela.

const POR_PAGINA = 20

const PASTAS = [
    ['entrada', 'Caixa de entrada'],
    ['enviados', 'Itens enviados'],
    ['rascunhos', 'Rascunhos'],
    ['arquivo', 'Arquivo morto'],
    ['lixeira', 'Itens excluídos'],
]
const NOME_PASTA = Object.fromEntries(PASTAS)

const FILTROS = [
    ['', 'Todos'],
    ['nao-lidos', 'Não lidos'],
    ['sinalizados', 'Sinalizados'],
    ['anexos', 'Com anexo'],
    ['importantes', 'Importantes'],
]
const passaFiltro = {
    '': () => true,
    'nao-lidos': (e) => !e.lido,
    sinalizados: (e) => e.sinalizado,
    anexos: (e) => e.anexos?.length,
    importantes: (e) => e.importante,
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const textoDoEmail = (e) => (e.texto ?? e.corpo.join(' ')).replace(/\s+/g, ' ')

// Hoje / Ontem / Esta semana / Este mês / Mais antigos, como a lista do Outlook
function grupoDaData(ms, agora) {
    const d = new Date(ms)
    const hoje = new Date(agora)
    hoje.setHours(0, 0, 0, 0)
    const dia = 86400000
    if (d >= hoje) return 'Hoje'
    if (d >= hoje - dia) return 'Ontem'
    const seg = new Date(hoje)
    seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7))
    if (d >= seg) return 'Esta semana'
    if (d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear()) return 'Este mês'
    return 'Mais antigos'
}

function horaNaLista(ms, agora) {
    const d = new Date(ms)
    const g = grupoDaData(ms, agora)
    if (g === 'Hoje') return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    if (g === 'Ontem') return 'Ontem'
    if (g === 'Esta semana') return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const dataCompleta = (ms) =>
    new Date(ms).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function CaixaEmail({ selecionado, aoSelecionar, usuario, moldura, topo, emails, setEmails, agora }) {
    const [pasta, setPasta] = useState('entrada')
    const [filtro, setFiltro] = useState('')
    const [busca, setBusca] = useState('')
    const [todasPastas, setTodasPastas] = useState(false)
    const [antigos, setAntigos] = useState(false)
    const [limite, setLimite] = useState(POR_PAGINA)
    const [marcados, setMarcados] = useState(() => new Set())
    const [resposta, setResposta] = useState(null) // modo: responder | todos | encaminhar
    const [aviso, setAviso] = useState(null) // { texto, desfazer }

    // qualquer mudança de pasta, filtro, busca ou ordem volta para os 20 primeiros e limpa a seleção
    const recomecar = (fn) => (v) => {
        fn(v)
        setLimite(POR_PAGINA)
        setMarcados(new Set())
    }

    const termo = semAcento(busca.trim())
    const buscando = Boolean(termo)
    const filtrados = emails
        .filter((e) => (buscando && todasPastas ? true : e.pasta === pasta))
        .filter((e) => passaFiltro[filtro](e))
        .filter((e) => !termo || semAcento(`${e.de.nome} ${e.de.email} ${e.para.join(' ')} ${e.assunto} ${textoDoEmail(e)}`).includes(termo))
        .sort((a, b) => (antigos ? a.recebido - b.recebido : b.recebido - a.recebido))
    const visiveis = filtrados.slice(0, limite)
    const atual = emails.find((e) => e.id === selecionado) || null
    const naoLidosEntrada = emails.filter((e) => e.pasta === 'entrada' && !e.lido).length
    const contagem = (p) => emails.filter((e) => e.pasta === p).length

    // ---- ações (cada uma guarda o estado anterior para o "Desfazer") ----
    const aplicar = (texto, transformar) => {
        const antes = emails
        setEmails(transformar(emails))
        setAviso({ texto, desfazer: () => setEmails(antes) })
    }
    const atualizar = (ids, campos) => setEmails((l) => l.map((e) => (ids.includes(e.id) ? { ...e, ...campos } : e)))
    const mover = (ids, destino) => {
        const n = ids.length
        const verbo = destino === 'lixeira' ? 'excluído' : 'movido'
        const rotulo = `${n > 1 ? `${n} e-mails ${verbo}s` : `E-mail ${verbo}`}${destino === 'lixeira' ? '' : ` para ${NOME_PASTA[destino]}`}`
        aplicar(rotulo, (l) => l.map((e) => (ids.includes(e.id) ? { ...e, pasta: destino, pastaOriginal: e.pasta === 'lixeira' ? e.pastaOriginal : e.pasta } : e)))
        if (ids.includes(selecionado)) aoSelecionar(null)
        setMarcados(new Set())
    }
    const excluir = (ids) => {
        const naLixeira = ids.every((id) => emails.find((e) => e.id === id)?.pasta === 'lixeira')
        if (!naLixeira) return mover(ids, 'lixeira')
        if (!confirm(`Excluir ${ids.length > 1 ? `${ids.length} e-mails` : 'este e-mail'} de vez? Não dá para recuperar.`)) return
        aplicar(`${ids.length > 1 ? `${ids.length} e-mails excluídos` : 'E-mail excluído'} de vez`, (l) => l.filter((e) => !ids.includes(e.id)))
        if (ids.includes(selecionado)) aoSelecionar(null)
        setMarcados(new Set())
    }
    const restaurar = (ids) => {
        aplicar(`${ids.length > 1 ? `${ids.length} e-mails restaurados` : 'E-mail restaurado'}`, (l) =>
            l.map((e) => (ids.includes(e.id) ? { ...e, pasta: e.pastaOriginal || 'entrada', pastaOriginal: undefined } : e)),
        )
        if (ids.includes(selecionado)) aoSelecionar(null)
        setMarcados(new Set())
    }

    const abrir = (e) => {
        if (!e.lido) atualizar([e.id], { lido: true })
        setResposta(null)
        aoSelecionar(e.id)
    }
    const alternarMarcado = (id) =>
        setMarcados((s) => {
            const n = new Set(s)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })

    // e-mail que "saiu": vai para Enviados com o HTML do editor
    const novoEnviado = ({ para, cc, assunto, html, texto, anexos }) => ({
        id: novoIdPrevia('enviado'),
        pasta: 'enviados',
        recebido: new Date().getTime(),
        de: { nome: usuario.nome || 'Você', email: usuario.email },
        para,
        cc: cc?.length ? cc : undefined,
        assunto,
        lido: true,
        html,
        texto,
        corpo: [],
        anexos: anexos?.length ? anexos : undefined,
    })
    const enviarResposta = (m) => {
        if (!atual) return
        const prefixo = resposta.modo === 'encaminhar' ? 'Enc: ' : 'Re: '
        const enviado = novoEnviado({
            ...m,
            para: resposta.modo === 'encaminhar' ? m.para : resposta.modo === 'todos' ? [atual.de.nome, ...atual.para.filter((p) => p !== (usuario.nome || ''))] : [atual.de.nome],
            assunto: prefixo + atual.assunto.replace(/^(Re|Enc):\s*/i, ''),
        })
        setEmails((l) => [enviado, ...l.map((e) => (e.id === atual.id ? { ...e, respondidoEm: enviado.recebido } : e))])
        setResposta(null)
        setAviso({ texto: resposta.modo === 'encaminhar' ? 'E-mail encaminhado' : 'Resposta enviada' })
    }

    const seMarcados = marcados.size > 0
    const idsMarcados = [...marcados]
    const naLixeira = !(buscando && todasPastas) && pasta === 'lixeira'

    // ---------- lista ----------
    const lista = (
        <>
            {topo}
            <div className="busca ms-busca">
                <label className="busca-caixa">
                    <Icone nome="busca" tamanho={18} />
                    <input
                        type="search"
                        value={busca}
                        onChange={(e) => recomecar(setBusca)(e.target.value)}
                        placeholder="Buscar e-mails (remetente, assunto, texto)"
                        aria-label="Buscar e-mails"
                    />
                    {busca ? (
                        <button type="button" className="icone-botao" aria-label="Limpar busca" onClick={() => recomecar(setBusca)('')}>
                            <Icone nome="fechar" tamanho={16} />
                        </button>
                    ) : null}
                </label>
                {buscando ? (
                    <label className="check ms-todas-pastas">
                        <input type="checkbox" checked={todasPastas} onChange={(e) => recomecar(setTodasPastas)(e.target.checked)} /> Buscar em todas as pastas
                    </label>
                ) : null}
            </div>

            {seMarcados ? (
                <div className="ms-lote" role="toolbar" aria-label="Ações nos selecionados">
                    <strong>{marcados.size} selecionado(s)</strong>
                    <button className="icone-botao" aria-label="Marcar como lido" data-dica="Marcar como lido" onClick={() => (atualizar(idsMarcados, { lido: true }), setMarcados(new Set()))}>
                        <Icone nome="checkDuplo" tamanho={18} />
                    </button>
                    <button className="icone-botao" aria-label="Marcar como não lido" data-dica="Marcar como não lido" onClick={() => (atualizar(idsMarcados, { lido: false }), setMarcados(new Set()))}>
                        <Icone nome="email" tamanho={18} />
                    </button>
                    <button className="icone-botao" aria-label="Sinalizar" data-dica="Sinalizar" onClick={() => (atualizar(idsMarcados, { sinalizado: true }), setMarcados(new Set()))}>
                        <Icone nome="bandeira" tamanho={18} />
                    </button>
                    {naLixeira || pasta === 'arquivo' ? (
                        <button className="icone-botao" aria-label="Restaurar" data-dica="Restaurar" onClick={() => restaurar(idsMarcados)}>
                            <Icone nome="tentar" tamanho={18} />
                        </button>
                    ) : (
                        <button className="icone-botao" aria-label="Arquivar" data-dica="Arquivar" onClick={() => mover(idsMarcados, 'arquivo')}>
                            <Icone nome="vazio" tamanho={18} />
                        </button>
                    )}
                    <button className="icone-botao perigo" aria-label={naLixeira ? 'Excluir de vez' : 'Excluir'} data-dica={naLixeira ? 'Excluir de vez' : 'Excluir'} onClick={() => excluir(idsMarcados)}>
                        <Icone nome="lixo" tamanho={18} />
                    </button>
                    <button className="ms-link" onClick={() => setMarcados(new Set())}>
                        Cancelar
                    </button>
                </div>
            ) : (
                <div className="ms-filtros-email">
                    <Seletor
                        className="filtro-select"
                        aria-label="Pasta"
                        valor={pasta}
                        aoMudar={recomecar(setPasta)}
                        opcoes={PASTAS.map(([v, r]) => ({ valor: v, rotulo: v === 'entrada' ? `${r}${naoLidosEntrada ? ` (${naoLidosEntrada})` : ''}` : `${r} (${contagem(v)})` }))}
                    />
                    <Seletor className="filtro-select" aria-label="Filtro" ativo={Boolean(filtro)} valor={filtro} aoMudar={recomecar(setFiltro)} opcoes={FILTROS.map(([v, r]) => ({ valor: v, rotulo: r }))} />
                    <button
                        className="icone-botao ms-ordem"
                        aria-pressed={antigos}
                        aria-label={antigos ? 'Mais antigos primeiro' : 'Mais recentes primeiro'}
                        data-dica={antigos ? 'Mais antigos primeiro' : 'Mais recentes primeiro'}
                        data-dica-lado="esquerda"
                        onClick={() => recomecar(setAntigos)(!antigos)}
                    >
                        <Icone nome="ordenar" tamanho={18} />
                    </button>
                </div>
            )}

            <div className="ms-contagem">
                <label className="check">
                    <input
                        type="checkbox"
                        aria-label="Selecionar os e-mails mostrados"
                        checked={seMarcados && visiveis.every((e) => marcados.has(e.id))}
                        disabled={!visiveis.length}
                        onChange={(e) => setMarcados(e.target.checked ? new Set(visiveis.map((x) => x.id)) : new Set())}
                    />
                </label>
                <span>
                    {buscando ? `${filtrados.length} resultado(s) para "${busca.trim()}"` : `Mostrando ${visiveis.length} de ${filtrados.length}`}
                    {buscando && todasPastas ? ' em todas as pastas' : ''}
                </span>
            </div>

            <div className={`lista ms-lista-email ${seMarcados ? 'selecionando' : ''}`} role="list">
                {visiveis.map((e, i) => {
                    // cabeçalho de data quando o grupo muda em relação ao e-mail de cima (só em "mais recentes")
                    const grupo = antigos ? null : grupoDaData(e.recebido, agora)
                    const cabecalho = grupo && (i === 0 || grupo !== grupoDaData(visiveis[i - 1].recebido, agora)) ? grupo : null
                    const meu = e.pasta === 'enviados' || e.pasta === 'rascunhos'
                    const quem = meu ? `Para: ${e.para.join(', ') || '(sem destinatário)'}` : e.de.nome
                    return (
                        <div key={e.id} className="ms-item-grupo">
                            {cabecalho ? <p className="ms-secao">{cabecalho}</p> : null}
                            <div
                                role="listitem"
                                tabIndex={0}
                                className={`item ms-item-email ${selecionado === e.id ? 'selecionado' : ''} ${!e.lido ? 'nao-lida' : ''} ${marcados.has(e.id) ? 'marcado' : ''}`}
                                onClick={() => abrir(e)}
                                onKeyDown={(ev) => ev.key === 'Enter' && abrir(e)}
                            >
                                <span className="ms-item-esq">
                                    <Avatar nome={meu ? e.para[0] || '?' : e.de.nome} tamanho={40} />
                                    <label className="ms-item-marcar" onClick={(ev) => ev.stopPropagation()}>
                                        <input type="checkbox" aria-label={`Selecionar: ${e.assunto}`} checked={marcados.has(e.id)} onChange={() => alternarMarcado(e.id)} />
                                    </label>
                                </span>
                                <div className="item-corpo">
                                    <div className="item-linha">
                                        <span className="item-nome-wrap">
                                            <span className="item-nome">{quem}</span>
                                        </span>
                                        <span className={`item-hora ${!e.lido ? 'destaque' : ''}`}>{horaNaLista(e.recebido, agora)}</span>
                                        <span className="ms-item-acoes" onClick={(ev) => ev.stopPropagation()}>
                                            <button className="icone-botao mini" aria-label={e.lido ? 'Marcar como não lido' : 'Marcar como lido'} data-dica={e.lido ? 'Marcar como não lido' : 'Marcar como lido'} onClick={() => atualizar([e.id], { lido: !e.lido })}>
                                                <Icone nome={e.lido ? 'email' : 'checkDuplo'} tamanho={16} />
                                            </button>
                                            <button className={`icone-botao mini ${e.sinalizado ? 'ms-sinal' : ''}`} aria-label={e.sinalizado ? 'Remover sinalização' : 'Sinalizar'} data-dica={e.sinalizado ? 'Remover sinalização' : 'Sinalizar'} onClick={() => atualizar([e.id], { sinalizado: !e.sinalizado })}>
                                                <Icone nome="bandeira" tamanho={16} />
                                            </button>
                                            <button className="icone-botao mini" aria-label="Excluir" data-dica={e.pasta === 'lixeira' ? 'Excluir de vez' : 'Excluir'} data-dica-lado="esquerda" onClick={() => excluir([e.id])}>
                                                <Icone nome="lixo" tamanho={16} />
                                            </button>
                                        </span>
                                    </div>
                                    <div className="item-linha ms-assunto">
                                        {e.pasta === 'rascunhos' ? <span className="ms-rascunho">[Rascunho]</span> : null}
                                        {e.importante ? <span className="ms-importante" title="Alta importância">!</span> : null}
                                        <span className="ms-assunto-txt">{e.assunto || '(sem assunto)'}</span>
                                        {e.conversa ? <span className="ms-qtd">{e.conversa}</span> : null}
                                        {buscando && todasPastas ? <span className="ms-qtd">{NOME_PASTA[e.pasta]}</span> : null}
                                    </div>
                                    <div className="item-linha">
                                        <span className="item-previa">
                                            <span className="item-previa-texto">{textoDoEmail(e)}</span>
                                        </span>
                                        {e.anexos?.length ? <Icone nome="clipe" tamanho={14} className="ms-icone-lista" /> : null}
                                        {e.convite ? <Icone nome="calendario" tamanho={14} className="ms-icone-lista" /> : null}
                                        {e.sinalizado ? <Icone nome="bandeira" tamanho={14} className="ms-icone-lista ms-sinal" /> : null}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
                {!visiveis.length ? (
                    <p className="lista-vazia">{buscando ? 'Nenhum e-mail encontrado. Tente outra palavra ou busque em todas as pastas.' : filtro ? 'Nenhum e-mail com esse filtro.' : 'Nada nesta pasta.'}</p>
                ) : null}
                {filtrados.length > visiveis.length ? (
                    <button className="ms-carregar-mais" onClick={() => setLimite((n) => n + POR_PAGINA)}>
                        Carregar mais {Math.min(POR_PAGINA, filtrados.length - visiveis.length)} <small>({filtrados.length - visiveis.length} restantes)</small>
                    </button>
                ) : null}
            </div>
            {aviso ? (
                <div className="ms-aviso" role="status">
                    <span>{aviso.texto}</span>
                    {aviso.desfazer ? (
                        <button
                            className="ms-link"
                            onClick={() => {
                                aviso.desfazer()
                                setAviso(null)
                            }}
                        >
                            Desfazer
                        </button>
                    ) : null}
                    <button className="icone-botao mini" aria-label="Fechar aviso" onClick={() => setAviso(null)}>
                        <Icone nome="fechar" tamanho={14} />
                    </button>
                </div>
            ) : null}
        </>
    )

    // ---------- área da direita ----------
    let conteudo = null
    const cabecalhoSimples = (titulo, sub) => (
        <header className="barra barra-chat">
            <button className="icone-botao so-mobile" onClick={() => aoSelecionar(null)} aria-label="Voltar para a lista">
                <Icone nome="voltar" />
            </button>
            <div className="barra-titulo">
                <strong className="ms-titulo">{titulo}</strong>
                <small>{sub}</small>
            </div>
        </header>
    )

    if (selecionado === 'novo' || atual?.pasta === 'rascunhos') {
        const rascunho = atual?.pasta === 'rascunhos' ? atual : null
        conteudo = (
            <section className="chat">
                {cabecalhoSimples(rascunho ? 'Rascunho' : 'Novo e-mail', `De: ${usuario.email}`)}
                <EditorEmail
                    key={rascunho?.id || 'novo'}
                    paraInicial={rascunho?.para.join(', ') || ''}
                    ccInicial={rascunho?.cc?.join(', ') || ''}
                    assuntoInicial={rascunho?.assunto || ''}
                    htmlInicial={rascunho ? rascunho.html || rascunho.corpo.map((p) => `<p>${p.replace(/[<>&]/g, '')}</p>`).join('') : ''}
                    anexosIniciais={rascunho?.anexos || []}
                    aoDescartar={() => (rascunho ? excluir([rascunho.id]) : aoSelecionar(null))}
                    aoSalvarRascunho={(m) => {
                        const dados = { pasta: 'rascunhos', recebido: new Date().getTime(), de: { nome: usuario.nome || 'Você', email: usuario.email }, ...m, cc: m.cc.length ? m.cc : undefined, corpo: [], lido: true }
                        setEmails((l) => (rascunho ? l.map((e) => (e.id === rascunho.id ? { ...e, ...dados } : e)) : [{ id: novoIdPrevia('rascunho'), ...dados }, ...l]))
                        setAviso({ texto: 'Rascunho salvo em Rascunhos' })
                        aoSelecionar(null)
                    }}
                    aoEnviar={(m) => {
                        const enviado = novoEnviado(m)
                        setEmails((l) => [enviado, ...l.filter((e) => e.id !== rascunho?.id)])
                        setAviso({ texto: 'E-mail enviado' })
                        recomecar(setPasta)('enviados')
                        aoSelecionar(enviado.id)
                    }}
                />
            </section>
        )
    } else if (atual) {
        const naLixeiraAtual = atual.pasta === 'lixeira'
        conteudo = (
            <section className="chat">
                <header className="barra barra-chat">
                    <button className="icone-botao so-mobile" onClick={() => aoSelecionar(null)} aria-label="Voltar para a lista">
                        <Icone nome="voltar" />
                    </button>
                    <div className="barra-titulo">
                        <strong className="ms-titulo">{atual.assunto || '(sem assunto)'}</strong>
                        <small>{NOME_PASTA[atual.pasta]}</small>
                    </div>
                    <div className="barra-acoes">
                        <button className="icone-botao" aria-label="Responder" data-dica="Responder" onClick={() => setResposta({ modo: 'responder' })}>
                            <Icone nome="responder" />
                        </button>
                        <button className="icone-botao some-estreito" aria-label="Responder a todos" data-dica="Responder a todos" onClick={() => setResposta({ modo: 'todos' })}>
                            <Icone nome="responderTodos" />
                        </button>
                        <button className="icone-botao" aria-label="Encaminhar" data-dica="Encaminhar" onClick={() => setResposta({ modo: 'encaminhar' })}>
                            <Icone nome="encaminhar" />
                        </button>
                        {naLixeiraAtual || atual.pasta === 'arquivo' ? (
                            <button className="icone-botao" aria-label="Restaurar" data-dica="Restaurar" onClick={() => restaurar([atual.id])}>
                                <Icone nome="tentar" />
                            </button>
                        ) : (
                            <button className="icone-botao" aria-label="Arquivar" data-dica="Arquivar" onClick={() => mover([atual.id], 'arquivo')}>
                                <Icone nome="vazio" />
                            </button>
                        )}
                        <button className="icone-botao" aria-label={naLixeiraAtual ? 'Excluir de vez' : 'Excluir'} data-dica={naLixeiraAtual ? 'Excluir de vez' : 'Excluir'} onClick={() => excluir([atual.id])}>
                            <Icone nome="lixo" />
                        </button>
                        <button
                            className={`icone-botao ${atual.sinalizado ? 'ativo ms-sinal' : ''}`}
                            aria-label={atual.sinalizado ? 'Remover sinalização' : 'Sinalizar'}
                            data-dica={atual.sinalizado ? 'Remover sinalização' : 'Sinalizar'}
                            onClick={() => atualizar([atual.id], { sinalizado: !atual.sinalizado })}
                        >
                            <Icone nome="bandeira" />
                        </button>
                        <Menu
                            titulo="Mais ações"
                            itens={[
                                {
                                    rotulo: 'Marcar como não lido',
                                    acao: () => {
                                        atualizar([atual.id], { lido: false })
                                        aoSelecionar(null)
                                    },
                                },
                                { rotulo: atual.importante ? 'Tirar alta importância' : 'Marcar como importante', acao: () => atualizar([atual.id], { importante: !atual.importante }) },
                                ...PASTAS.filter(([v]) => v !== atual.pasta && v !== 'rascunhos' && v !== 'lixeira').map(([v, r]) => ({ rotulo: `Mover para ${r}`, acao: () => mover([atual.id], v) })),
                            ]}
                        >
                            <Icone nome="menu" />
                        </Menu>
                    </div>
                </header>
                <article className="ms-email">
                    <div className="ms-email-cab">
                        <Avatar nome={atual.de.nome} tamanho={40} />
                        <div>
                            <strong>{atual.de.nome}</strong> <span className="ms-email-end">&lt;{atual.de.email}&gt;</span>
                            <small>Para: {atual.para.join(', ')}</small>
                            {atual.cc ? <small>Cc: {atual.cc.join(', ')}</small> : null}
                            <small>{dataCompleta(atual.recebido)}</small>
                        </div>
                    </div>
                    {atual.convite ? (
                        <div className="ms-convite">
                            <Icone nome="calendario" tamanho={22} />
                            <div className="ms-convite-txt">
                                <strong>{atual.convite.titulo}</strong>
                                <small>
                                    {atual.convite.quando} · {atual.convite.local}
                                </small>
                            </div>
                            <div className="ms-convite-acoes">
                                {[
                                    ['aceito', 'Aceitar'],
                                    ['talvez', 'Talvez'],
                                    ['recusado', 'Recusar'],
                                ].map(([v, r]) => (
                                    <button key={v} className={`chip ${atual.respostaConvite === v ? 'ativo' : ''}`} onClick={() => atualizar([atual.id], { respostaConvite: v })}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {atual.html ? (
                        // HTML já limpo (htmlSeguro.js); na integração, o corpo dos e-mails recebidos passa pelo mesmo filtro
                        <div className="ms-email-html" dangerouslySetInnerHTML={{ __html: limparHtml(atual.html) }} />
                    ) : (
                        atual.corpo.map((p, n) => <p key={n}>{p}</p>)
                    )}
                    {atual.anexos?.length ? (
                        <div className="ms-anexos">
                            {atual.anexos.map((a) => (
                                <Arquivo key={a.nome} arquivo={a} />
                            ))}
                        </div>
                    ) : null}
                    {atual.respondidoEm ? (
                        <p className="ms-respondido">
                            <Icone nome="responder" tamanho={14} /> Você respondeu em {dataCompleta(atual.respondidoEm)} (está em Itens enviados).
                        </p>
                    ) : null}
                </article>
                {resposta ? (
                    <div className="composer ms-composer">
                        <EditorEmail
                            key={resposta.modo}
                            resposta={resposta.modo !== 'encaminhar'}
                            titulo={resposta.modo === 'encaminhar' ? 'Encaminhar' : resposta.modo === 'todos' ? 'Responder a todos' : `Responder a ${atual.de.nome}`}
                            assuntoInicial={`Enc: ${atual.assunto}`}
                            anexosIniciais={resposta.modo === 'encaminhar' ? atual.anexos || [] : []}
                            aoEnviar={enviarResposta}
                            aoDescartar={() => setResposta(null)}
                        />
                    </div>
                ) : null}
            </section>
        )
    }

    return <MolduraMicrosoft {...moldura} lista={lista} conteudo={conteudo} />
}
