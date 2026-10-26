import { iniciais, corAvatar, nomeExibicao, dataLista, canalDoId } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'

export function Avatar({ conversa, tamanho = 49 }) {
    const canal = canalDoId(conversa.waId)
    return (
        <span className="avatar" style={{ width: tamanho, height: tamanho, background: corAvatar(conversa.waId), fontSize: tamanho * 0.36 }}>
            {conversa.foto ? (
                <img src={conversa.foto} alt="" referrerPolicy="no-referrer" />
            ) : conversa.nome ? (
                iniciais(conversa.nome)
            ) : canal === 'whatsapp' ? (
                <Icone nome="usuario" tamanho={tamanho * 0.5} />
            ) : (
                <IconeCanal canal={canal} tamanho={tamanho * 0.46} cor="#fff" />
            )}
        </span>
    )
}

export default function ListaConversas({ conversas, carregando, erro, textoVazio, selecionada, deptoPorId, usuarioEmail, equipe, aoAbrir, aoTentar }) {
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
                    <button key={c.waId} role="listitem" className={`item ${selecionada === c.waId ? 'selecionado' : ''} ${c.naoLidas ? 'nao-lida' : ''}`} onClick={() => aoAbrir(c)}>
                        <Avatar conversa={c} />
                        <div className="item-corpo">
                            <div className="item-linha">
                                <span className="item-nome">{nomeExibicao(c)}</span>
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
                            {depto || c.atendenteEmail ? (
                                <div className="item-tags">
                                    {depto ? (
                                        <span className="tag" style={{ '--tag': depto.cor }}>
                                            {depto.nome}
                                        </span>
                                    ) : null}
                                    {c.atendenteEmail ? (
                                        <span className="tag tag-neutra">
                                            <Icone nome="usuario" tamanho={11} traco={2.5} /> {nomeAtendente(c.atendenteEmail)}
                                        </span>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </button>
                )
            })}
        </div>
    )
}
