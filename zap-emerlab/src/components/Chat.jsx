import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { nomeExibicao, formatarTelefone, rotuloDia, chaveDia, janelaAberta, canalDoId, CANAIS } from '../util.js'
import Icone from './Icone.jsx'
import IconeCanal from './IconeCanal.jsx'
import Menu from './Menu.jsx'
import { Avatar } from './ListaConversas.jsx'
import Mensagem from './Mensagem.jsx'
import Composer from './Composer.jsx'
import Transferir from './Transferir.jsx'
import EnviarTemplate from './EnviarTemplate.jsx'

const INTERVALO_CHAT = 5000

export default function Chat({ conversa, usuario, config, prefs, departamentos, deptoPorId, respostas, equipe, aoVoltar, aoAtualizar, aoRecarregarLista, avisar }) {
    const { waId } = conversa
    const caminho = `conversas/${encodeURIComponent(waId)}`
    const canal = canalDoId(waId)
    const temTemplates = canal === 'whatsapp'
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
            const r = await api(`${caminho}/mensagens?pagina=1`)
            setMensagens((atual) => {
                // mantém páginas antigas já carregadas e substitui as recentes
                const ids = new Set(r.mensagens.map((m) => m.id))
                const antigas = atual.filter((m) => !ids.has(m.id) && r.mensagens.length && m.em < r.mensagens[0].em)
                return [...antigas, ...r.mensagens]
            })
            // pendente que já apareceu no histórico da WATI some da fila local
            setPendentes((p) => p.filter((x) => x.status === 'erro' || !r.mensagens.some((m) => m.minha && m.texto === x.texto)))
            setTemMais((v) => (pagina === 1 ? r.temMais : v))
            setErro('')
        } catch (e) {
            setErro(e.message)
        } finally {
            setCarregando(false)
        }
    }, [caminho, pagina])

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
            const r = await api(`${caminho}/mensagens?pagina=${prox}`)
            setMensagens((atual) => {
                const ids = new Set(atual.map((m) => m.id))
                return [...r.mensagens.filter((m) => !ids.has(m.id)), ...atual]
            })
            setTemMais(r.temMais)
            setPagina(prox)
        } catch (e) {
            alturaAntes.current = null
            avisar(`Não foi possível carregar mensagens anteriores. ${e.message}`, 'erro')
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

    const enviarTexto = async (texto, existente) => {
        const temp = existente
            ? { ...existente, status: 'pendente', erro: null }
            : { id: `tmp-${Date.now()}`, tipo: 'text', texto, em: new Date().toISOString(), minha: true, status: 'pendente', evento: 'message', operador: usuario.nome }
        setPendentes((p) => (existente ? p.map((x) => (x.id === temp.id ? temp : x)) : [...p, temp]))
        setNoFim(true)
        const ctx = existente ? existente.replyContextId : respondendo?.wamid
        if (!existente) setRespondendo(null)
        try {
            await api(`${caminho}/texto`, { method: 'POST', body: { texto, replyContextId: ctx } })
            aoAtualizar(waId, { ultimaMsg: texto, ultimaMinha: true, ultimaEm: temp.em, atendenteEmail: conversa.atendenteEmail || usuario.email })
            setTimeout(carregar, 800)
        } catch (e) {
            // a mensagem fica no chat, marcada, com explicação e ações (tentar/descartar/template)
            setPendentes((p) => p.map((x) => (x.id === temp.id ? { ...x, status: 'erro', replyContextId: ctx, erro: { mensagem: e.message, codigo: e.codigo } } : x)))
        }
    }

    const tentarDeNovo = (m) => enviarTexto(m.texto, m)
    const descartar = (m) => setPendentes((p) => p.filter((x) => x.id !== m.id))

    // erros de arquivo voltam para o modal do Composer, que mantém o arquivo para nova tentativa
    const enviarArquivo = async (dados) => {
        await api(`${caminho}/arquivo`, { method: 'POST', body: dados })
        avisar('Arquivo enviado.')
        setNoFim(true)
        setTimeout(carregar, 1200)
    }

    const acao = async (rota, body, sucesso, campos) => {
        try {
            const r = await api(`${caminho}/${rota}`, { method: 'POST', body })
            aoAtualizar(waId, campos)
            avisar(r.avisoWati ? `${sucesso} Aviso da WATI: ${r.avisoWati}` : sucesso, r.avisoWati ? 'aviso' : 'info')
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
    const abrirTemplate = () =>
        temTemplates ? setModal('template') : avisar('Instagram e Messenger não têm templates: só dá para responder depois que o cliente escrever.', 'aviso')

    const itensMenu = [
        !minha && { rotulo: 'Assumir conversa', acao: assumir },
        { rotulo: 'Transferir…', acao: () => setModal('transferir') },
        temTemplates && { rotulo: 'Enviar template…', acao: () => setModal('template') },
        conversa.status !== 'resolvida' && { rotulo: 'Marcar como resolvida', acao: () => mudarStatus('resolvida', 'Conversa resolvida.') },
        conversa.status !== 'pendente' && { rotulo: 'Marcar como pendente', acao: () => mudarStatus('pendente', 'Conversa marcada como pendente.') },
        conversa.status !== 'aberta' && { rotulo: 'Reabrir conversa', acao: () => mudarStatus('aberta', 'Conversa reaberta.') },
        minha && { rotulo: 'Soltar conversa (voltar à fila)', acao: () => acao('atribuir', { email: null }, 'Conversa devolvida à fila.', { atendenteEmail: null }) },
    ]

    let diaAnterior = null
    let anterior = null

    return (
        <section className="chat" aria-label={`Conversa com ${nomeExibicao(conversa)}`}>
            <header className="barra barra-chat">
                <button className="icone-botao so-mobile" onClick={aoVoltar} aria-label="Voltar para a lista">
                    <Icone nome="voltar" />
                </button>
                <span className="avatar-com-canal">
                    <Avatar conversa={conversa} tamanho={40} />
                    <span className="selo-canal" style={{ background: CANAIS[canal].cor }} aria-label={CANAIS[canal].rotulo} role="img">
                        <IconeCanal canal={canal} tamanho={10} cor="#fff" />
                    </span>
                </span>
                <div className="barra-titulo">
                    <strong>{nomeExibicao(conversa)}</strong>
                    <small>
                        {conversa.nome && formatarTelefone(waId) ? <span className="sub-fone">{formatarTelefone(waId)}</span> : null}
                        {depto ? (
                            <span className="tag tag-mini" style={{ '--tag': depto.cor }}>
                                {depto.nome}
                            </span>
                        ) : null}
                        <span className="sub-atendente">
                            <Icone nome="usuario" tamanho={12} traco={2.5} /> {atendente ? (minha ? 'Você' : atendente) : 'Na fila'}
                        </span>
                        {conversa.status !== 'aberta' ? <span className={`status-pill ${conversa.status}`}>{conversa.status}</span> : null}
                    </small>
                </div>
                <div className="barra-acoes">
                    {!minha ? (
                        <button className="botao botao-pequeno botao-assumir" onClick={assumir} aria-label="Assumir conversa" data-dica="Atribuir esta conversa a você">
                            <Icone nome="pessoaMais" tamanho={18} />
                            <span>Assumir</span>
                        </button>
                    ) : null}
                    <button className="icone-botao some-estreito" aria-label="Transferir" data-dica="Transferir" onClick={() => setModal('transferir')}>
                        <Icone nome="transferir" />
                    </button>
                    {conversa.status !== 'resolvida' ? (
                        <button className="icone-botao some-estreito" aria-label="Marcar como resolvida" data-dica="Marcar como resolvida" onClick={() => mudarStatus('resolvida', 'Conversa resolvida.')}>
                            <Icone nome="concluir" />
                        </button>
                    ) : null}
                    <Menu itens={itensMenu} titulo="Mais ações">
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
                    {carregando ? <div className="spinner spinner-centro" aria-label="Carregando mensagens" /> : null}
                    {erro ? (
                        <div className="estado-erro estado-erro-chat" role="alert">
                            <Icone nome="erro" tamanho={24} />
                            <p>Não foi possível carregar as mensagens. {erro}</p>
                            <button className="botao botao-pequeno botao-secundario" onClick={carregar}>
                                <Icone nome="tentar" tamanho={16} /> Tentar de novo
                            </button>
                        </div>
                    ) : null}
                    {!carregando && !erro && todas.length === 0 ? (
                        <div className="msg-sistema">
                            <span>{temTemplates ? 'Nenhuma mensagem ainda. Para iniciar o contato, envie um template.' : 'Nenhuma mensagem ainda. Aguarde o cliente escrever.'}</span>
                        </div>
                    ) : null}
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
                                <Mensagem
                                    m={m}
                                    waId={waId}
                                    primeiraDoGrupo={primeira}
                                    aoResponder={aberta ? setRespondendo : null}
                                    aoTentar={tentarDeNovo}
                                    aoDescartar={descartar}
                                    aoTemplate={abrirTemplate}
                                />
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

            {!carregando && !erro && !aberta ? (
                <div className="janela-fechada" role="status">
                    <span>
                        <Icone nome="cadeado" tamanho={18} />
                        {temTemplates
                            ? 'Janela de 24h fechada: o cliente não escreve há mais de 24 horas. Só templates aprovados podem ser enviados.'
                            : `Janela de 24h fechada: o ${CANAIS[canal].rotulo} só permite responder até 24 horas depois da última mensagem do cliente.`}
                    </span>
                    {temTemplates ? (
                        <button className="botao botao-pequeno" onClick={() => setModal('template')}>
                            Enviar template
                        </button>
                    ) : null}
                </div>
            ) : null}

            <Composer
                desabilitado={!carregando && !erro && !aberta}
                temTemplates={temTemplates}
                prefs={prefs}
                respostas={respostas}
                respondendo={respondendo}
                aoCancelarResposta={() => setRespondendo(null)}
                aoEnviarTexto={enviarTexto}
                aoEnviarArquivo={enviarArquivo}
                aoAbrirTemplate={abrirTemplate}
                contexto={{ nome: conversa.nome || '', atendente: usuario.nome, telefone: formatarTelefone(waId) }}
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
