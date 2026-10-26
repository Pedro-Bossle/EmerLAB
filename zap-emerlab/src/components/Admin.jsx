import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Modal from './Modal.jsx'
import Icone from './Icone.jsx'

const USUARIO_VAZIO = { nome: '', email: '', senha: '', papel: 'atendente', ativo: true, departamentos: [] }
const DEPTO_VAZIO = { nome: '', cor: '#25d366', equipeWati: '' }
const RESPOSTA_VAZIA = { atalho: '', titulo: '', texto: '', departamentoId: '' }

function Usuarios({ departamentos, avisar }) {
    const [lista, setLista] = useState(null)
    const [form, setForm] = useState(null)

    const carregar = useCallback(() => {
        api('usuarios')
            .then((r) => setLista(r.usuarios))
            .catch((e) => avisar(e.message, 'erro'))
    }, [avisar])
    useEffect(carregar, [carregar])

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            if (id) await api(`usuarios/${id}`, { method: 'PUT', body: { ...corpo, senha: corpo.senha || undefined } })
            else await api('usuarios', { method: 'POST', body: corpo })
            avisar('Usuário salvo.')
            setForm(null)
            carregar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const remover = async (u) => {
        if (!confirm(`Remover ${u.nome}? Esta ação não pode ser desfeita.`)) return
        try {
            await api(`usuarios/${u.id}`, { method: 'DELETE' })
            carregar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const alternarDepto = (id) =>
        setForm((f) => ({ ...f, departamentos: f.departamentos.includes(id) ? f.departamentos.filter((d) => d !== id) : [...f.departamentos, id] }))

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Nome</span>
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
                </label>
                <label className="campo">
                    <span>E-mail (o mesmo do operador na WATI)</span>
                    <input type="email" value={form.email} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </label>
                <label className="campo">
                    <span>{form.id ? 'Nova senha (deixe vazio para manter)' : 'Senha (mín. 8)'}</span>
                    <input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} minLength={8} required={!form.id} autoComplete="new-password" />
                </label>
                <label className="campo">
                    <span>Papel</span>
                    <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                        <option value="atendente">Atendente — vê só os próprios departamentos</option>
                        <option value="admin">Administrador — vê tudo e gerencia o painel</option>
                    </select>
                </label>
                <fieldset className="campo">
                    <span>Departamentos</span>
                    {departamentos.length === 0 ? <small className="ajuda">Cadastre departamentos na aba Departamentos.</small> : null}
                    <div className="checks">
                        {departamentos.map((d) => (
                            <label key={d.id} className="check">
                                <input type="checkbox" checked={form.departamentos.includes(d.id)} onChange={() => alternarDepto(d.id)} />
                                <span className="tag" style={{ '--tag': d.cor }}>
                                    {d.nome}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <label className="check">
                    <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
                </label>
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao">Salvar</button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...USUARIO_VAZIO })}>
                <Icone nome="mais" tamanho={18} /> Novo usuário
            </button>
            {lista === null ? <div className="spinner spinner-centro" /> : null}
            <ul className="tabela">
                {(lista || []).map((u) => (
                    <li key={u.id} className={u.ativo ? '' : 'inativo'}>
                        <div className="tabela-principal">
                            <strong>{u.nome}</strong>
                            <small>
                                {u.email} · {u.papel === 'admin' ? 'Admin' : 'Atendente'}
                                {u.fixo ? ' · definido no .env' : ''}
                                {!u.ativo ? ' · inativo' : ''}
                            </small>
                            <div className="item-tags">
                                {u.departamentos.map((id) => {
                                    const d = departamentos.find((x) => x.id === id)
                                    return d ? (
                                        <span key={id} className="tag" style={{ '--tag': d.cor }}>
                                            {d.nome}
                                        </span>
                                    ) : null
                                })}
                            </div>
                        </div>
                        {!u.fixo ? (
                            <div className="tabela-acoes">
                                <button className="icone-botao" title="Editar" onClick={() => setForm({ ...u, senha: '' })}>
                                    <Icone nome="editar" tamanho={20} />
                                </button>
                                <button className="icone-botao perigo" title="Remover" onClick={() => remover(u)}>
                                    <Icone nome="lixo" tamanho={20} />
                                </button>
                            </div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </>
    )
}

function Departamentos({ departamentos, aoMudar, avisar }) {
    const [form, setForm] = useState(null)

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            await api(id ? `departamentos/${id}` : 'departamentos', { method: id ? 'PUT' : 'POST', body: corpo })
            setForm(null)
            aoMudar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const remover = async (d) => {
        if (!confirm(`Remover o departamento ${d.nome}? As conversas dele voltam para "sem departamento".`)) return
        try {
            await api(`departamentos/${d.id}`, { method: 'DELETE' })
            aoMudar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Nome</span>
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex.: Comercial, Suporte, Financeiro" required />
                </label>
                <label className="campo">
                    <span>Cor</span>
                    <input type="color" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
                </label>
                <label className="campo">
                    <span>Equipe correspondente na WATI (opcional)</span>
                    <input value={form.equipeWati} onChange={(e) => setForm({ ...form, equipeWati: e.target.value })} placeholder="Nome exato do team na WATI" />
                    <small className="ajuda">Se preenchido, transferir para este departamento também atribui a equipe na WATI (plano Pro).</small>
                </label>
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao">Salvar</button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...DEPTO_VAZIO })}>
                <Icone nome="mais" tamanho={18} /> Novo departamento
            </button>
            <ul className="tabela">
                {departamentos.length === 0 ? <p className="lista-vazia">Nenhum departamento ainda.</p> : null}
                {departamentos.map((d) => (
                    <li key={d.id}>
                        <div className="tabela-principal">
                            <span className="tag" style={{ '--tag': d.cor }}>
                                {d.nome}
                            </span>
                            {d.equipe_wati ? <small>Equipe WATI: {d.equipe_wati}</small> : null}
                        </div>
                        <div className="tabela-acoes">
                            <button className="icone-botao" title="Editar" onClick={() => setForm({ id: d.id, nome: d.nome, cor: d.cor, equipeWati: d.equipe_wati || '' })}>
                                <Icone nome="editar" tamanho={20} />
                            </button>
                            <button className="icone-botao perigo" title="Remover" onClick={() => remover(d)}>
                                <Icone nome="lixo" tamanho={20} />
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    )
}

function Respostas({ departamentos, aoMudar, avisar }) {
    const [lista, setLista] = useState(null)
    const [form, setForm] = useState(null)

    const carregar = useCallback(() => {
        api('respostas')
            .then((r) => setLista(r.respostas))
            .catch((e) => avisar(e.message, 'erro'))
    }, [avisar])
    useEffect(carregar, [carregar])

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            await api(id ? `respostas/${id}` : 'respostas', { method: id ? 'PUT' : 'POST', body: corpo })
            setForm(null)
            carregar()
            aoMudar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const remover = async (r) => {
        if (!confirm(`Remover a resposta /${r.atalho}?`)) return
        try {
            await api(`respostas/${r.id}`, { method: 'DELETE' })
            carregar()
            aoMudar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Atalho (usado como /atalho)</span>
                    <input value={form.atalho} onChange={(e) => setForm({ ...form, atalho: e.target.value })} placeholder="ex.: bomdia" required />
                </label>
                <label className="campo">
                    <span>Título (opcional)</span>
                    <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="ex.: Saudação" />
                </label>
                <label className="campo">
                    <span>Texto</span>
                    <textarea rows={5} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} required />
                    <small className="ajuda">
                        Variáveis: <code>{'{{nome}}'}</code> <code>{'{{primeiro_nome}}'}</code> <code>{'{{atendente}}'}</code> <code>{'{{telefone}}'}</code> · formatação WhatsApp: *negrito* _itálico_ ~tachado~
                    </small>
                </label>
                <label className="campo">
                    <span>Disponível para</span>
                    <select value={form.departamentoId} onChange={(e) => setForm({ ...form, departamentoId: e.target.value })}>
                        <option value="">Todos os departamentos</option>
                        {departamentos.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.nome}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao">Salvar</button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...RESPOSTA_VAZIA })}>
                <Icone nome="mais" tamanho={18} /> Nova resposta rápida
            </button>
            {lista === null ? <div className="spinner spinner-centro" /> : null}
            <ul className="tabela">
                {lista && lista.length === 0 ? <p className="lista-vazia">Nenhuma resposta rápida ainda.</p> : null}
                {(lista || []).map((r) => {
                    const d = departamentos.find((x) => x.id === r.departamento_id)
                    return (
                        <li key={r.id}>
                            <div className="tabela-principal">
                                <strong>
                                    /{r.atalho} {r.titulo ? <small>— {r.titulo}</small> : null}
                                </strong>
                                <small className="texto-limitado">{r.texto}</small>
                                <div className="item-tags">
                                    {d ? (
                                        <span className="tag" style={{ '--tag': d.cor }}>
                                            {d.nome}
                                        </span>
                                    ) : (
                                        <span className="tag tag-neutra">Todos</span>
                                    )}
                                </div>
                            </div>
                            <div className="tabela-acoes">
                                <button
                                    className="icone-botao"
                                    title="Editar"
                                    onClick={() => setForm({ id: r.id, atalho: r.atalho, titulo: r.titulo || '', texto: r.texto, departamentoId: r.departamento_id || '' })}
                                >
                                    <Icone nome="editar" tamanho={20} />
                                </button>
                                <button className="icone-botao perigo" title="Remover" onClick={() => remover(r)}>
                                    <Icone nome="lixo" tamanho={20} />
                                </button>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </>
    )
}

export default function Admin({ departamentos, aoFechar, aoMudar, avisar }) {
    const [aba, setAba] = useState('usuarios')
    return (
        <Modal titulo="Administração" aoFechar={aoFechar} largo>
            <div className="abas">
                <button className={aba === 'usuarios' ? 'ativo' : ''} onClick={() => setAba('usuarios')}>
                    Usuários
                </button>
                <button className={aba === 'departamentos' ? 'ativo' : ''} onClick={() => setAba('departamentos')}>
                    Departamentos
                </button>
                <button className={aba === 'respostas' ? 'ativo' : ''} onClick={() => setAba('respostas')}>
                    Respostas rápidas
                </button>
            </div>
            {aba === 'usuarios' ? <Usuarios departamentos={departamentos} avisar={avisar} /> : null}
            {aba === 'departamentos' ? <Departamentos departamentos={departamentos} aoMudar={aoMudar} avisar={avisar} /> : null}
            {aba === 'respostas' ? <Respostas departamentos={departamentos} aoMudar={aoMudar} avisar={avisar} /> : null}
        </Modal>
    )
}
