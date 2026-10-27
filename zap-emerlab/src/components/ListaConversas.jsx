import { iniciais, corAvatar, nomeExibicao, dataLista, canalDoId } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'

/** Pills discretas de Tipo e Cidade (atributos WATI) ao lado do nome. */
// "Tráfego": a conversa entrou por anúncio Click-to-WhatsApp (anuncio = messageReferral guardado pelo servidor)
function dicaAnuncio(a) {
    const quando = a.em ? new Date(a.em).toLocaleDateString('pt-BR') : ''
    return ['Entrou por anúncio' + (quando ? ` em ${quando}` : ''), a.titulo, a.url].filter(Boolean).join('\n')
}

export function ContatoMetaPills({ tipo, cidade, anuncio }) {
    const t = String(tipo || '').trim()
    const c = String(cidade || '').trim()
    if (!t && !c && !anuncio) return null
    return (
        <span className="meta-pills">
            {anuncio ? (
                <span className="tag tag-meta tag-trafego" title={dicaAnuncio(anuncio)}>
                    Tráfego
                </span>
            ) : null}
            {t ? (
                <span className="tag tag-neutra tag-meta" title={`Tipo: ${t}`}>
                    {t}
                </span>
            ) : null}
            {c ? (
                <span className="tag tag-neutra tag-meta" title={`Cidade: ${c}`}>
                    {c}
                </span>
            ) : null}
        </span>
    )
}

export function Avatar({ conversa, tamanho = 49 }) {
    const canal = canalDoId(conversa.waId)
    return (
        <span className="avatar" style={{ width: tamanho, height: tamanho, '--av': corAvatar(conversa.waId), fontSize: tamanho * 0.36 }}>
            {conversa.foto ? (
                <img src={conversa.foto} alt="" referrerPolicy="no-referrer" />
            ) : conversa.nome ? (
                iniciais(conversa.nome)
            ) : canal === 'whatsapp' ? (
                <Icone nome="usuario" tamanho={tamanho * 0.5} />
            ) : (
                <IconeCanal canal={canal} tamanho={tamanho * 0.46} />
            )}
        </span>
    )
}

export default function ListaConversas({ conversas, carregando, erro, textoVazio, selecionada, deptoPorId, usuarioEmail, equipe, aoAbrir, aoTentar, aoMenu }) {
    const nomeAtendente = (email) => (email === usuarioEmail ? 'Você' : equipe.find((u) => u.email === email)?.nome?.split(' ')[0] || email?.split('@')[0])

    if (carregando) {
        return (
            <div className="lista" aria-busy="true" aria-label="Carregando conversas">
                {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="item esqueleto">
                        <span className="avatar" />
                        <div className="item-corpo">
                            <span className="barra-esq" />
                            <span className="barra-esq curta" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="lista" role="list">
            {erro ? (
                <div className="estado-erro" role="alert">
                    <Icone nome="erro" tamanho={28} />
                    <p>{erro}</p>
                    <button className="botao botao-pequeno botao-secundario" onClick={aoTentar}>
                        <Icone nome="tentar" tamanho={16} /> Tentar de novo
                    </button>
                </div>
            ) : null}
            {!erro && conversas.length === 0 ? (
                <div className="estado-vazio">
                    <Icone nome="vazio" tamanho={32} traco={1.5} />
                    <p>{textoVazio}</p>
                </div>
            ) : null}
            {conversas.map((c) => {
                const depto = c.departamentoId ? deptoPorId[c.departamentoId] : null
                return (
                    <button
                        key={c.waId}
                        role="listitem"
                        className={`item ${selecionada === c.waId ? 'selecionado' : ''} ${c.naoLidas ? 'nao-lida' : ''} ${!c.atendenteEmail && c.status !== 'resolvida' ? 'na-fila' : ''}`}
                        // a prévia corta em uma linha: o tooltip nativo mostra a última mensagem inteira
                        title={c.ultimaMsg || undefined}
                        onClick={() => aoAbrir(c)}
                        onContextMenu={(e) => {
                            if (!aoMenu) return
                            e.preventDefault()
                            // pela tecla Menu ou Shift+F10 o evento vem sem coordenadas: abre junto do card
                            const r = e.currentTarget.getBoundingClientRect()
                            const peloTeclado = e.clientX === 0 && e.clientY === 0
                            aoMenu(c, peloTeclado ? { x: r.left + 24, y: r.top + r.height / 2 } : { x: e.clientX, y: e.clientY })
                        }}
                    >
                        <Avatar conversa={c} />
                        <div className="item-corpo">
                            <div className="item-linha">
                                <span className="item-nome-wrap">
                                    <span className="item-nome">{nomeExibicao(c)}</span>
                                    <ContatoMetaPills tipo={c.atributos?.tipo} cidade={c.atributos?.cidade} anuncio={c.anuncio} />
                                </span>
                                <span className={`item-hora ${c.naoLidas ? 'destaque' : ''}`}>{dataLista(c.ultimaEm)}</span>
                            </div>
                            <div className="item-linha">
                                <span className="item-previa">
                                    {c.ultimaMinha ? <Icone nome="checkDuplo" tamanho={16} className="previa-check" /> : null}
                                    {c.status === 'resolvida' ? <em className="previa-status">Resolvida · </em> : null}
                                    {c.status === 'pendente' ? <em className="previa-status pendente">Pendente · </em> : null}
                                    <span className="item-previa-texto">{c.ultimaMsg || (c.nome ? '' : 'Toque para abrir')}</span>
                                </span>
                                {c.naoLidas ? (
                                    <span className="badge" aria-label={`${c.naoLidas} não lidas`}>
                                        {c.naoLidas > 99 ? '99+' : c.naoLidas}
                                    </span>
                                ) : null}
                            </div>
                            {depto || c.atendenteEmail || c.tags?.length || c.status !== 'resolvida' ? (
                                <div className="item-tags">
                                    {depto ? (
                                        <span className="tag" style={{ '--tag': depto.cor }}>
                                            {depto.nome}
                                        </span>
                                    ) : null}
                                    {c.atendenteEmail ? (
                                        <span className="item-atendente">
                                            <Icone nome="usuario" tamanho={12} traco={2.25} /> {nomeAtendente(c.atendenteEmail)}
                                        </span>
                                    ) : c.status !== 'resolvida' ? (
                                        <span className="item-atendente">
                                            <Icone nome="pendente" tamanho={12} traco={2.25} /> Na fila
                                        </span>
                                    ) : null}
                                    {(c.tags || []).slice(0, 2).map((t) => (
                                        <span key={t} className="tag tag-neutra tag-etiqueta">
                                            {t}
                                        </span>
                                    ))}
                                    {c.tags?.length > 2 ? <span className="tag tag-neutra tag-etiqueta">+{c.tags.length - 2}</span> : null}
                                </div>
                            ) : null}
                        </div>
                    </button>
                )
            })}
        </div>
    )
}
