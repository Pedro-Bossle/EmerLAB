import { Link } from 'react-router-dom'
import { Button } from '../../components/ui'

const NotFound = () => {
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(1200px_700px_at_12%_-10%,#cfe8f8_0%,transparent_55%),linear-gradient(165deg,#eef6fb_0%,#f7fbfd_42%,#e8f2f8_100%)] p-6 dark:bg-[linear-gradient(165deg,#0d1520_0%,#121c2a_45%,#0f1a26_100%)]">
      <p
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-[clamp(8rem,28vw,18rem)] font-extrabold leading-none tracking-tighter text-ink/[0.05] dark:text-white/[0.04]"
        aria-hidden
      >
        404
      </p>
      <div className="el-stage relative z-10 w-full max-w-lg">
        <p className="mb-4 font-display text-[clamp(2rem,5.5vw,2.85rem)] font-extrabold leading-none tracking-tight text-ink dark:text-[#e8f1f8]">
          EmerLAB
        </p>
        <h1 className="mb-2 font-display text-xl font-bold text-ink dark:text-[#e8f1f8]">
          Página não encontrada
        </h1>
        <p className="mb-6 max-w-[28ch] text-sm font-medium text-ink-soft dark:text-[#9eb4c8]">
          Este endereço não existe no Livro de Apoio Base — ou foi movido.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/home">
            <Button className="w-full sm:w-auto">Ir para a Home</Button>
          </Link>
          <Link to="/">
            <Button variant="secondary" className="w-full sm:w-auto">
              Voltar ao login
            </Button>
          </Link>
        </div>
      </div>
    </main>
  )
}

export default NotFound
