import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { arquivoParaBase64 } from '../api.js'
import Icone from './Icone.jsx'
import Modal from './Modal.jsx'
import {
    avaliarRegras,
    codigosServicos,
    listaQuemRealiza,
    preencherServicos,
    temMarcaServicos,
    MARCA_SERVICOS,
    temMarcaCredenciados,
    preencherCredenciados,
    cidadeDaRegra,
    chaveCidade,
} from '../regras.js'
import { preencherVariaveis } from '../variaveis.js'

// seletor de emoji do campo de mensagem: recurso do produto (o cliente usa emoji), não enfeite da interface
const EMOJIS = '😀 😃 😄 😁 😅 😂 🙂 😉 😊 😍 😘 😎 🤔 🤗 🙏 👍 👎 👏 🙌 💪 👋 🤝 ✅ ❌ ⚠️ ❤️ 💚 💙 🔥 🎉 ⭐ 📌 📎 📄 📅 ⏰ 📞 💬 🐶 🐱 🐾 🩺 💊 🏥 🚗 📍 💰 🧾'.split(' ') // taste-skill-ignore
const MAX_MB = 3
// rascunho por conversa (como no WhatsApp Web): sair da conversa com Esc ou trocando de chat não perde o texto
const rascunhos = new Map()
const MAX_CARACTERES = 4096
const AVISO_CARACTERES = 3500

// por que {services.content} ainda não virou a lista de prestadores
const MOTIVO_SERVICOS = {
    'sem-cidade': 'Preencha a UF e a cidade do contato para listar quem realiza',
    carregando: 'Buscando quem realiza na cidade do contato…',
    erro: 'Não foi possível buscar quem realiza agora',
    vazio: 'Ninguém da rede realiza esses procedimentos na cidade do contato',
    'sem-regra': `${MARCA_SERVICOS} só é preenchido por uma resposta rápida com regra services {…}`,
}

// por que {credenciados.*} ainda não virou a lista de nomes
const MOTIVO_CREDENCIADOS = {
    'sem-cidade': 'Preencha a UF e a cidade do contato (ou use uma regra locais com uma cidade) para listar os credenciados',
    carregando: 'Buscando os credenciados da cidade…',
    erro: 'Não foi possível buscar os credenciados agora',
    'sem-resposta': 'As marcas {credenciados.*} só são preenchidas por uma resposta rápida',
}


// separa as respostas cujas regras não batem com o contato aberto
function DivisoriaRegras({ emLista = true }) {
    const texto = 'Não se aplicam a este contato'
    return emLista ? (
        <li className="divisoria-regras" role="presentation">
            {texto}
        </li>
    ) : (
        <div className="divisoria-regras" role="presentation">
            {texto}
        </div>
    )
}

function SeloIndicada() {
    return (
        <span className="selo-indicada" title="As regras desta resposta batem com este contato">
            indicada
        </span>
    )
}

export default function Composer({ desabilitado, inicioNosso = false, temTemplates, prefs, respostas, respondendo, aoCancelarResposta, aoEnviarTexto, aoEnviarArquivo, aoAbrirTemplate, contexto, contextoRegras, quemRealiza, credenciados, controle, chave }) {
    const [texto, setTexto] = useState(() => rascunhos.get(chave) || '')
    const [indice, setIndice] = useState(0)
    const [painel, setPainel] = useState(null) // 'emoji' | 'respostas'
    const [arquivo, setArquivo] = useState(null)
    const [legenda, setLegenda] = useState('')
    const [enviandoArquivo, setEnviandoArquivo] = useState(false)
    const [erroArquivo, setErroArquivo] = useState('')
    const [avisoAnexo, setAvisoAnexo] = useState('')
    const campo = useRef(null)
    const inputArquivo = useRef(null)
    // códigos da regra services {…} da última resposta inserida com {services.content} (para preencher quando a busca voltar)
    const codigosMarca = useRef([])
    // cidade (chave) das marcas {credenciados.*} da última resposta inserida, para preencher quando a busca voltar
    const cidadeMarcaCred = useRef(null)

    // posição do cursor no campo: as respostas rápidas entram ali, sem apagar o que já foi digitado
    const [cursor, setCursor] = useState(() => texto.length)
    // Esc fecha as sugestões daquele "/" (até digitar outra barra)
    const [fechadoEm, setFechadoEm] = useState(null)

    // "/atalho" no começo de qualquer palavra abre as respostas rápidas, como no WhatsApp Business
    const gatilho = useMemo(() => {
        const m = texto.slice(0, cursor).match(/(^|\s)\/([^\s/]*)$/)
        if (!m) return null
        const inicio = cursor - m[2].length - 1
        return inicio === fechadoEm ? null : { inicio, termo: m[2].toLowerCase() }
    }, [texto, cursor, fechadoEm])
    const termoAtalho = gatilho ? gatilho.termo : null
    // regras da resposta: as que batem com o contato vêm primeiro, depois as sem regra; as que não se
    // aplicam ficam no fim, depois de uma divisória (continuam disponíveis)
    const regrasCtx = JSON.stringify(contextoRegras || {})
    const respostasOrdenadas = useMemo(() => {
        const ctx = JSON.parse(regrasCtx)
        const ordem = { bate: 0, livre: 1, fora: 2 }
        return respostas
            .map((r) => ({ ...r, situacao: avaliarRegras(r.regras, ctx) }))
            .sort((a, b) => ordem[a.situacao] - ordem[b.situacao])
    }, [respostas, regrasCtx])

    const sugestoes = useMemo(() => {
        if (termoAtalho === null) return []
        return respostasOrdenadas
            .filter((r) => r.atalho.includes(termoAtalho) || (r.titulo || '').toLowerCase().includes(termoAtalho) || r.texto.toLowerCase().includes(termoAtalho))
            .slice(0, 8)
    }, [termoAtalho, respostasOrdenadas])
    const semResultadoAtalho = termoAtalho !== null && termoAtalho.length > 0 && sugestoes.length === 0

    useEffect(() => setIndice(0), [termoAtalho])
    useEffect(() => {
        codigosMarca.current = []
        cidadeMarcaCred.current = null
    }, [chave])

    // apagou a barra que tinha sido dispensada: a próxima volta a abrir sugestões
    useEffect(() => {
        if (fechadoEm !== null && texto[fechadoEm] !== '/') setFechadoEm(null)
    }, [texto, fechadoEm])

    useEffect(() => {
        if (texto) rascunhos.set(chave, texto)
        else rascunhos.delete(chave)
    }, [chave, texto])

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
        // o que ainda não se sabe (ex.: UF sem cadastro) fica como {{uf}} e é resolvido no envio
        let conteudo = preencherVariaveis(r.texto, contexto, { manterVazias: true })
        if (temMarcaServicos(conteudo)) {
            codigosMarca.current = codigosServicos(r.regras, { soIncluidos: true })
            // sem a lista ainda (ou sem ninguém), a marca fica no campo e o envio espera; ver motivoServicos
            if (quemRealiza?.estado === 'pronto' && listaQuemRealiza(codigosMarca.current, quemRealiza.prestadores)) {
                conteudo = preencherServicos(conteudo, codigosMarca.current, quemRealiza.prestadores)
            }
        }
        if (temMarcaCredenciados(conteudo)) {
            const alvo = cidadeDaRegra(r.regras) || credenciados?.contato
            cidadeMarcaCred.current = alvo ? chaveCidade(alvo) : 'sem-cidade'
            const pronto = credenciados?.porCidade?.[cidadeMarcaCred.current]
            if (pronto?.estado === 'pronto') conteudo = preencherCredenciados(conteudo, pronto.listas)
        }
        let novo
        let pos
        if (gatilho) {
            // troca só o "/atalho" digitado
            novo = texto.slice(0, gatilho.inicio) + conteudo + texto.slice(cursor)
            pos = gatilho.inicio + conteudo.length
        } else {
            // pelo botão de respostas: insere onde o cursor estava, separando da palavra anterior
            const antes = texto.slice(0, cursor)
            const separador = antes && !/\s$/.test(antes) ? ' ' : ''
            novo = antes + separador + conteudo + texto.slice(cursor)
            pos = antes.length + separador.length + conteudo.length
        }
        setTexto(novo)
        setCursor(pos)
        setPainel(null)
        requestAnimationFrame(() => {
            campo.current?.focus()
            campo.current?.setSelectionRange(pos, pos)
        })
    }

    // a busca de quem realiza voltou depois de a resposta entrar no campo: troca a marca pela lista ali mesmo
    const prestadoresProntos = quemRealiza?.estado === 'pronto' ? quemRealiza.prestadores : null
    useEffect(() => {
        if (!prestadoresProntos || !codigosMarca.current.length || !listaQuemRealiza(codigosMarca.current, prestadoresProntos)) return
        setTexto((t) => (temMarcaServicos(t) ? preencherServicos(t, codigosMarca.current, prestadoresProntos) : t))
    }, [prestadoresProntos])

    // a lista de credenciados chegou depois de a resposta entrar no campo: preenche ali mesmo
    const credProntos = cidadeMarcaCred.current ? credenciados?.porCidade?.[cidadeMarcaCred.current] : null
    const listasCred = credProntos?.estado === 'pronto' ? credProntos.listas : null
    useEffect(() => {
        if (!listasCred) return
        setTexto((t) => (temMarcaCredenciados(t) ? preencherCredenciados(t, listasCred) : t))
    }, [listasCred])

    const limpo = texto.trim()
    const longo = limpo.length > MAX_CARACTERES
    const motivoServicos = !temMarcaServicos(limpo)
        ? null
        : !codigosMarca.current.length
          ? MOTIVO_SERVICOS['sem-regra']
          : MOTIVO_SERVICOS[quemRealiza?.estado === 'pronto' ? 'vazio' : quemRealiza?.estado || 'carregando']
    const motivoCredenciados = !temMarcaCredenciados(limpo)
        ? null
        : !cidadeMarcaCred.current
          ? MOTIVO_CREDENCIADOS['sem-resposta']
          : cidadeMarcaCred.current === 'sem-cidade'
            ? MOTIVO_CREDENCIADOS['sem-cidade']
            : MOTIVO_CREDENCIADOS[credProntos?.estado === 'erro' ? 'erro' : 'carregando']
    const motivoBloqueioEnvio = !limpo
        ? 'Digite uma mensagem'
        : longo
          ? `Passou de ${MAX_CARACTERES} caracteres`
          : motivoServicos || motivoCredenciados

    const enviar = () => {
        if (motivoBloqueioEnvio || desabilitado) return
        const final = preencherVariaveis(limpo, contexto)
        // "*Atendente <nome>*" (negrito no WhatsApp) vai no próprio texto: a bolha otimista e o "tentar de novo" já saem com ele
        aoEnviarTexto(prefs.identificarAtendente && contexto.atendente ? `*Atendente ${contexto.atendente}*\n${final}` : final)
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
            if (e.key === 'Escape') {
                e.preventDefault()
                return setFechadoEm(gatilho.inicio)
            }
        }
        if (e.key === 'Escape' && painel) {
            e.preventDefault()
            return setPainel(null)
        }
        if (e.key === 'Escape' && respondendo) {
            e.preventDefault()
            return aoCancelarResposta()
        }
        if (e.key === 'Enter' && !e.shiftKey && (prefs.enterEnvia || e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            enviar()
        }
    }

    const prepararArquivo = (f) => {
        if (f.size > MAX_MB * 1024 * 1024) {
            setAvisoAnexo(`"${f.name}" tem ${(f.size / 1024 / 1024).toFixed(1)} MB. O limite é ${MAX_MB} MB: comprima o arquivo ou envie um link.`)
            return
        }
        setErroArquivo('')
        setArquivo({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })
        setLegenda('')
    }

    const escolherArquivo = (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) prepararArquivo(f)
    }

    // Ctrl+V com imagem copiada (print, foto) abre a prévia de envio, como no WhatsApp Web
    const aoColar = (e) => {
        const f = e.clipboardData?.files?.[0]
        if (!f) return
        e.preventDefault()
        prepararArquivo(f)
    }

    // o Chat usa isto para atalhos (Ctrl+Alt+E/R), arrastar arquivo e "digitar em qualquer lugar"
    useEffect(() => {
        if (!controle) return
        controle.current = desabilitado
            ? null
            : {
                  anexar: prepararArquivo,
                  focar: () => campo.current?.focus(),
                  alternar: (qual) => {
                      setPainel((p) => (p === qual ? null : qual))
                      campo.current?.focus()
                  },
              }
        return () => {
            controle.current = null
        }
    })

    // Esc fecha o painel de respostas/emojis mesmo sem foco no textarea (o Painel ignora Esc com role=dialog aberto)
    useEffect(() => {
        if (!painel) return
        const ouvir = (e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            setPainel(null)
            campo.current?.focus()
        }
        window.addEventListener('keydown', ouvir, true)
        return () => window.removeEventListener('keydown', ouvir, true)
    }, [painel])

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
                        <Icone nome="template" tamanho={18} />{' '}
                        {inicioNosso ? 'Enviar template para iniciar o contato' : 'Enviar template para reabrir a conversa'}
                    </button>
                ) : (
                    <p className="composer-aviso">
                        <Icone nome="cadeado" tamanho={16} />{' '}
                        {inicioNosso
                            ? 'Respostas liberadas assim que o cliente escrever.'
                            : 'Respostas liberadas assim que o cliente escrever de novo.'}
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
                        <Fragment key={r.id}>
                            {r.situacao === 'fora' && sugestoes[i - 1]?.situacao !== 'fora' ? <DivisoriaRegras /> : null}
                            <li role="option" aria-selected={i === indice}>
                                <button className={`${i === indice ? 'ativo' : ''} ${r.situacao === 'fora' ? 'fora-regra' : ''}`} onMouseEnter={() => setIndice(i)} onClick={() => usarResposta(r)}>
                                    <strong>
                                        /{r.atalho} {r.situacao === 'bate' ? <SeloIndicada /> : null}
                                    </strong>
                                    {r.titulo ? <span className="sug-titulo">{r.titulo}</span> : null}
                                    <span className="sug-texto">{r.texto}</span>
                                </button>
                            </li>
                        </Fragment>
                    ))}
                    <li className="sugestoes-dica" aria-hidden="true">
                        ↑↓ navegar · Enter usar · Esc cancelar
                    </li>
                </ul>
            ) : null}

            {semResultadoAtalho ? (
                <div className="sugestoes sugestoes-vazia" role="status">
                    Nenhuma resposta rápida com “{termoAtalho}”.{' '}
                    {respostas.length ? 'Esc ou espaço continuam como texto normal.' : 'Um administrador pode cadastrar em Administração.'}
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
                    {respostasOrdenadas.map((r, i) => (
                        <Fragment key={r.id}>
                            {r.situacao === 'fora' && respostasOrdenadas[i - 1]?.situacao !== 'fora' ? <DivisoriaRegras emLista={false} /> : null}
                            <button className={`resposta-item ${r.situacao === 'fora' ? 'fora-regra' : ''}`} onClick={() => usarResposta(r)}>
                                <strong>
                                    /{r.atalho} {r.situacao === 'bate' ? <SeloIndicada /> : null}
                                </strong>{' '}
                                {r.titulo ? <span>{r.titulo}</span> : null}
                                <span className="sug-texto">{r.texto}</span>
                            </button>
                        </Fragment>
                    ))}
                </div>
            ) : null}

            {avisoAnexo ? (
                <div className="composer-alerta" role="alert">
                    <Icone nome="erro" tamanho={16} /> {avisoAnexo}
                </div>
            ) : null}
            {motivoServicos ? (
                <div className="composer-alerta" role="status">
                    <Icone nome="erro" tamanho={16} /> {motivoServicos}. Até lá, {MARCA_SERVICOS} fica no texto e a mensagem não é enviada.
                </div>
            ) : null}
            {motivoCredenciados ? (
                <div className="composer-alerta" role="status">
                    <Icone nome="erro" tamanho={16} /> {motivoCredenciados}. Até lá, a marca fica no texto e a mensagem não é enviada.
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
                        onChange={(e) => {
                            setTexto(e.target.value)
                            setCursor(e.target.selectionStart)
                        }}
                        onSelect={(e) => setCursor(e.target.selectionStart)}
                        onKeyDown={aoTeclar}
                        onPaste={aoColar}
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
