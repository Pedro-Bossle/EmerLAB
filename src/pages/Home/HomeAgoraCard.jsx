import React from 'react'
import { formatarPrazoTarefa, tarefaAtrasada } from '../../lib/homeTarefas.js'

/** «Agora»: a tarefa que pede atenção primeiro (atrasada ou de prazo mais próximo). */
export default function HomeAgoraCard({ tarefa, carregando, onAbrir, onNova }) {
    const atrasada = tarefa ? tarefaAtrasada(tarefa) : false
    return (
        <section className="home_dash_agora" aria-label="Agora">
            <span className="home_dash_agora_lab">Agora</span>
            {carregando && !tarefa ? (
                <p className="home_dash_agora_txt">Carregando…</p>
            ) : tarefa ? (
                <>
                    <h2 className="home_dash_agora_titulo" title={tarefa.titulo}>
                        {tarefa.titulo}
                    </h2>
                    <p className="home_dash_agora_txt">
                        <span className={`home_dash_agora_prazo${atrasada ? ' is-atrasada' : ''}`}>
                            {atrasada ? 'Atrasada · ' : ''}
                            {formatarPrazoTarefa(tarefa.prazo, tarefa.horario)}
                        </span>
                        {tarefa.criadoPor !== tarefa.atribuidoA && tarefa.criadorNome && tarefa.criadorNome !== '—'
                            ? ` · de ${tarefa.criadorNome}`
                            : ''}
                    </p>
                    {String(tarefa.observacoes || '').trim() ? (
                        <p className="home_dash_agora_desc">{tarefa.observacoes}</p>
                    ) : null}
                    <div className="home_dash_agora_acoes">
                        <button type="button" className="home_dash_agora_btn is-primary" onClick={() => onAbrir?.(tarefa)}>
                            Abrir tarefa
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <h2 className="home_dash_agora_titulo">Nada urgente</h2>
                    <p className="home_dash_agora_txt">Você não tem tarefas em aberto.</p>
                    <div className="home_dash_agora_acoes">
                        <button type="button" className="home_dash_agora_btn is-primary" onClick={onNova}>
                            Nova tarefa
                        </button>
                    </div>
                </>
            )}
        </section>
    )
}
