import { Component } from 'react'

// Rede de segurança da interface: um erro numa tela mostra esta mensagem em vez de deixar o painel em branco
// no meio do atendimento. (Arquivo antigo depois de deploy é tratado antes, em main.jsx, recarregando.)
export default class ErroTela extends Component {
    constructor(props) {
        super(props)
        this.state = { erro: null }
    }

    static getDerivedStateFromError(erro) {
        return { erro }
    }

    componentDidCatch(erro, info) {
        console.error('[Emerzap] erro na tela:', erro, info?.componentStack)
    }

    render() {
        if (!this.state.erro) return this.props.children
        return (
            <main
                role="alert"
                style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--fundo-app)', color: 'var(--texto)' }}
            >
                <div style={{ maxWidth: 420 }}>
                    <h1 style={{ fontSize: '1.3rem', margin: '0 0 8px' }}>O painel encontrou um erro</h1>
                    <p style={{ margin: '0 0 20px', color: 'var(--texto-2)', lineHeight: 1.45 }}>
                        As conversas e mensagens continuam salvas na WATI. Recarregue para voltar ao atendimento; se o erro
                        se repetir, avise o administrador com o que estava fazendo.
                    </p>
                    <button type="button" className="botao" onClick={() => window.location.reload()}>
                        Recarregar o painel
                    </button>
                </div>
            </main>
        )
    }
}
