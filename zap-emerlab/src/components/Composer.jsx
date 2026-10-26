import { useEffect, useMemo, useRef, useState } from 'react'
import { arquivoParaBase64 } from '../api.js'
import Icone from './Icone.jsx'
import Modal from './Modal.jsx'

const EMOJIS = '😀 😃 😄 😁 😅 😂 🙂 😉 😊 😍 😘 😎 🤔 🤗 🙏 👍 👎 👏 🙌 💪 👋 🤝 ✅ ❌ ⚠️ ❤️ 💚 💙 🔥 🎉 ⭐ 📌 📎 📄 📅 ⏰ 📞 💬 🐶 🐱 🐾 🩺 💊 🏥 🚗 📍 💰 🧾'.split(' ')
const MAX_MB = 3

function preencher(texto, ctx) {
    return texto.replace(/\{\{\s*(nome|primeiro_nome|atendente|telefone)\s*\}\}/gi, (_, k) => {
        const c = k.toLowerCase()
        if (c === 'primeiro_nome') return (ctx.nome || '').split(' ')[0]
        return ctx[c] ?? ''
    })
}

export default function Composer({ desabilitado, prefs, respostas, respondendo, aoCancelarResposta, aoEnviarTexto, aoEnviarArquivo, aoAbrirTemplate, contexto }) {
    const [texto, setTexto] = useState('')
    const [indice, setIndice] = useState(0)
    const [painel, setPainel] = useState(null) // 'emoji' | 'respostas'
    const [arquivo, setArquivo] = useState(null)
    const [legenda, setLegenda] = useState('')
    const [enviandoArquivo, setEnviandoArquivo] = useState(false)
    const campo = useRef(null)
    const inputArquivo = useRef(null)

    // "/atalho" no início abre as respostas rápidas, como no WhatsApp Business
    const termoAtalho = texto.startsWith('/') && !texto.includes('\n') ? texto.slice(1).toLowerCase() : null
    const sugestoes = useMemo(() => {
        if (termoAtalho === null) return []
        return respostas
            .filter((r) => r.atalho.includes(termoAtalho) || (r.titulo || '').toLowerCase().includes(termoAtalho) || r.texto.toLowerCase().includes(termoAtalho))
            .slice(0, 8)
    }, [termoAtalho, respostas])

    useEffect(() => setIndice(0), [termoAtalho])

    useEffect(() => {
        const el = campo.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`
    }, [texto])

    useEffect(() => {
        if (respondendo) campo.current?.focus()
    }, [respondendo])

    const usarResposta = (r) => {
        setTexto(preencher(r.texto, contexto))
        setPainel(null)
        requestAnimationFrame(() => campo.current?.focus())
    }

    const enviar = () => {
        const t = texto.trim()
        if (!t || desabilitado) return
        aoEnviarTexto(t)
        setTexto('')
        setPainel(null)
    }

    const aoTeclar = (e) => {
        if (sugestoes.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                return setIndice((i) => (i + 1) % sugestoes.length)
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                return setIndice((i) => (i - 1 + sugestoes.length) % sugestoes.length)
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                return usarResposta(sugestoes[indice])
            }
            if (e.key === 'Escape') return setTexto('')
        }
        if (e.key === 'Enter' && !e.shiftKey && (prefs.enterEnvia || e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            enviar()
        }
    }

    const escolherArquivo = (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        if (f.size > MAX_MB * 1024 * 1024) {
            alert(`Arquivo acima de ${MAX_MB} MB.`)
            return
        }
        setArquivo({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })
        setLegenda('')
    }

    const confirmarArquivo = async () => {
        setEnviandoArquivo(true)
        try {
            const base64 = await arquivoParaBase64(arquivo.file)
            await aoEnviarArquivo({ nome: arquivo.file.name, mime: arquivo.file.type, base64, legenda: legenda.trim() || undefined })
        } finally {
            if (arquivo.url) URL.revokeObjectURL(arquivo.url)
            setArquivo(null)
            setEnviandoArquivo(false)
        }
    }

    if (desabilitado) {
        return (
            <footer className="composer composer-bloqueado">
                <button className="botao botao-secundario" onClick={aoAbrirTemplate}>
                    <Icone nome="template" tamanho={18} /> Enviar template para reabrir a conversa
                </button>
            </footer>
        )
    }

    return (
        <footer className="composer">
            {sugestoes.length ? (
                <ul className="sugestoes" role="listbox">
                    {sugestoes.map((r, i) => (
                        <li key={r.id} role="option" aria-selected={i === indice}>
                            <button className={i === indice ? 'ativo' : ''} onMouseEnter={() => setIndice(i)} onClick={() => usarResposta(r)}>
                                <strong>/{r.atalho}</strong>
                                {r.titulo ? <span className="sug-titulo">{r.titulo}</span> : null}
                                <span className="sug-texto">{r.texto}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}

            {painel === 'emoji' ? (
                <div className="painel-emoji">
                    {EMOJIS.map((em) => (
                        <button
                            key={em}
                            onClick={() => {
                                setTexto((t) => t + em)
                                campo.current?.focus()
                            }}
                        >
                            {em}
                        </button>
                    ))}
                </div>
            ) : null}

            {painel === 'respostas' ? (
                <div className="painel-respostas">
                    <div className="painel-respostas-topo">
                        <strong>Respostas rápidas</strong>
                        <small>Dica: digite <code>/</code> no campo para buscar</small>
                    </div>
                    {respostas.length === 0 ? <p className="lista-vazia">Nenhuma resposta cadastrada. Um administrador pode criar em Administração.</p> : null}
                    {respostas.map((r) => (
                        <button key={r.id} className="resposta-item" onClick={() => usarResposta(r)}>
                            <strong>/{r.atalho}</strong> {r.titulo ? <span>— {r.titulo}</span> : null}
                            <span className="sug-texto">{r.texto}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {respondendo ? (
                <div className="respondendo">
                    <div>
                        <strong>{respondendo.minha ? 'Você' : 'Cliente'}</strong>
                        <span>{respondendo.texto || `[${respondendo.tipo}]`}</span>
                    </div>
                    <button className="icone-botao mini" onClick={aoCancelarResposta} aria-label="Cancelar resposta">
                        <Icone nome="fechar" tamanho={18} />
                    </button>
                </div>
            ) : null}

            <div className="composer-linha">
                <button className={`icone-botao ${painel === 'emoji' ? 'ativo' : ''}`} title="Emojis" onClick={() => setPainel((p) => (p === 'emoji' ? null : 'emoji'))}>
                    <Icone nome="emoji" />
                </button>
                <button className="icone-botao" title="Anexar arquivo" onClick={() => inputArquivo.current?.click()}>
                    <Icone nome="clipe" />
                </button>
                <button className={`icone-botao ${painel === 'respostas' ? 'ativo' : ''}`} title="Respostas rápidas" onClick={() => setPainel((p) => (p === 'respostas' ? null : 'respostas'))}>
                    <Icone nome="raio" />
                </button>
                <input ref={inputArquivo} type="file" hidden onChange={escolherArquivo} accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
                <textarea
                    ref={campo}
                    rows={1}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={aoTeclar}
                    placeholder="Digite uma mensagem ou / para respostas rápidas"
                    aria-label="Mensagem"
                />
                <button className="icone-botao enviar" title="Enviar" onClick={enviar} disabled={!texto.trim()}>
                    <Icone nome="enviar" />
                </button>
            </div>

            {arquivo ? (
                <Modal titulo="Enviar arquivo" aoFechar={() => !enviandoArquivo && setArquivo(null)}>
                    <div className="previa-arquivo">
                        {arquivo.url ? <img src={arquivo.url} alt="Prévia" /> : <Icone nome="documento" tamanho={64} />}
                        <span>
                            {arquivo.file.name} · {(arquivo.file.size / 1024).toFixed(0)} KB
                        </span>
                    </div>
                    <label className="campo">
                        <span>Legenda (opcional)</span>
                        <input value={legenda} onChange={(e) => setLegenda(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && confirmarArquivo()} />
                    </label>
                    <div className="modal-acoes">
                        <button className="botao botao-secundario" onClick={() => setArquivo(null)} disabled={enviandoArquivo}>
                            Cancelar
                        </button>
                        <button className="botao" onClick={confirmarArquivo} disabled={enviandoArquivo}>
                            {enviandoArquivo ? 'Enviando…' : 'Enviar'}
                        </button>
                    </div>
                </Modal>
            ) : null}
        </footer>
    )
}
