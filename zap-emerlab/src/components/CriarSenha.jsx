import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { gravar } from '../util.js'

// Tela aberta pelo link do e-mail de convite (?convite=<token>): o usuário cria a própria senha e já entra
export default function CriarSenha({ token, aoEntrar, aoDesistir }) {
    const [convite, setConvite] = useState(null)
    const [erroConvite, setErroConvite] = useState('')
    const [senha, setSenha] = useState('')
    const [confirma, setConfirma] = useState('')
    const [erro, setErro] = useState('')
    const [enviando, setEnviando] = useState(false)

    useEffect(() => {
        api(`auth/convite?token=${encodeURIComponent(token)}`)
            .then(setConvite)
            .catch((e) => setErroConvite(e.message))
    }, [token])

    const criar = async (e) => {
        e.preventDefault()
        if (senha !== confirma) return setErro('As senhas não conferem.')
        setErro('')
        setEnviando(true)
        try {
            const r = await api('auth/convite', { method: 'POST', body: { token, senha } })
            gravar('zap.tenant', r.tenantId)
            gravar('zap.email', r.email)
            await aoEntrar()
        } catch (e2) {
            setErro(e2.message)
            setEnviando(false)
        }
    }

    return (
        <div className="login">
            <form className="login-cartao" onSubmit={criar}>
                <div className="login-marca">
                    <img src="/favicon.svg" alt="" width="44" height="44" />
                    <div>
                        <h1>Emerzap</h1>
                        <p>Crie sua senha de acesso</p>
                    </div>
                </div>

                {erroConvite ? (
                    <>
                        <div className="alerta alerta-erro">{erroConvite}</div>
                        <button type="button" className="botao botao-largo" onClick={aoDesistir}>
                            Ir para o login
                        </button>
                    </>
                ) : !convite ? (
                    <div className="spinner spinner-centro" aria-label="Carregando" />
                ) : (
                    <>
                        <p className="login-boas-vindas">
                            Olá, <strong>{convite.nome.split(' ')[0]}</strong>. Defina a senha que você vai usar para entrar com <strong>{convite.email}</strong>.
                        </p>
                        <input type="email" value={convite.email} autoComplete="username" readOnly hidden />
                        <label className="campo">
                            <span>Nova senha (mín. 8 caracteres)</span>
                            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={8} autoComplete="new-password" autoFocus required />
                        </label>
                        <label className="campo">
                            <span>Repita a senha</span>
                            <input type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} minLength={8} autoComplete="new-password" required />
                        </label>

                        {erro ? <div className="alerta alerta-erro">{erro}</div> : null}

                        <button className="botao botao-largo" disabled={enviando}>
                            {enviando ? 'Salvando…' : 'Criar senha e entrar'}
                        </button>
                    </>
                )}
            </form>
        </div>
    )
}
