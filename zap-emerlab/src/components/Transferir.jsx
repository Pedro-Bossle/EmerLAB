import { useState } from 'react'
import Modal from './Modal.jsx'

export default function Transferir({ conversa, usuario, departamentos, equipe, aoFechar, aoTransferir }) {
    const [departamentoId, setDepartamentoId] = useState(conversa.departamentoId || '')
    const [email, setEmail] = useState(conversa.atendenteEmail || '')

    // atendentes do departamento escolhido (sem departamento: todos)
    const candidatos = equipe.filter((u) => !departamentoId || u.papel === 'admin' || u.departamentos.includes(departamentoId))
    const mudouDepto = departamentoId !== (conversa.departamentoId || '')

    return (
        <Modal titulo="Transferir conversa" aoFechar={aoFechar}>
            <label className="campo">
                <span>Departamento</span>
                <select
                    value={departamentoId}
                    onChange={(e) => {
                        setDepartamentoId(e.target.value)
                        setEmail('')
                    }}
                >
                    <option value="">Sem departamento (triagem)</option>
                    {departamentos.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.nome}
                        </option>
                    ))}
                </select>
            </label>
            <label className="campo">
                <span>Atendente</span>
                <select value={email} onChange={(e) => setEmail(e.target.value)}>
                    <option value="">Ninguém — deixar na fila do departamento</option>
                    {candidatos.map((u) => (
                        <option key={u.email} value={u.email}>
                            {u.nome}
                            {u.email === usuario.email ? ' (você)' : ''}
                        </option>
                    ))}
                </select>
            </label>
            {mudouDepto ? <p className="ajuda">Ao trocar de departamento, a conversa sai do atendente atual e entra na fila do novo departamento.</p> : null}
            <div className="modal-acoes">
                <button className="botao botao-secundario" onClick={aoFechar}>
                    Cancelar
                </button>
                <button className="botao" onClick={() => aoTransferir({ departamentoId, email })}>
                    Transferir
                </button>
            </div>
        </Modal>
    )
}
