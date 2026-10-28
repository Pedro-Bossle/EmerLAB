import { useEffect, useRef, useState } from 'react'
import Icone from './Icone.jsx'
import { limparHtml } from '../htmlSeguro.js'

// Editor de e-mail da prévia do Outlook: campos Para/Cc/Assunto (no "Novo e-mail") e corpo com formatação básica.
// Gera HTML limpo (htmlSeguro.js), o mesmo formato que o Graph recebe em sendMail com contentType "HTML".
// `resposta`: só o corpo, com o destinatário mostrado em cima (responder, responder a todos, encaminhar).
// Anexos: na integração vão como fileAttachment (até 3 MB direto; acima disso, por sessão de upload do Graph).
// Rascunho: `aoSalvarRascunho` (POST /me/messages) e `htmlInicial`/`ccInicial` para reabrir um rascunho salvo.

const MAX_ANEXO_MB = 25

function tamanhoLegivel(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const FORMATOS = [
    ['bold', 'Negrito (Ctrl+B)', <strong key="b">B</strong>],
    ['italic', 'Itálico (Ctrl+I)', <em key="i">I</em>],
    ['underline', 'Sublinhado (Ctrl+U)', <u key="u">U</u>],
    ['insertUnorderedList', 'Lista com marcadores', '•≡'],
    ['insertOrderedList', 'Lista numerada', '1.'],
]

export default function EditorEmail({ titulo, resposta = false, paraInicial = '', ccInicial = '', assuntoInicial = '', htmlInicial = '', anexosIniciais = [], aoEnviar, aoDescartar, aoSalvarRascunho }) {
    const [para, setPara] = useState(paraInicial)
    const [cc, setCc] = useState(ccInicial)
    const [mostrarCc, setMostrarCc] = useState(Boolean(ccInicial))
    const [assunto, setAssunto] = useState(assuntoInicial)
    const [vazio, setVazio] = useState(!htmlInicial)
    const [anexos, setAnexos] = useState(anexosIniciais)
    const [avisoAnexo, setAvisoAnexo] = useState('')
    const corpo = useRef(null)
    const arquivos = useRef(null)

    // rascunho reaberto: o texto salvo volta para o editor (HTML já limpo)
    useEffect(() => {
        if (htmlInicial && corpo.current) corpo.current.innerHTML = limparHtml(htmlInicial)
    }, [htmlInicial])

    // na resposta o cursor já começa no texto
    useEffect(() => {
        if (resposta) corpo.current?.focus()
    }, [resposta])

    // execCommand ainda é o caminho simples para formatar um contentEditable sem biblioteca
    const formatar = (comando, valor) => {
        corpo.current?.focus()
        document.execCommand(comando, false, valor)
        setVazio(!corpo.current?.innerText.trim())
    }
    const inserirLink = () => {
        const url = window.prompt('Endereço do link (https://… ou mailto:…)', 'https://')
        if (!url) return
        if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) return window.alert('Use um endereço começando com https:// ou mailto:')
        formatar('createLink', url.trim())
    }

    const anexar = (lista) => {
        const grandes = [...lista].filter((f) => f.size > MAX_ANEXO_MB * 1024 * 1024).map((f) => f.name)
        setAvisoAnexo(grandes.length ? `Acima de ${MAX_ANEXO_MB} MB, não anexado: ${grandes.join(', ')}` : '')
        const novos = [...lista].filter((f) => f.size <= MAX_ANEXO_MB * 1024 * 1024).map((f) => ({ nome: f.name, tamanho: tamanhoLegivel(f.size) }))
        setAnexos((a) => [...a, ...novos.filter((n) => !a.some((x) => x.nome === n.nome))])
    }

    const mensagem = () => ({
        para: para.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        cc: cc.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        assunto: assunto.trim(),
        html: limparHtml(corpo.current?.innerHTML || ''),
        texto: corpo.current?.innerText.trim() || '',
        anexos,
    })
    const podeEnviar = !vazio && (resposta || (para.trim() && assunto.trim()))
    const enviar = (e) => {
        e.preventDefault()
        if (!podeEnviar) return
        aoEnviar(mensagem())
    }

    return (
        <form className={`ms-editor ${resposta ? 'ms-editor-resposta' : ''}`} onSubmit={enviar}>
            {titulo ? <strong className="ms-editor-titulo">{titulo}</strong> : null}
            {!resposta ? (
                <div className="ms-editor-campos">
                    <label>
                        <span>Para</span>
                        <input value={para} onChange={(e) => setPara(e.target.value)} placeholder="nome@emerdog.com.br" autoFocus />
                        {!mostrarCc ? (
                            <button type="button" className="ms-link" onClick={() => setMostrarCc(true)}>
                                Cc
                            </button>
                        ) : null}
                    </label>
                    {mostrarCc ? (
                        <label>
                            <span>Cc</span>
                            <input value={cc} onChange={(e) => setCc(e.target.value)} />
                        </label>
                    ) : null}
                    <label>
                        <span>Assunto</span>
                        <input value={assunto} onChange={(e) => setAssunto(e.target.value)} />
                    </label>
                </div>
            ) : null}
            <div className="ms-editor-barra" role="toolbar" aria-label="Formatação">
                {FORMATOS.map(([cmd, rotulo, icone]) => (
                    // mousedown sem foco: a seleção do texto não se perde ao clicar no botão
                    <button key={cmd} type="button" aria-label={rotulo} data-dica={rotulo} onMouseDown={(e) => e.preventDefault()} onClick={() => formatar(cmd)}>
                        {icone}
                    </button>
                ))}
                <button type="button" aria-label="Inserir link" data-dica="Inserir link" onMouseDown={(e) => e.preventDefault()} onClick={inserirLink}>
                    🔗
                </button>
                <span className="ms-editor-sep" />
                <button type="button" aria-label="Anexar arquivo" data-dica={`Anexar arquivo (até ${MAX_ANEXO_MB} MB)`} onClick={() => arquivos.current?.click()}>
                    <Icone nome="clipe" tamanho={16} />
                </button>
                <input
                    ref={arquivos}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                        anexar(e.target.files)
                        e.target.value = ''
                    }}
                />
            </div>
            {anexos.length || avisoAnexo ? (
                <div className="ms-editor-anexos">
                    {anexos.map((a) => (
                        <span key={a.nome} className="ms-editor-anexo">
                            <Icone nome="clipe" tamanho={13} />
                            <span>{a.nome}</span>
                            <small>{a.tamanho}</small>
                            <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => setAnexos((l) => l.filter((x) => x.nome !== a.nome))}>
                                <Icone nome="fechar" tamanho={12} />
                            </button>
                        </span>
                    ))}
                    {avisoAnexo ? <small className="ms-erro">{avisoAnexo}</small> : null}
                </div>
            ) : null}
            <div
                ref={corpo}
                className="ms-editor-corpo entrada"
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label="Texto do e-mail"
                data-vazio={vazio ? 'Escreva sua mensagem' : undefined}
                onInput={() => setVazio(!corpo.current?.innerText.trim())}
                suppressContentEditableWarning
            />
            <div className="ms-acoes">
                <button className="botao botao-pequeno" type="submit" disabled={!podeEnviar}>
                    <Icone nome="enviar" tamanho={16} /> Enviar
                </button>
                {aoSalvarRascunho ? (
                    <button className="botao botao-secundario botao-pequeno" type="button" onClick={() => aoSalvarRascunho(mensagem())}>
                        Salvar rascunho
                    </button>
                ) : null}
                <button className="botao botao-secundario botao-pequeno" type="button" onClick={aoDescartar}>
                    Descartar
                </button>
                <small>Prévia: não sai e-mail de verdade.</small>
            </div>
        </form>
    )
}
