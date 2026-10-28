import { useState } from 'react'
import Modal from './Modal.jsx'
import Seletor from './Seletor.jsx'

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
                <Seletor
                    valor={departamentoId}
                    aoMudar={(v) => {
                        setDepartamentoId(v)
                        setEmail('')
                    }}
                    opcoes={[{ valor: '', rotulo: 'Sem departamento (triagem)', cor: null }, ...departamentos.map((d) => ({ valor: d.id, rotulo: d.nome, cor: d.cor }))]}
                />
            </label>
            <label className="campo">
                <span>Atendente</span>
                <Seletor
                    valor={email}
                    aoMudar={setEmail}
                    opcoes={[
                        { valor: '', rotulo: 'Ninguém — deixar na fila do departamento' },
                        ...candidatos.map((u) => ({ valor: u.email, rotulo: `${u.nome}${u.email === usuario.email ? ' (você)' : ''}` })),
                    ]}
                />
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
