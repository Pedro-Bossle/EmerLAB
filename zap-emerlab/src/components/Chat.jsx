import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { nomeExibicao, formatarTelefone, rotuloDia, chaveDia, janelaAberta } from '../util.js'
import Icone from './Icone.jsx'
import Menu from './Menu.jsx'
import { Avatar } from './ListaConversas.jsx'
import Mensagem from './Mensagem.jsx'
import Composer from './Composer.jsx'
import Transferir from './Transferir.jsx'
import EnviarTemplate from './EnviarTemplate.jsx'

const INTERVALO_CHAT = 5000

export default function Chat({ conversa, usuario, config, prefs, departamentos, deptoPorId, respostas, equipe, aoVoltar, aoAtualizar, aoRecarregarLista, avisar }) {
    const { waId } = conversa
    const [mensagens, setMensagens] = useState([])
    const [pendentes, setPendentes] = useState([])
    const [carregando, setCarregando] = useState(true)
    const [erro, setErro] = useState('')
    const [pagina, setPagina] = useState(1)
    const [temMais, setTemMais] = useState(false)
    const [respondendo, setRespondendo] = useState(null)
    const [modal, setModal] = useState(null)
    const [noFim, setNoFim] = useState(true)
    const area = useRef(null)
    const alturaAntes = useRef(null)

    const carregar = useCallback(async () => {
        try {
            const r = await api(`conversas/${waId}/mensagens?pagina=1`)
            setMensagens((atual) => {
                // mantém páginas antigas já carregadas e substitui as recentes
                const ids = new Set(r.mensagens.map((m) => m.id))
                const antigas = atual.filter((m) => !ids.has(m.id) && r.mensagens.length && m.em < r.mensagens[0].em)
                return [...antigas, ...r.mensagens]
            })
            setPendentes((p) => p.filter((x) => !r.mensagens.some((m) => m.minha && m.texto === x.texto)))
            setTemMais((v) => (pagina === 1 ? r.temMais : v))
            setErro('')
        } catch (e) {
            setErro(e.message)
        } finally {
            setCarregando(false)
        }
    }, [waId, pagina])

    useEffect(() => {
        carregar()
        const id = setInterval(() => {
            if (!document.hidden) carregar()
        }, INTERVALO_CHAT)
        return () => clearInterval(id)
    }, [carregar])

    const carregarAntigas = async () => {
        const prox = pagina + 1
        alturaAntes.current = area.current?.scrollHeight ?? null
        try {
            const r = await api(`conversas/${waId}/mensagens?pagina=${prox}`)
            setMensagens((atual) => {
                const ids = new Set(atual.map((m) => m.id))
                return [...r.mensagens.filter((m) => !ids.has(m.id)), ...atual]
            })
            setTemMais(r.temMais)
            setPagina(prox)
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const todas = [...mensagens, ...pendentes]

    // rolagem: mantém no fim quando chegam mensagens; preserva posição ao carregar antigas
    useLayoutEffect(() => {
        const el = area.current
        if (!el) return
        if (alturaAntes.current != null) {
            el.scrollTop = el.scrollHeight - alturaAntes.current
            alturaAntes.current = null
        } else if (noFim) {
            el.scrollTop = el.scrollHeight
        }
    }, [todas.length]) // eslint-disable-line react-hooks/exhaustive-deps

    const aoRolar = () => {
        const el = area.current
        setNoFim(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
    }

    const irParaFim = () => {
        area.current.scrollTo({ top: area.current.scrollHeight, behavior: 'smooth' })
    }

    const aberta = janelaAberta(mensagens)

    const enviarTexto = async (texto) => {
        const temp = { id: `tmp-${Date.now()}`, tipo: 'text', texto, em: new Date().toISOString(), minha: true, status: 'pendente', evento: 'message', operador: usuario.nome }
        setPendentes((p) => [...p, temp])
        setNoFim(true)
        const ctx = respondendo?.wamid
        setRespondendo(null)
        try {
            await api(`conversas/${waId}/texto`, { method: 'POST', body: { texto, replyContextId: ctx } })
            aoAtualizar(waId, { ultimaMsg: texto, ultimaMinha: true, ultimaEm: temp.em, atendenteEmail: conversa.atendenteEmail || usuario.email })
            setTimeout(carregar, 800)
        } catch (e) {
            setPendentes((p) => p.map((x) => (x.id === temp.id ? { ...x, status: 'erro' } : x)))
            avisar(e.message, 'erro')
        }
    }

    const enviarArquivo = async (dados) => {
        try {
            await api(`conversas/${waId}/arquivo`, { method: 'POST', body: dados })
            avisar('Arquivo enviado.')
            setNoFim(true)
            setTimeout(carregar, 1200)
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const acao = async (caminho, body, sucesso, campos) => {
        try {
            const r = await api(`conversas/${waId}/${caminho}`, { method: 'POST', body })
            aoAtualizar(waId, campos)
            avisar(r.avisoWati ? `${sucesso} (aviso WATI: ${r.avisoWati})` : sucesso, r.avisoWati ? 'aviso' : 'info')
            aoRecarregarLista()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const assumir = () => acao('atribuir', {}, 'Conversa atribuída a você.', { atendenteEmail: usuario.email })
    const mudarStatus = (status, txt) => acao('status', { status }, txt, { status })

    const depto = conversa.departamentoId ? deptoPorId[conversa.departamentoId] : null
    const atendente = conversa.atendenteEmail ? equipe.find((u) => u.email === conversa.atendenteEmail)?.nome || conversa.atendenteEmail : null
    const minha = conversa.atendenteEmail === usuario.email

    const itensMenu = [
        !minha && { rotulo: 'Assumir conversa', acao: assumir },
        { rotulo: 'Transferir…', acao: () => setModal('transferir') },
        { rotulo: 'Enviar template…', acao: () => setModal('template') },
        conversa.status !== 'resolvida' && { rotulo: 'Marcar como resolvida', acao: () => mudarStatus('resolvida', 'Conversa resolvida.') },
        conversa.status !== 'pendente' && { rotulo: 'Marcar como pendente', acao: () => mudarStatus('pendente', 'Conversa marcada como pendente.') },
        conversa.status !== 'aberta' && { rotulo: 'Reabrir conversa', acao: () => mudarStatus('aberta', 'Conversa reaberta.') },
        minha && { rotulo: 'Soltar conversa (voltar à fila)', acao: () => acao('atribuir', { email: null }, 'Conversa devolvida à fila.', { atendenteEmail: null }) },
    ]

    let diaAnterior = null
    let anterior = null

    return (
        <section className="chat">
            <header className="barra barra-chat">
                <button className="icone-botao so-mobile" onClick={aoVoltar} aria-label="Voltar">
                    <Icone nome="voltar" />
                </button>
                <Avatar conversa={conversa} tamanho={40} />
                <div className="barra-titulo">
                    <strong>{nomeExibicao(conversa)}</strong>
                    <small>
                        {conversa.nome ? formatarTelefone(waId) : ''}
                        {depto ? <span className="tag tag-mini" style={{ '--tag': depto.cor }}>{depto.nome}</span> : null}
                        {atendente ? <span className="sub-atendente">· 👤 {minha ? 'Você' : atendente}</span> : <span className="sub-atendente">· Na fila</span>}
                        {conversa.status !== 'aberta' ? <span className={`status-pill ${conversa.status}`}>{conversa.status}</span> : null}
                    </small>
                </div>
                <div className="barra-acoes">
                    {!minha ? (
                        <button className="botao botao-pequeno" onClick={assumir} title="Atribuir esta conversa a você">
                            Assumir
                        </button>
                    ) : null}
                    <button className="icone-botao" title="Transferir" onClick={() => setModal('transferir')}>
                        <Icone nome="transferir" />
                    </button>
                    {conversa.status !== 'resolvida' ? (
                        <button className="icone-botao" title="Marcar como resolvida" onClick={() => mudarStatus('resolvida', 'Conversa resolvida.')}>
                            <Icone nome="concluir" />
                        </button>
                    ) : null}
                    <Menu itens={itensMenu}>
                        <Icone nome="menu" />
                    </Menu>
                </div>
            </header>

            <div className="mensagens" ref={area} onScroll={aoRolar}>
                <div className="mensagens-interno">
                    {temMais ? (
                        <button className="carregar-mais" onClick={carregarAntigas}>
                            Carregar mensagens anteriores
                        </button>
                    ) : null}
                    {carregando ? <div className="spinner spinner-centro" /> : null}
                    {erro ? <div className="alerta alerta-erro">{erro}</div> : null}
                    {!carregando && !erro && todas.length === 0 ? <div className="msg-sistema"><span>Nenhuma mensagem ainda. Inicie com um template.</span></div> : null}
                    {todas.map((m) => {
                        const dia = m.em ? chaveDia(m.em) : diaAnterior
                        const novoDia = dia !== diaAnterior
                        const primeira = novoDia || !anterior || anterior.minha !== m.minha || anterior.evento !== 'message'
                        diaAnterior = dia
                        anterior = m
                        return (
                            <Fragment key={m.id}>
                                {novoDia && m.em ? (
                                    <div className="msg-dia">
                                        <span>{rotuloDia(m.em)}</span>
                                    </div>
                                ) : null}
                                <Mensagem m={m} waId={waId} primeiraDoGrupo={primeira} aoResponder={aberta ? setRespondendo : null} />
                            </Fragment>
                        )
                    })}
                </div>
            </div>

            {!noFim ? (
                <button className="ir-fim" onClick={irParaFim} aria-label="Ir para a última mensagem">
                    <Icone nome="baixo" />
                </button>
            ) : null}

            {!carregando && !aberta ? (
                <div className="janela-fechada">
                    <span>
                        <Icone nome="relogio" tamanho={18} /> A janela de 24h está fechada: o cliente não escreve há mais de 24 horas. Para retomar, envie um template aprovado.
                    </span>
                    <button className="botao botao-pequeno" onClick={() => setModal('template')}>
                        Enviar template
                    </button>
                </div>
            ) : null}

            <Composer
                desabilitado={!carregando && !aberta}
                prefs={prefs}
                respostas={respostas}
                respondendo={respondendo}
                aoCancelarResposta={() => setRespondendo(null)}
                aoEnviarTexto={enviarTexto}
                aoEnviarArquivo={enviarArquivo}
                aoAbrirTemplate={() => setModal('template')}
                contexto={{ nome: conversa.nome || '', atendente: usuario.nome, telefone: waId }}
            />

            {modal === 'transferir' ? (
                <Transferir
                    conversa={conversa}
                    usuario={usuario}
                    departamentos={departamentos}
                    equipe={equipe}
                    aoFechar={() => setModal(null)}
                    aoTransferir={async ({ departamentoId, email }) => {
                        setModal(null)
                        const mudouDepto = departamentoId !== (conversa.departamentoId || '')
                        if (mudouDepto) {
                            await acao('departamento', { departamentoId: departamentoId || null }, 'Departamento atualizado.', { departamentoId: departamentoId || null, atendenteEmail: null })
                        }
                        // trocar de departamento já zera o atendente no servidor
                        if (mudouDepto ? Boolean(email) : email !== (conversa.atendenteEmail || '')) {
                            await acao('atribuir', { email: email || null }, email ? 'Conversa transferida.' : 'Conversa devolvida à fila.', { atendenteEmail: email || null })
                        }
                    }}
                />
            ) : null}

            {modal === 'template' ? (
                <EnviarTemplate
                    conversa={conversa}
                    config={config}
                    aoFechar={() => setModal(null)}
                    aoEnviado={() => {
                        setModal(null)
                        avisar('Template enviado.')
                        setTimeout(carregar, 1500)
                    }}
                    avisar={avisar}
                />
            ) : null}
        </section>
    )
}
