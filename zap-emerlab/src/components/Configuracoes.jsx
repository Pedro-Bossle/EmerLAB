import { useState } from 'react'
import { api } from '../api.js'
import { DESTAQUES } from '../tema.js'
import Modal from './Modal.jsx'
import Instrucoes from './Instrucoes.jsx'

function Segmentado({ valor, opcoes, aoMudar, rotulo }) {
    return (
        <div className="segmentado" role="radiogroup" aria-label={rotulo}>
            {opcoes.map(([v, r]) => (
                <button key={v} role="radio" aria-checked={valor === v} className={valor === v ? 'ativo' : ''} onClick={() => aoMudar(v)}>
                    {r}
                </button>
            ))}
        </div>
    )
}

function Alternar({ rotulo, descricao, valor, aoMudar }) {
    return (
        <label className="alternar">
            <div>
                <strong>{rotulo}</strong>
                {descricao ? <small>{descricao}</small> : null}
            </div>
            <input type="checkbox" checked={valor} onChange={(e) => aoMudar(e.target.checked)} />
            <span className="alternar-trilho" aria-hidden="true" />
        </label>
    )
}

export default function Configuracoes({ usuario, prefs, setPrefs, aoFechar, avisar }) {
    const [aba, setAba] = useState('aparencia')
    const [senhas, setSenhas] = useState({ atual: '', nova: '', confirmar: '' })
    const [salvando, setSalvando] = useState(false)

    const trocarSenha = async (e) => {
        e.preventDefault()
        if (senhas.nova !== senhas.confirmar) return avisar('As senhas não conferem.', 'erro')
        setSalvando(true)
        try {
            await api('auth/senha', { method: 'POST', body: { atual: senhas.atual, nova: senhas.nova } })
            setSenhas({ atual: '', nova: '', confirmar: '' })
            avisar('Senha alterada.')
        } catch (e2) {
            avisar(e2.message, 'erro')
        } finally {
            setSalvando(false)
        }
    }

    const alternarNotificacoes = async (ligar) => {
        if (ligar && 'Notification' in window && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission()
            if (p !== 'granted') return avisar('O navegador bloqueou as notificações.', 'aviso')
        }
        setPrefs({ notificacoes: ligar })
    }

    return (
        <Modal titulo="Configurações" aoFechar={aoFechar}>
            <div className="abas">
                <button className={aba === 'aparencia' ? 'ativo' : ''} onClick={() => setAba('aparencia')}>
                    Aparência
                </button>
                <button className={aba === 'conversas' ? 'ativo' : ''} onClick={() => setAba('conversas')}>
                    Conversas
                </button>
                <button className={aba === 'conta' ? 'ativo' : ''} onClick={() => setAba('conta')}>
                    Conta
                </button>
                <button className={aba === 'instrucoes' ? 'ativo' : ''} onClick={() => setAba('instrucoes')}>
                    Instruções de uso
                </button>
            </div>

            {aba === 'aparencia' ? (
                <div className="config-secao">
                    <h3>Tema</h3>
                    <Segmentado
                        rotulo="Tema"
                        valor={prefs.modo}
                        aoMudar={(modo) => setPrefs({ modo })}
                        opcoes={[
                            ['sistema', 'Sistema'],
                            ['claro', 'Claro'],
                            ['escuro', 'Escuro'],
                        ]}
                    />
                    <h3>Cor de destaque</h3>
                    <div className="amostras" role="radiogroup" aria-label="Cor de destaque">
                        {Object.entries(DESTAQUES).map(([k, cor]) => (
                            <button
                                key={k}
                                role="radio"
                                aria-checked={prefs.destaque === k}
                                aria-label={`Destaque ${k}`}
                                data-dica={k[0].toUpperCase() + k.slice(1)}
                                className={`amostra ${prefs.destaque === k ? 'ativo' : ''}`}
                                style={{ background: cor }}
                                onClick={() => setPrefs({ destaque: k })}
                            />
                        ))}
                    </div>
                    <h3>Papel de parede do chat</h3>
                    <Segmentado
                        rotulo="Papel de parede"
                        valor={prefs.fundo}
                        aoMudar={(fundo) => setPrefs({ fundo })}
                        opcoes={[
                            ['padrao', 'Padrão'],
                            ['liso', 'Liso'],
                            ['nenhum', 'Neutro'],
                        ]}
                    />
                    <h3>Tamanho do texto</h3>
                    <Segmentado
                        rotulo="Tamanho do texto"
                        valor={prefs.fonte}
                        aoMudar={(fonte) => setPrefs({ fonte })}
                        opcoes={[
                            ['pequena', 'Pequeno'],
                            ['normal', 'Normal'],
                            ['grande', 'Grande'],
                        ]}
                    />
                </div>
            ) : null}

            {aba === 'conversas' ? (
                <div className="config-secao">
                    <Alternar
                        rotulo="Enter envia a mensagem"
                        descricao="Desligado: use Ctrl+Enter para enviar e Enter para quebrar linha."
                        valor={prefs.enterEnvia}
                        aoMudar={(v) => setPrefs({ enterEnvia: v })}
                    />
                    <Alternar
                        rotulo="Identificar o atendente nas mensagens"
                        descricao={`Começa cada mensagem com "Atendente ${usuario.nome}" em negrito e uma quebra de linha.`}
                        valor={prefs.identificarAtendente}
                        aoMudar={(v) => setPrefs({ identificarAtendente: v })}
                    />
                    <Alternar rotulo="Som de nova mensagem" valor={prefs.som} aoMudar={(v) => setPrefs({ som: v })} />
                    <Alternar
                        rotulo="Notificações da área de trabalho"
                        descricao="Avisa quando chegar mensagem com a aba em segundo plano."
                        valor={prefs.notificacoes}
                        aoMudar={alternarNotificacoes}
                    />
                </div>
            ) : null}

            {aba === 'instrucoes' ? <Instrucoes /> : null}

            {aba === 'conta' ? (
                <div className="config-secao">
                    <p className="conta-info">
                        <strong>{usuario.nome}</strong>
                        <span>{usuario.email}</span>
                        <small>{usuario.papel === 'admin' ? 'Administrador' : 'Atendente'}</small>
                    </p>
                    <form onSubmit={trocarSenha}>
                        <h3>Trocar senha</h3>
                        <label className="campo">
                            <span>Senha atual</span>
                            <input type="password" value={senhas.atual} onChange={(e) => setSenhas((s) => ({ ...s, atual: e.target.value }))} autoComplete="current-password" required />
                        </label>
                        <label className="campo">
                            <span>Nova senha (mín. 8)</span>
                            <input type="password" value={senhas.nova} onChange={(e) => setSenhas((s) => ({ ...s, nova: e.target.value }))} autoComplete="new-password" minLength={8} required />
                        </label>
                        <label className="campo">
                            <span>Confirmar nova senha</span>
                            <input type="password" value={senhas.confirmar} onChange={(e) => setSenhas((s) => ({ ...s, confirmar: e.target.value }))} autoComplete="new-password" required />
                        </label>
                        <div className="modal-acoes">
                            <button className="botao" disabled={salvando}>
                                {salvando ? 'Salvando…' : 'Salvar nova senha'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </Modal>
    )
}
