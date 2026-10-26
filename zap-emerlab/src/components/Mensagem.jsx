import { urlMidia } from '../api.js'
import { formatarWhatsapp, horaCurta } from '../util.js'
import Icone from './Icone.jsx'

function TextoFormatado({ texto }) {
    if (!texto) return null
    return (
        <span className="msg-texto">
            {formatarWhatsapp(String(texto)).map((t, i) => {
                if (t.t === 'b') return <strong key={i}>{t.v}</strong>
                if (t.t === 'i') return <em key={i}>{t.v}</em>
                if (t.t === 's') return <s key={i}>{t.v}</s>
                if (t.t === 'mono') return <code key={i}>{t.v}</code>
                if (t.t === 'link')
                    return (
                        <a key={i} href={t.v} target="_blank" rel="noopener noreferrer">
                            {t.v}
                        </a>
                    )
                return <span key={i}>{t.v}</span>
            })}
        </span>
    )
}

function Status({ status }) {
    if (status === 'pendente') return <Icone nome="relogio" tamanho={15} className="msg-tick" titulo="Enviando" />
    if (status === 'failed' || status === 'erro') return <Icone nome="erro" tamanho={15} className="msg-tick falhou" titulo="Falhou" />
    if (status === 'read') return <Icone nome="checkDuplo" tamanho={16} className="msg-tick lido" titulo="Lida" />
    if (status === 'delivered' || status === 'replied') return <Icone nome="checkDuplo" tamanho={16} className="msg-tick" titulo="Entregue" />
    return <Icone nome="check" tamanho={15} className="msg-tick" titulo="Enviada" />
}

function Midia({ m, waId }) {
    if (!m.arquivo) return m.tipo !== 'text' ? <span className="msg-midia-ausente">[{m.tipo}]</span> : null
    const src = urlMidia(m.arquivo, waId)
    const nomeArquivo = m.arquivo.split('/').pop()
    if (m.tipo === 'image' || m.tipo === 'sticker')
        return (
            <a href={src} target="_blank" rel="noopener noreferrer" className={`msg-imagem ${m.tipo === 'sticker' ? 'sticker' : ''}`}>
                <img src={src} alt="Imagem" loading="lazy" />
            </a>
        )
    if (m.tipo === 'video') return <video className="msg-video" src={src} controls preload="metadata" />
    if (m.tipo === 'audio' || m.tipo === 'voice') return <audio className="msg-audio" src={src} controls preload="none" />
    return (
        <a className="msg-doc" href={src} target="_blank" rel="noopener noreferrer" download={nomeArquivo}>
            <Icone nome="documento" tamanho={30} />
            <span>{nomeArquivo}</span>
        </a>
    )
}

export default function Mensagem({ m, waId, aoResponder, primeiraDoGrupo }) {
    // eventos do ticket (atribuições, status…) aparecem como aviso central
    if (m.evento !== 'message' && m.evento !== 'broadcastMessage') {
        const txt = m.descricao || m.texto
        if (!txt) return null
        return (
            <div className="msg-sistema">
                <span>{txt}</span>
            </div>
        )
    }

    const temMidia = m.tipo !== 'text' && m.tipo !== 'interactive' && m.tipo !== 'button'
    // em mídia o texto costuma ser a legenda; evita repetir o caminho do arquivo
    const texto = temMidia && m.texto === m.arquivo ? '' : m.texto

    return (
        <div className={`msg-linha ${m.minha ? 'minha' : 'dele'} ${primeiraDoGrupo ? 'com-cauda' : ''}`}>
            <div className={`msg ${temMidia && m.tipo === 'sticker' ? 'msg-sem-fundo' : ''}`}>
                {m.minha && m.operador && primeiraDoGrupo ? <span className="msg-autor">{m.operador}</span> : null}
                {m.evento === 'broadcastMessage' ? <span className="msg-autor">📄 Template</span> : null}
                {temMidia ? <Midia m={m} waId={waId} /> : null}
                <TextoFormatado texto={texto} />
                <span className="msg-meta">
                    {horaCurta(m.em)}
                    {m.minha ? <Status status={m.status} /> : null}
                </span>
                {m.wamid && aoResponder ? (
                    <button className="msg-acao" title="Responder" onClick={() => aoResponder(m)}>
                        <Icone nome="responder" tamanho={16} />
                    </button>
                ) : null}
            </div>
        </div>
    )
}
