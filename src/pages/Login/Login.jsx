import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { registrarEventoAuthAuditoria } from '../../lib/auditoriaLogs.js'
import { Button, Input } from '../../components/ui'
import { carregarSessaoEPerfilAcesso } from '../../lib/authSession'
import {
  destinoAlterarSenhaAposRecuperacao,
  isPasswordRecoveryPending,
  urlIndicaRecuperacaoSenha,
  markPasswordRecoveryPending,
  waitForAuthBootstrap,
} from '../../lib/passwordRecovery'

const DARK_MODE_KEY = 'emerlab-dark-mode'

function aplicarTemaSalvoNoBody() {
  if (typeof window === 'undefined') return
  const ativo = window.localStorage.getItem(DARK_MODE_KEY) === '1'
  document.body.classList.toggle('dark-mode', ativo)
}

function destinoPosLogin(nextRaw) {
  const next = String(nextRaw || '').trim()
  if (!next.startsWith('/') || next.startsWith('//')) return '/home'
  return next
}

const IconEye = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
  </svg>
)

const IconEyeOff = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 3l18 18M10.5 10.6a3 3 0 0 0 4.1 4.3M9.4 5.4A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.6M6.2 6.4C3.9 8 2.5 12 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const Login = () => {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')
  const [modoRecuperacao, setModoRecuperacao] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const destino = destinoPosLogin(searchParams.get('next'))

  useEffect(() => {
    aplicarTemaSalvoNoBody()
    const prev = document.title
    document.title = 'EmerLAB'
    return () => {
      document.title = prev
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('senhaRedefinida') === '1') {
      setInfoMsg('Senha redefinida. Entre com o e-mail e a nova senha.')
    } else if (searchParams.get('erro') === 'link-senha') {
      setErrorMsg('Link de redefinição inválido ou expirado. Peça um novo em «Esqueci a senha».')
    }
  }, [searchParams])

  useEffect(() => {
    if (urlIndicaRecuperacaoSenha()) markPasswordRecoveryPending('url')
    let ativo = true
    void (async () => {
      try {
        // Evita correr para /home antes do Supabase processar o link do e-mail.
        await waitForAuthBootstrap(supabase)
        if (!ativo) return
        if (urlIndicaRecuperacaoSenha()) markPasswordRecoveryPending('url')

        // Acabou de redefinir: não auto-entrar mesmo que reste sessão residual.
        if (searchParams.get('senhaRedefinida') === '1') return

        const { session, profile } = await carregarSessaoEPerfilAcesso()
        if (!ativo || !session?.user?.id) return

        const precisaTrocarSenha =
          Boolean(profile?.forcePasswordChange) || isPasswordRecoveryPending()
        if (precisaTrocarSenha) {
          navigate(destinoAlterarSenhaAposRecuperacao(destino), { replace: true })
          return
        }
        navigate(destino, { replace: true })
      } catch {
        /* fica no login */
      }
    })()
    return () => {
      ativo = false
    }
  }, [destino, navigate, searchParams])

  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setLoading(false)
      const msg = String(error.message || '').toLowerCase()
      if (msg.includes('rate') || msg.includes('too many') || error.status === 429) {
        setErrorMsg('Demasiadas tentativas de login. Aguarde alguns minutos e tente de novo.')
      } else {
        setErrorMsg('Email ou senha inválidos.')
      }
      return
    }

    void registrarEventoAuthAuditoria('LOGIN')

    try {
      const { profile } = await carregarSessaoEPerfilAcesso()
      setLoading(false)
      if (profile?.forcePasswordChange || isPasswordRecoveryPending()) {
        navigate(destinoAlterarSenhaAposRecuperacao(destino))
        return
      }
      navigate(destino)
    } catch {
      setLoading(false)
      navigate(destino)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')
    const emailTrim = String(email || '').trim().toLowerCase()
    if (!emailTrim.includes('@')) {
      setErrorMsg('Informe o e-mail da conta para enviar o link de recuperação.')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'forgotPassword',
          email: emailTrim,
          redirectTo: `${window.location.origin}/alterar-senha?from=recovery`,
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (resp.status === 429) {
        setErrorMsg(
          json?.error ||
            'Demasiados pedidos de recuperação. Aguarde alguns minutos e tente de novo.',
        )
        return
      }
      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || 'Não foi possível enviar o e-mail de recuperação.')
      }
      setInfoMsg(
        json?.message ||
          'Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Verifique a caixa de entrada e o spam.',
      )
      setModoRecuperacao(false)
    } catch (err) {
      setErrorMsg(err?.message || 'Não foi possível enviar o e-mail de recuperação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(1200px_700px_at_12%_-10%,#cfe8f8_0%,transparent_55%),radial-gradient(900px_600px_at_100%_0%,#d9eef7_0%,transparent_50%),linear-gradient(165deg,#eef6fb_0%,#f7fbfd_42%,#e8f2f8_100%)] p-6 dark:bg-[radial-gradient(1000px_640px_at_10%_-8%,#1a3a52_0%,transparent_55%),linear-gradient(165deg,#0d1520_0%,#121c2a_45%,#0f1a26_100%)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(20,32,51,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(20,32,51,0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,#000_20%,transparent_75%)]"
        aria-hidden
      />
      <p
        className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 font-display text-[clamp(8rem,28vw,16rem)] font-extrabold leading-none tracking-tighter text-ink/[0.05] dark:text-white/[0.04]"
        aria-hidden
      >
        LAB
      </p>

      <div className="el-stage relative z-10 w-full max-w-md animate-[fadeRise_0.7s_cubic-bezier(0.22,1,0.36,1)_both]">
        <p className="mb-4 font-display text-[clamp(1.85rem,4.5vw,2.5rem)] font-extrabold leading-none tracking-tight text-ink dark:text-[#e8f1f8]">
          EmerLAB
        </p>
        <h1 className="mb-2 font-sans text-xl font-extrabold tracking-tight text-[#123e59] dark:text-[#e8f1f8]">
          {modoRecuperacao ? 'Recuperar senha' : 'Bem-vindo de volta'}
        </h1>
        <p className="mb-6 max-w-[34ch] text-[0.95rem] font-medium leading-relaxed text-ink-soft dark:text-[#9eb4c8]">
          {modoRecuperacao
            ? 'Informe o e-mail da conta. Se estiver cadastrado, enviaremos um link para redefinir a senha.'
            : 'Entre com sua conta para continuar no Livro de Apoio Base.'}
        </p>

        <form
          className="flex flex-col gap-4"
          onSubmit={modoRecuperacao ? handleForgotPassword : handleLogin}
          noValidate
        >
          <Input
            label="Email"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            autoFocus
          />

          {!modoRecuperacao ? (
            <div className="relative">
              <Input
                label="Senha"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="[&_input]:pr-12"
              />
              <button
                type="button"
                className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5 dark:text-[#9eb4c8]"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          ) : null}

          {errorMsg ? (
            <p
              className="rounded-xl border border-status-erro/20 bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro"
              role="alert"
            >
              {errorMsg}
            </p>
          ) : null}

          {infoMsg ? (
            <p
              className="rounded-xl border border-[#2F87C6]/25 bg-[#E7F4FC] px-3 py-2 text-sm font-semibold text-[#1E3148] dark:border-[#2F87C6]/35 dark:bg-[#1a334d] dark:text-[#9fd4ff]"
              role="status"
            >
              {infoMsg}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="text-sm font-semibold text-[#2F87C6] underline-offset-2 hover:underline dark:text-[#7fc0f0]"
              onClick={() => {
                setErrorMsg('')
                setInfoMsg('')
                setModoRecuperacao((v) => !v)
              }}
            >
              {modoRecuperacao ? 'Voltar ao login' : 'Esqueci minha senha'}
            </button>
          </div>

          <Button type="submit" className="mt-1 w-full" disabled={loading}>
            {loading
              ? modoRecuperacao
                ? 'Enviando…'
                : 'Entrando…'
              : modoRecuperacao
                ? 'Enviar link de recuperação'
                : 'Entrar'}
          </Button>
        </form>
      </div>

      <style>{`
        @keyframes fadeRise {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  )
}

export default Login
