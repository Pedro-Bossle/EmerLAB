import { useCallback, useEffect, useState } from 'react'
import { api, registrarAoExpirar } from './api.js'
import { usePreferencias } from './tema.js'
import Login from './components/Login.jsx'
import Painel from './components/Painel.jsx'

export default function App() {
    const [prefs, setPrefs] = usePreferencias()
    const [estado, setEstado] = useState({ fase: 'carregando' })

    const carregarSessao = useCallback(async () => {
        try {
            const status = await api('status')
            if (!status.configurado) return setEstado({ fase: 'config', faltando: status.faltando })
            const sessao = await api('auth/me')
            setEstado({ fase: 'painel', sessao })
        } catch (e) {
            setEstado(e.status === 401 ? { fase: 'login' } : { fase: 'erro', erro: e.message })
        }
    }, [])

    useEffect(() => {
        registrarAoExpirar(() => setEstado({ fase: 'login', aviso: 'Sua sessão expirou. Entre novamente.' }))
        queueMicrotask(carregarSessao)
    }, [carregarSessao])

    const sair = async () => {
        await api('auth/logout', { method: 'POST' }).catch(() => {})
        setEstado({ fase: 'login' })
    }

    if (estado.fase === 'carregando') {
        return (
            <div className="tela-centro">
                <div className="spinner" aria-label="Carregando" />
            </div>
        )
    }

    if (estado.fase === 'config') {
        return (
            <div className="tela-centro">
                <div className="cartao">
                    <h1>Configuração pendente</h1>
                    <p>Preencha estas variáveis no seu <code>.env.local</code> (modelo em <code>zap-emerlab/.env.example</code>) e reinicie o servidor:</p>
                    <ul className="lista-faltando">
                        {estado.faltando.map((f) => (
                            <li key={f}>
                                <code>{f}</code>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )
    }

    if (estado.fase === 'erro') {
        return (
            <div className="tela-centro">
                <div className="cartao">
                    <h1>Não foi possível abrir o painel</h1>
                    <p>{estado.erro}</p>
                    <button className="botao" onClick={carregarSessao}>
                        Tentar de novo
                    </button>
                </div>
            </div>
        )
    }

    if (estado.fase === 'login') return <Login aviso={estado.aviso} aoEntrar={carregarSessao} />

    return <Painel sessao={estado.sessao} prefs={prefs} setPrefs={setPrefs} aoSair={sair} recarregarSessao={carregarSessao} />
}
