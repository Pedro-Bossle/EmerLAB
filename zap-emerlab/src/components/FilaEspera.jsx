import { useEffect, useMemo, useState } from 'react'
import { tempoDesde, janelaDaConversa, calcularEspera, nomeExibicao, formatarTelefone, CANAIS } from '../util.js'
import { Avatar, ContatoMetaPills } from './ListaConversas.jsx'
import Icone from './Icone.jsx'

// a partir de 20h de espera a janela entra em risco (faltam 4h para fechar)
const RISCO_MS = 4 * 3600 * 1000

const CATEGORIAS = [
    {
        id: 'esperando',
        rotulo: 'Esperando',
        ajuda: 'Última mensagem do cliente — ainda dentro da janela de 24h',
        lider: true,
    },
    {
        id: 'sem-atendente',
        rotulo: 'Sem atendente',
        ajuda: 'Conversas abertas na fila, sem ninguém atribuído',
    },
    {
        id: 'minhas',
        rotulo: 'Atribuídas a você',
        ajuda: 'Conversas abertas sob sua responsabilidade',
    },
]

// Painel mostrado quando nenhuma conversa está aberta: responde "quem está esperando resposta, e há quanto tempo?"
export default function FilaEspera({ conversas, canal, usuarioEmail, aoAbrir }) {
    // relógio próprio para os tempos de espera andarem sem recarregar a lista
    const [agora, setAgora] = useState(() => Date.now())
    const [categoria, setCategoria] = useState('esperando')

    useEffect(() => {
        const id = setInterval(() => setAgora(Date.now()), 30000)
        return () => clearInterval(id)
    }, [])

    const abertas = useMemo(() => conversas.filter((c) => c.status !== 'resolvida'), [conversas])
    // só dá para saber quem espera quando o webhook registrou quem falou por último
    const semDados = abertas.length > 0 && abertas.every((c) => c.ultimaMinha === null)
    const esperando = useMemo(() => calcularEspera(conversas, agora), [conversas, agora])
    const semAtendente = useMemo(() => abertas.filter((c) => !c.atendenteEmail), [abertas])
    const minhas = useMemo(
        () => abertas.filter((c) => String(c.atendenteEmail || '').toLowerCase() === String(usuarioEmail || '').toLowerCase()),
        [abertas, usuarioEmail],
    )

    const listas = {
        esperando: semDados ? [] : esperando,
        'sem-atendente': semAtendente,
        minhas,
    }
    const contagens = {
        esperando: semDados ? null : esperando.length,
        'sem-atendente': semAtendente.length,
        minhas: minhas.length,
    }

    // lista já vem filtrada ao escopo (eu/setor); "Sem atendente" = fila do setor
    const categorias = CATEGORIAS

    const maisAntiga = esperando[0]
    const emRisco = esperando.filter((c) => (janelaDaConversa(c, agora)?.restanteMs ?? 0) <= RISCO_MS).length
    const lista = listas[categoria] || []
    const meta = CATEGORIAS.find((c) => c.id === categoria)

    return (
        <section className="fila-painel" aria-labelledby="fila-titulo">
            <header className="fila-topo">
                <div>
                    <h2 id="fila-titulo">Esperando resposta</h2>
                    <p className="fila-achado">
                        {maisAntiga
                            ? `A mais antiga espera ${tempoDesde(maisAntiga.ultimaEm, agora)}${emRisco ? ` · ${emRisco} com a janela de 24h perto de fechar` : ''}.`
                            : semDados
                              ? 'Ainda não há registro de quem falou por último. Configure o webhook da WATI para ver a espera.'
                              : `Ninguém esperando resposta no ${CANAIS[canal].rotulo} agora.`}
                    </p>
                </div>
                {maisAntiga ? (
                    <button className="botao botao-primario" onClick={() => aoAbrir(maisAntiga)}>
                        Abrir a mais antiga
                    </button>
                ) : null}
            </header>

            <div className="fila-numeros" role="tablist" aria-label="Classificação das conversas">
                {categorias.map((cat) => {
                    const ativa = categoria === cat.id
                    const qtd = contagens[cat.id]
                    return (
                        <button
                            key={cat.id}
                            type="button"
                            role="tab"
                            aria-selected={ativa}
                            className={`fila-numero ${cat.lider ? 'lider' : ''} ${ativa ? 'ativo' : ''}`}
                            onClick={() => setCategoria(cat.id)}
                            title={cat.ajuda}
                        >
                            <span className="fila-numero-rotulo">{cat.rotulo}</span>
                            <span className="num fila-numero-valor">{qtd == null ? '—' : qtd}</span>
                        </button>
                    )
                })}
            </div>

            <div className="fila-lista-bloco" role="tabpanel" aria-label={meta?.rotulo}>
                <header className="fila-lista-topo">
                    <h3>{meta?.rotulo}</h3>
                    <p>{meta?.ajuda}</p>
                </header>

                {lista.length === 0 ? (
                    <p className="fila-lista-vazia">
                        {categoria === 'esperando' && semDados
                            ? 'Sem dados de espera ainda — configure o webhook da WATI.'
                            : `Nenhuma conversa nesta classificação no ${CANAIS[canal].rotulo}.`}
                    </p>
                ) : (
                    <ul className="fila-lista">
                        {lista.map((c) => {
                            const janela = c.ultimaEm ? janelaDaConversa(c, agora) : null
                            const risco = janela && !janela.fechada && janela.restanteMs <= RISCO_MS
                            const fone = formatarTelefone(c.waId)
                            return (
                                <li key={c.waId}>
                                    <button type="button" className="fila-contato" onClick={() => aoAbrir(c)}>
                                        <Avatar conversa={c} tamanho={40} />
                                        <span className="fila-contato-corpo">
                                            <span className="fila-contato-linha">
                                                <span className="fila-contato-nome">{nomeExibicao(c)}</span>
                                                <ContatoMetaPills tipo={c.atributos?.tipo} cidade={c.atributos?.cidade} anuncio={c.anuncio} />
                                            </span>
                                            <span className="fila-contato-meta">
                                                {fone ? <span>{fone}</span> : null}
                                                {categoria === 'esperando' && c.ultimaEm ? (
                                                    <span className={risco ? 'fila-risco' : ''}>
                                                        espera {tempoDesde(c.ultimaEm, agora)}
                                                        {risco ? ' · janela em risco' : ''}
                                                    </span>
                                                ) : null}
                                                {categoria === 'sem-atendente' ? (
                                                    <span>
                                                        <Icone nome="pendente" tamanho={12} traco={2.25} /> Na fila
                                                    </span>
                                                ) : null}
                                                {categoria === 'minhas' ? (
                                                    <span>
                                                        <Icone nome="usuario" tamanho={12} traco={2.25} /> Você
                                                        {c.ultimaMinha === false && c.ultimaEm
                                                            ? ` · espera ${tempoDesde(c.ultimaEm, agora)}`
                                                            : c.ultimaMinha
                                                              ? ' · última mensagem sua'
                                                              : ''}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </section>
    )
}
