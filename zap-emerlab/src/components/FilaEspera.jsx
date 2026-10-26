import { useEffect, useState } from 'react'
import { tempoDesde, janela24h, calcularEspera, CANAIS } from '../util.js'

// a partir de 20h de espera a janela entra em risco (faltam 4h para fechar)
const RISCO_MS = 4 * 3600 * 1000

// Painel mostrado quando nenhuma conversa está aberta: responde "quem está esperando resposta, e há quanto tempo?"
export default function FilaEspera({ conversas, canal, usuarioEmail, aoAbrir }) {
    // relógio próprio para os tempos de espera andarem sem recarregar a lista
    const [agora, setAgora] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setAgora(Date.now()), 30000)
        return () => clearInterval(id)
    }, [])

    const abertas = conversas.filter((c) => c.status !== 'resolvida')
    // só dá para saber quem espera quando o webhook registrou quem falou por último
    const semDados = abertas.length > 0 && abertas.every((c) => c.ultimaMinha === null)
    const esperando = calcularEspera(conversas, agora)
    const semAtendente = abertas.filter((c) => !c.atendenteEmail).length
    const minhas = abertas.filter((c) => c.atendenteEmail === usuarioEmail).length
    const maisAntiga = esperando[0]
    const emRisco = esperando.filter((c) => janela24h(c.ultimaEm, agora).restanteMs <= RISCO_MS).length

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

            <dl className="fila-numeros">
                <div className="fila-numero lider">
                    <dt>Esperando</dt>
                    <dd className="num">{semDados ? '—' : esperando.length}</dd>
                </div>
                <div className="fila-numero">
                    <dt>Sem atendente</dt>
                    <dd className="num">{semAtendente}</dd>
                </div>
                <div className="fila-numero">
                    <dt>Atribuídas a você</dt>
                    <dd className="num">{minhas}</dd>
                </div>
            </dl>
        </section>
    )
}
