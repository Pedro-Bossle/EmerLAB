import { useState } from 'react'
import { api } from '../api.js'
import { ler, gravar } from '../util.js'
import Icone from './Icone.jsx'

export default function Login({ aviso, aoEntrar }) {
    const [tenantId, setTenantId] = useState(() => ler('zap.tenant', ''))
    const [email, setEmail] = useState(() => ler('zap.email', ''))
    const [senha, setSenha] = useState('')
    const [mostrarSenha, setMostrarSenha] = useState(false)
    const [erro, setErro] = useState('')
    const [enviando, setEnviando] = useState(false)

    const entrar = async (e) => {
        e.preventDefault()
        setErro('')
        setEnviando(true)
        try {
            await api('auth/login', { method: 'POST', body: { tenantId: tenantId.trim(), email: email.trim(), senha } })
            gravar('zap.tenant', tenantId.trim())
            gravar('zap.email', email.trim())
            await aoEntrar()
        } catch (e2) {
            setErro(e2.message)
            setEnviando(false)
        }
    }

    return (
        <div className="login">
            <div className="login-faixa" />
            <form className="login-cartao" onSubmit={entrar}>
                <div className="login-marca">
                    <img src="/favicon.svg" alt="" width="44" height="44" />
                    <div>
                        <h1>zap.emerlab</h1>
                        <p>Atendimento WhatsApp via WATI</p>
                    </div>
                </div>

                {aviso ? <div className="alerta">{aviso}</div> : null}

                <label className="campo">
                    <span>ID da conta WATI</span>
                    <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="ex.: 123456" autoComplete="organization" required />
                </label>
                <label className="campo">
                    <span>E-mail</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" autoComplete="username" required />
                </label>
                <label className="campo">
                    <span>Senha</span>
                    <div className="campo-senha">
                        <input
                            type={mostrarSenha ? 'text' : 'password'}
                            value={senha}
                            onChange={(e) => setSenha(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                        <button
                            type="button"
                            className="icone-botao mini campo-senha-toggle"
                            aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                            aria-pressed={mostrarSenha}
                            onClick={() => setMostrarSenha((v) => !v)}
                        >
                            <Icone nome={mostrarSenha ? 'olhoFechado' : 'olho'} tamanho={18} />
                        </button>
                    </div>
                </label>

                {erro ? <div className="alerta alerta-erro">{erro}</div> : null}

                <button className="botao botao-largo" disabled={enviando}>
                    {enviando ? 'Entrando…' : 'Entrar'}
                </button>
                <p className="login-rodape">O ID é o número do workspace que aparece no endpoint da API da WATI.</p>
            </form>
        </div>
    )
}
