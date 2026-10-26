import { useEffect, useMemo, useRef, useState } from 'react'
import { arquivoParaBase64 } from '../api.js'
import Icone from './Icone.jsx'
import Modal from './Modal.jsx'

const EMOJIS = '😀 😃 😄 😁 😅 😂 🙂 😉 😊 😍 😘 😎 🤔 🤗 🙏 👍 👎 👏 🙌 💪 👋 🤝 ✅ ❌ ⚠️ ❤️ 💚 💙 🔥 🎉 ⭐ 📌 📎 📄 📅 ⏰ 📞 💬 🐶 🐱 🐾 🩺 💊 🏥 🚗 📍 💰 🧾'.split(' ')
const MAX_MB = 3
const MAX_CARACTERES = 4096
const AVISO_CARACTERES = 3500

function preencher(texto, ctx) {
    return texto.replace(/\{\{\s*(nome|primeiro_nome|atendente|telefone)\s*\}\}/gi, (_, k) => {
        const c = k.toLowerCase()
        if (c === 'primeiro_nome') return (ctx.nome || '').split(' ')[0]
        return ctx[c] ?? ''
    })
}

export default function Composer({ desabilitado, temTemplates, prefs, respostas, respondendo, aoCancelarResposta, aoEnviarTexto, aoEnviarArquivo, aoAbrirTemplate, contexto }) {
    const [texto, setTexto] = useState('')
    const [indice, setIndice] = useState(0)
    const [painel, setPainel] = useState(null) // 'emoji' | 'respostas'
    const [arquivo, setArquivo] = useState(null)
    const [legenda, setLegenda] = useState('')
    const [enviandoArquivo, setEnviandoArquivo] = useState(false)
    const [erroArquivo, setErroArquivo] = useState('')
    const [avisoAnexo, setAvisoAnexo] = useState('')
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
    const semResultadoAtalho = termoAtalho !== null && termoAtalho.length > 0 && sugestoes.length === 0

    useEffect(() => setIndice(0), [termoAtalho])

    useEffect(() => {
        const el = campo.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }, [texto])

    useEffect(() => {
        if (respondendo) campo.current?.focus()
    }, [respondendo])

    useEffect(() => {
        if (!avisoAnexo) return
        const t = setTimeout(() => setAvisoAnexo(''), 5000)
        return () => clearTimeout(t)
    }, [avisoAnexo])

    const usarResposta = (r) => {
        setTexto(preencher(r.texto, contexto))
        setPainel(null)
        requestAnimationFrame(() => campo.current?.focus())
    }

    const limpo = texto.trim()
    const longo = limpo.length > MAX_CARACTERES
    const motivoBloqueioEnvio = !limpo ? 'Digite uma mensagem' : longo ? `Passou de ${MAX_CARACTERES} caracteres` : null

    const enviar = () => {
        if (motivoBloqueioEnvio || desabilitado) return
        aoEnviarTexto(limpo)
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
        if (e.key === 'Escape' && painel) return setPainel(null)
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
            setAvisoAnexo(`"${f.name}" tem ${(f.size / 1024 / 1024).toFixed(1)} MB. O limite é ${MAX_MB} MB: comprima o arquivo ou envie um link.`)
            return
        }
        setErroArquivo('')
        setArquivo({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })
        setLegenda('')
    }

    const fecharArquivo = () => {
        if (enviandoArquivo) return
        if (arquivo?.url) URL.revokeObjectURL(arquivo.url)
        setArquivo(null)
        setErroArquivo('')
    }

    const confirmarArquivo = async () => {
        setEnviandoArquivo(true)
        setErroArquivo('')
        try {
            const base64 = await arquivoParaBase64(arquivo.file)
            await aoEnviarArquivo({ nome: arquivo.file.name, mime: arquivo.file.type, base64, legenda: legenda.trim() || undefined })
            if (arquivo.url) URL.revokeObjectURL(arquivo.url)
            setArquivo(null)
        } catch (e) {
            setErroArquivo(e.message)
        } finally {
            setEnviandoArquivo(false)
        }
    }

    if (desabilitado) {
        return (
            <footer className="composer composer-bloqueado">
                {temTemplates ? (
                    <button className="botao botao-secundario" onClick={aoAbrirTemplate}>
                        <Icone nome="template" tamanho={18} /> Enviar template para reabrir a conversa
                    </button>
                ) : (
                    <p className="composer-aviso">
                        <Icone nome="cadeado" tamanho={16} /> Respostas liberadas assim que o cliente escrever de novo.
                    </p>
                )}
            </footer>
        )
    }

    return (
        <footer className="composer">
            {sugestoes.length ? (
                <ul className="sugestoes" role="listbox" aria-label="Respostas rápidas">
                    {sugestoes.map((r, i) => (
                        <li key={r.id} role="option" aria-selected={i === indice}>
                            <button className={i === indice ? 'ativo' : ''} onMouseEnter={() => setIndice(i)} onClick={() => usarResposta(r)}>
                                <strong>/{r.atalho}</strong>
                                {r.titulo ? <span className="sug-titulo">{r.titulo}</span> : null}
                                <span className="sug-texto">{r.texto}</span>
                            </button>
                        </li>
                    ))}
                    <li className="sugestoes-dica" aria-hidden="true">
                        ↑↓ navegar · Enter usar · Esc cancelar
                    </li>
                </ul>
            ) : null}

            {semResultadoAtalho ? (
                <div className="sugestoes sugestoes-vazia" role="status">
                    Nenhuma resposta rápida com “{termoAtalho}”.{' '}
                    {respostas.length ? 'Apague a / para enviar como texto.' : 'Um administrador pode cadastrar em Administração.'}
                </div>
            ) : null}

            {painel === 'emoji' ? (
                <div className="painel-emoji" role="dialog" aria-label="Emojis">
                    {EMOJIS.map((em) => (
                        <button
                            key={em}
                            aria-label={`Inserir ${em}`}
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
                <div className="painel-respostas" role="dialog" aria-label="Respostas rápidas">
                    <div className="painel-respostas-topo">
                        <strong>Respostas rápidas</strong>
                        <small>
                            Dica: digite <kbd>/</kbd> no campo para buscar
                        </small>
                    </div>
                    {respostas.length === 0 ? <p className="lista-vazia">Nenhuma resposta cadastrada. Um administrador pode criar em Administração.</p> : null}
                    {respostas.map((r) => (
                        <button key={r.id} className="resposta-item" onClick={() => usarResposta(r)}>
                            <strong>/{r.atalho}</strong> {r.titulo ? <span>{r.titulo}</span> : null}
                            <span className="sug-texto">{r.texto}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {avisoAnexo ? (
                <div className="composer-alerta" role="alert">
                    <Icone nome="erro" tamanho={16} /> {avisoAnexo}
                </div>
            ) : null}

            {respondendo ? (
                <div className="respondendo">
                    <div>
                        <strong>Respondendo a {respondendo.minha ? 'você' : 'cliente'}</strong>
                        <span>{respondendo.texto || `[${respondendo.tipo}]`}</span>
                    </div>
                    <button className="icone-botao mini" onClick={aoCancelarResposta} aria-label="Cancelar resposta">
                        <Icone nome="fechar" tamanho={18} />
                    </button>
                </div>
            ) : null}

            <div className="composer-linha">
                <button
                    className={`icone-botao ${painel === 'emoji' ? 'ativo' : ''}`}
                    aria-label="Emojis"
                    data-dica="Emojis"
                    aria-expanded={painel === 'emoji'}
                    onClick={() => setPainel((p) => (p === 'emoji' ? null : 'emoji'))}
                >
                    <Icone nome="emoji" />
                </button>
                <button className="icone-botao" aria-label="Anexar arquivo" data-dica={`Anexar (até ${MAX_MB} MB)`} onClick={() => inputArquivo.current?.click()}>
                    <Icone nome="clipe" />
                </button>
                <button
                    className={`icone-botao some-estreito ${painel === 'respostas' ? 'ativo' : ''}`}
                    aria-label="Respostas rápidas"
                    data-dica="Respostas rápidas"
                    aria-expanded={painel === 'respostas'}
                    onClick={() => setPainel((p) => (p === 'respostas' ? null : 'respostas'))}
                >
                    <Icone nome="raio" />
                </button>
                <input ref={inputArquivo} type="file" hidden onChange={escolherArquivo} accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
                <div className="composer-campo">
                    <textarea
                        ref={campo}
                        rows={1}
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={aoTeclar}
                        placeholder="Digite uma mensagem"
                        aria-label="Mensagem"
                        aria-invalid={longo}
                    />
                    {limpo.length > AVISO_CARACTERES ? (
                        <span className={`contador ${longo ? 'estourou' : ''}`} aria-live="polite">
                            {limpo.length}/{MAX_CARACTERES}
                        </span>
                    ) : null}
                </div>
                <span className="dica-wrap" data-dica={motivoBloqueioEnvio || (prefs.enterEnvia ? 'Enviar (Enter)' : 'Enviar (Ctrl+Enter)')} data-dica-lado="esquerda">
                    <button className="icone-botao enviar" aria-label="Enviar mensagem" onClick={enviar} disabled={Boolean(motivoBloqueioEnvio)}>
                        <Icone nome="enviar" />
                    </button>
                </span>
            </div>

            {arquivo ? (
                <Modal titulo="Enviar arquivo" aoFechar={fecharArquivo}>
                    <div className="previa-arquivo">
                        {arquivo.url ? <img src={arquivo.url} alt="Prévia do arquivo" /> : <Icone nome="documento" tamanho={56} traco={1.5} />}
                        <span>
                            {arquivo.file.name} · {(arquivo.file.size / 1024).toFixed(0)} KB
                        </span>
                    </div>
                    <label className="campo">
                        <span>Legenda (opcional)</span>
                        <input value={legenda} onChange={(e) => setLegenda(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && !enviandoArquivo && confirmarArquivo()} />
                    </label>
                    {erroArquivo ? (
                        <div className="alerta alerta-erro" role="alert">
                            <strong>Não foi enviado.</strong> {erroArquivo}
                        </div>
                    ) : null}
                    <div className="modal-acoes">
                        <button className="botao botao-secundario" onClick={fecharArquivo} disabled={enviandoArquivo}>
                            Cancelar
                        </button>
                        <button className="botao" onClick={confirmarArquivo} disabled={enviandoArquivo}>
                            {enviandoArquivo ? 'Enviando…' : erroArquivo ? 'Tentar de novo' : 'Enviar'}
                        </button>
                    </div>
                </Modal>
            ) : null}
        </footer>
    )
}
