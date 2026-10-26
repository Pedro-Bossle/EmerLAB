import { iniciais, corAvatar, nomeExibicao, dataLista } from '../util.js'
import Icone from './Icone.jsx'

export function Avatar({ conversa, tamanho = 49 }) {
    const nome = nomeExibicao(conversa)
    return (
        <span className="avatar" style={{ width: tamanho, height: tamanho, background: corAvatar(conversa.waId), fontSize: tamanho * 0.36 }}>
            {conversa.foto ? (
                <img src={conversa.foto} alt="" referrerPolicy="no-referrer" />
            ) : conversa.nome ? (
                iniciais(nome)
            ) : (
                <Icone nome="usuario" tamanho={tamanho * 0.55} />
            )}
        </span>
    )
}

export default function ListaConversas({ conversas, carregando, erro, selecionada, deptoPorId, usuarioEmail, equipe, aoAbrir }) {
    const nomeAtendente = (email) => (email === usuarioEmail ? 'Você' : equipe.find((u) => u.email === email)?.nome?.split(' ')[0] || email?.split('@')[0])

    if (carregando) {
        return (
            <div className="lista">
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
            {erro ? <div className="alerta alerta-erro lista-alerta">{erro}</div> : null}
            {!erro && conversas.length === 0 ? <p className="lista-vazia">Nenhuma conversa por aqui.</p> : null}
            {conversas.map((c) => {
                const depto = c.departamentoId ? deptoPorId[c.departamentoId] : null
                return (
                    <button key={c.waId} role="listitem" className={`item ${selecionada === c.waId ? 'selecionado' : ''}`} onClick={() => aoAbrir(c)}>
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
                                    {c.ultimaMsg || (c.nome ? '' : 'Toque para abrir')}
                                </span>
                                {c.naoLidas ? <span className="badge">{c.naoLidas > 99 ? '99+' : c.naoLidas}</span> : null}
                            </div>
                            {depto || c.atendenteEmail ? (
                                <div className="item-tags">
                                    {depto ? (
                                        <span className="tag" style={{ '--tag': depto.cor }}>
                                            {depto.nome}
                                        </span>
                                    ) : null}
                                    {c.atendenteEmail ? <span className="tag tag-neutra">👤 {nomeAtendente(c.atendenteEmail)}</span> : null}
                                </div>
                            ) : null}
                        </div>
                    </button>
                )
            })}
        </div>
    )
}
