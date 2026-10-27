import { useState } from 'react'
import { urlMidia } from '../api.js'
import { formatarWhatsapp, horaCurta, pareceEventoSistemaWati, traduzirEventoSistema } from '../util.js'
import Icone from './Icone.jsx'
import MenuContexto from './MenuContexto.jsx'

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

const STATUS = {
    pendente: { icone: 'relogio', rotulo: 'Enviando…' },
    erro: { icone: 'erro', rotulo: 'Não enviada', classe: 'falhou' },
    failed: { icone: 'erro', rotulo: 'Não entregue', classe: 'falhou' },
    read: { icone: 'checkDuplo', rotulo: 'Lida', classe: 'lido' },
    delivered: { icone: 'checkDuplo', rotulo: 'Entregue' },
    replied: { icone: 'checkDuplo', rotulo: 'Respondida', classe: 'lido' },
}

function Status({ status }) {
    const s = STATUS[status] || { icone: 'check', rotulo: 'Enviada' }
    return (
        <span className={`msg-tick ${s.classe || ''}`} data-dica={s.rotulo} aria-label={s.rotulo} role="img">
            <Icone nome={s.icone} tamanho={15} traco={2.25} />
        </span>
    )
}

// A WATI guarda os arquivos com nome aleatório (UUID). Sem o nome original, mostra e baixa com um nome legível:
// "Documento 27-10-2026 09h22.pdf"
const ROTULO_ARQUIVO = { image: 'Imagem', sticker: 'Figurinha', video: 'Vídeo', audio: 'Áudio', voice: 'Áudio', document: 'Documento' }
export function nomeDoArquivo(m) {
    if (m.nomeArquivo) return m.nomeArquivo
    const ext = String(m.arquivo || '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
    const d = m.em ? new Date(m.em) : null
    const quando = d && !Number.isNaN(d.getTime())
        ? ` ${d.toLocaleDateString('pt-BR').replace(/\//g, '-')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`
        : ''
    return `${ROTULO_ARQUIVO[m.tipo] || 'Arquivo'}${quando}${ext ? `.${ext}` : ''}`
}

function Midia({ m, waId }) {
    const [quebrou, setQuebrou] = useState(false)
    if (!m.arquivo || quebrou) {
        if (m.tipo === 'text') return null
        return (
            <span className="msg-midia-ausente">
                <Icone nome="info" tamanho={16} /> {quebrou ? 'Mídia indisponível (pode ter expirado na WATI).' : `Mensagem do tipo "${m.tipo}" sem prévia.`}
            </span>
        )
    }
    const nomeArquivo = nomeDoArquivo(m)
    const src = urlMidia(m.arquivo, waId, nomeArquivo)
    if (m.tipo === 'image' || m.tipo === 'sticker')
        return (
            <a href={src} target="_blank" rel="noopener noreferrer" className={`msg-imagem ${m.tipo === 'sticker' ? 'sticker' : ''}`}>
                <img src={src} alt={nomeArquivo} loading="lazy" onError={() => setQuebrou(true)} />
            </a>
        )
    if (m.tipo === 'video') return <video className="msg-video" src={src} controls preload="metadata" onError={() => setQuebrou(true)} />
    if (m.tipo === 'audio' || m.tipo === 'voice') return <audio className="msg-audio" src={src} controls preload="none" onError={() => setQuebrou(true)} />
    return (
        <a className="msg-doc" href={src} target="_blank" rel="noopener noreferrer" download={nomeArquivo}>
            <span className="msg-doc-icone">
                <Icone nome="documento" tamanho={22} />
            </span>
            <span className="msg-doc-nome" title={nomeArquivo}>
                {nomeArquivo}
            </span>
            <Icone nome="baixar" tamanho={18} />
        </a>
    )
}

// Explicação + ações abaixo de uma mensagem que não saiu
function Falha({ m, aoTentar, aoDescartar, aoTemplate }) {
    const local = m.status === 'erro'
    const texto = local
        ? m.erro?.mensagem || 'Não foi possível enviar.'
        : m.falha || 'Não entregue ao cliente (conta bloqueada, contato inválido ou janela de 24h fechada).'
    return (
        <div className="msg-falha" role="alert">
            <p className="msg-falha-texto">
                <Icone nome="erro" tamanho={16} />
                <span>{texto}</span>
            </p>
            {local ? (
                <span className="msg-falha-acoes">
                    {m.erro?.codigo === 'janela_24h' ? (
                        <button type="button" onClick={aoTemplate}>
                            Enviar template
                        </button>
                    ) : (
                        <button type="button" onClick={() => aoTentar(m)}>
                            <Icone nome="tentar" tamanho={14} /> Tentar de novo
                        </button>
                    )}
                    <button type="button" onClick={() => aoDescartar(m)}>
                        Descartar
                    </button>
                </span>
            ) : temTemplatesHint(texto) ? (
                <span className="msg-falha-acoes">
                    <button type="button" onClick={aoTemplate}>
                        Enviar template
                    </button>
                </span>
            ) : null}
        </div>
    )
}

function temTemplatesHint(texto) {
    const t = String(texto || '').toLowerCase()
    return t.includes('24') || t.includes('locked') || t.includes('bloque') || t.includes('janela')
}

export default function Mensagem({ m, waId, aoResponder, primeiraDoGrupo, aoTentar, aoDescartar, aoTemplate }) {
    const [menu, setMenu] = useState(null) // { x, y } do botão direito no balão
    const brutoSistema = m.descricao || m.texto
    // eventos do ticket (atribuições, status…) — e frases da WATI em inglês que às vezes vêm como message
    const ehSistema =
        (m.evento !== 'message' && m.evento !== 'broadcastMessage') || pareceEventoSistemaWati(brutoSistema)
    if (ehSistema) {
        const txt = traduzirEventoSistema(brutoSistema)
        if (!txt) return null
        return (
            <div className="msg-sistema">
                <span>{txt}</span>
            </div>
        )
    }

    const temMidia = m.tipo !== 'text' && m.tipo !== 'interactive' && m.tipo !== 'button'
    // em mídia o texto costuma ser a legenda; evita repetir o caminho ou o nome do arquivo
    const texto = temMidia && (m.texto === m.arquivo || (m.nomeArquivo && m.texto?.trim() === m.nomeArquivo)) ? '' : m.texto
    const falhou = m.minha && (m.status === 'erro' || m.status === 'failed')
    const podeResponder = Boolean(m.wamid && aoResponder)
    // WATI grava "API Token <tenant>" quando o envio foi pela API — não mostrar como autor
    const autorVisivel = m.operador && !/^api\s*token\b/i.test(String(m.operador).trim()) ? m.operador : null

    // botão direito no balão, como no WhatsApp; com texto selecionado fica o menu do navegador (para copiar o trecho)
    const abrirMenu = (e) => {
        if (window.getSelection?.().toString()) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
    }
    const itensMenu = [
        {
            rotulo: podeResponder ? 'Responder' : !m.wamid ? 'Responder (mensagem ainda sem ID do WhatsApp)' : 'Responder (janela de 24h fechada)',
            acao: () => aoResponder(m),
            desabilitado: !podeResponder,
        },
        texto ? { rotulo: 'Copiar texto', acao: () => navigator.clipboard?.writeText(String(texto)).catch(() => {}) } : null,
        temMidia && m.arquivo ? { rotulo: 'Abrir arquivo', acao: () => window.open(urlMidia(m.arquivo, waId, nomeDoArquivo(m)), '_blank', 'noopener') } : null,
    ]

    return (
        <div className={`msg-linha ${m.minha ? 'minha' : 'dele'} ${primeiraDoGrupo ? 'com-cauda' : ''}`}>
            <div className="msg-coluna">
                <div
                    onContextMenu={abrirMenu}
                    className={`msg ${temMidia && m.tipo === 'sticker' ? 'msg-sem-fundo' : ''} ${falhou ? 'msg-com-falha' : ''} ${m.evento === 'broadcastMessage' ? 'msg-template' : ''}`}
                >
                    {m.minha && autorVisivel && primeiraDoGrupo && m.evento !== 'broadcastMessage' && m.tipo !== 'template' ? (
                        <span className="msg-autor">{autorVisivel}</span>
                    ) : null}
                    {m.evento === 'broadcastMessage' || m.tipo === 'template' || /^templateMessage/i.test(m.evento || '') ? (
                        <span className="msg-autor msg-autor-template">
                            <Icone nome="template" tamanho={13} /> Template
                            {autorVisivel ? ` · ${autorVisivel}` : ''}
                        </span>
                    ) : null}
                    {temMidia ? <Midia m={m} waId={waId} /> : null}
                    <TextoFormatado texto={texto} />
                    <span className="msg-meta">
                        {horaCurta(m.em)}
                        {m.minha ? <Status status={m.status} /> : null}
                    </span>
                </div>
                {falhou ? <Falha m={m} aoTentar={aoTentar} aoDescartar={aoDescartar} aoTemplate={aoTemplate} /> : null}
            </div>
            {/* ao lado do balão, como no WhatsApp: à direita das mensagens do cliente, à esquerda das nossas */}
            {podeResponder ? (
                <button className="msg-acao" aria-label="Responder esta mensagem" data-dica="Responder" onClick={() => aoResponder(m)}>
                    <Icone nome="responder" tamanho={16} />
                </button>
            ) : null}
            {menu ? <MenuContexto x={menu.x} y={menu.y} titulo="Mensagem" itens={itensMenu} aoFechar={() => setMenu(null)} /> : null}
        </div>
    )
}
