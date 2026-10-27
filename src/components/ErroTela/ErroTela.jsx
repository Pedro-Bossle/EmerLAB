import { Component } from 'react'
import { buttonClassName } from '../ui'

/**
 * Rede de segurança da interface: um erro numa tela mostra esta mensagem em vez de deixar a página em branco.
 * (Erro de arquivo antigo depois de deploy é tratado antes, em main.jsx, recarregando a página.)
 */
export default class ErroTela extends Component {
  constructor(props) {
    super(props)
    this.state = { erro: null }
  }

  static getDerivedStateFromError(erro) {
    return { erro }
  }

  componentDidCatch(erro, info) {
    console.error('[EmerLAB] erro na tela:', erro, info?.componentStack)
  }

  render() {
    if (!this.state.erro) return this.props.children
    return (
      <main
        role="alert"
        className="flex min-h-dvh items-center justify-center bg-[linear-gradient(165deg,#eef6fb_0%,#f7fbfd_42%,#e8f2f8_100%)] p-6 dark:bg-[linear-gradient(165deg,#0d1520_0%,#121c2a_45%,#0f1a26_100%)]"
      >
        <div className="w-full max-w-lg">
          <p className="mb-4 font-display text-[clamp(2rem,5.5vw,2.85rem)] font-extrabold leading-none tracking-tight text-ink dark:text-[#e8f1f8]">
            EmerLAB
          </p>
          <h1 className="mb-2 font-display text-xl font-bold text-ink dark:text-[#e8f1f8]">Esta tela encontrou um erro</h1>
          <p className="mb-6 max-w-[42ch] text-sm font-medium text-ink-soft dark:text-[#9eb4c8]">
            O que você já salvou está guardado. Recarregue a página para tentar de novo; se o erro continuar, avise o
            suporte com o que estava fazendo.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => window.location.reload()} className={buttonClassName({ className: 'w-full sm:w-auto' })}>
              Recarregar a página
            </button>
            <a href="/home" className={buttonClassName({ variant: 'secondary', className: 'w-full sm:w-auto' })}>
              Ir para a Home
            </a>
          </div>
        </div>
      </main>
    )
  }
}
